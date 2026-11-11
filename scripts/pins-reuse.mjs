// DEV-SPEED DS12: identical pins are cloned, never unpacked again. A full `pins.ts install` unpacks every pinned
// product into out/ and publishes its mounts under public/: about 1.8 GiB and 12-18 s per plan worktree. A second
// tree whose pins are identical needs exactly those bytes, so it takes APFS clones of them (no new blocks) and proves
// every byte by hash before it uses them.
//
//   1. A full install that admits every pin records `out/.pins-manifest.json`: the key below, and the sha256 of every
//      file it wrote under out/<folder>/ and of every mount it published (or found tracked) under public/. It writes
//      the manifest only if the key, recomputed after the install, still matches the one it started with. Any other
//      install (some slugs, a ring, --from-format) deletes the manifest first, so a manifest only ever describes the
//      exact result of the last full install.
//   2. The key hashes everything that decides those bytes: the pins and asset pins, the installer's own source, and
//      the shardfile validation revision (package.json, the lockfile, so `@wildshard/format`, and the admission code).
//   3. `reusePins` tries this tree first (a rebuild with unchanged pins verifies in place and writes nothing), then
//      every other worktree of the repo, the canonical checkout first, whose manifest carries the same key and whose
//      install lock is free. From a source it clones each product folder and each untracked mount; a mount this tree
//      tracks in Git is not cloned but must hash the same, as a full install requires.
//   4. Every product folder must hold exactly the manifest's files, all regular, none executable, and every file must
//      hash to the manifest; the products' receipts must name exactly this tree's pins. One mismatch and this tree's
//      clones are removed: the caller runs the full install.
//
// Paths: a manifest or ledger path is used only if it is a plain folder name under out/ or a plain path under public/,
// and nothing is deleted or written unless its parent directory resolves, with every link followed, to the same path
// inside this tree: a linked out/, public/ or ancestor is refused. Every install of a tree, full or reused, holds that
// tree's lock (`out/.pins.lock`) from start to finish. WILDSHARD_PINS_REUSE=0 turns reuse off.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {availableParallelism} from 'node:os';
import {dirname,join,relative,resolve,sep} from 'node:path';
import {Worker} from 'node:worker_threads';
import {clonePaths} from './apfs-clone.mjs';
import {pidLock} from './pid-lock.mjs';

export const MANIFEST='out/.pins-manifest.json';
const VERSION=2,KEY_VERSION='pins-reuse/2',LEDGER='out/.pins.json',LOCK='out/.pins.lock',PINS='test/pins/shardfiles.json';
const HEX=/^[a-f0-9]{64}$/u;
/** Every tracked file whose bytes decide what a full install writes. A local module `pins.ts` or `bake-loader.mjs`
 * imports is here unless KEY_EXEMPT says why its bytes can't change out/ or public/ (pins-reuse.test.mjs checks). */
export const KEY_SOURCES=Object.freeze(['scripts/pins.ts','scripts/pin-packs.ts','scripts/pin-assets.ts','scripts/pin-format.ts',
 'scripts/bake-loader.mjs','scripts/format-hook.mjs','scripts/shardfile-validation-revision.mjs','scripts/pins-reuse.mjs',
 PINS,'test/pins/assets.json']);
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

/** A product folder name a full install could have made. @param {string} name */
export const folderName=name=>/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/u.test(name);
/** A relative path with no way out of where it is joined. @param {string} path */
const plainPath=path=>path!==''&&!path.startsWith('/')&&!path.includes('\\')&&!path.includes('\0')&&path.split('/').every(part=>part!==''&&part!=='.'&&part!=='..');
/** A mount path: under public/, plain. @param {string} path */
export const mountPath=path=>path.startsWith('public/')&&plainPath(path);
/** @param {unknown} value @returns {value is Record<string,unknown>} */
const record=value=>typeof value==='object'&&value!==null&&!Array.isArray(value);

/** The manifest of `root`, or undefined if it is missing or not exactly the shape a full install writes.
 * @param {string} root @returns {Manifest|undefined} */
function readManifest(root){
 let value;
 try{value=JSON.parse(readFileSync(join(root,MANIFEST),'utf8'));}catch{return undefined;}
 if(!record(value)||value.version!==VERSION||typeof value.key!=='string'||!HEX.test(value.key)||!record(value.products)||!record(value.mounts))return undefined;
 for(const [folder,files] of Object.entries(value.products)){
  if(!folderName(folder)||!record(files)||Object.keys(files).length===0)return undefined;
  for(const [path,hash] of Object.entries(files))if(!plainPath(path)||typeof hash!=='string'||!HEX.test(hash))return undefined;
 }
 for(const [path,hash] of Object.entries(value.mounts))if(!mountPath(path)||typeof hash!=='string'||!HEX.test(hash))return undefined;
 return /** @type {Manifest} */(value);
}

/** Forget the last full install: out/ is about to change. @param {string} root */
export function dropManifest(root){rmSync(join(root,MANIFEST),{force:true});}

/** Record a complete full install. Products by folder then path inside it, mounts as `public/...`.
 * @param {string} root @param {string} key @param {Manifest['products']} products @param {Manifest['mounts']} mounts */
export function writeManifest(root,key,products,mounts){
 const sorted=(/** @type {Record<string,string>} */ files)=>Object.fromEntries(Object.entries(files).sort(([a],[b])=>a<b?-1:1));
 const value={version:VERSION,key,products:Object.fromEntries(Object.entries(products).sort(([a],[b])=>a<b?-1:1).map(([folder,files])=>[folder,sorted(files)])),mounts:sorted(mounts)};
 insideTree(root,'out',true);
 const part=join(root,`${MANIFEST}.${String(process.pid)}`);
 writeFileSync(part,`${JSON.stringify(value)}\n`);
 renameSync(part,join(root,MANIFEST));
}

/**
 * Throw unless directory `rel` of `root` resolves, every link followed, to `<real root>/<rel>`: no linked ancestor can
 * send a delete or a write elsewhere. With `make`, the directory is created first.
 * @param {string} root @param {string} rel @param {boolean} [make]
 */
export function insideTree(root,rel,make=false){
 const real=realpathSync(root),at=(/** @type {string} */ path)=>path===''||path==='.'?real:join(real,path);
 // The deepest folder that exists is checked before anything is made under it, and the result after.
 let probe=rel;
 while(probe!==''&&probe!=='.'&&!existsSync(join(root,probe)))probe=dirname(probe);
 const found=realpathSync(join(root,probe));
 if(found!==at(probe))throw new Error(`${probe===''?'.':probe} resolves outside the tree (${found})`);
 if(probe===rel||probe===''&&rel==='.')return;
 if(!make)return;
 mkdirSync(join(root,rel),{recursive:true});
 const made=realpathSync(join(root,rel));
 if(made!==at(rel))throw new Error(`${rel} resolves outside the tree (${made})`);
}

/**
 * Take `root`'s install lock (out/.pins.lock, scripts/pid-lock.mjs). With `wait`, a live holder is waited for up to
 * 15 minutes, then this throws; without, undefined is returned at once.
 * @param {string} root @param {{wait?:boolean}} [options] @returns {(() => void)|undefined} the release
 */
export function lockPins(root,{wait=true}={}){
 insideTree(root,'out',true);
 const release=pidLock(join(root,LOCK),{waitMs:wait?15*60_000:0});
 if(release===undefined&&wait)throw new Error(`${join(root,LOCK)}: another install has held it for 15 minutes`);
 return release;
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
 const hashes=Array.from({length:files.length},()=>'');
 await Promise.all(buckets.filter(bucket=>bucket.indices.length>0).map(bucket=>new Promise((_resolve,reject)=>{
  const worker=new Worker(HASHER,{eval:true,workerData:bucket.indices.map(index=>files[index]?.path)});
  worker.once('message',(/** @type {string[]} */ result)=>{result.forEach((hash,at)=>{hashes[bucket.indices[at]??-1]=hash;});_resolve(undefined);});
  worker.once('error',reject);
  worker.once('exit',code=>{if(code!==0)reject(new Error(`hash worker exited ${String(code)}`));});
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

/** The pin hashes `root` names. @param {string} root @returns {string[]} */
function pinHashes(root){
 const {shards}=/** @type {{shards?:{hash?:unknown}[]}} */(JSON.parse(readFileSync(join(root,PINS),'utf8')));
 return (shards??[]).map(row=>String(row.hash));
}

/** Every file under `directory` as a path relative to it with its size, or a refusal: an entry that is neither a
 * directory nor a regular file, an executable file, or a directory the owner can't write and enter.
 * @param {string} directory @returns {Map<string,number>|string} */
function regularFiles(directory){
 /** @type {Map<string,number>} */const files=new Map();
 /** @param {string} folder @returns {string} '' or the refusal */
 const walk=folder=>{
  const stat=lstatSync(folder);
  if(!stat.isDirectory()||(stat.mode&0o300)!==0o300)return `${folder===directory?'.':relative(directory,folder)} is not a writable directory`;
  for(const entry of readdirSync(folder,{withFileTypes:true})){
   const path=join(folder,entry.name);
   if(entry.isDirectory()){const refused=walk(path);if(refused!=='')return refused;continue;}
   if(!entry.isFile())return `${relative(directory,path)} is not a regular file`;
   const file=lstatSync(path);
   if((file.mode&0o111)!==0||(file.mode&0o200)===0)return `${relative(directory,path)} has mode ${(file.mode&0o777).toString(8)}`;
   files.set(relative(directory,path).split(sep).join('/'),file.size);
  }
  return '';
 };
 try{const refused=walk(directory);return refused===''?files:refused;}catch(error){return error instanceof Error?error.message:String(error);}
}

/** @typedef {{source:string,mode:'in place'|'clone'|'copy',files:number,bytes:number,published:string[],seconds:{clone:number,verify:number}}} Reused */

/**
 * Make `root`'s pinned products and mounts the manifest's, from this tree or another worktree with the same key, and
 * prove every byte. Undefined when no source matches or any byte differs: then the caller runs the full install.
 * The caller holds `root`'s lock (lockPins).
 * @param {string} tree @param {string} key @param {{sources?:readonly string[],log?:(line:string)=>void}} [options]
 * @returns {Promise<Reused|undefined>}
 */
export async function reusePins(tree,key,{sources,log=()=>undefined}={}){
 const root=resolve(tree);
 const candidates=[root,...(sources??worktreeRoots(root)).map(path=>resolve(path)).filter(path=>path!==root)];
 const tracked=trackedPublic(root);
 for(const source of candidates){
  const manifest=readManifest(source);
  if(manifest===undefined){if(existsSync(join(source,MANIFEST)))log(`pins reuse: ${source} has a malformed manifest; skipped`);continue;}
  if(manifest.key!==key)continue;
  // Another tree's install must not rewrite it under the clone; a busy source is skipped, not waited for.
  const release=source===root?()=>undefined:lockPins(source,{wait:false});
  if(release===undefined){log(`pins reuse: ${source} is installing; skipped`);continue;}
  try{
   const reused=await reuseFrom(root,source,manifest,tracked,log);
   if(reused!==undefined)return reused;
  }finally{release();}
 }
 return undefined;
}

/** @param {string} root @param {string} source @param {Manifest} manifest @param {Set<string>} tracked
 * @param {(line:string)=>void} log @returns {Promise<Reused|undefined>} */
async function reuseFrom(root,source,manifest,tracked,log){
 const self=source===root,started=performance.now();
 const folders=Object.keys(manifest.products),mounts=Object.keys(manifest.mounts);
 const published=mounts.filter(path=>!tracked.has(path));
 /** @type {string[]} */const placed=[];
 let mode=/** @type {Reused['mode']} */('in place'),refusal='';
 try{
  insideTree(root,'out',true);
  if(!self){
   insideTree(source,'out');
   // The previous install's mounts go, as a full install removes them first; then this tree's copies of the folders.
   /** @type {unknown} */let ledger;
   try{ledger=JSON.parse(readFileSync(join(root,LEDGER),'utf8')).published;}catch{/* No earlier install. */}
   for(const path of Array.isArray(ledger)?ledger:[]){
    if(typeof path!=='string'||!mountPath(path)||tracked.has(path))continue;
    insideTree(root,dirname(path));
    rmSync(join(root,path),{force:true});
   }
   /** @type {[string,string][]} */const pairs=[];
   for(const folder of folders){
    rmSync(join(root,'out',folder),{recursive:true,force:true});
    pairs.push([join(source,'out',folder),join(root,'out',folder)]);
   }
   for(const path of published){
    insideTree(root,dirname(path),true);
    insideTree(source,dirname(path));
    rmSync(join(root,path),{force:true});
    pairs.push([join(source,path),join(root,path)]);
   }
   placed.push(...pairs.map(([,target])=>target));
   mode=clonePaths(pairs)==='copy'?'copy':'clone';
  }
 }catch(error){refusal=`cloning failed (${error instanceof Error?error.message:String(error)})`;}
 const cloned=performance.now();
 /** @type {{path:string,bytes:number,hash:string}[]} */const files=[];
 if(refusal==='')for(const folder of folders){
  const want=manifest.products[folder]??{},have=regularFiles(join(root,'out',folder));
  if(typeof have==='string'){refusal=`out/${folder}: ${have}`;break;}
  const extra=[...have.keys()].find(path=>!Object.hasOwn(want,path)),missing=Object.keys(want).find(path=>!have.has(path));
  if(extra!==undefined||missing!==undefined){refusal=`out/${folder}/${extra??missing} is ${extra===undefined?'missing':'not in the manifest'}`;break;}
  for(const [path,bytes] of have)files.push({path:join(root,'out',folder,path),bytes,hash:want[path]??''});
 }
 if(refusal==='')for(const path of mounts){
  let bytes=-1;
  try{insideTree(root,dirname(path));const stat=lstatSync(join(root,path));if(stat.isFile())bytes=stat.size;}catch{/* Missing or outside. */}
  if(bytes<0){refusal=`${path} is missing or not a regular file`;break;}
  files.push({path:join(root,path),bytes,hash:manifest.mounts[path]??''});
 }
 if(refusal===''){
  const hashes=await hashFiles(files);
  const wrong=files.findIndex((file,at)=>hashes[at]!==file.hash);
  if(wrong!==-1)refusal=`${relative(root,files[wrong]?.path??'')} does not hash to the manifest`;
 }
 if(refusal===''){
  // The verified products are exactly this tree's pins: every receipt names a pin, and every pin has a product.
  /** @type {string[]} */const named=[];
  try{for(const folder of folders)named.push(String(JSON.parse(readFileSync(join(root,'out',folder,'validation.json'),'utf8')).pin?.hash));}
  catch{refusal='a product has no readable receipt';}
  const pins=refusal===''?pinHashes(root):[];
  if(refusal===''&&(named.length!==pins.length||[...named].sort().join(',')!==[...pins].sort().join(',')))refusal='the products are not exactly the pins';
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
