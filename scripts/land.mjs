// J422: one way onto main. After every row, from the plan worktree:
// rebase -> gen:inputs (ignored boot stamps) -> push main through the ordinary split pre-push
// (lint, types, related tests, about 74 s) -> main-watch follows main's
// hosted full suite. No plan-branch push, no full suite in the lane, no
// queue. The worktree stays for the next row; --done removes it. A red
// main is fixed forward by the push main-watch names (J422 wave 2).
// FS5 deleted --hosted (the branch-CI land: plan push, CI wait,
// exact/carried main push); FS23 deleted --local (J400's full local gate)
// after the Mac mini's last full-gate land (J443 moved it to push mode).
// Land preserves pin provenance, canonical sync, main-watch and
// owned-worktree cleanup. A red main is fixed forward at once (J249).
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {keepCopy,worktreeState} from './pin-keep-copy.mjs';
import {appendFileSync,existsSync,linkSync,lstatSync,mkdirSync,readFileSync,realpathSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {homedir,hostname} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {MANIFEST as PINS_MANIFEST,stalePinFolders,verifiedPinsOutputs} from './pins-reuse.mjs';
import {checkedTreeDirt} from './push-proof-cache.mjs';
import {installLag} from './install-lag.mjs';
import {canonicalRoot,followMain,withStoreUse} from './worktree.mjs';
import {stopWorktreeProcesses} from './worktree-reap.mjs';
import {assertNoLocalCandidates} from './local-candidates.ts';
import {holdRefusal} from './land-hold.mjs';
import {laneName} from './lane-name.mjs';

/** The hosted workflows a green SHA needs, by workflow name (J195, J240); pin-provenance.mjs reads it. */
// CI-JOB-PACKING (J244): ci, ring-1 and engine-boundaries are one workflow, `ci`.
export const LAND_WORKFLOWS=Object.freeze(['ci']);
const PLAN_BRANCH=/^plan\/[a-z0-9][a-z0-9._-]*$/u;
const SHA=/^[a-f0-9]{40}$/u;

class StopError extends Error{name='StopError';}

/** package.json `gen:inputs`, run directly: pnpm adds nothing here and a fixture's pnpm is a stub. */
const GEN=Object.freeze(['scripts/gen.mjs','--inputs-only']);

/** What to do about one porcelain line that keeps the tree from being clean. Never a fix that deletes new work.
 * @param {string} code @param {string} path @param {string} branch */
function dirtFix(code,path,branch){
 if(code==='??'){
  if(/^public\/(?:assets\/gpu|programs)\//u.test(path))return `untracked pin output: run \`pnpm pins\` here (its manifest no longer matches this tree), or ignore that pin folder in .gitignore as engine 2fa94a78 did`;
  return `untracked: commit it on ${branch} (git add ${path}, then git commit -- ${path}), move it under tmp/, or delete it`;
 }
 if(code.startsWith('A'))return `staged new file: commit it on ${branch} (git commit -- ${path}), or unstage it (git restore --staged ${path}) and move it under tmp/`;
 return `uncommitted change: commit it on ${branch} (git commit -- ${path}), or drop it (git restore --staged --worktree ${path})`;
}

/** Git's own lines in a refused push's output, never the hook's cause. */
const GIT_OWN=/^error: failed to push some refs|^To \S+$|^hint: |^Done$|^!\s/u;
/** Build-max C3 (2026-11-21): under a RED check, what in it failed: the first new red test, type error or lint rule
 * (with its place), and how many more. A STOP that says only "vitest RED" sends the lane back to scroll the gate.
 * @param {string[]} lines plain, trimmed hook lines @returns {string|undefined} */
export function failingDetail(lines){
 const counted=(/** @type {RegExp} */pattern,/** @type {(line:string,index:number)=>string} */name)=>{
  const hits=lines.flatMap((line,index)=>pattern.test(line)?[name(line,index)]:[]);
  return hits[0]===undefined?undefined:`${hits[0]}${hits.length>1?` (+${String(hits.length-1)} more)`:''}`;
 };
 return counted(/^NEW red: /u,line=>line.slice('NEW red: '.length))
  ??counted(/: error TS\d+: /u,line=>line)
  ??counted(/^x \S+\(/u,(line,index)=>{const at=/^,-\[(.+)\]$/u.exec(lines[index+1]??'')?.[1];return `${line.slice(2)}${at===undefined?'':` at ${at}`}`;})
  ??counted(/^FAIL /u,line=>line.slice('FAIL '.length).trim());
}

/** Prefer an actual remote rejection, otherwise the hook's first RED or last
 * thrown error. Git may forward hook output on either stream under --porcelain.
 * Keep Git's stdout separate from hook stderr, which can print sample trailers.
 * @param {string} output @param {string} [porcelain] @param {string} [fallback] @returns {string} */
export function prePushCause(output,porcelain='',fallback=''){
 // oxlint-disable-next-line no-control-regex -- strips terminal colour codes.
 const plain=(/** @type {string} */text)=>text.split('\n').map(line=>line.replaceAll(/\u001B\[[0-9;]*m/gu,'').trim()).filter(line=>line!=='');
 const lines=plain(output);
 const hook=lines.filter(line=>!GIT_OWN.test(line));
 const other=plain(fallback),otherHook=other.filter(line=>!GIT_OWN.test(line));
 const pick=remoteRejection(porcelain)
  ??hook.find(line=>/(?:^|\s)RED(?:\s|$)/u.test(line))?.replace(/^- /u,'')
  ??hook.findLast(line=>/^(?:[A-Z]\w*)?Error: /u.test(line))?.replace(/^(?:[A-Z]\w*)?Error: /u,'')
  ??lines.find(line=>/^!\s.*\[(?:remote )?rejected\]/u.test(line))
  ??otherHook.find(line=>/(?:^|\s)RED(?:\s|$)/u.test(line))?.replace(/^- /u,'')
  ??otherHook.findLast(line=>/^(?:[A-Z]\w*)?Error: /u.test(line))?.replace(/^(?:[A-Z]\w*)?Error: /u,'')
  ??other.find(line=>/^!\s.*\[(?:remote )?rejected\]/u.test(line))
  ??hook.at(-1)
  ??otherHook.at(-1)
  ??plain(porcelain).findLast(line=>!GIT_OWN.test(line));
 if(pick===undefined||pick.trim()==='')return 'no output';
 const detail=/(?:^|\s)RED(?:\s|$)/u.test(pick)?failingDetail([...hook,...otherHook]):undefined;
 return (detail===undefined?pick:`${pick}; ${detail}`).slice(0,300);
}

/** Only Git's final porcelain trailer proves the hook passed and the remote refused.
 * Passing tests can print expected errors (and even sample porcelain output).
 * @param {string} output @returns {string|undefined} */
function remoteRejection(output){
 const trailer=output.slice(output.lastIndexOf('\nTo ')+1);
 if(!trailer.startsWith('To ')||!/^Done\s*$/mu.test(trailer))return undefined;
 return trailer.split('\n').find(line=>/^!\t[^\t]+\t\[(?:remote )?rejected\]/u.test(line));
}

/** Run git with its stderr shown live (the pre-push's progress) and kept, for the receipt's cause.
 * @param {string} cwd @param {string[]} args @param {NodeJS.ProcessEnv} env @param {string} [command]
 * @returns {Promise<{status:number,stdout:string,stderr:string,interrupted:boolean}>} */
function gitTee(cwd,args,env,command='git'){
 return new Promise(_resolve=>{
  // WL22's keepalive policy also belongs to the parent SSH session: the
  // pre-push may spend minutes in its gate before Git sends main.
  /** @type {NodeJS.ProcessEnv} */
  const network={...env,GIT_SSH_COMMAND:env.GIT_SSH_COMMAND??'ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=120 -o TCPKeepAlive=yes'};
  const groups=process.platform!=='win32',child=spawn(command,args,{cwd,env:network,stdio:['ignore','pipe','pipe'],detached:groups});
  let stdout='',stderr='',interrupted=false,settled=false;
  /** @type {ReturnType<typeof setTimeout>|undefined} */let forced;
  const signal=(/** @type {NodeJS.Signals} */kind)=>{
   try{if(groups&&child.pid!==undefined)process.kill(-child.pid,kind);else child.kill(kind);}
   catch(error){if(/** @type {NodeJS.ErrnoException} */(error).code!=='ESRCH')throw error;}
  };
  const stop=()=>{interrupted=true;signal('SIGTERM');forced??=setTimeout(()=>{signal('SIGKILL');},command==='python3'?20000:10000);};
  const exit=()=>{signal('SIGKILL');};
  const pipeLost=(/** @type {NodeJS.ErrnoException} */error)=>{if(error.code==='EPIPE')stop();else throw error;};
  process.once('SIGTERM',stop);process.once('SIGINT',stop);process.once('SIGHUP',stop);process.once('exit',exit);
  process.stdout.on('error',pipeLost);process.stderr.on('error',pipeLost);
  const finish=(/** @type {number} */status,/** @type {string} */error='')=>{
   if(settled)return;settled=true;
   clearTimeout(forced);process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);process.removeListener('SIGHUP',stop);process.removeListener('exit',exit);
   process.stdout.removeListener('error',pipeLost);process.stderr.removeListener('error',pipeLost);
   _resolve({status,stdout,stderr:`${stderr}${error}`,interrupted});
  };
  child.stdout.on('data',chunk=>{stdout=`${stdout}${String(chunk)}`.slice(-(1<<16));if(command!=='git')process.stdout.write(chunk);});
  child.stderr.on('data',chunk=>{process.stderr.write(chunk);stderr=`${stderr}${String(chunk)}`.slice(-(1<<16));});
  child.once('error',error=>{finish(1,`\n${error.message}`);});
  child.once('close',code=>{finish(code??1);});
 });
}

/** @param {string} cwd @param {string[]} args @param {NodeJS.ProcessEnv} [env] */
const git=(cwd,args,env=process.env)=>execFileSync('git',args,{cwd,env,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:64<<20}).trim();
/** @param {string} cwd @param {string[]} args @param {NodeJS.ProcessEnv} [env] */
const tryGit=(cwd,args,env=process.env)=>spawnSync('git',args,{cwd,env,encoding:'utf8',maxBuffer:64<<20});

const NO_CURRENT_PIN_PUBLICATION='no current full pin publication. Run pnpm pins in this worktree and retry';

/** DS22 may commit only after the tracked assets and the full pin publication are present.
 * @param {string} root @param {NodeJS.ProcessEnv} env @returns {string|undefined} */
function bootStampInputProblem(root,env){
 const assets='public/assets/',assetPins='test/pins/assets.json';
 const tracked=new Set(git(root,['ls-files','-z','--',assets,assetPins,'test/pins/shardfiles.json'],env).split('\0').filter(Boolean));
 for(const path of tracked){
  try{if(lstatSync(join(root,path)).isFile())continue;}catch{/* Missing tracked input, including sparse checkouts. */}
  return `tracked boot input ${path} is missing or is not a regular file. Materialize it in this worktree and retry`;
 }
 if(!tracked.has(assetPins))return undefined;
 const {paths,key}=verifiedPinsOutputs(root);
 if(key==='')return NO_CURRENT_PIN_PUBLICATION;
 // verifiedPinsOutputs already validates the manifest and verifies the ledger's mounts by hash.
 // Check completeness too: an old ledger can exist after files under public/assets are removed.
 const manifest=JSON.parse(readFileSync(join(root,PINS_MANIFEST),'utf8'));
 const missing=Object.keys(manifest.mounts).find(path=>path.startsWith(assets)&&!tracked.has(path)&&!paths.has(path));
 if(missing!==undefined)return `pin boot input ${missing} is missing or does not match its manifest. Run pnpm pins in this worktree and retry`;
 return undefined;
}

/** WL12: a recent small branch merits a mode reminder, never a refusal.
 * Reflog selectors carry branch-event time; commit time can predate branch creation.
 * Missing/expired local reflogs cannot establish age and produce no warning.
 * @param {string} root @param {string} branch @param {number} [now]
 * @param {NodeJS.ProcessEnv} [env] @returns {string|null} */
export function smallPlanWarning(root,branch,now=Date.now(),env=process.env){
 if(!PLAN_BRANCH.test(branch))return null;
 const count=tryGit(root,['rev-list','--count',`origin/main..${branch}`],env);
 if(count.status!==0)return null;
 const commits=Number(count.stdout.trim());
 if(!Number.isSafeInteger(commits)||commits<1||commits>3)return null;
 const history=tryGit(root,['reflog','show','--date=unix','--format=%gD%x09%gs',`refs/heads/${branch}`],env);
 if(history.status!==0)return null;
 const first=history.stdout.trim().split('\n').at(-1)??'';
 const created=Number(/@\{(\d+)\}\tbranch: Created from .+$/u.exec(first)?.[1])*1000,age=now-created;
 if(!Number.isFinite(created)||!Number.isFinite(age)||age<0||age>=3*60*60*1000)return null;
 return `WARNING one-row land (J290): commit on main next time (${commits} commit${commits===1?'':'s'}, ${Math.floor(age/60_000)} min old; J336: land a whole plan once)`;
}
/** A ref lock another git process holds or just moved: worktrees share refs, so two lands fetching main at once race
 * for refs/remotes/origin/main ("cannot lock ref ...: is at X but expected Y", engine run 43332891983), and any git
 * may hold packed-refs.lock for a moment. Only these are retried; every other git failure stops as before. */
export const REF_LOCK=/cannot lock ref|Unable to create '[^']*\.lock': File exists/u;
const LOCK_WAITS_MS=[200,400,800,1600];
/** tryGit, tried again after a short backoff while git's only complaint is a ref lock (REF_LOCK). Only for git
 * commands safe to repeat: a fetch or a ref update, never a push.
 * @param {string} cwd @param {string[]} args @param {NodeJS.ProcessEnv} env @param {(why:string)=>void} [onRetry] */
export function tryGitLocked(cwd,args,env,onRetry){
 for(let attempt=0;;attempt++){
  const result=tryGit(cwd,args,env),wait=LOCK_WAITS_MS[attempt];
  if(result.status===0||wait===undefined||!REF_LOCK.test(result.stderr))return result;
  onRetry?.(`git ${args[0]??''} lost a ref lock (${result.stderr.trim().split('\n')[0]??''}); retrying in ${String(wait)} ms`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,wait+Math.floor(Math.random()*wait/2));
 }
}
/** @param {string} cwd @param {string} ancestor @param {string} descendant */
const isAncestor=(cwd,ancestor,descendant)=>tryGit(cwd,['merge-base','--is-ancestor',ancestor,descendant]).status===0;
/** @param {string} cwd @param {string} from @param {string} to */
const short=(/** @type {string} */ sha)=>sha.slice(0,10);

/** What `pnpm pins` leaves (scripts/pins.ts LEDGER). Without it gen.mjs --inputs-only fails, so land runs pins first. */
export const PINS_LEDGER='out/.pins.json';

/** The line that says why a child failed: its last thrown `Error:` line (a stack's tail names only Node's internals, as two
 * gen:inputs stops did on 2026-11-16), else its last three lines, else the spawn error.
 * @param {string} output @param {Error} [error] */
export function failureLine(output,error){
 const lines=output.trim().split('\n').map(line=>line.trim()).filter(Boolean);
 const thrown=lines.findLast(line=>/^(?:\w*Error|StopError)(?:\s\[\w+\])?: /u.test(line));
 return thrown??(lines.length>0?lines.slice(-3).join(' '):error?.message??'no output');
}

/** `owner/name` of a GitHub remote URL, or null.
 * @param {string} remote */
export function githubSlug(remote){
 const match=/^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/)([-\w.]+\/[-\w.]+?)(?:\.git)?\/?$/u.exec(remote.trim());
 return match?.[1]??null;
}

const LOCAL_GONE='--local is gone (meta FLOW-SIMPLE FS23, J443): every machine lands in push mode; run node scripts/land.mjs';

/** Push mode on every machine (J443, meta FLOW-SIMPLE FS23: the Mac mini moved to the push flow, replacing J388 for
 * landing). FS23 deleted J400's full local gate (`--local`, WS_LAND_MODE=local) after the mini's last full-gate land.
 * @param {NodeJS.ProcessEnv} env @param {string} [_host] kept for callers; no host gets its own default @returns {'push'} */
export function defaultMode(env,_host){
 if(env.WS_LAND_MODE==='local')throw new StopError(LOCAL_GONE);
 return 'push';
}

/** Refuse anything but the known options. Any spelling of force is refused by name.
 * @param {string[]} argv @param {NodeJS.ProcessEnv} [env] @param {string} [host] */
export function parseArgs(argv,env=process.env,host=hostname()){
 const options={mode:defaultMode(env,host),rounds:5,keep:false,done:false};
 for(const arg of argv){
  if(/^-f$|force/iu.test(arg))throw new StopError(`refused ${arg}: land never force-pushes main (J240: fast-forward only). If main moved, land rebases and retries by itself`);
  const [name,value]=arg.split('=',2);
  const number=Number(value);
  // Accepted for old callers, and no-ops: land never watches main (LS8) and has no preflight (FS5).
  if((name==='--no-watch-main'||name==='--no-preflight')&&value===undefined)continue;
  if(name==='--hosted')throw new StopError('--hosted is gone (J422, meta FLOW-SIMPLE FS5): land pushes main through the push gate; run node scripts/land.mjs');
  if(name==='--local')throw new StopError(LOCAL_GONE);
  if(name==='--push'&&value===undefined)continue;
  if(name==='--keep'&&value===undefined)options.keep=true;
  else if(name==='--done'&&value===undefined)options.done=true;
  else if(value!==undefined&&Number.isSafeInteger(number)&&number>0&&name==='--rounds')options.rounds=number;
  else throw new StopError(`unknown option ${arg}; usage: node scripts/land.mjs [--done] [--rounds=N] [--keep]`);
 }
 // J422: push mode keeps the plan worktree for the next row unless this is the last one.
 if(!options.done)options.keep=true;
 return options;
}

/** Exact-SHA verdict from the Actions `runs?head_sha=` response: the newest
 * push run of each landing workflow, decided only when all are complete.
 * @param {unknown} data @param {string} sha */
export function shaVerdict(data,sha){
 const runs=data!==null&&typeof data==='object'&&'workflow_runs'in data&&Array.isArray(data.workflow_runs)?data.workflow_runs:[];
 /** @type {Record<string,{id:number,status:string,conclusion:string|null,branch:string,url:string,attempt:number}>} */const latest={};
 for(const run of runs){
  if(run===null||typeof run!=='object'||run.head_sha!==sha||run.event!=='push'||typeof run.id!=='number'||!LAND_WORKFLOWS.includes(run.name))continue;
  const current=latest[run.name];
  if(current===undefined||run.id>current.id)latest[run.name]={id:run.id,status:String(run.status),conclusion:run.conclusion===null||run.conclusion===undefined?null:String(run.conclusion),branch:String(run.head_branch??''),url:String(run.html_url??''),attempt:Number.isSafeInteger(run.run_attempt)?Number(run.run_attempt):1};
 }
 const rows=LAND_WORKFLOWS.map(name=>({name,run:latest[name]}));
 const state=rows.some(row=>row.run===undefined||row.run.status!=='completed')?'pending':rows.every(row=>row.run?.conclusion==='success')?'green':'red';
 return {state,runs:latest,summary:rows.map(row=>`${row.name} ${row.run===undefined?'none':row.run.status==='completed'?row.run.conclusion:row.run.status}`).join(', ')};
}

/** One landing, start to finish, for the worktree at `cwd`. */
class Landing{
 /** @param {string} cwd @param {ReturnType<typeof parseArgs>} options @param {NodeJS.ProcessEnv} env */
 constructor(cwd,options,env){
  this.options=options;this.env=env;this.started=Date.now();
  const named=laneName(env,'land');if('refusal' in named)throw new StopError(named.refusal);
  this.lane=named.lane;
  const inside=tryGit(cwd,['rev-parse','--show-toplevel']);
  if(inside.status!==0)throw new StopError('not inside a git checkout');
  this.root=inside.stdout.trim();
  this.branch=git(this.root,['branch','--show-current']);
  if(!PLAN_BRANCH.test(this.branch))throw new StopError(`land runs on a plan/<slug> branch (J240); this checkout is on ${this.branch===''?'a detached HEAD':this.branch}`);
  const gitDir=resolve(this.root,git(this.root,['rev-parse','--git-dir'])),common=resolve(this.root,git(this.root,['rev-parse','--git-common-dir']));
  if(gitDir===common)throw new StopError('land runs in a linked plan worktree (<repo>/.worktrees/<plan>), never in the canonical checkout');
  this.remote=git(this.root,['remote','get-url','origin']);
  const repo=env.WS_LAND_REPO??githubSlug(this.remote);
  if(repo===null||!/^[-\w.]+\/[-\w.]+$/u.test(repo))throw new StopError(`origin ${this.remote} is not a GitHub repo; main-watch reads its Actions`);
  this.repo=repo;
  this.expected='';
  /** @type {string|null} */this.landedSha=null;
  /** @type {string|null} */this.sizeWarning=null;
 }

 /** @type {(why:string)=>void} */
 retry=why=>{this.say('retry',why);};

 /** @param {string} state @param {string} detail */
 say(state,detail){process.stdout.write(`land ${new Date().toISOString().slice(11,19)} ${state.padEnd(9)} ${detail}\n`);}

 /** @param {string} message */
 receipt(message){
  const file=resolve(this.env.WS_LANE_RECEIPTS??join(homedir(),'.cache/wildshard/lane-receipts.log'));
  try{mkdirSync(dirname(file),{recursive:true});appendFileSync(file,`${new Date().toISOString().slice(11,16)} UTC ${this.lane} land ${this.branch} ${message.replaceAll(/\s+/gu,' ').slice(0,1000)}\n`);}
  catch(error){process.stderr.write(`land receipt unavailable: ${String(error)}\n`);}
 }

 /** One land per worktree at a time; worktrees never wait on each other.
  * The lock file appears whole (a hard link of a written file), and a stale
  * one is taken over by rename, so two contenders can't both clear it. */
 lock(){
  const file=resolve(this.root,git(this.root,['rev-parse','--git-path','wildshard-land.lock'])),mine=`${file}.${process.pid}`;
  writeFileSync(mine,String(process.pid));
  try{
   for(let attempt=0;attempt<3;attempt++){
    try{linkSync(mine,file);return ()=>{rmSync(file,{force:true});};}
    catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='EEXIST'))throw error;}
    const owner=Number(readFileSync(file,'utf8'));
    let alive=Number.isSafeInteger(owner)&&owner>0;
    if(alive){try{process.kill(owner,0);}catch{alive=false;}}
    if(alive)throw new StopError(`land already running in this worktree (pid ${owner})`);
    // Claim the stale file by renaming it; only the contender whose rename
    // took the dead owner's file may drop it. Anything else goes back.
    const taken=`${file}.stale.${process.pid}`;
    try{renameSync(file,taken);}catch{continue;}
    if(Number(readFileSync(taken,'utf8'))===owner)rmSync(taken,{force:true});
    else{try{linkSync(taken,file);}catch{/* A live owner already holds it again. */}rmSync(taken,{force:true});}
   }
   throw new StopError('cannot take this worktree\'s land lock');
  }finally{rmSync(mine,{force:true});}
 }

 /** Stop if HEAD is not the SHA this landing is working on: a commit made
  * while land waits must never ride along unchecked.
  * @param {string} where */
 holds(where){
  const head=this.head();
  if(head!==this.expected){
   this.receipt(`STOP HEAD moved ${where}: ${short(this.expected)} -> ${short(head)}`);
   throw new StopError(`HEAD moved ${where} (${short(this.expected)} -> ${short(head)}): a commit or checkout during the landing. Run land again to land the new HEAD.`);
  }
  return head;
 }

 head(){return git(this.root,['rev-parse','HEAD']);}

 fetchMain(){
  const fetched=tryGitLocked(this.root,['fetch','--quiet','origin','+refs/heads/main:refs/remotes/origin/main'],process.env,this.retry);
  if(fetched.status!==0)throw new StopError(`git fetch origin main failed: ${fetched.stderr.trim()}`);
  return git(this.root,['rev-parse','refs/remotes/origin/main']);
 }

 clean(){
  for(const name of ['rebase-merge','rebase-apply','MERGE_HEAD','CHERRY_PICK_HEAD']){
   if(existsSync(resolve(this.root,git(this.root,['rev-parse','--git-path',name]))))throw new StopError(`a ${name} is in progress in this worktree; finish or abort it first`);
  }
  this.preflight('before the gate');
 }

 /** DS22: the same list push-proof-cache.mjs's clean-tree check refuses (pins outputs this tree's install published
  * pass), checked in seconds instead of minutes into the pre-push. The boot stamps gen:inputs writes are ignored build
  * outputs (SHARD-COMPAT LS1, scripts/boot-stamps.mjs), so any dirt stops land, naming each path and its fix.
  * @param {string} when */
 preflight(when){
  /** @type {{code:string,path:string}[]} */const foreign=[];
  for(const line of checkedTreeDirt(this.root))foreign.push({code:line.slice(0,2),path:line.slice(3)});
  if(foreign.length===0)return;
  foreign.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  this.receipt(`STOP tree not clean ${when}: ${foreign.map(row=>row.path).join(', ')}`);
  throw new StopError(`this worktree is not clean ${when}; the pre-push would refuse it ("Push target requires a clean checked tree"). Each path and its fix:\n${foreign.map(({code,path})=>`  ${code} ${path}: ${dirtFix(code,path,this.branch)}`).join('\n')}\nThen run land again.`);
 }

 /** DS22: before the gate, run gen:inputs (the pre-push's own first step) with stale pin output refused, so a bad pin
  * install stops here in seconds. Its stamps are ignored (LS1): the tree must stay clean, and nothing is committed.
  * @param {boolean} pinsRefreshed whether this preflight already ran pnpm pins */
 regenerate(pinsRefreshed){
  if(!existsSync(join(this.root,GEN[0])))return;
  const before=this.holds('before gen:inputs');
  let problem=bootStampInputProblem(this.root,this.env);
  // A rebase can change the pin key through the validator or installer with every pinned revision unchanged.
  if(problem===NO_CURRENT_PIN_PUBLICATION&&!pinsRefreshed&&this.pinsOnce(true)){
   this.holds('after refreshing the pin publication');
   problem=bootStampInputProblem(this.root,this.env);
  }
  if(problem!==undefined){
   this.receipt(`STOP boot stamps: ${problem}`);
   throw new StopError(`cannot regenerate boot stamps: ${problem}`);
  }
  const ran=spawnSync(process.execPath,[...GEN],{cwd:this.root,env:{...this.env,WS_STALE_PINS:'refuse'},encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:300_000,maxBuffer:64<<20});
  const head=this.head();
  if(head!==before){
   this.receipt(`STOP ${GEN.join(' ')} moved HEAD ${short(before)} -> ${short(head)}`);
   throw new StopError(`${GEN.join(' ')} made a commit (${short(before)} -> ${short(head)}): land runs it only to write the ignored boot stamps. Fix the generator, reset ${this.branch} to ${short(before)} if that commit is unwanted, and run land again.`);
  }
  if(ran.status!==0){
   const why=failureLine(`${ran.stderr}${ran.stdout}`,ran.error);
   this.receipt(`STOP ${GEN.join(' ')} failed: ${why}`);
   throw new StopError(`${GEN.join(' ')} failed before the gate (the pre-push would fail on it too): ${why}\nFix it and run land again.`);
  }
  this.preflight(`after ${GEN.join(' ')}`);
 }

 /** Rebase onto origin/main; a conflict aborts and stops with the paths.
  * @param {string} main */
 rebase(main){
  // FORMAT-PRUNE FP54's land (opus-fp54, 11-25): an edit made while the gate ran left the tree dirty, the race round's rebase
  // refused it, and the stop said only "(none reported)"; the same clean check as before the gate names each path first
  this.preflight(`before rebasing onto main ${short(main)}`);
  const before=this.head();
  const result=tryGit(this.root,['-c','rebase.autoStash=false','-c','rebase.updateRefs=false','rebase','--quiet',main]);
  if(result.status===0){
   this.expected=this.head();
   this.say('rebased',`${short(before)} -> ${short(this.expected)} onto main ${short(main)}`);
   this.installIfDependenciesMoved(before);
   return;
  }
  const conflicts=git(this.root,['diff','--name-only','--diff-filter=U']).split('\n').filter(Boolean);
  const aborted=tryGit(this.root,['rebase','--abort']);
  const paths=conflicts.length>0?conflicts.join(', '):'(none reported)';
  if(aborted.status!==0||this.head()!==before||existsSync(resolve(this.root,git(this.root,['rev-parse','--git-path','rebase-merge'])))){
   this.receipt(`STOP rebase onto ${short(main)} failed and its abort did not restore ${short(before)}`);
   throw new StopError(`rebase onto main ${short(main)} failed (${paths}) and git rebase --abort did not restore ${short(before)}: ${aborted.stderr.trim()}\nInspect the worktree by hand: git status, git rebase --abort.`);
  }
  this.receipt(`STOP rebase conflict onto main ${short(main)}: ${paths}`);
  throw new StopError(`rebase onto main ${short(main)} conflicts in: ${paths}\nResolve: git rebase origin/main, fix those paths, git rebase --continue, then run land again. HEAD is back at ${short(before)}.`);
 }

 /** A rebase that brought in a lockfile or package.json change: install before any pre-push, or every check fails on a
  * missing module (WR2's `@wildshard/wire` turned older worktrees red, 2026-11-11). Frozen, so the lockfile is the law.
  * @param {string} before */
 installIfDependenciesMoved(before){
  const moved=git(this.root,['diff','--name-only',before,'HEAD','--','pnpm-lock.yaml','package.json','**/package.json']).split('\n').filter(Boolean);
  if(moved.length===0)return;
  // Owed until it succeeds: a stop here leaves HEAD rebased, so the next land must not skip it.
  writeFileSync(this.installMarker(),`${moved.join('\n')}\n`);
  this.install(moved);
 }

 /** Where an owed install is remembered, inside this worktree's own git dir. */
 installMarker(){return resolve(this.root,git(this.root,['rev-parse','--git-path','wildshard-land-install']));}

 /** GVS G9/G10: confirmModulesPurge=false lets a worktree made before a store-layout flip reinstall without a TTY
  * (pnpm otherwise aborts: ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY). Purging is only safe in this worktree's own
  * node_modules, never through a link to the canonical checkout's, so a linked one stops. withStoreUse keeps the
  * install out of a running store prune (meta make prune), as worktree.mjs's install does.
  * @param {string[]} moved @param {string} [when] what moved them, for the lines */
 install(moved,when='changed in the rebase'){
  const modules=join(this.root,'node_modules');
  let linked=false;
  try{linked=lstatSync(modules).isSymbolicLink();}catch{/* no node_modules yet */}
  if(linked){
   this.receipt('STOP node_modules here is a link; land will not purge through it');
   throw new StopError(`${modules} is a symlink; land installs only into this worktree's own node_modules. Replace it with a real install (rm the link, pnpm install --frozen-lockfile), then run land again.`);
  }
  this.say('install',`${moved.join(', ')} ${when}; pnpm install --frozen-lockfile`);
  let installed;
  try{
   installed=withStoreUse(this.env,'land install',()=>spawnSync('pnpm',['install','--frozen-lockfile','--config.confirmModulesPurge=false'],{cwd:this.root,env:this.env,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:64<<20}));
  }catch(error){
   const why=error instanceof Error?error.message:String(error);
   const busy=/store prune is running/u.test(why);
   this.receipt(busy?'STOP pnpm install waits: a pnpm store prune is running':`STOP pnpm install could not start: ${why}`);
   throw new StopError(`${why}\n${busy?'Run land again once the prune ends; the install is still owed and runs first.':'Fix that, then run land again; the install is still owed and runs first.'}`);
  }
  if(installed.status===0){rmSync(this.installMarker(),{force:true});return;}
  this.receipt(`STOP pnpm install --frozen-lockfile failed (${moved.join(', ')} ${when})`);
  throw new StopError(`pnpm install --frozen-lockfile failed (${moved.join(', ')} ${when}): ${`${installed.stderr}${installed.stdout}`.trim().split('\n').slice(-3).join(' ')}\nRun it by hand in the worktree, then run land again.`);
 }

 /** Fast-forward main to HEAD. Refuses before pushing unless origin/main is
  * an ancestor; the refspec has no `+` and no force flag ever.
  * J422's push gate (lint, types, related tests) runs in the pre-push.
  * @returns {Promise<'landed'|'moved'>} */
 async pushMain(){
  const head=this.holds('before the merge'),main=this.fetchMain();
  if(!isAncestor(this.root,main,head))return 'moved';
  if(main===head)return 'landed';
  // Meta QA 11-25 row 37: an open engine land HOLD in the receipts stops every lander but the one it names.
  const held=holdRefusal({lane:this.lane,env:this.env,bodies:git(this.root,['log','--format=%B',`${main}..${head}`],this.env)});
  if(held!==null){this.receipt(`STOP ${held}`);throw new StopError(held);}
  const args=mainPushArgs(head);
  this.say('merging',`main ${short(main)} -> ${short(head)} fast-forward only; push gate: lint, types, related tests (J422)`);
  // The pre-push knows this is land's main push and of which kind (.githooks/run-checks.mjs).
  /** @type {NodeJS.ProcessEnv} */
  const env={...this.env,WS_LAND_MAIN_PUSH:`push:${head}`};
  // The outer queue authenticates this controller, never a hook or proof.
  for(const key of Object.keys(env))if(key.startsWith('WS_FULL_GATE_'))Reflect.deleteProperty(env,key);
  Reflect.deleteProperty(env,'WS_LOCAL_LAND_DELTA');
  Reflect.deleteProperty(env,'WS_LOCAL_LAND_BASE_MAIN');
  const result=await gitTee(this.root,args,env);
  if(result.status===0)return 'landed';
  // A lost race is main having moved; anything else (a red pre-push) stops.
  const now=this.fetchMain();
  if(isAncestor(this.root,head,now))return 'landed';
  const rejected=remoteRejection(result.stdout)!==undefined;
  if(!result.interrupted&&rejected&&now!==main&&!isAncestor(this.root,now,head))return 'moved';
  // Structured stderr failures take priority over expected stdout controls.
  const cause=result.interrupted?'interrupted; owned push stopped':prePushCause(result.stderr,result.stdout,'');
  this.receipt(`STOP main push of ${short(head)} refused: ${cause}`);
  // J422: a file written in this worktree while the gate ran made the gate's after-check refuse the tree. The gate now
  // runs in a clean copy for land's push (push-gate-copy.mjs copyReason); a worktree not yet rebased past that fix says so.
  const fix=/requires a clean checked tree/u.test(cause)?'This worktree changed while the gate ran (your next row\'s edits). Run land again: after its rebase the gate runs in a clean copy, so edits during the gate no longer stop it.':'Fix forward and run land again.';
  throw new StopError(`main push of ${short(head)} refused: ${cause}\n${fix}`);
 }

 /** gen:inputs refuses a tree whose `out/` lacks the pins' outputs: a worktree that never ran `pnpm pins` has no PINS_LEDGER
  * (opus-gcm11, 2026-11-15), and one rebased past a pin bump holds the old revision (`stalePinFolders`; codex-netlag and
  * opus-publish1, 2026-11-16). Either way `pnpm pins` runs before gen:inputs.
  * @param {boolean} [refreshPublication] whether the boot check found no current full publication
  * @returns {boolean} whether pnpm pins ran successfully */
 pinsOnce(refreshPublication=false){
  /** @type {{pins?:string}} */let scripts={};
  try{scripts=JSON.parse(readFileSync(join(this.root,'package.json'),'utf8')).scripts??{};}catch{return false;}
  if(scripts.pins===undefined)return false;
  const stale=stalePinFolders(this.root);
  if(!refreshPublication&&existsSync(join(this.root,PINS_LEDGER))&&stale.length===0)return false;
  this.say('pins',refreshPublication?'full pin publication is stale or missing; running pnpm pins before gen:inputs'
   :stale.length===0?`no ${PINS_LEDGER}: this worktree never ran pnpm pins; running it before gen:inputs`
   :`out/ holds pins main no longer names (${stale.map(row=>`${row.folder} revision ${String(row.revision)}`).join(', ')}); running pnpm pins before gen:inputs`);
  const ran=spawnSync('pnpm',['--silent','pins'],{cwd:this.root,env:this.env,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:256<<20});
  if(ran.status!==0){
   const why=`${ran.stderr??''}${ran.stdout??''}`.trim().split('\n').slice(-3).join(' | ')||String(ran.error??`exit ${String(ran.status)}`);
   this.receipt(`STOP pnpm pins failed before gen:inputs: ${why}`);
   throw new StopError(`pnpm pins failed in ${this.root} (gen:inputs needs its outputs); nothing was pushed: ${why}`);
  }
  this.say('pins',`pnpm pins done; ${PINS_LEDGER} written`);
  return true;
 }

 /** @returns {Promise<number>} */
 run(){
  this.clean();
  const start=this.head();this.expected=start;
  const main=this.fetchMain();
  if(start===main||isAncestor(this.root,start,main)){this.say('nothing',`${this.branch} ${short(start)} has nothing main lacks`);return Promise.resolve(0);}
  this.say('start',`${this.branch} ${short(start)} -> main ${short(main)} (repo ${this.repo})`);
  this.sizeWarning=this.options.mode==='push'?null:smallPlanWarning(this.root,this.branch);
  if(this.sizeWarning!==null){this.say('warning',this.sizeWarning);this.receipt(`small-plan warning: ${this.sizeWarning}`);}
  // An install a stopped land owed (its rebase had already moved HEAD) runs before anything else (J206 review).
  if(existsSync(this.installMarker()))this.install(['an earlier land\'s rebase']);
  if(!isAncestor(this.root,main,start)){
   this.rebase(main);
   if(this.head()===main){this.say('nothing',`every commit on ${this.branch} is already on main`);return Promise.resolve(0);}
  }
  // Build-max C4: an install behind the lockfile however it got there (made before a lock move, a by-hand rebase): the
  // pre-push's typecheck reads this node_modules, and on 2026-11-21 stale ones failed every gate for 2.5 h.
  const lag=installLag(this.root);
  if(lag!==''){writeFileSync(this.installMarker(),`${lag}\n`);this.install(['node_modules'],`is behind: ${lag}`);}
  this.regenerate(this.pinsOnce());
  return this.runPush(main);
 }

 /** J422: the ordinary split pre-push gates the main push (lint, types, related tests); main's hosted ci runs the
  * full suite once per tip and main-watch names the push that turned it red. A lost race rebases and pushes again.
  * @param {string} base */
 async runPush(base){
  let main=base;
  for(let round=1;round<=this.options.rounds;round++){
   if(await this.pushMain()==='landed'){
    return this.landed('push','push gate (lint, types, related tests); main ci runs the full suite',round,main);
   }
   main=this.fetchMain();
   this.say('moved',`main moved to ${short(main)}; rebasing and pushing again (round ${round})`);
   this.rebase(main);
   if(this.head()===main){this.say('nothing',`every commit on ${this.branch} is already on main`);return 0;}
   this.regenerate(this.pinsOnce());
  }
  this.receipt(`STOP gave up after ${this.options.rounds} tries; main kept moving`);
  throw new StopError(`main kept moving: ${this.options.rounds} tries each lost the race to another push. Nothing landed; run land again`);
 }

 /** After GitHub's main moved, bring the canonical checkout's main along (Jake, 2026-11-10 ~23:50 Cancún: "go to
  * the main checkout, pull main, make sure it's up to date, and then merge fast forward only in the main checkout").
  * The push came first, so the canonical checkout is never ahead of GitHub. Only a fast-forward, under worktree.mjs's
  * followMain guards (on main, clean, not diverged, no git operation in progress); anything else is a
  * warning and a receipt, never a reset or a stash. The landing stands either way. */
 followCanonical(){
  let canonical='',outcome='';
  try{
   canonical=canonicalRoot(this.root);
   const fetched=tryGitLocked(canonical,['fetch','--quiet','origin','main'],process.env,this.retry);
   if(fetched.status!==0)throw new Error(`git fetch origin main failed: ${fetched.stderr.trim()}`);
   outcome=followMain(canonical,git(canonical,['rev-parse','origin/main']).trim());
  }catch(error){outcome=`could not check it (${error instanceof Error?error.message.split('\n')[0]:String(error)})`;}
  if(/fast-forwarded|main current/u.test(outcome)&&!/CANONICAL INSTALL STALE/u.test(outcome)){this.say('canonical',outcome);return;}
  this.say('canonical',`WARNING ${outcome}; canonical ${canonical||'checkout'} was not updated`);
  this.receipt(`canonical checkout not fast-forwarded after landing: ${outcome}`);
 }

 /** LAND-SIMPLIFY LS5 (J258): main's verdict belongs to scripts/main-watch.mjs. It follows this SHA in the
  * background until main's ci judges it, writes the receipt and messages this pane on red. It runs from the
  * canonical checkout, so it outlives this worktree. WS_MAIN_WATCH=0 turns it off.
  * @param {string} head */
 startWatcher(head){
  const own=join(this.root,'scripts/main-watch.mjs');
  if(this.env.WS_MAIN_WATCH==='0'||!existsSync(own))return;
  // Run the canonical checkout's copy when it has one: this worktree may be removed before node has read its own
  // (J206 review). Otherwise a private copy, rooted at the canonical checkout.
  const canonical=canonicalRoot(this.root),shared=join(canonical,'scripts/main-watch.mjs');
  let script=shared,env=this.env;
  if(!existsSync(shared)){
   script=join(homedir(),'.cache/wildshard/main-watch/main-watch.mjs');
   mkdirSync(dirname(script),{recursive:true});writeFileSync(script,readFileSync(own));
   env={...this.env,WS_MAIN_WATCH_ROOT:canonical};
  }
  const args=[script,`--follow=${head}`,`--lane=${this.lane}`,...(this.env.HERDR_PANE_ID?[`--pane=${this.env.HERDR_PANE_ID}`]:[])];
  try{
   spawn(process.execPath,args,{cwd:canonical,env,detached:true,stdio:'ignore'}).unref();
   this.say('watch',`main-watch follows ${short(head)} and reports main's ci (receipt, and a message here on red)`);
  }catch(error){this.say('watch',`main-watch not started (${error instanceof Error?error.message:String(error)}); run node scripts/main-watch.mjs by hand`);}
 }

 /** LS5 (J258, Jake: "Yes, land cleans up its own"): after landing, remove this worktree with its local branch, from
  * the canonical checkout. A worktree with
  * uncommitted or untracked work is kept and named. The reaper stays only for abandoned worktrees.
  * @returns {string} what happened */
 cleanUp(){
  const head=this.landedSha;
  if(head===null)return 'nothing landed';
  const canonical=canonicalRoot(this.root),/** @type {string[]} */parts=[];
  const dirtyResult=tryGit(this.root,['status','--porcelain','--untracked-files=all']);
  const dirty=dirtyResult.stdout.trimEnd();
  const generatedOnly=dirty!==''&&dirty.split('\n').every(line=>/^[ MAD?]{2} (?:[^"\n]+\.generated\.ts|public\/assets\/gpu\/[^"\n]+)$/u.test(line));
  const patchBefore=tryGit(this.root,['diff','--binary','HEAD']);
  const now=tryGit(this.root,['symbolic-ref','--quiet','HEAD']).stdout.trim(),at=tryGit(this.root,['rev-parse','HEAD']).stdout.trim();
  if(now!==`refs/heads/${this.branch}`||at!==head)parts.push(`worktree kept: HEAD moved off ${this.branch} ${short(head)} after landing`);
  else if(dirtyResult.status!==0||patchBefore.status!==0)parts.push('worktree kept: status unreadable');
  else if(dirty!==''&&!generatedOnly)parts.push(`worktree kept: ${dirty.split('\n').length} uncommitted or untracked path(s)`);
  else{
   // J358's sole removal exception: this land owns this just-landed worktree.
   // Copy first; any failure retains the source and its local branch.
   let before;
   try{
    before=worktreeState(this.root);
    const saved=keepCopy(this.root,{keepRoot:this.env.WS_SESSION_KEEP_ROOT});
    this.say('copied',`recoverable worktree state saved at ${saved.dir}`);
   }catch(error){
    // QA 11-25 row 34: over 50 MiB the small, irreplaceable part is copied anyway; the tree stays, and the line says where.
    const partial=error instanceof Error&&'keepDir' in error?`over 50 MiB; partial copy (unpushed commits, patches, source and scripts) at ${String(error.keepDir)}, the rest listed in its SKIPPED.txt`:null;
    const line=parts.concat(partial===null?`worktree kept: copy failed (${error instanceof Error?error.message:String(error)})`:`worktree kept: ${partial}`).join('; ');
    this.say('cleaned',line);
    return line;
   }
   const unchanged=()=>{try{return worktreeState(this.root)===before;}catch{return false;}};
   if(!unchanged()){
    const line=parts.concat('worktree kept: changed during copy').join('; ');
    this.say('cleaned',line);return line;
   }
   // TEST-SPEED FL30: nothing started here may outlive the folder (an orphaned Vitest held the CPU slots).
   let stopped=[];
   try{stopped=stopWorktreeProcesses(realpathSync(this.root));}catch{
    const line=parts.concat('worktree kept: process cleanup failed').join('; ');
    this.say('cleaned',line);return line;
   }
   if(stopped.length>0)parts.push(`stopped ${String(stopped.length)} process(es) still running there (pid ${stopped.join(', ')})`);
   // Shutdown handlers may write after the copy. Protect their last writes.
   if(!unchanged()){
    const line=parts.concat('worktree kept: changed during process cleanup').join('; ');
    this.say('cleaned',line);return line;
   }
   const removed=tryGit(canonical,['worktree','remove',...(generatedOnly?['--force']:[]),this.root]);
   if(removed.status===0){
    tryGitLocked(canonical,['update-ref','-d',`refs/heads/${this.branch}`,head],process.env,this.retry);
    parts.push(`worktree and ${this.branch} removed; continue from ${canonical}`);
   }else parts.push(`worktree kept (${removed.stderr.trim().split('\n').at(-1)??'git worktree remove refused'})`);
  }
  const line=parts.join('; ');
  this.say('cleaned',line);
  return line;
 }

 /** @param {string} rule @param {string} why @param {number} round @param {string} before */
 landed(rule,why,round,before){
  const head=this.head();
  this.say('landed',`main ${short(before)} -> ${short(head)} (${rule}: ${why})`);
  this.landedSha=head;
  this.followCanonical();
  this.startWatcher(head);
  this.say('rule',`main's own CI runs the full suite on ${short(head)} now. If main-watch names this push on red, fix it forward at once (J422); otherwise keep going`);
  const seconds=Math.round((Date.now()-this.started)/1000);
  this.receipt(`landed ${short(head)} on main (${short(before)}..${short(head)}); ${rule}; rounds ${round}; main ci followed by main-watch${this.sizeWarning===null?'':'; one-row'}; finished=${new Date().toISOString()}; ${seconds} s`);
  return 0;
 }
}

/** The only main push land makes: the exact SHA, an explicit non-forced refspec.
 * @param {string} sha */
export function mainPushArgs(sha){
 if(!SHA.test(sha))throw new Error('land pushes an exact SHA to main');
 const args=['push','--porcelain','origin',`${sha}:refs/heads/main`];
 if(args.some(arg=>arg.startsWith('+')||/force|^-f$/u.test(arg)))throw new Error('land never forces main');
 return args;
}

/** Land the worktree at `cwd`; resolves to the exit code.
 * @param {string[]} argv @param {string} [cwd] @param {NodeJS.ProcessEnv} [env] */
export async function land(argv,cwd=process.cwd(),env=process.env){
 /** @type {(() => void)|null} */let unlock=null;
 try{
  try{assertNoLocalCandidates(cwd,env);}catch(error){throw new StopError(error instanceof Error?error.message:String(error));}
  const landing=new Landing(cwd,parseArgs(argv,env),env);
  unlock=landing.lock();
  const code=await landing.run();
  // Cleanup runs under the land lock (J206 review): no second land can start here meanwhile. The lock file lives in
  // this worktree's git dir, so removing the worktree removes it too; the release below then finds nothing.
  if(!landing.options.keep)landing.cleanUp();
  return code;
 }catch(error){
  if(error instanceof StopError){process.stdout.write(`land STOP ${error.message}\n`);return 1;}
  throw error;
 }finally{unlock?.();}
}

if(process.argv[1]!==undefined&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)process.exitCode=await land(process.argv.slice(2));
