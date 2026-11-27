// A pre-lock gate certifies the exact base and tip in its pre-push input.
// The final push can reuse that proof only for the same ref update.
import {spawnSync} from 'node:child_process';
import {mkdirSync,readdirSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';

const KEEP_MS=24*60*60*1000;
const SHA=/^[a-f0-9]{40}$/u;
const ZERO=/^0+$/u;

/** @param {string} cwd @param {string[]} args */
function git(cwd,args){
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
 return spawnSync('git',args,{cwd,env,encoding:'utf8',maxBuffer:256<<20});
}

/** The common Git dir is shared by the main checkout and its gate copies. @param {string} cwd */
export function markDir(cwd){
 return join(resolve(cwd,git(cwd,['rev-parse','--git-common-dir']).stdout.trim()),'main-push-gated');
}

/** @param {string} cwd @param {string} base @param {string} tip */
function commitCount(cwd,base,tip){
 if(!SHA.test(base)||!SHA.test(tip)||ZERO.test(base)||ZERO.test(tip))return 0;
 if(git(cwd,['merge-base','--is-ancestor',base,tip]).status!==0)return 0;
 const count=git(cwd,['rev-list','--count',`${base}..${tip}`]);
 return count.status===0?Number(count.stdout.trim()):0;
}

/** @param {string} cwd @param {string} base @param {string} tip */
export function markGated(cwd,base,tip){
 const count=commitCount(cwd,base,tip);
 if(count===0)return 0;
 const dir=markDir(cwd);
 mkdirSync(dir,{recursive:true});
 writeFileSync(join(dir,`${base}-${tip}`),`${new Date().toISOString()}\n`);
 try{for(const name of readdirSync(dir))if(Date.now()-statSync(join(dir,name)).mtimeMs>KEEP_MS)rmSync(join(dir,name),{force:true});}catch{/* Housekeeping only. */}
 return count;
}

/** @param {string} cwd @param {string|undefined} refs @param {string} proof */
export function pregated(cwd,refs,proof){
 const rows=(refs??'').trim().split('\n').filter(Boolean).map(line=>line.trim().split(/\s+/u));
 if(rows.length!==1)return null;
 const [,tip='',remote='',base='']=rows[0]??[];
 if(remote!=='refs/heads/main'||proof!==`${base}:${tip}`)return null;
 const count=commitCount(cwd,base,tip);
 if(count===0)return null;
 try{
  if(Date.now()-statSync(join(markDir(cwd),`${base}-${tip}`)).mtimeMs>KEEP_MS)return null;
 }catch{return null;}
 return count;
}
