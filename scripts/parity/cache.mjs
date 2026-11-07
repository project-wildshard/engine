import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Remove oldest completed builds by directory mtime, retaining the newest N (default 3).
 * Live readers and builders can temporarily exceed N; the next build retries eviction.
 * @param {string} [cacheRoot] @param {number} [keep] @returns {string[]} evicted keys */
export function evictBuildCache(cacheRoot=join(homedir(),'.cache/wildshard-parity'),keep=3) {
  if(!Number.isInteger(keep)||keep<1)throw new Error('usage: --cache-keep must be a positive integer');
  if(!existsSync(cacheRoot))return [];
  const entries=readdirSync(cacheRoot,{withFileTypes:true}).filter((entry)=>entry.isDirectory()&&/^[0-9a-f]{64}$/.test(entry.name))
    .flatMap((entry)=>{
      const dir=join(cacheRoot,entry.name);
      try{return existsSync(join(dir,'ready.json'))&&existsSync(join(dir,'tree/dist/version.json'))?[{key:entry.name,mtime:statSync(dir).mtimeMs}]:[];}
      catch{return [];}
    }).sort((a,b)=>b.mtime-a.mtime||a.key.localeCompare(b.key));
  const evicted=[];
  for(const {key} of entries.slice(keep)) {
    const dir=join(cacheRoot,key),lock=`${dir}.lock`,users=`${dir}.users`;
    try{mkdirSync(lock);writeFileSync(join(lock,'pid'),String(process.pid));}
    catch(error){if(error instanceof Error&&'code' in error&&error.code==='EEXIST')continue;throw error;}
    try {
      let active=false;
      if(existsSync(users))for(const user of readdirSync(users)) {
        const pid=Number(user.split('-')[0]);
        if(!Number.isInteger(pid)||pid<1){active=true;continue;}
        try{process.kill(pid,0);active=true;}
        catch(error){
          if(error instanceof Error&&'code' in error&&error.code==='ESRCH')rmSync(join(users,user),{recursive:true,force:true});
          else active=true;
        }
      }
      if(active)continue;
      // A second evictor may already have removed this entry after the inventory read.
      if(!existsSync(dir))continue;
      rmSync(dir,{recursive:true,force:true});rmSync(users,{recursive:true,force:true});evicted.push(key);
    } finally {rmSync(lock,{recursive:true,force:true});}
  }
  return evicted;
}
