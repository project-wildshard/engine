// G450/P4: closure is a per-shard work queue, never a source percentage.
import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {relative,resolve} from 'node:path';
import {shardfileBoundaryViolations} from '../lint/shardfile-boundaries.mjs';

function files(folder) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder,{withFileTypes:true}).flatMap(entry=>{
    const path=resolve(folder,entry.name);
    if(entry.isSymbolicLink())throw new Error(`Runtime closure refuses a symlink: ${path}`);
    return entry.isDirectory()?files(path):entry.name.endsWith('.ts')?[path]:[];
  });
}
/** Count every raw P0 escape, without baseline allowances or running shard code.
 * @param {string} root @returns {Record<string,import('./shard-runtime-closure.mjs').RuntimeClosure>} */
export function runtimeClosures(root) {
  const result={};
  for(const entry of readdirSync(resolve(root,'src/shards'),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
    if(!entry.isDirectory())continue;
    const directory=resolve(root,'src/shards',entry.name);
    const escapes=files(resolve(directory,'runtime')).flatMap(path=>{
      const file=relative(root,path).replaceAll('\\','/');
      const issues=shardfileBoundaryViolations(root,file,readFileSync(path,'utf8')).filter(row=>row.rule==='runtime-standalone');
      return issues.length===0?[]:[{path:file,count:issues.length,messages:[...new Set(issues.map(row=>row.message))]}];
    }).sort((a,b)=>b.count-a.count||a.path.localeCompare(b.path));
    const count=escapes.reduce((sum,row)=>sum+row.count,0);
    result[entry.name]={status:count===0?'closed':'unclosed',escapes:count,files:escapes};
  }
  return result;
}
