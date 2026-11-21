import {createHash} from 'node:crypto';
import {closeSync,constants,existsSync,fstatSync,lstatSync,openSync,readSync,readdirSync,realpathSync} from 'node:fs';
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {homedir} from 'node:os';
import {moduleCacheOutput,moduleEntries,moduleLookupDirectories} from './node-module-scope.mjs';

/** @param {string} base @param {string} target */
const inside=(base,target)=>{const path=relative(base,target);return path===''||path!=='..'&&!path.startsWith(`..${sep}`)&&!isAbsolute(path);};
const MAX_FILE=256n*1024n*1024n;
const fileIO={stat:/** @param {number} fd */fd=>fstatSync(fd,{bigint:true}),read:readSync,allocate:/** @param {number} length */length=>Buffer.alloc(length)};
/** Read exactly the measured regular-file body, never until an unbounded EOF.
 * @param {number} fd @param {{dev:bigint,ino:bigint,size:bigint}} before
 * @param {typeof fileIO} [io] */
export function readInstalledBytes(fd,before,io=fileIO){
 const opened=io.stat(fd);
 if(!opened.isFile()||opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==before.size||opened.size<0n||opened.size>MAX_FILE)throw new Error('Installed proof input changed before read');
 const body=io.allocate(Number(before.size));let offset=0;
 while(offset<body.length){const count=io.read(fd,body,offset,body.length-offset,null);if(count===0)throw new Error('Installed proof input shrank');offset+=count;}
 if(io.read(fd,io.allocate(1),0,1,null)!==0)throw new Error('Installed proof input grew');
 return body;
}
/** @param {string} file @param {bigint} [limit] */
function readFile(file,limit=MAX_FILE){
 const before=lstatSync(file,{bigint:true});if(!before.isFile()||before.size>limit)throw new Error('Unsupported installed metadata');
 const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{return readInstalledBytes(fd,before);}finally{closeSync(fd);}
}
// One gate resolves each install's recorded store once. Package bytes are
// always recaptured; an external package-manager process is never necessary.
/** @type {Map<string,{root:string,manager:string|undefined}>} */
const recordedStores=new Map();
/** @param {string} modules @param {string} [expectedManager] */
function recordedStore(modules,expectedManager){
 if(recordedStores.has(modules)){
  const record=recordedStores.get(modules);return expectedManager!==undefined&&record?.manager!==expectedManager?null:record?.root??null;
 }
 const file=join(modules,'.modules.yaml');if(!existsSync(file))return null;
 const text=readFile(file,1024n*1024n).toString('utf8');let store,manager;
 if(text.trimStart().startsWith('{')){const parsed=JSON.parse(text);store=parsed.storeDir;manager=parsed.packageManager;}
 else{
  store=/^storeDir: (.+)$/mu.exec(text)?.[1];
  if(store?.startsWith('"'))store=JSON.parse(store);
  else if(store?.startsWith("'"))store=store.slice(1,-1).replaceAll("''","'");
  manager=/^packageManager: (.+)$/mu.exec(text)?.[1];
 }
 if(typeof store!=='string'||!isAbsolute(store))throw new Error('Unsupported installed store metadata');
 const result=join(realpathSync(store),'links');recordedStores.set(modules,{root:result,manager});
 return expectedManager!==undefined&&manager!==expectedManager?null:result;
}

/** Installed bytes are part of a portable proof. Never follow a live source
 * alias or an unsupported install layout; those simply miss the cache.
 * The full gate still runs, with its original source/ref checks.
 * @param {string} root @param {NodeJS.ProcessEnv} [env] @returns {string|null} */
export function pushDependencyIdentity(root,env=process.env){
 return installedIdentity(root,env);
}

/** A `.bin` shim's bytes, minus which checkout installed it. pnpm's global virtual store keeps one shim per package
 * for every checkout, and each install rewrites its NODE_PATH to name the installing checkout's hoisted
 * `node_modules/.pnpm/node_modules`, so another clone's `pnpm install` during the gate moved this checkout's proof
 * inputs (opus-format-prune, 324e55a6f, 2026-11-21: 17 shims, no package byte). The shim's target stays bound.
 * @param {string} text @param {string} base */
export function shimIdentity(text,base){
 return text.replaceAll(base,'<checkout>')
  .replaceAll(/[^:"'\s]*\/node_modules\/\.pnpm\/node_modules(?=[:"'\s]|$)/gmu,'<checkout>/node_modules/.pnpm/node_modules');
}

/** pnpm annotates fetched Git archives in its installed snapshot. Bind every
 * resolution/path/commit and tolerate only that generated true flag.
 * @param {Buffer} body */
function snapshotLock(body){
 const text=body.toString('utf8');
 if(!Buffer.from(text).equals(body))throw new Error('Invalid installed lock text');
 return text.replaceAll(/^([ \t]+resolution: \{)gitHosted: true, (?=[^}\r\n]*\btarball: https?:\/\/)/gmu,'$1');
}

/** @param {string} root @param {NodeJS.ProcessEnv} env @param {string} [managedBy] @returns {string|null} */
function installedIdentity(root,env,managedBy){
 try{
  const base=realpathSync(root),directory=join(base,'node_modules'),store=join(directory,'.pnpm');
  const manifest=join(base,'package.json'),pkg=existsSync(manifest)?JSON.parse(readFile(manifest,1024n*1024n).toString('utf8')):{};
  const names=Object.keys({...pkg.dependencies,...pkg.devDependencies}).sort();
  const tools=toolIdentity(base,pkg,env);if(tools===null)return null;
  const hash=createHash('sha256').update('managed pnpm bytes/4\0').update(tools).update('\0');
  if(names.length>0){
   const lock=join(base,'pnpm-lock.yaml');
   if(!existsSync(store)||!lstatSync(store).isDirectory()||realpathSync(store)!==store||snapshotLock(readFile(lock))!==snapshotLock(readFile(join(store,'lock.yaml'))))return null;
   hash.update(readFile(lock));
   for(const name of names)if(!existsSync(join(directory,name)))return null;
  }
  /** @type {{path:string,key:string,kind:string}[]} */const scopes=[];
  /** @type {{file:string,key:string}[]} */const pending=[];
  const contexts=new Set(),lookups=[{origin:base,key:'project'}],lookupOrigins=new Set([base]);
  /** @param {string} path @param {string} kind */
  const addScope=(path,kind)=>{
   const known=scopes.find(scope=>scope.path===path);if(known)return known;
   const scope={path,key:`${kind}:${scopes.length}`,kind};scopes.push(scope);return scope;
  };
  if(existsSync(store)){if(!lstatSync(store).isDirectory()||realpathSync(store)!==store)return null;addScope(store,'local');pending.push({file:store,key:'store'});}
  const bin=join(directory,'.bin');if(existsSync(bin))pending.push({file:bin,key:'root/.bin'});
  /** @param {string} target @param {string} modules */
  const scopeFor=(target,modules)=>{
   let found=scopes.find(scope=>inside(scope.path,target));if(found)return found;
   const local=join(modules,'.pnpm');
   if(existsSync(local)){if(!lstatSync(local).isDirectory()||realpathSync(local)!==local)throw new Error('Unsupported module store');addScope(local,'local');}
   if(existsSync(join(modules,'.package-lock.json')))addScope(modules,'npm');
   const global=recordedStore(modules,modules===directory?managedBy??pkg.packageManager:undefined);if(global!==null)addScope(global,'global');
   found=scopes.find(scope=>inside(scope.path,target));
   if(!found)throw new Error(`Installed proof link leaves managed stores: ${target}`);return found;
  };
  /** @param {string} target */
  const keyFor=target=>{const scope=scopes.find(candidate=>inside(candidate.path,target));if(!scope)throw new Error('Unknown managed input');return `${scope.key}/${relative(scope.path,target)}`;};
  /** @param {string} target @param {string} modules */
  const register=(target,modules)=>{
   const scope=scopeFor(target,modules);
   if(scope.kind==='npm'){
    if(!contexts.has(target)){
     contexts.add(target);const key=keyFor(target);pending.push({file:target,key:`external:${key}`});
     if(!lookupOrigins.has(target)){lookupOrigins.add(target);lookups.push({origin:target,key});}
    }
    return keyFor(target);
   }
   let container=target;
   while(inside(scope.path,container)&&container!==scope.path&&basename(container)!=='node_modules')container=dirname(container);
   if(basename(container)!=='node_modules')throw new Error('Unsupported managed package context');
   const key=keyFor(container);
   if(!contexts.has(container)){
    contexts.add(container);
    if(!inside(store,container))pending.push({file:container,key:`external:${key}`});
    if(!lookupOrigins.has(container)){lookupOrigins.add(container);lookups.push({origin:container,key});}
   }
   return keyFor(target);
  };
  /** @param {{origin:string,key:string}} input */
  const closeLookup=({origin,key})=>{
   const sealed=new Set();let tier=0;
   for(const modules of moduleLookupDirectories(origin)){
    const entries=moduleEntries(modules).filter(entry=>!sealed.has(entry.name));if(entries.length===0)continue;
    hash.update(`lookup:${key}:${tier++}\0`);
    for(const entry of entries){
     const target=realpathSync(entry.file);let item;
     if(modules===directory&&target===base&&entry.name===pkg.name){hash.update(entry.name).update('\0self:checked-tree\0');item=pkg;}
     else{
      hash.update(entry.name).update('\0').update(register(target,modules)).update('\0');
      const file=join(target,'package.json');item=lstatSync(target).isDirectory()&&existsSync(file)?JSON.parse(readFile(file,1024n*1024n).toString('utf8')):{};
     }
     // Node throws on a missing/forbidden export; it cannot fall through to
     // another copy of this package higher in the lookup chain.
     if(item.exports!==undefined&&item.exports!==null)sealed.add(entry.name);
    }
   }
  };
  let count=0,bytes=0,at=0,lookup=0;
  while(at<pending.length||lookup<lookups.length){
   while(lookup<lookups.length)closeLookup(lookups[lookup++]);
   if(at===pending.length)continue;
   const {file,key}=pending[at++],before=lstatSync(file,{bigint:true});
   if(++count>50_000)throw new Error('Installed proof inventory exceeds cap');
   hash.update(key).update('\0').update(String(before.mode&0o111n)).update('\0');
   if(before.isDirectory()){
    hash.update('dir\0');for(const name of readdirSync(file).sort().filter(entry=>basename(file)!=='node_modules'||!moduleCacheOutput(entry)))pending.push({file:join(file,name),key:`${key}/${name}`});
   }else if(before.isSymbolicLink()){
    const target=realpathSync(file);hash.update('link\0').update(register(target,directory)).update('\0');
   }else if(before.isFile()){
    bytes+=Number(before.size);if(bytes>2*1024*1024*1024||before.size>MAX_FILE)throw new Error('Installed proof bytes exceed cap');
    const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);let body;
    try{body=readInstalledBytes(fd,before);}finally{closeSync(fd);}
    const after=lstatSync(file,{bigint:true});
    if(before.ino!==after.ino||before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs)throw new Error('Installed proof input moved');
    if(key.includes('/.bin/')&&body.subarray(0,2).toString()==='#!')body=Buffer.from(shimIdentity(body.toString('utf8'),base));
    hash.update(`file\0${body.length}\0`).update(body).update('\0');
   }else throw new Error('Unsupported installed proof input');
  }
  return hash.digest('hex');
 }catch{return null;}
}

/** Read-only adapter for the installed npr 2.1 pnpm layout. Never run `which`
 * here: npr may install on a miss. Unknown versions/layouts miss conservatively.
 * The three committed inputs and every installed tool byte must agree.
 * @param {string} base @param {{binDependencies?:Record<string,string>,binDependenciesDir?:string,binDependenciesInstaller?:string,packageManager?:string}} pkg
 * @param {NodeJS.ProcessEnv} env @returns {string|null} */
function toolIdentity(base,pkg,env){
 const pins=pkg.binDependencies??{};if(Object.keys(pins).length===0)return 'no-bin-dependencies';
 if(!pkg.packageManager?.startsWith('pnpm@')||pkg.binDependenciesInstaller!==undefined)return null;
 const npr=JSON.parse(readFile(join(base,'node_modules/npm-bin-deps/package.json'),1024n*1024n).toString('utf8'));
 if(npr.version!=='2.1.0')return null;
 const source=resolve(base,pkg.binDependenciesDir??'.bin-deps');if(!inside(base,source)||realpathSync(source)!==source)return null;
 const manifest=JSON.parse(readFile(join(source,'package.json'),1024n*1024n).toString('utf8'));
 if(JSON.stringify(Object.entries(manifest.dependencies??{}).sort(([a],[b])=>a.localeCompare(b)))!==JSON.stringify(Object.entries(pins).sort(([a],[b])=>a.localeCompare(b))))return null;
 const key=createHash('sha256').update('pnpm\0'),files=['package.json','pnpm-lock.yaml','pnpm-workspace.yaml'];
 for(const name of files)key.update(name).update('\0').update(readFile(join(source,name))).update('\0');
 const installed=join(env.XDG_CACHE_HOME??join(homedir(),'.cache'),'npm-bin-deps',key.digest('hex').slice(0,32));
 if(!lstatSync(join(installed,'.npr-installed')).isFile())return null;
 for(const name of files)if(!readFile(join(source,name)).equals(readFile(join(installed,name))))return null;
 return installedIdentity(installed,env,pkg.packageManager);
}
