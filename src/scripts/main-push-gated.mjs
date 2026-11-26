// main-push gates before it takes the lock (meta M1, mini coordinator 2026-11-16 ~17:50 Cancún: "main-push should run
// the gate before taking the lock ... so waiters don't serialize 4-minute gates"). main-push runs the pre-push on its
// commits first, outside the lock, and marks each gated commit by its patch id (`git patch-id --stable`, which a replay
// onto a newer main keeps). Under the lock it syncs and pushes with WS_MAIN_PUSH_GATED=1; the push lane skips the gate
// when every outgoing commit carries a mark. A commit nobody gated (another lane's, carried along) gates as before.
import {spawnSync} from 'node:child_process';
import {mkdirSync,readdirSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';

/** Marks older than this are swept. */
const KEEP_MS=24*60*60*1000;

/** @param {string} cwd @param {string[]} args @param {string} [input] */
function git(cwd,args,input){
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
 return spawnSync('git',args,{cwd,env,encoding:'utf8',input,maxBuffer:256<<20});
}

/** Where marks live: the common git dir, shared by the checkout and its gate copies. @param {string} cwd */
export function markDir(cwd){
 return join(resolve(cwd,git(cwd,['rev-parse','--git-common-dir']).stdout.trim()),'main-push-gated');
}

/** The patch id of each commit in `range` (oldest first), or null for any commit with none (a merge, an empty commit).
 * @param {string} cwd @param {string} range @returns {string[]|null} */
export function patchIds(cwd,range){
 const commits=git(cwd,['rev-list','--reverse',range]).stdout.trim().split('\n').filter(Boolean);
 /** @type {string[]} */const ids=[];
 for(const commit of commits){
  const diff=git(cwd,['show','--format=','--no-color','--no-ext-diff',commit]).stdout;
  const id=git(cwd,['patch-id','--stable'],diff).stdout.trim().split(/\s+/u)[0]??'';
  if(!/^[a-f0-9]{40}$/u.test(id))return null;
  ids.push(id);
 }
 return ids;
}

/** Mark every commit in `range` as gated. @param {string} cwd @param {string} range @returns {number} marked */
export function markGated(cwd,range){
 const ids=patchIds(cwd,range)??[],dir=markDir(cwd);
 mkdirSync(dir,{recursive:true});
 for(const id of ids)writeFileSync(join(dir,id),`${new Date().toISOString()}\n`);
 try{for(const name of readdirSync(dir))if(Date.now()-statSync(join(dir,name)).mtimeMs>KEEP_MS)rmSync(join(dir,name),{force:true});}catch{/* Housekeeping only. */}
 return ids.length;
}

/** How many commits a main push carries, when every one was gated by main-push; null when any was not (or the push is
 * not a plain update of main). @param {string} cwd @param {string|undefined} refs @returns {number|null} */
export function pregated(cwd,refs){
 const rows=(refs??'').trim().split('\n').filter(Boolean).map(line=>line.trim().split(/\s+/u));
 if(rows.length!==1)return null;
 const [,local='',remote='',base='']=rows[0]??[];
 if(remote!=='refs/heads/main'||!/^[a-f0-9]{40}$/u.test(local)||!/^[a-f0-9]{40}$/u.test(base)||/^0+$/u.test(local)||/^0+$/u.test(base))return null;
 if(git(cwd,['merge-base','--is-ancestor',base,local]).status!==0)return null;
 const ids=patchIds(cwd,`${base}..${local}`),dir=markDir(cwd);
 if(ids===null||ids.length===0)return null;
 for(const id of ids){try{statSync(join(dir,id));}catch{return null;}}
 return ids.length;
}
