import {createHash} from 'node:crypto';
import {closeSync,constants,existsSync,fstatSync,lstatSync,openSync,readFileSync,readdirSync,realpathSync} from 'node:fs';
import {isAbsolute,join,relative,resolve,sep} from 'node:path';

/** @param {string} base @param {string} target */
const inside=(base,target)=>{const path=relative(base,target);return path===''||path!=='..'&&!path.startsWith(`..${sep}`)&&!isAbsolute(path);};

/** Installed bytes are part of a portable proof. Never follow a live source
 * alias or an unsupported/global store; those layouts simply miss the cache.
 * The full gate still runs, with its original source/ref checks.
 * @param {string} root @returns {string|null} */
export function pushDependencyIdentity(root){
 try{
  const base=realpathSync(root),manifest=resolve(base,'package.json');
  const pkg=existsSync(manifest)?JSON.parse(readFileSync(manifest,'utf8')):{};
  const names=Object.keys({...pkg.dependencies,...pkg.devDependencies}).sort();
  if(names.length===0)return createHash('sha256').update('Node builtins; no declared installed packages').digest('hex');
  const directory=resolve(base,'node_modules'),store=join(directory,'.pnpm'),lock=join(base,'pnpm-lock.yaml');
  if(!lstatSync(store).isDirectory()||realpathSync(store)!==store||!readFileSync(lock).equals(readFileSync(join(store,'lock.yaml'))))return null;
  const hash=createHash('sha256');hash.update('managed pnpm bytes/1\0').update(readFileSync(lock));
  for(const name of names){
   if(!/^(?:@[a-z0-9_.-]+\/)?[a-z0-9][a-z0-9_.-]*$/iu.test(name))return null;
   const target=realpathSync(join(directory,name));
   // The engine's declared self-link is its already checked Git tree, not an
   // unbound sibling checkout. Other live source aliases remain unsupported.
   if(target===base&&name===pkg.name){hash.update(name).update('\0self:checked-tree\0');continue;}
   if(!inside(store,target))return null;
   hash.update(name).update('\0').update(relative(store,target)).update('\0');
  }
  let count=0,bytes=0;
  /** @param {string} folder @param {string} prefix */
  const visit=(folder,prefix)=>{
   for(const name of readdirSync(folder).sort()){
    const file=join(folder,name),key=`${prefix}/${name}`,before=lstatSync(file,{bigint:true});
    if(++count>50_000)throw new Error('Installed proof inventory exceeds cap');
    hash.update(key).update('\0').update(String(before.mode&0o111n)).update('\0');
    if(before.isDirectory()){hash.update('dir\0');visit(file,key);}
    else if(before.isSymbolicLink()){
     const target=realpathSync(file);if(!inside(store,target))throw new Error('Installed proof link leaves managed store');
     hash.update('link\0').update(relative(store,target)).update('\0');
    }else if(before.isFile()){
     bytes+=Number(before.size);if(bytes>512*1024*1024)throw new Error('Installed proof bytes exceed cap');
     const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);let body;
     try{const opened=fstatSync(fd,{bigint:true});if(!opened.isFile()||opened.dev!==before.dev||opened.ino!==before.ino)throw new Error('Installed proof input changed before read');body=readFileSync(fd);}finally{closeSync(fd);}
     const after=lstatSync(file,{bigint:true});
     if(before.ino!==after.ino||before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs)throw new Error('Installed proof input moved');
     // pnpm's generated bin wrappers encode only their checkout location.
     if(key.includes('/.bin/')&&body.subarray(0,2).toString()==='#!')body=Buffer.from(body.toString('utf8').replaceAll(base,'<checkout>'));
     hash.update('file\0').update(body).update('\0');
    }else throw new Error('Unsupported installed proof input');
   }
  };
  visit(store,'store');const bin=join(directory,'.bin');if(existsSync(bin))visit(bin,'root/.bin');
  return hash.digest('hex');
 }catch{return null;}
}
