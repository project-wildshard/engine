// DEV-SPEED DS12: identical pins are cloned, never unpacked again. A full `pins.ts install` unpacks every pinned
// product into out/ and publishes its mounts under public/: about 1.8 GiB and 12-18 s per plan worktree. A second
// tree whose pins are identical needs exactly those bytes, so it takes APFS clones of them (no new blocks) and proves
// every byte by hash before it uses them.
//
//   1. A full install that admits every pin records `out/.pins-manifest.json`: the key below, and the sha256 of every
//      file it wrote under out/<folder>/ and of every mount it published (or found tracked) under public/. It writes
//      the manifest only if the key, recomputed after the install, still matches the one it started with. Any other
//      install (some slugs, a ring, --from-format) deletes the manifest first, so a manifest only ever describes the
//      exact result of the last full install. Each pin also records which product and mounts it supplied.
//   2. The key hashes the pin descriptors, asset pins and local fallback bytes, installer and lockfile, tracked
//      public path names and the shardfile validation revision. Same-tree reuse checks the shared inputs separately.
//   3. `reusePins` tries this tree first (a rebuild with unchanged pins verifies in place and writes nothing), then
//      every other worktree of the repo, the canonical checkout first, whose manifest carries the same key and whose
//      install lock is free. From a source it clones each product folder and each untracked mount; a mount this tree
//      tracks in Git is not cloned but must hash the same, as a full install requires.
//   4. Every product folder must hold exactly the manifest's files, all regular, none executable, and every file must
//      hash to the manifest; the products' receipts must name exactly this tree's pins. One mismatch discards the
//      clones. A full install can retain unchanged, verified products in place when the other inputs still match.
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
import {shardfileValidationRevision} from './shardfile-validation-revision.mjs';
import {trackedPublic} from './tracked-public.mjs';

export const MANIFEST='out/.pins-manifest.json';
const VERSION=2,KEY_VERSION='pins-reuse/3',LEDGER='out/.pins.json',LOCK='out/.pins.lock',PINS='test/pins/shardfiles.json';
const HEX=/^[a-f0-9]{64}$/u;
/** Every tracked file whose bytes decide what a full install writes. A local module `pins.ts` or `bake-loader.mjs`
 * imports is here unless KEY_EXEMPT says why its bytes can't change out/ or public/ (pins-reuse.test.mjs checks). */
export const KEY_SOURCES=Object.freeze(['scripts/pins.ts','scripts/pin-packs.ts','scripts/pin-assets.ts','scripts/pin-format.ts',
 'scripts/bake-loader.mjs','scripts/format-hook.mjs','scripts/shardfile-validation-revision.mjs','scripts/pins-reuse.mjs',
 'scripts/tracked-public.mjs','scripts/pin-local.ts','scripts/local-candidates.ts','scripts/pin-admit.ts','pnpm-lock.yaml',PINS,'test/pins/assets.json']);
export const KEY_EXEMPT=Object.freeze({
 'scripts/agent-requests.mjs':'adds HTTP request markers; the pinned digest still decides the admitted bytes',
 'scripts/pins-exclude.mjs':'writes Git\'s exclude file only',
 'scripts/apfs-clone.mjs':'clones bytes that are then hashed against the manifest',
 'scripts/slice-inputs.ts':'slice and ring commands only, which delete the manifest',
 'src/cook/game/shardCook.ts':'slice command, and the printed sidecar preparation label (SP1b4); no byte under out/',
 'src/cook/game/cookSidecar.ts':'finds and judges a cook preparation sidecar for a printed label only (SP1b4); no byte under out/',
 'scripts/renderer-revision.mjs':'names a printed preparation label only (J262); no byte under out/',
 'src/shared/game/shardfile/ktx2Targets.ts':'hashed already: the validation revision in the key covers src/shared/game/shardfile (S11)',
 'scripts/pins-catalogue.ts':'refresh check only (DEL9): refuses before the pins are written; no byte under out/',
 'scripts/pins-staging.ts':'refresh/export only; selection materializes shardfiles.json already hashed in the key',
 'scripts/server-release/served-slug.mjs':'refresh check only (DEL9): names a slug\'s served folder for the catalogue compare',
 'scripts/pin-test-names.ts':'drop check only (SHARD-COMPAT NB10): refuses a --drop while tests name the slug; no byte under out/',
});

/** @typedef {{slug:string,hash:string,revision:number,bytes:number}} Pin */
/** @typedef {{folder:string,descriptor:string,mounts:string[]}} PinOwner */
/** @typedef {{inputs:string,owners:Record<string,PinOwner>}} Incremental */
/** @typedef {{version:number,key:string,products:Record<string,Record<string,string>>,mounts:Record<string,string>,incremental?:Incremental}} Manifest */

/** All shared admission inputs. KTX2 target checks depend on which public paths Git tracks.
 * @param {string} root @param {string} revision the shardfile validation revision */
export function pinsCompatibilityKey(root,revision){
 const hash=createHash('sha256').update(`${KEY_VERSION}\0${revision}\0`);
 for(const path of KEY_SOURCES){
  if(path===PINS)continue;
  const file=join(root,path);
  hash.update(`${path}\0`).update(existsSync(file)?readFileSync(file):'absent').update('\0');
 }
 const assets=join(root,'test/pins/assets');
 if(existsSync(assets)&&lstatSync(assets).isDirectory())for(const entry of readdirSync(assets,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:1)){
  hash.update(`asset:${entry.name}\0`).update(entry.isFile()?readFileSync(join(assets,entry.name)):'not a file').update('\0');
 }
 for(const path of [...trackedPublic(undefined,root)].sort())hash.update(`tracked:${path}\0`);
 return hash.digest('hex');
}

/** The exact reuse key for a complete installation.
 * @param {string} root @param {string} revision @param {string} [inputs] */
export function pinsKey(root,revision,inputs=pinsCompatibilityKey(root,revision)){
 const file=join(root,PINS);
 return createHash('sha256').update(inputs).update('\0').update(existsSync(file)?readFileSync(file):'absent').digest('hex');
}

/** Hash the full pin descriptor, including its size and revision. @param {Pin} pin */
export const pinDescriptor=pin=>createHash('sha256').update(JSON.stringify(pin)).digest('hex');

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
 if(value.incremental!==undefined){
  const {incremental,products,mounts}=value;
  if(!record(incremental)||typeof incremental.inputs!=='string'||!HEX.test(incremental.inputs)||!record(incremental.owners))return undefined;
  const folders=new Set();
  for(const [slug,owner] of Object.entries(incremental.owners)){
   if(!folderName(slug)||!record(owner)||typeof owner.folder!=='string'||!Object.hasOwn(products,owner.folder)||folders.has(owner.folder)
     ||typeof owner.descriptor!=='string'||!HEX.test(owner.descriptor)||!Array.isArray(owner.mounts)
     ||owner.mounts.some(path=>typeof path!=='string'||!Object.hasOwn(mounts,path)))return undefined;
   folders.add(owner.folder);
  }
  if(folders.size!==Object.keys(products).length)return undefined;
 }
 return /** @type {Manifest} */(value);
}

/**
 * The untracked mounts under public/ that are provably this tree's pins outputs, for checks that want a clean tree
 * (push-proof-cache.mjs): listed in this tree's ledger and manifest, the manifest's key still this tree's committed
 * pins and installer, inside the tree, and hashing to the manifest now. `key` is that manifest key ('' when there is
 * none), so a proof binds the pins its outputs came from. A worktree whose canonical checkout never wrote the exclude
 * block sees these as untracked (pins-exclude.mjs); anything else untracked still counts.
 * @param {string} root @returns {{paths:Set<string>,key:string}}
 */
export function verifiedPinsOutputs(root){
 /** @type {Set<string>} */const paths=new Set();
 const manifest=readManifest(root);
 if(manifest===undefined||manifest.key!==pinsKey(root,shardfileValidationRevision(root)))return {paths,key:''};
 /** @type {unknown} */let ledger;
 try{ledger=JSON.parse(readFileSync(join(root,LEDGER),'utf8')).published;}catch{return {paths,key:''};}
 for(const path of Array.isArray(ledger)?ledger:[]){
  if(typeof path!=='string'||!mountPath(path)||!Object.hasOwn(manifest.mounts,path))continue;
  try{
   insideTree(root,dirname(path));
   if(!lstatSync(join(root,path)).isFile())continue;
   if(createHash('sha256').update(readFileSync(join(root,path))).digest('hex')===manifest.mounts[path])paths.add(path);
  }catch{/* Missing or outside: it stays untracked dirt. */}
 }
 return {paths,key:manifest.key};
}

/** Forget the last full install: out/ is about to change. @param {string} root */
export function dropManifest(root){rmSync(join(root,MANIFEST),{force:true});}

/** Record a complete full install. Products by folder then path inside it, mounts as `public/...`.
 * @param {string} root @param {string} key @param {Manifest['products']} products @param {Manifest['mounts']} mounts
 * @param {Incremental} [incremental] */
export function writeManifest(root,key,products,mounts,incremental){
 /** @template T @param {Record<string,T>} entries */
 const sorted=entries=>Object.entries(entries).sort(([a],[b])=>a<b?-1:1);
 const value={version:VERSION,key,products:Object.fromEntries(sorted(products).map(([folder,files])=>[folder,Object.fromEntries(sorted(files))])),mounts:Object.fromEntries(sorted(mounts)),
  incremental:incremental===undefined?undefined:{inputs:incremental.inputs,owners:Object.fromEntries(sorted(incremental.owners))}};
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

/** The pin hashes `root` names. @param {string} root @returns {string[]} */
function pinHashes(root){
 const {shards}=/** @type {{shards?:{hash?:unknown}[]}} */(JSON.parse(readFileSync(join(root,PINS),'utf8')));
 return (shards??[]).map(row=>String(row.hash));
}

/**
 * The products under `out/` whose receipt names a pin `root`'s pins no longer name (`out/<folder>`, with the revision its
 * receipt says), e.g. a worktree installed before a pin bump and rebased past it. Their mounts under public/ are that old
 * revision's, so the boot stamps gen:inputs writes from public/ would carry the old files (Far Reach rev 1's 21 rows,
 * re-added by lands from such worktrees, 2026-11-14). A tree with no `out/` or no pins file has none, and a format-dependency
 * product (installed from the frozen format package, named by no pin) is never stale.
 * @param {string} root @param {readonly string[]} [hashes] @returns {{folder:string,revision:unknown}[]}
 */
export function stalePinFolders(root,hashes){
 let want;
 try{want=new Set(hashes??pinHashes(root));}catch{return [];}
 let folders;
 try{folders=readdirSync(join(root,'out'),{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>entry.name);}catch{return [];}
 /** @type {{folder:string,revision:unknown}[]} */const stale=[];
 for(const folder of folders.sort()){
  /** @type {unknown} */let pin,source;
  try{({pin,source}=JSON.parse(readFileSync(join(root,'out',folder,'validation.json'),'utf8')));}catch{continue;}
  // A format-dependency product (`pins.ts install --from-format`) is
  // named by no pin on purpose, so it is current while its index is the installed format package's (TEMPLATE-E2E, 2026-11-16)
  // and stale once the dependency moves past it.
  if(typeof source==='object'&&source!==null&&'kind'in source&&source.kind==='format-dependency'){
   if(!currentFormatFolder(root,source))stale.push({folder,revision:typeof pin==='object'&&pin!==null&&'revision'in pin?pin.revision:undefined});
   continue;
  }
  if(typeof pin!=='object'||pin===null||!('hash'in pin)||typeof pin.hash!=='string')continue;
  if(!want.has(pin.hash))stale.push({folder,revision:'revision'in pin?pin.revision:undefined});
 }
 return stale;
}

/** A full `pnpm pins` removes every out/ product `stalePinFolders` names, so land's gen:inputs never refuses a tree the pins
 * just installed (opus-bugfix2, 2026-11-16: the Brasscap rename left a worktree's out/<old slug> behind until a hand
 * rm -rf). Only folders under out/ with a pin receipt; anything else in out/ stays. Their public/ mounts went with the ledger.
 * @param {string} root @param {readonly string[]} [hashes] @returns {{folder:string,revision:unknown}[]} the products removed */
export function pruneStalePinProducts(root,hashes){
 const stale=stalePinFolders(root,hashes).filter(row=>folderName(row.folder));
 for(const {folder} of stale){
  insideTree(root,join('out',folder));
  rmSync(join(root,'out',folder),{recursive:true,force:true});
 }
 return stale;
}

/** Whether a format-dependency receipt's `source` (`{path:'@wildshard/format/<folder>', indexHash}`, scripts/pin-format.ts)
 * names the `shard.json` the tree's installed format package holds today.
 * @param {string} root @param {object} source @returns {boolean} */
function currentFormatFolder(root,source){
 const path='path'in source&&typeof source.path==='string'?source.path:'',indexHash='indexHash'in source?source.indexHash:undefined;
 const folder=path.startsWith('@wildshard/format/')?path.slice('@wildshard/format/'.length):'';
 if(folder===''||folder.split('/').includes('..'))return false;
 try{return createHash('sha256').update(readFileSync(join(root,'node_modules','@wildshard','format',folder,'shard.json'))).digest('hex')===indexHash;}
 catch{return false;}
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

/** @typedef {{path:string,bytes:number,hash:string}} ExpectedFile */

/** @param {string} root @param {string} folder @param {Record<string,string>} want @returns {ExpectedFile[]|string} */
function productFiles(root,folder,want){
 const directory=join(root,'out',folder),have=regularFiles(directory);
 if(typeof have==='string')return `out/${folder}: ${have}`;
 const extra=[...have.keys()].find(path=>!Object.hasOwn(want,path)),missing=Object.keys(want).find(path=>!have.has(path));
 if(extra!==undefined||missing!==undefined)return `out/${folder}/${extra??missing} is ${extra===undefined?'missing':'not in the manifest'}`;
 return [...have].map(([path,bytes])=>({path:join(directory,path),bytes,hash:want[path]??''}));
}

/** @param {string} root @param {string} path @param {string} hash @returns {ExpectedFile|undefined} */
function mountFile(root,path,hash){
 try{
  insideTree(root,dirname(path));
  const file=join(root,path),stat=lstatSync(file);
  if(stat.isFile())return {path:file,bytes:stat.size,hash};
 }catch{/* Missing or outside. */}
 return undefined;
}

/** Check same-tree products independently, hashing shared mounts only once.
 * The caller holds the install lock. This only selects retained output and does not write anything.
 * @param {string} root @param {string} inputs @param {readonly Pin[]} pins
 * @returns {Promise<(Pick<Manifest,'products'|'mounts'>&{owners:Incremental['owners']})|undefined>} */
export async function reuseUnchangedPins(root,inputs,pins){
 const manifest=readManifest(root),incremental=manifest?.incremental;
 if(manifest===undefined||incremental?.inputs!==inputs)return undefined;
 // Pin membership controls which fallback public assets can satisfy any product's KTX2 table.
 const slugs=new Set(pins.map(({slug})=>slug));
 if(slugs.size!==pins.length||Object.keys(incremental.owners).length!==slugs.size||[...slugs].some(slug=>!Object.hasOwn(incremental.owners,slug)))return undefined;
 insideTree(root,'out');
 /** @type {Map<string,ExpectedFile>} */const files=new Map();
 /** @type {{pin:Pin,owner:PinOwner,paths:string[]}[]} */const candidates=[];
 for(const pin of pins){
  if(!Object.hasOwn(incremental.owners,pin.slug))continue;
  const owner=incremental.owners[pin.slug];
  if(owner===undefined||owner.descriptor!==pinDescriptor(pin))continue;
  const product=productFiles(root,owner.folder,manifest.products[owner.folder]??{});
  if(typeof product==='string')continue;
  const mounts=owner.mounts.map(path=>files.get(join(root,path))??mountFile(root,path,manifest.mounts[path]??''));
  if(mounts.some(file=>file===undefined))continue;
  const expected=product.concat(mounts.filter(file=>file!==undefined));
  for(const file of expected)files.set(file.path,file);
  candidates.push({pin,owner,paths:expected.map(file=>file.path)});
 }
 const expected=[...files.values()],hashes=await hashFiles(expected);
 const wrong=new Set(expected.filter((file,at)=>hashes[at]!==file.hash).map(file=>file.path));
 const verified=candidates.filter(({pin,owner,paths})=>!paths.some(path=>wrong.has(path))&&receiptMatches(root,owner.folder,pin));
 if(verified.length===0)return undefined;
 return {
  owners:Object.fromEntries(verified.map(({pin,owner})=>[pin.slug,owner])),
  products:Object.fromEntries(verified.map(({owner})=>[owner.folder,manifest.products[owner.folder]??{}])),
  mounts:Object.fromEntries(verified.flatMap(({owner})=>owner.mounts.map(path=>[path,manifest.mounts[path]??'']))),
 };
}

/** @param {string} root @param {string} folder @param {Pin} pin */
function receiptMatches(root,folder,pin){
 try{
  const receipt=JSON.parse(readFileSync(join(root,'out',folder,'validation.json'),'utf8'));
  return receipt.source===undefined&&receipt.pin?.hash===pin.hash&&receipt.pin?.revision===pin.revision;
 }catch{return false;}
}

/**
 * FORMAT-PRUNE FP59 (opus-fp54, 11-25): engine main's reused install cloned a receipt the preparation client build then
 * refused ("Stale output validation receipt: brasscap-mesa", app-build/validationReceipts.mjs). The first product whose
 * build receipt fails that same check under `revision`, or undefined; a product without a build receipt (a migrated
 * copy) is not checked.
 * @param {string} source @param {readonly string[]} folders @param {string} revision @returns {string|undefined} */
export function staleReceipt(source,folders,revision){
 for(const folder of folders){
  let receipt,bytes;
  try{receipt=JSON.parse(readFileSync(join(source,'out',folder,'validation.json'),'utf8'));}catch{continue;}
  if(typeof receipt!=='object'||receipt===null||!('revision' in receipt))continue;
  try{bytes=readFileSync(join(source,'out',folder,'shard.json'));}catch{return folder;}
  let index;
  try{index=JSON.parse(bytes.toString('utf8'));}catch{return folder;}
  if(receipt.revision!==revision||receipt.indexHash!==createHash('sha256').update(bytes).digest('hex')||receipt.sourceHash!==index?.build?.sourceHash)return folder;
 }
 return undefined;
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
 const tracked=trackedPublic(undefined,root);
 for(const source of candidates){
  const manifest=readManifest(source);
  if(manifest===undefined){if(existsSync(join(source,MANIFEST)))log(`pins reuse: ${source} has a malformed manifest; skipped`);continue;}
  if(manifest.key!==key)continue;
  // FORMAT-PRUNE FP59: a source whose build receipts the app build would refuse is never cloned
  const stale=staleReceipt(source,Object.keys(manifest.products),shardfileValidationRevision(root));
  if(stale!==undefined){log(`pins reuse: ${source} has a stale validation receipt (${stale}); skipped`);continue;}
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

/** @param {string} root @param {string} source @param {Manifest} manifest @param {ReadonlySet<string>} tracked
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
 /** @type {ExpectedFile[]} */const files=[];
 if(refusal==='')for(const folder of folders){
  const expected=productFiles(root,folder,manifest.products[folder]??{});
  if(typeof expected==='string'){refusal=expected;break;}
  files.push(...expected);
 }
 if(refusal==='')for(const path of mounts){
  const file=mountFile(root,path,manifest.mounts[path]??'');
  if(file===undefined){refusal=`${path} is missing or not a regular file`;break;}
  files.push(file);
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
 if(!self)writeManifest(root,manifest.key,manifest.products,manifest.mounts,manifest.incremental);
 const verified=performance.now();
 return {source,mode,files:files.length,bytes:files.reduce((sum,file)=>sum+file.bytes,0),published,
  seconds:{clone:Number(((cloned-started)/1000).toFixed(2)),verify:Number(((verified-cloned)/1000).toFixed(2))}};
}
