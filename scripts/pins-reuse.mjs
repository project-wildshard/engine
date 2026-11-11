// DEV-SPEED DS12: identical pins are cloned, never unpacked again. A full `pins.ts install` unpacks every pinned
// product into out/ and publishes its mounts under public/: about 1.8 GiB and 12-18 s per plan worktree. A second
// tree whose pins are identical needs exactly those bytes, so it takes APFS clones of them (no new blocks) and proves
// every byte by hash before it uses them.
//
//   1. A full install that admits every pin records `out/.pins-manifest.json`: the key below, and the sha256 of every
//      file it wrote under out/<folder>/ and of every mount it published (or found tracked) under public/. Any other
//      install (some slugs, a ring, --from-format) deletes the manifest first, so a manifest only ever describes the
//      exact result of the last full install.
//   2. The key hashes everything that decides those bytes: the pins and asset pins, the installer's own source, and
//      the shardfile validation revision (package.json, the lockfile, so `@wildshard/format`, and the admission code).
//   3. `reusePins` tries this tree first (a rebuild with unchanged pins verifies in place and writes nothing), then
//      every other worktree of the repo, the canonical checkout first, whose manifest carries the same key. From a
//      source it clones each product folder and each untracked mount; a mount this tree tracks in Git is not
//      cloned but must hash the same, as a full install requires.
//   4. Every product folder must hold exactly the manifest's files, all regular, and every file must hash to the
//      manifest. One mismatch and this tree's clones are removed: the caller runs the full install.
//
// So a worktree never holds a product its own pins would not have produced: the bytes are the source's, and their
// hashes are what a full install of the same key wrote. WILDSHARD_PINS_REUSE=0 turns reuse off.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {availableParallelism} from 'node:os';
import {dirname,join,relative,resolve} from 'node:path';
import {Worker} from 'node:worker_threads';
import {clonePaths} from './apfs-clone.mjs';

export const MANIFEST='out/.pins-manifest.json';
const VERSION=1,KEY_VERSION='pins-reuse/1',LEDGER='out/.pins.json';
/** Every tracked file whose bytes decide what a full install writes. A local module `pins.ts` or `bake-loader.mjs`
 * imports is here unless KEY_EXEMPT says why its bytes can't change out/ or public/ (pins-reuse.test.mjs checks). */
export const KEY_SOURCES=Object.freeze(['scripts/pins.ts','scripts/pin-packs.ts','scripts/pin-assets.ts','scripts/pin-format.ts',
 'scripts/bake-loader.mjs','scripts/format-hook.mjs','scripts/shardfile-validation-revision.mjs','scripts/pins-reuse.mjs',
 'test/pins/shardfiles.json','test/pins/assets.json']);
export const KEY_EXEMPT=Object.freeze({
 'scripts/pins-exclude.mjs':'writes Git\'s exclude file only',
 'scripts/apfs-clone.mjs':'clones bytes that are then hashed against the manifest',
 'scripts/slice-inputs.ts':'slice and ring commands only, which delete the manifest',
 'src/cook/game/shardCook.ts':'slice command only',
});

/** @typedef {{version:number,key:string,products:Record<string,Record<string,string>>,mounts:Record<string,string>}} Manifest */

/** The reuse key of `root`'s pins. @param {string} root @param {string} revision the shardfile validation revision */
export function pinsKey(root,revision){
 const hash=createHash('sha256').update(`${KEY_VERSION}\0${revision}\0`);
 for(const path of KEY_SOURCES){
  const file=join(root,path);
  hash.update(`${path}\0`).update(existsSync(file)?readFileSync(file):'absent').update('\0');
 }
 return hash.digest('hex');
}

/** @param {string} root @returns {Manifest|undefined} */
function readManifest(root){
 try{
  const value=JSON.parse(readFileSync(join(root,MANIFEST),'utf8'));
  return value?.version===VERSION&&typeof value.key==='string'&&typeof value.products==='object'&&typeof value.mounts==='object'?value:undefined;
 }catch{return undefined;}
}

/** Forget the last full install: out/ is about to change. @param {string} root */
export function dropManifest(root){rmSync(join(root,MANIFEST),{force:true});}

/** Record a complete full install. Paths are root-relative: products by folder then path inside it, mounts as
 * `public/...`. @param {string} root @param {string} key @param {Manifest['products']} products @param {Manifest['mounts']} mounts */
export function writeManifest(root,key,products,mounts){
 mkdirSync(join(root,'out'),{recursive:true});
 const sorted=(/** @type {Record<string,string>} */ record)=>Object.fromEntries(Object.entries(record).sort(([a],[b])=>a<b?-1:1));
 const value={version:VERSION,key,products:Object.fromEntries(Object.entries(products).sort(([a],[b])=>a<b?-1:1).map(([folder,files])=>[folder,sorted(files)])),mounts:sorted(mounts)};
 const part=join(root,`${MANIFEST}.${process.pid}`);
 writeFileSync(part,`${JSON.stringify(value)}\n`);
 renameSync(part,join(root,MANIFEST));
}

const HASHER=`const {parentPort,workerData}=require('node:worker_threads');const {createHash}=require('node:crypto');const {readFileSync}=require('node:fs');
parentPort.postMessage(workerData.map(path=>{try{return createHash('sha256').update(readFileSync(path)).digest('hex');}catch{return '';}}));`;

/** sha256 of each file, '' for one that can't be read, across worker threads, largest files spread first.
 * @param {readonly {path:string,bytes:number}[]} files @returns {Promise<string[]>} */
export async function hashFiles(files){
 const lanes=Math.max(1,Math.min(8,availableParallelism()-1,Math.ceil(files.length/64)));
 /** @type {{load:number,indices:number[]}[]} */const buckets=Array.from({length:lanes},()=>({load:0,indices:[]}));
 for(const index of files.map((_,at)=>at).sort((a,b)=>(files[b]?.bytes??0)-(files[a]?.bytes??0))){
  const bucket=buckets.reduce((low,next)=>next.load<low.load?next:low);
  bucket.indices.push(index);bucket.load+=(files[index]?.bytes??0)+4096;
 }
 const hashes=new Array(files.length).fill('');
 await Promise.all(buckets.map(bucket=>new Promise((done,fail)=>{
  const worker=new Worker(HASHER,{eval:true,workerData:bucket.indices.map(index=>files[index]?.path)});
  worker.once('message',(/** @type {string[]} */ result)=>{result.forEach((hash,at)=>{hashes[bucket.indices[at]??-1]=hash;});done(undefined);});
  worker.once('error',fail);
  worker.once('exit',code=>{if(code!==0)fail(new Error(`hash worker exited ${String(code)}`));});
 })));
 return hashes;
}

/** Every worktree root of the repo `root` is in, the canonical (main) worktree first. @param {string} root */
function worktreeRoots(root){
 try{
  return execFileSync('git',['worktree','list','--porcelain','-z'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']})
   .split('\0').filter(line=>line.startsWith('worktree ')).map(line=>resolve(line.slice('worktree '.length)));
 }catch{return [];}
}

/** Paths `root` tracks under public/. @param {string} root */
function trackedPublic(root){
 try{return new Set(execFileSync('git',['ls-files','-z','public'],{cwd:root,encoding:'utf8',maxBuffer:1<<28,stdio:['ignore','pipe','ignore']}).split('\0').filter(Boolean));}
 catch{return new Set();}
}

/** Every entry under `directory` as a path relative to it, or undefined if any is neither a file nor a directory.
 * @param {string} directory @returns {Map<string,number>|undefined} path -> bytes */
function regularFiles(directory){
 /** @type {Map<string,number>} */const files=new Map();
 const walk=(/** @type {string} */ folder)=>{
  for(const entry of readdirSync(folder,{withFileTypes:true})){
   const path=join(folder,entry.name);
   if(entry.isDirectory()){walk(path);continue;}
   if(!entry.isFile())return false;
   files.set(relative(directory,path),lstatSync(path).size);
  }
  return true;
 };
 try{return walk(directory)===false?undefined:files;}catch{return undefined;}
}

/** @typedef {{source:string,mode:'in place'|'clone'|'copy',files:number,bytes:number,published:string[],seconds:{clone:number,verify:number}}} Reused */

/**
 * Make `root`'s pinned products and mounts the manifest's, from this tree or another worktree with the same key, and
 * prove every byte. Undefined when no source matches or any byte differs: then the caller runs the full install.
 * @param {string} root @param {string} key @param {{sources?:readonly string[],log?:(line:string)=>void}} [options]
 * @returns {Promise<Reused|undefined>}
 */
export async function reusePins(root,key,{sources,log=()=>{}}={}){
 root=resolve(root);
 const candidates=[root,...(sources??worktreeRoots(root)).map(path=>resolve(path)).filter(path=>path!==root)];
 const tracked=trackedPublic(root);
 for(const source of candidates){
  const manifest=readManifest(source);
  if(manifest===undefined||manifest.key!==key)continue;
  const reused=await reuseFrom(root,source,manifest,tracked,log);
  if(reused!==undefined)return reused;
 }
 return undefined;
}

/** @param {string} root @param {string} source @param {Manifest} manifest @param {Set<string>} tracked
 * @param {(line:string)=>void} log @returns {Promise<Reused|undefined>} */
async function reuseFrom(root,source,manifest,tracked,log){
 const self=source===root,started=performance.now();
 const folders=Object.keys(manifest.products);
 const mounts=Object.keys(manifest.mounts);
 // Only names a full install could have written: a folder name, and public/ paths with no way out of it.
 if(folders.some(folder=>!/^[^/\\]+$/u.test(folder)||folder==='.'||folder==='..')
  ||mounts.some(path=>!path.startsWith('public/')||path.split('/').some(part=>part===''||part==='.'||part==='..'))){
  log(`pins reuse: ${source} has a malformed manifest; skipped`);return undefined;
 }
 const published=mounts.filter(path=>!tracked.has(path));
 /** @type {string[]} */const placed=[];
 let mode=/** @type {Reused['mode']} */('in place');
 if(!self){
  try{
   // The previous install's mounts go, as a full install removes them first; then this tree's copies of the folders.
   try{for(const path of /** @type {{published?:string[]}} */(JSON.parse(readFileSync(join(root,LEDGER),'utf8'))).published??[])if(!tracked.has(path))rmSync(join(root,path),{force:true});}catch{/* No earlier install. */}
   /** @type {[string,string][]} */const pairs=[];
   for(const folder of folders){
    const target=join(root,'out',folder);
    rmSync(target,{recursive:true,force:true});
    pairs.push([join(source,'out',folder),target]);
   }
   for(const path of published){
    rmSync(join(root,path),{force:true});
    mkdirSync(dirname(join(root,path)),{recursive:true});
    pairs.push([join(source,path),join(root,path)]);
   }
   mkdirSync(join(root,'out'),{recursive:true});
   placed.push(...pairs.map(([,target])=>target));
   mode=clonePaths(pairs)==='copy'?'copy':'clone';
  }catch(error){
   for(const path of placed)rmSync(path,{recursive:true,force:true});
   log(`pins reuse: cloning from ${source} failed (${error instanceof Error?error.message:String(error)})`);
   return undefined;
  }
 }
 const cloned=performance.now();
 /** @type {{path:string,bytes:number,hash:string}[]} */const files=[];
 let refusal='';
 for(const folder of folders){
  const want=manifest.products[folder]??{},have=regularFiles(join(root,'out',folder));
  if(have===undefined){refusal=`out/${folder} holds an entry that is not a regular file`;break;}
  const extra=[...have.keys()].find(path=>!Object.hasOwn(want,path)),missing=Object.keys(want).find(path=>!have.has(path));
  if(extra!==undefined||missing!==undefined){refusal=`out/${folder}/${extra??missing} is ${extra===undefined?'missing':'not in the manifest'}`;break;}
  for(const [path,bytes] of have)files.push({path:join(root,'out',folder,path),bytes,hash:want[path]??''});
 }
 if(refusal===''){
  for(const path of mounts){
   let bytes=-1;
   try{const stat=lstatSync(join(root,path));if(stat.isFile())bytes=stat.size;}catch{/* Missing. */}
   if(bytes<0){refusal=`${path} is missing or not a regular file`;break;}
   files.push({path:join(root,path),bytes,hash:manifest.mounts[path]??''});
  }
 }
 if(refusal===''){
  const hashes=await hashFiles(files);
  const wrong=files.findIndex((file,at)=>hashes[at]!==file.hash);
  if(wrong!==-1)refusal=`${relative(root,files[wrong]?.path??'')} does not hash to the manifest`;
 }
 if(refusal!==''){
  for(const path of placed)rmSync(path,{recursive:true,force:true});
  log(`pins reuse: refused ${self?'this tree':source}: ${refusal}`);
  return undefined;
 }
 if(!self)writeManifest(root,manifest.key,manifest.products,manifest.mounts);
 const verified=performance.now();
 return {source,mode,files:files.length,bytes:files.reduce((sum,file)=>sum+file.bytes,0),published,
  seconds:{clone:Number(((cloned-started)/1000).toFixed(2)),verify:Number(((verified-cloned)/1000).toFixed(2))}};
}
