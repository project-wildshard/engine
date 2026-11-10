// oxlint-disable-next-line import/no-nodejs-modules -- Only the trusted supervisor reads installed package manifests.
import {existsSync,readFileSync,realpathSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the installed runtime closure, not a machine-wide store.
import {basename,dirname,isAbsolute,join,relative,sep} from 'node:path';
import * as v from 'valibot';

const Dependencies=v.record(v.string(),v.string());
const Manifest=v.object({dependencies:v.optional(Dependencies),optionalDependencies:v.optional(Dependencies),peerDependencies:v.optional(Dependencies)});
const prepared=new WeakMap<object,{root:string;reads:readonly string[]}>();
const inside=(root:string,path:string):boolean=>{
  const part=relative(root,path);return part===''||part!=='..'&&!part.startsWith(`..${sep}`)&&!isAbsolute(part);
};
function installed(name:string,from:string):{directory:string;lookup:string}|undefined{
  if(!/^(?:@[a-zA-Z0-9._~-]+\/)?[a-zA-Z0-9._~-]+$/u.test(name)||name==='.'||name==='..')throw new Error('Invalid installed runtime package name');
  for(let at=from;;at=dirname(at)){
    if(basename(at)!=='node_modules'){
      const directory=join(at,'node_modules',name);
      if(existsSync(join(directory,'package.json')))return {directory:realpathSync(directory),lookup:directory};
    }
    if(dirname(at)===at)return undefined;
  }
}
/** One launcher's trusted installed runtime closure. Never grant an entire store,
 * node_modules directory, dev dependencies, or names supplied by a shard. Node
 * needs the exact declared link path for metadata reads before resolving it. */
export function installedRuntimeReads(launcher:object,root:string):readonly string[]{
  const known=prepared.get(launcher);if(known?.root===root)return known.reads;
  const canonical=realpathSync(root),seen=new Set<string>(),reads=new Set<string>(),pending=[canonical];
  while(pending.length>0){
    const directory=pending.pop();if(directory===undefined||seen.has(directory))continue;seen.add(directory);
    // A caller may launch a standalone script with no package installation.
    // Preserve its original root-only permissions rather than requiring a manifest.
    if(directory===canonical&&!existsSync(join(directory,'package.json')))continue;
    const manifest=v.parse(Manifest,JSON.parse(readFileSync(join(directory,'package.json'),'utf8')));
    if(!inside(canonical,directory))reads.add(directory);
    const optional=new Set(Object.keys(manifest.optionalDependencies??{}));
    const names=new Set([...Object.keys(manifest.dependencies??{}),...optional,...Object.keys(manifest.peerDependencies??{})]);
    for(const name of names){
      const target=installed(name,directory);
      if(target!==undefined){
        pending.push(target.directory);
        if(!inside(canonical,target.lookup))reads.add(target.lookup);
      }
      else if(Object.hasOwn(manifest.dependencies??{},name)&&!optional.has(name))throw new Error(`Missing installed runtime dependency: ${name}`);
    }
  }
  const result=Object.freeze([...reads].sort());prepared.set(launcher,{root,reads:result});return result;
}
