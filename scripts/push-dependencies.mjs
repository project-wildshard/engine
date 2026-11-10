import {createHash} from 'node:crypto';
import {closeSync,constants,existsSync,fstatSync,lstatSync,openSync,readFileSync,readdirSync,realpathSync} from 'node:fs';
import {isAbsolute,join,relative,resolve,sep} from 'node:path';
import {homedir} from 'node:os';
import {execFileSync} from 'node:child_process';

/** @param {string} base @param {string} target */
const inside=(base,target)=>{const path=relative(base,target);return path===''||path!=='..'&&!path.startsWith(`..${sep}`)&&!isAbsolute(path);};

/** Installed bytes are part of a portable proof. Never follow a live source
 * alias or an unsupported/global store; those layouts simply miss the cache.
 * The full gate still runs, with its original source/ref checks.
 * @param {string} root @param {NodeJS.ProcessEnv} [env] @returns {string|null} */
export function pushDependencyIdentity(root,env=process.env){
 return installedIdentity(root,env,false);
}

/** @param {string} root @param {NodeJS.ProcessEnv} env @param {boolean} toolStore @returns {string|null} */
function installedIdentity(root,env,toolStore){
 try{
  const base=realpathSync(root),manifest=resolve(base,'package.json');
  const pkg=existsSync(manifest)?JSON.parse(readFileSync(manifest,'utf8')):{};
  const names=Object.keys({...pkg.dependencies,...pkg.devDependencies}).sort();
  const tools=toolIdentity(base,pkg,env);if(tools===null)return null;
  if(names.length===0)return createHash('sha256').update('Node builtins; no declared installed packages').update(tools).digest('hex');
  const directory=resolve(base,'node_modules'),store=join(directory,'.pnpm'),lock=join(base,'pnpm-lock.yaml');
  if(!lstatSync(store).isDirectory()||realpathSync(store)!==store||!readFileSync(lock).equals(readFileSync(join(store,'lock.yaml'))))return null;
  // npr's actual frozen tool install can use pnpm's global virtual store.
  // Read its public store location and bind the complete reachable byte graph,
  // never arbitrary sibling checkout links or an entire unrelated store.
  const global=toolStore?join(realpathSync(execFileSync('pnpm',['store','path'],{cwd:base,env,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:5000}).trim()),'links'):null;
  /** @param {string} target */
  const permitted=target=>inside(store,target)||global!==null&&inside(global,target);
  /** @type {Set<string>} */const external=new Set();
  const hash=createHash('sha256');hash.update('managed pnpm bytes/2\0').update(tools).update('\0').update(readFileSync(lock));
  for(const name of names){
   if(!/^(?:@[a-z0-9_.-]+\/)?[a-z0-9][a-z0-9_.-]*$/iu.test(name))return null;
   const target=realpathSync(join(directory,name));
   // The engine's declared self-link is its already checked Git tree, not an
   // unbound sibling checkout. Other live source aliases remain unsupported.
   if(target===base&&name===pkg.name){hash.update(name).update('\0self:checked-tree\0');continue;}
   if(!permitted(target))return null;
   if(!inside(store,target))external.add(target);
   hash.update(name).update('\0').update(relative(store,target)).update('\0');
  }
  let count=0,bytes=0;
  const pending=[{file:store,key:'store'}];const bin=join(directory,'.bin');
  if(existsSync(bin))pending.push({file:bin,key:'root/.bin'});
  for(const target of external)pending.push({file:target,key:`external:${target}`});
  // Iteration includes discovered children and external dependencies. The set
  // terminates package cycles while retaining every symlink's own identity.
  for(const {file,key} of pending){
    const before=lstatSync(file,{bigint:true});
    if(++count>50_000)throw new Error('Installed proof inventory exceeds cap');
    hash.update(key).update('\0').update(String(before.mode&0o111n)).update('\0');
    if(before.isDirectory()){
     hash.update('dir\0');for(const name of readdirSync(file).sort())pending.push({file:join(file,name),key:`${key}/${name}`});
    }
    else if(before.isSymbolicLink()){
     const target=realpathSync(file);if(!permitted(target))throw new Error('Installed proof link leaves managed store');
     if(!inside(store,target)&&!external.has(target)){external.add(target);pending.push({file:target,key:`external:${target}`});}
     hash.update('link\0').update(relative(store,target)).update('\0');
    }else if(before.isFile()){
     bytes+=Number(before.size);if(bytes>512*1024*1024)throw new Error('Installed proof bytes exceed cap');
     const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);let body;
     try{const opened=fstatSync(fd,{bigint:true});if(!opened.isFile()||opened.dev!==before.dev||opened.ino!==before.ino)throw new Error('Installed proof input changed before read');body=readFileSync(fd);}finally{closeSync(fd);}
     const after=lstatSync(file,{bigint:true});
     if(before.ino!==after.ino||before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs)throw new Error('Installed proof input moved');
     // pnpm's generated bin wrappers encode only their checkout location.
     if(key.includes('/.bin/')&&body.subarray(0,2).toString()==='#!')body=Buffer.from(body.toString('utf8').replaceAll(base,'<checkout>'));
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
 const npr=JSON.parse(readFileSync(join(base,'node_modules/npm-bin-deps/package.json'),'utf8'));
 if(npr.version!=='2.1.0')return null;
 const source=resolve(base,pkg.binDependenciesDir??'.bin-deps');if(!inside(base,source)||realpathSync(source)!==source)return null;
 const manifest=JSON.parse(readFileSync(join(source,'package.json'),'utf8'));
 if(JSON.stringify(Object.entries(manifest.dependencies??{}).sort(([a],[b])=>a.localeCompare(b)))!==JSON.stringify(Object.entries(pins).sort(([a],[b])=>a.localeCompare(b))))return null;
 const key=createHash('sha256').update('pnpm\0'),files=['package.json','pnpm-lock.yaml','pnpm-workspace.yaml'];
 for(const name of files)key.update(name).update('\0').update(readFileSync(join(source,name),'utf8')).update('\0');
 const installed=join(env.XDG_CACHE_HOME??join(homedir(),'.cache'),'npm-bin-deps',key.digest('hex').slice(0,32));
 if(!lstatSync(join(installed,'.npr-installed')).isFile())return null;
 for(const name of files)if(!readFileSync(join(source,name)).equals(readFileSync(join(installed,name))))return null;
 return installedIdentity(installed,env,true);
}
