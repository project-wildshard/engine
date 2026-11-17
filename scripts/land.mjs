// J400: worktree -> rebase -> complete local gate -> fast-forward main.
// Default MacBook mode never pushes plan/* and never waits on Actions.
// The ordinary pre-push owns the full gate plus CSS inside a test slot;
// a lost main race rebases and gates the resulting tree again.
// --hosted retains J249/J258's branch-CI fallback: preflight, plan push,
// exact CI, then exact/carried main push. --no-preflight affects only it.
// Both modes preserve pin provenance, canonical sync, main-watch and
// owned-worktree cleanup. A red main is fixed forward at once (J249).
// J381 exception: SKIP_CHECK=1 plus WS_LAND_J381_REASON explicitly audits a
// skipped local gate, never a full proof or a source for delta reuse.
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {keepCopy,worktreeState} from './pin-keep-copy.mjs';
import {appendFileSync,existsSync,linkSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {stalePinFolders} from './pins-reuse.mjs';
import {checkedTreeDirt} from './push-proof-cache.mjs';
import {canonicalRoot,followMain,withStoreUse} from './worktree.mjs';
import {GitHubLimitError,backoffMs,ghFailure,readerEnv} from './gh-limit.mjs';
import {stopWorktreeProcesses} from './worktree-reap.mjs';
import {assertNoLocalCandidates} from './local-candidates.ts';
import {beginLocalHook} from './land-hook-ack.mjs';
import {assertHeavyLease} from './heavy-lane-lease.mjs';

/** The hosted workflows a landing needs green, by workflow name (J195, J240). */
// CI-JOB-PACKING (J244): ci, ring-1 and engine-boundaries are one workflow, `ci`.
export const LAND_WORKFLOWS=Object.freeze(['ci']);
const PLAN_BRANCH=/^plan\/[a-z0-9][a-z0-9._-]*$/u;
const SHA=/^[a-f0-9]{40}$/u;

class StopError extends Error{name='StopError';}

/** J381: explicit audited exception; inherited SKIP_CHECK alone never changes local land.
 * @param {NodeJS.ProcessEnv} env @returns {string|undefined} */
export function localGateHatch(env){
 if(env.SKIP_CHECK!=='1'||env.WS_LAND_J381_REASON===undefined)return undefined;
 const reason=env.WS_LAND_J381_REASON.trim();
 if(reason.length===0||reason.length>120||reason.includes('\n')||reason.includes('\r')){
  throw new StopError('WS_LAND_J381_REASON must be one nonempty line of at most 120 characters');
 }
 return reason;
}

/** DEV-SPEED DS22: the boot stamps the pre-push's gen:inputs rewrites from the tree (scripts/app-build/gen.ts). After a
 * rebase they go stale whenever main changed public/assets, and the pre-push's clean-tree check then refused the push
 * minutes in (58 `pre-push red` receipts in a day). Land runs the same generator first and commits these, and only
 * these, on the plan branch, so they ride the plan push and its pre-push like any commit. Hosted CI regenerates them
 * itself (ci.yml runs gen:inputs before the tests) and doesn't yet diff them against the commit (DS22 follow-up). */
export const STAMPS=Object.freeze(['src/client/game/boot/audio.generated.ts','src/client/game/boot/bytes.generated.ts','src/client/game/boot/versions.generated.ts']);
/** package.json `gen:inputs`, run directly: pnpm adds nothing here and a fixture's pnpm is a stub. */
const GEN=Object.freeze(['scripts/gen.mjs','--inputs-only']);
const STAMPS_MESSAGE='chore(gen): regenerate boot stamps\n\nDEV-SPEED DS22: land ran gen:inputs after its rebase and commits the\nboot stamps it rewrote, so the pre-push sees a clean tree.\n\nAssisted-by: land:ds22-stamps';

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
/** Prefer an actual remote rejection, otherwise the hook's first RED or last
 * thrown error. Git may forward hook output on either stream under --porcelain.
 * Keep Git's stdout separate from hook stderr, which can print sample trailers.
 * @param {string} output @param {string} [porcelain] @returns {string} */
export function prePushCause(output,porcelain=''){
 // oxlint-disable-next-line no-control-regex -- strips terminal colour codes.
 const plain=(/** @type {string} */text)=>text.split('\n').map(line=>line.replaceAll(/\u001B\[[0-9;]*m/gu,'').trim()).filter(line=>line!=='');
 const lines=plain(output);
 const hook=lines.filter(line=>!GIT_OWN.test(line));
 const pick=remoteRejection(porcelain)
  ??hook.find(line=>/(?:^|\s)RED(?:\s|$)/u.test(line))?.replace(/^- /u,'')
  ??hook.findLast(line=>/^(?:[A-Z]\w*)?Error: /u.test(line))?.replace(/^(?:[A-Z]\w*)?Error: /u,'')
  ??lines.find(line=>/^!\s.*\[(?:remote )?rejected\]/u.test(line))
  ??hook.at(-1)
  ??plain(porcelain).findLast(line=>!GIT_OWN.test(line));
 return pick===undefined?'no output':pick.slice(0,300);
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
 * @returns {Promise<{status:number,stdout:string,stderr:string,interrupted:boolean,hookGreen:boolean}>} */
function gitTee(cwd,args,env,command='git'){
 return new Promise(_resolve=>{
  // WL22's keepalive policy also belongs to the parent SSH session: the
  // pre-push may spend minutes in a full gate before Git sends main.
  /** @type {NodeJS.ProcessEnv} */
  const network={...env,GIT_SSH_COMMAND:env.GIT_SSH_COMMAND??'ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=120 -o TCPKeepAlive=yes'};
  const localHead=command==='git'?/^local:([a-f0-9]{40})$/u.exec(env.WS_LAND_MAIN_PUSH??'')?.[1]:undefined;
  const ack=localHead===undefined?null:beginLocalHook(cwd,localHead);
  Reflect.deleteProperty(network,'WS_LAND_HOOK_ACK');
  if(ack!==null)network.WS_LAND_HOOK_ACK=ack.token;
  const groups=process.platform!=='win32',child=spawn(command,args,{cwd,env:network,stdio:['ignore','pipe','pipe'],detached:groups});
  let stdout='',stderr='',interrupted=false,settled=false;
  /** @type {ReturnType<typeof setTimeout>|undefined} */let forced;
  const signal=(/** @type {NodeJS.Signals} */kind)=>{
   try{if(groups&&child.pid!==undefined)process.kill(-child.pid,kind);else child.kill(kind);}
   catch(error){if(/** @type {NodeJS.ErrnoException} */(error).code!=='ESRCH')throw error;}
  };
  const stop=()=>{interrupted=true;signal('SIGTERM');forced??=setTimeout(()=>{signal('SIGKILL');},command==='python3'?20000:10000);};
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
  const finish=(/** @type {number} */status,/** @type {string} */error='')=>{
   if(settled)return;settled=true;
   clearTimeout(forced);process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);
   _resolve({status,stdout,stderr:`${stderr}${error}`,interrupted,hookGreen:ack?.finish()??false});
  };
  child.stdout.on('data',chunk=>{stdout+=String(chunk);if(command!=='git')process.stdout.write(chunk);});
  child.stderr.on('data',chunk=>{process.stderr.write(chunk);stderr=`${stderr}${String(chunk)}`.slice(-(1<<16));});
  child.once('error',error=>{finish(1,`\n${error.message}`);});
  child.once('close',code=>{finish(code??1);});
 });
}

/** @param {string} cwd @param {string[]} args @param {NodeJS.ProcessEnv} [env] */
const git=(cwd,args,env=process.env)=>execFileSync('git',args,{cwd,env,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:64<<20}).trim();
/** @param {string} cwd @param {string[]} args @param {NodeJS.ProcessEnv} [env] */
const tryGit=(cwd,args,env=process.env)=>spawnSync('git',args,{cwd,env,encoding:'utf8',maxBuffer:64<<20});

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

/** CI's `check css` (scripts/ci-static.sh). A tree without it (a fixture, another repo's land) skips the step. */
export const CHECK_CSS='scripts/check-css.mjs';
/** What `pnpm pins` leaves (scripts/pins.ts LEDGER). Without it gen.mjs --inputs-only fails, so land runs pins first. */
export const PINS_LEDGER='out/.pins.json';

/** The preflight's checks, in order, as [name, argv], for a branch whose diff from main is `files` (BUILD-MAX 2026-11-15).
 * check-css is a check CI's static job runs and the pre-push does not (it cost opus-gcm11 a 27-minute re-run). Vitest
 * runs only when code changed, on the tests related to that code (`vitest related`, which includes a changed test itself).
 * @param {string[]} files @returns {[string,string[]][]} */
export function preflightSteps(files){
 const code=files.filter(file=>/^(?:src|test|scripts)\/.+\.[cm]?[jt]sx?$/u.test(file));
 /** @type {[string,string[]][]} */const steps=[['lint:game',['pnpm','lint:game']],['check-css',['node',CHECK_CSS]],['typecheck',['pnpm','typecheck']]];
 if(code.length>0)steps.push(['vitest',['pnpm','exec','vitest','related','--run','--passWithNoTests',...code]]);
 return steps;
}

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

/** Refuse anything but the known options. Any spelling of force is refused by name.
 * @param {string[]} argv @param {NodeJS.ProcessEnv} [env] */
export function parseArgs(argv,env=process.env){
 const options={mode:env.WS_LAND_MODE==='hosted'?'hosted':'local',pollSeconds:60,timeoutMinutes:60,appearMinutes:5,rounds:5,keep:false,preflight:true};
 for(const arg of argv){
  if(/^-f$|force/iu.test(arg))throw new StopError(`refused ${arg}: land never force-pushes main (J240: fast-forward only). If main moved, land rebases and retries by itself`);
  const [name,value]=arg.split('=',2);
  const number=Number(value);
  // --no-watch-main is accepted for old callers: land never watches main now (LS8).
  if(name==='--no-watch-main'&&value===undefined)continue;
  if((name==='--hosted'||name==='--local')&&value===undefined)options.mode=name.slice(2);
  else if(name==='--keep'&&value===undefined)options.keep=true;
  else if(name==='--no-preflight'&&value===undefined)options.preflight=false;
  else if(value!==undefined&&Number.isFinite(number)&&number>0&&name==='--poll')options.pollSeconds=number;
  else if(value!==undefined&&Number.isFinite(number)&&number>0&&name==='--timeout')options.timeoutMinutes=number;
  else if(value!==undefined&&Number.isFinite(number)&&number>0&&name==='--appear')options.appearMinutes=number;
  else if(value!==undefined&&Number.isSafeInteger(number)&&number>0&&name==='--rounds')options.rounds=number;
  else throw new StopError(`unknown option ${arg}; usage: node scripts/land.mjs [--local|--hosted] [--poll=SECONDS] [--timeout=MINUTES] [--appear=MINUTES] [--rounds=N] [--keep] [--no-preflight]`);
 }
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

/** @param {string} repo @param {string} path */
function ghApi(repo,path){
 const result=spawnSync('gh',['api',`repos/${repo}/${path}`],{encoding:'utf8',env:readerEnv(),timeout:30_000,maxBuffer:64<<20});
 if(result.error!==undefined||result.status!==0)throw ghFailure(`gh api ${path}`,`${result.stderr}${result.error?.message??''}`);
 return /** @type {unknown} */(JSON.parse(result.stdout));
}

/** J193/J200: `quarantine (n)` jobs run quarantined files with their ordinary exit code and are continue-on-error;
 * they are red by design until rewritten and never block a landing. Boundaries blocks after TS15's green soak. */
const NONBLOCKING_JOB=/^quarantine(?: \(\d+\))?$/u;
const FAILED=new Set(['failure','timed_out','cancelled','startup_failure']);

/** A run's failed jobs, split into the blocking ones and the non-blocking quarantine ones.
 * @param {unknown} data the Actions `runs/<id>/jobs` response
 * @returns {{blocking:string[],nonblocking:string[]}} */
export function failedJobs(data){
 const jobs=data!==null&&typeof data==='object'&&'jobs'in data&&Array.isArray(data.jobs)?data.jobs:[];
 /** @type {{blocking:string[],nonblocking:string[]}} */const split={blocking:[],nonblocking:[]};
 for(const job of jobs){
  if(job===null||typeof job!=='object'||!FAILED.has(String(job.conclusion)))continue;
  const name=String(job.name);
  (NONBLOCKING_JOB.test(name)?split.nonblocking:split.blocking).push(`${name} (${String(job.conclusion)})`);
 }
 return split;
}

/** @param {string} repo @param {number} id @returns {{blocking:string[],nonblocking:string[]}} */
function runFailures(repo,id){
 try{return failedJobs(ghApi(repo,`actions/runs/${id}/jobs?filter=latest&per_page=100`));}
 catch{return {blocking:['(job list unavailable)'],nonblocking:[]};}
}

const sleep=(/** @type {number} */ ms)=>new Promise(_resolve=>{setTimeout(_resolve,ms);});

/** True when every failed blocking job of the run failed only in its packed-share step (TS10).
 * @param {string} repo @param {number} id */
function onlyPackedStepsFailed(repo,id){
 try{
  const data=ghApi(repo,`actions/runs/${id}/jobs?filter=latest&per_page=100`);
  const jobs=data!==null&&typeof data==='object'&&'jobs'in data&&Array.isArray(data.jobs)?data.jobs:[];
  const failed=jobs.filter(job=>job!==null&&typeof job==='object'&&FAILED.has(String(job.conclusion))&&!NONBLOCKING_JOB.test(String(job.name)));
  return failed.length>0&&failed.every(job=>Array.isArray(job.steps)&&job.steps.filter(step=>step!==null&&typeof step==='object'&&FAILED.has(String(step.conclusion)))
   .every(step=>step.name==="Run this job's packed share")&&job.steps.some(step=>step!==null&&typeof step==='object'&&FAILED.has(String(step.conclusion))));
 }catch{return false;}
}

// TEST-SPEED TS10 (J255): a hosted red whose only failures are test files gets one re-run of its failed jobs. If the
// re-run is green, each of those files takes a strike in the machine's strike book; a file with strikes from two
// different plans within 24 h is quarantined under J200 (two days, owned by the standing TEST-SPEED lane) by a
// commit land adds to the plan before its main push. A red re-run stops land as before: it blocks only its plan.
const STRIKE_WINDOW_MS=24*60*60*1000,QUARANTINE_MS=48*60*60*1000;
/** The test files to strike when a packed ci run's every blocking failure is a test file, from its downloaded
 * `engine-ci-*` artifacts and the names of its failed jobs; null when any failure is something else (a static check,
 * a unit, a shard over its wall, a job with no report) or nothing names a file.
 * @param {string} directory @param {readonly string[]} jobNames blocking failed job names, e.g. `tests (2)`
 * @returns {string[]|null} */
export function flakyFiles(directory,jobNames){
 /** @type {Map<string,unknown>} */const reports=new Map();
 /** @param {string} at */
 const walk=at=>{
  /** @type {import('node:fs').Dirent[]} */let rows=[];
  try{rows=readdirSync(at,{withFileTypes:true});}catch{return;}
  for(const row of rows){
   const path=join(at,row.name);
   if(row.isDirectory())walk(path);
   else if(/^(?:shard-\d+-(?:native|ordinary|wall)|job-\d+)\.json$/u.test(row.name)){
    try{reports.set(row.name,JSON.parse(readFileSync(path,'utf8')));}catch{reports.set(row.name,null);}
   }
  }
 };
 walk(directory);
 /** @type {Set<string>} */const files=new Set();
 for(const name of jobNames){
  const job=/^tests \((\d+)\)(?: \([a-z_]+\))?$/u.exec(name)?.[1];
  if(job===undefined)return null;
  const report=reports.get(`job-${job}.json`);
  if(report===null||typeof report!=='object'||!('units'in report)||!Array.isArray(report.units)||('pinsCode'in report&&report.pinsCode!==0))return null;
  const red=report.units.filter(unit=>unit!==null&&typeof unit==='object'&&unit.blocking===true&&unit.code!==0);
  if(red.length===0)return null;
  for(const unit of red){
   const shard=/^shard:(\d+)$/u.exec(String(unit.name))?.[1];
   if(shard===undefined)return null;
   const wall=reports.get(`shard-${shard}-wall.json`);
   if(wall!==undefined&&(wall===null||typeof wall!=='object'||('overBudget'in wall&&wall.overBudget!==false)))return null;
   let named=0;
   for(const phase of ['native','ordinary']){
    const shardReport=reports.get(`shard-${shard}-${phase}.json`);
    if(shardReport===undefined)continue;
    if(shardReport===null||typeof shardReport!=='object'||!('files'in shardReport)||!Array.isArray(shardReport.files))return null;
    // An unhandled error outside any test file is not a flaky file.
    if('errorCount'in shardReport&&shardReport.errorCount!==0)return null;
    // J295: a file red on time (2x its budget, or amber on main too long) is a hang or an ignored amber, never a
    // flake to re-run away; a file merely over budget is amber and green, so it is never named here.
    if('budget'in shardReport&&shardReport.budget!==null&&typeof shardReport.budget==='object'&&'red'in shardReport.budget
      &&(!Array.isArray(shardReport.budget.red)||shardReport.budget.red.length>0))return null;
    for(const file of shardReport.files){
     if(file===null||typeof file!=='object'||typeof file.file!=='string')return null;
     if(file.state==='failed'){files.add(file.file);named++;}
    }
   }
   if(named===0)return null;
  }
 }
 return files.size===0?null:[...files].sort();
}
/** The plans with a strike on `file` in the 24 h before `now`, from strike-book rows (one JSON object per line).
 * @param {string} book @param {string} file @param {number} now @returns {string[]} */
export function strikePlans(book,file,now){
 /** @type {Set<string>} */const plans=new Set();
 for(const line of book.split('\n')){
  if(line.trim()==='')continue;
  try{
   const row=/** @type {unknown} */(JSON.parse(line));
   if(row===null||typeof row!=='object'||!('file'in row)||row.file!==file||!('plan'in row)||typeof row.plan!=='string'||!('at'in row)||typeof row.at!=='string')continue;
   const at=Date.parse(row.at);
   if(Number.isFinite(at)&&at<=now&&now-at<STRIKE_WINDOW_MS)plans.add(row.plan);
  }catch{/* A torn line is skipped. */}
 }
 return [...plans].sort();
}
/** Add a J200 quarantine entry for `file` unless one is already there; false when it was.
 * @param {string} path test/quarantine.json @param {string} file @param {string} owner @param {string} reason @param {number} now */
export function quarantineFile(path,file,owner,reason,now){
 const data=/** @type {{entries:{file:string}[]}} */(JSON.parse(readFileSync(path,'utf8')));
 if(!Array.isArray(data.entries))throw new Error('test/quarantine.json has no entries list');
 if(data.entries.some(entry=>entry.file===file))return false;
 // J193 history: addedAt is the introducing commit's own (whole-second) time, and the deadline 48 h after it.
 const at=Math.floor(now/1000)*1000;
 data.entries.push({file,owner,addedAt:new Date(at).toISOString(),deadline:new Date(at+QUARANTINE_MS).toISOString(),reason});
 writeFileSync(path,`${JSON.stringify(data,null,2)}\n`);
 return true;
}

/** One landing, start to finish, for the worktree at `cwd`. */
class Landing{
 /** @param {string} cwd @param {ReturnType<typeof parseArgs>} options @param {NodeJS.ProcessEnv} env */
 constructor(cwd,options,env){
  this.options=options;this.env=env;this.started=Date.now();
  this.localHatch=options.mode==='local'?localGateHatch(env):undefined;
  /** @type {{file:string,plans:string[],run:number}[]} */this.pendingQuarantine=[];
  /** @type {string[]} */this.quarantined=[];
  this.quarantineAt=0;
  /** @type {unknown[]} */this.quarantinedEntries=[];
  this.lane=/^[a-z][a-z0-9_-]*$/u.test(env.WS_LANE_NAME??'')?String(env.WS_LANE_NAME):'land';
  const inside=tryGit(cwd,['rev-parse','--show-toplevel']);
  if(inside.status!==0)throw new StopError('not inside a git checkout');
  this.root=inside.stdout.trim();
  this.branch=git(this.root,['branch','--show-current']);
  if(!PLAN_BRANCH.test(this.branch))throw new StopError(`land runs on a plan/<slug> branch (J240); this checkout is on ${this.branch===''?'a detached HEAD':this.branch}`);
  const gitDir=resolve(this.root,git(this.root,['rev-parse','--git-dir'])),common=resolve(this.root,git(this.root,['rev-parse','--git-common-dir']));
  if(gitDir===common)throw new StopError('land runs in a linked plan worktree (<repo>/.worktrees/<plan>), never in the canonical checkout');
  this.remote=git(this.root,['remote','get-url','origin']);
  const repo=env.WS_LAND_REPO??githubSlug(this.remote);
  if(repo===null||!/^[-\w.]+\/[-\w.]+$/u.test(repo))throw new StopError(`origin ${this.remote} is not a GitHub repo; land polls GitHub Actions`);
  this.repo=repo;
  /** @type {number[]} */this.runs=[];
  /** @type {string|null} */this.planTip=null;
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
  return this.preflight('before the gate');
 }

 /** DS22: the same list push-proof-cache.mjs's clean-tree check refuses (pins outputs this tree's install published
  * pass), checked in seconds instead of minutes into the pre-push. Modified boot stamps pass when this tree has the
  * generator that rewrites them; anything else stops land, naming each path and its fix.
  * @param {string} when @returns {string[]} the modified stamps */
 preflight(when){
  const generates=existsSync(join(this.root,GEN[0]));
  /** @type {string[]} */const stamps=[];
  /** @type {{code:string,path:string}[]} */const foreign=[];
  for(const line of checkedTreeDirt(this.root)){
   const code=line.slice(0,2),path=line.slice(3);
   if(generates&&/^(?:M[ M]| M)$/u.test(code)&&STAMPS.includes(path))stamps.push(path);
   else foreign.push({code,path});
  }
  if(foreign.length===0)return stamps;
  foreign.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  this.receipt(`STOP tree not clean ${when}: ${foreign.map(row=>row.path).join(', ')}`);
  throw new StopError(`this worktree is not clean ${when}; the pre-push would refuse it ("Push target requires a clean checked tree"). Each path and its fix:\n${foreign.map(({code,path})=>`  ${code} ${path}: ${dirtFix(code,path,this.branch)}`).join('\n')}\nThen run land again.`);
 }

 /** DS22: before the gate, run gen:inputs (the pre-push's own first step) and commit the boot stamps it rewrote, on
  * the plan branch, so branch CI checks them. The generator may not commit, and may not touch anything else. */
 regenerate(){
  if(!existsSync(join(this.root,GEN[0])))return;
  const before=this.holds('before gen:inputs');
  // the stamps it writes are committed here, so stale pin output refuses instead of warning (gen.ts, stalePinFolders)
  const ran=spawnSync(process.execPath,[...GEN],{cwd:this.root,env:{...this.env,WS_STALE_PINS:'refuse'},encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:300_000,maxBuffer:64<<20});
  const head=this.head();
  if(head!==before){
   this.receipt(`STOP ${GEN.join(' ')} moved HEAD ${short(before)} -> ${short(head)}`);
   throw new StopError(`${GEN.join(' ')} made a commit (${short(before)} -> ${short(head)}): land runs it only to rewrite the boot stamps. Fix the generator, reset ${this.branch} to ${short(before)} if that commit is unwanted, and run land again.`);
  }
  if(ran.status!==0){
   const why=failureLine(`${ran.stderr}${ran.stdout}`,ran.error);
   this.receipt(`STOP ${GEN.join(' ')} failed: ${why}`);
   throw new StopError(`${GEN.join(' ')} failed before the gate (the pre-push would fail on it too): ${why}\nFix it and run land again.`);
  }
  const stamps=this.preflight(`after ${GEN.join(' ')}`);
  if(stamps.length===0)return;
  // The commit hooks run, but not D25's journal rule (a re-baked shard rewrites dozens of stamp lines, and a journal
  // line would be a second path in what must stay a stamps-only commit) nor the commit lane's 8 s cap (a loaded
  // machine would stop land for a generated file). The commit message says why it exists.
  const committed=spawnSync('git',['commit','--quiet','-m',STAMPS_MESSAGE,'--',...stamps],{cwd:this.root,env:{...this.env,SKIP_JOURNAL:'1',SKIP_BUDGET:'1'},encoding:'utf8',stdio:['ignore','pipe','pipe']});
  const sha=this.head();
  const changed=tryGit(this.root,['diff','--name-only',before,sha]).stdout.trim().split('\n').filter(Boolean);
  if(committed.status!==0||tryGit(this.root,['rev-parse',`${sha}^`]).stdout.trim()!==before||changed.some(path=>!STAMPS.includes(path))){
   this.receipt(`STOP stamps commit on ${short(before)} failed or changed more than the stamps`);
   throw new StopError(`committing the regenerated stamps (${stamps.join(', ')}) failed or changed more than them: ${`${committed.stderr}${committed.stdout}`.trim()}\nInspect: git status, git log -2. Then run land again.`);
  }
  this.preflight(`after the stamps commit`);
  this.expected=sha;
  this.say('stamps',`committed ${stamps.join(', ')} rewritten by gen:inputs (${short(sha)})`);
  this.receipt(`stamps committed ${short(sha)}: ${stamps.join(', ')}`);
 }

 /** Rebase onto origin/main; a conflict aborts and stops with the paths.
  * @param {string} main */
 rebase(main){
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
  * @param {string[]} moved */
 install(moved){
  const modules=join(this.root,'node_modules');
  let linked=false;
  try{linked=lstatSync(modules).isSymbolicLink();}catch{/* no node_modules yet */}
  if(linked){
   this.receipt('STOP node_modules here is a link; land will not purge through it');
   throw new StopError(`${modules} is a symlink; land installs only into this worktree's own node_modules. Replace it with a real install (rm the link, pnpm install --frozen-lockfile), then run land again.`);
  }
  this.say('install',`${moved.join(', ')} changed in the rebase; pnpm install --frozen-lockfile`);
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
  this.receipt(`STOP pnpm install --frozen-lockfile failed after the rebase`);
  throw new StopError(`pnpm install --frozen-lockfile failed after the rebase (${moved.join(', ')} changed): ${`${installed.stderr}${installed.stdout}`.trim().split('\n').slice(-3).join(' ')}\nRun it by hand in the worktree, then run land again.`);
 }

 /** J249 provenance: what goes to main on the branch's green run must be exactly main plus that run's SHA. Git's own
  * three-way merge of the two is computed apart from the rebase, and the rebased HEAD must match it file for file; a
  * commit made during the rebase, or anything else, stops land (J206 review).
  * @param {string} main @param {string} tested */
 verifyReplay(main,tested){
  const merged=tryGit(this.root,['merge-tree','--write-tree','--name-only','--no-messages',main,tested]);
  const [tree='',...conflicted]=merged.stdout.split('\n').map(line=>line.trim()).filter(Boolean);
  const excluded=this.quarantined.length===0?[]:[':(exclude)test/quarantine.json'];
  const same=SHA.test(tree)&&merged.status===0&&conflicted.length===0&&tryGit(this.root,['diff','--quiet',tree,'HEAD','--','.',...excluded]).status===0
   &&this.onlyQuarantineAdded(tree,'HEAD');
  if(same)return;
  this.receipt(`STOP rebased ${short(this.head())} is not main ${short(main)} plus the hosted-green ${short(tested)}`);
  throw new StopError(`after the rebase, ${short(this.head())} is not main ${short(main)} plus the hosted-green ${short(tested)}: a commit or edit came in during the land. Check git log, keep what you meant, and run land again; a new commit gets its own branch CI.`);
 }

 /** Push the exact SHA to this worktree's own plan branch (LAND-SIMPLIFY LS4, J258). Land reads origin's real tip
  * (refreshing the remote-tracking ref, which a hand push by URL leaves stale) and rewrites it only when the local
  * branch's reflog reached it: a tip this worktree pushed, by land or by hand, or once held. Anything else is
  * someone else's push and stops land before any push. The push itself carries an explicit lease on that tip, so a
  * push landing in between is refused by git. This is `--force-if-includes`'s rule without its timestamp window,
  * which made git refuse a fresh fetch of the worktree's own tip (J206 review). No record files.
  * @param {string} sha */
 async pushPlan(sha){
  const ref=`refs/heads/${this.branch}`,tracking=`refs/remotes/origin/${this.branch}`;
  if(git(this.root,['rev-parse',ref])!==sha)throw new StopError(`${this.branch} is not at ${short(sha)}; run land again`);
  const fetched=tryGitLocked(this.root,['fetch','--quiet','origin',`+${ref}:${tracking}`],process.env,this.retry);
  if(fetched.status!==0){
   // Only a branch origin lacks clears the tracking ref (a lease on "absent"); any other failure, the network or a
   // lock still held after the retries, stops here instead of passing for someone else's push.
   if(!/couldn't find remote ref/u.test(fetched.stderr))throw new StopError(`git fetch origin ${this.branch} failed: ${fetched.stderr.trim()}`);
   tryGitLocked(this.root,['update-ref','-d',tracking],process.env,this.retry);
  }
  const tipOut=tryGit(this.root,['rev-parse','--verify','--quiet',`${tracking}^{commit}`]).stdout.trim();
  const tip=tipOut===''?null:tipOut;
  if(tip===sha){this.say('pushed',`${this.branch} already at ${short(sha)}`);this.planTip=sha;return;}
  const rewrite=tip!==null&&!isAncestor(this.root,tip,sha);
  if(rewrite&&!this.reached(tip)){
   this.receipt(`STOP plan push ${short(sha)} refused (origin has commits this worktree never had)`);
   throw new StopError(`origin ${this.branch} is at ${short(tip)}, which this worktree's branch never reached: someone else pushed it. Fetch and integrate their commits (git rebase origin/${this.branch}), then run land again; or start a new worktree with a new slug. Never force over it.`);
  }
  const args=['push','--porcelain',`--force-with-lease=${ref}:${tip??''}`,'origin',`${ref}:${ref}`];
  this.say('pushing',`${this.branch} ${short(sha)}${rewrite?` (rebased; replaces its own ${short(tip)} under a lease)`:''}; the pre-push runs`);
  const result=await gitTee(this.root,args,this.env);
  if(result.status!==0){
   const leased=/\[rejected\].*\((?:stale info|fetch first)\)/u.test(result.stdout);
    this.receipt(`STOP plan push ${short(sha)} ${leased?'refused (origin moved during the push)':`refused by the pre-push: ${prePushCause(result.stderr,result.stdout)}`}`);
   throw new StopError(leased
    ?`origin ${this.branch} moved while land pushed, so git refused the lease: someone else pushed it. Fetch and integrate their commits, then run land again. Never force over it.`
    :`push of ${this.branch} ${short(sha)} failed: ${result.stdout.trim()}\nA red pre-push names its failing check above; fix forward and run land again.`);
  }
  this.planTip=sha;
 }

 /** Refresh the hosted proof's remote tip immediately before pushing main. A narrow origin fetch config does not
  * update origin/plan/* on push; the provenance hook must see the tested SHA, never an earlier red tip. A replaced
  * or deleted remote branch stops the land rather than authorizing main from stale local provenance.
  * @param {string} tested */
 refreshPlanTip(tested){
  const tracking=`refs/remotes/origin/${this.branch}`;
  const fetched=tryGitLocked(this.root,['fetch','--quiet','origin',`+refs/heads/${this.branch}:${tracking}`],process.env,this.retry);
  const tip=fetched.status===0?git(this.root,['rev-parse',tracking]):'';
  const why=fetched.status!==0?`git fetch origin ${this.branch} failed: ${fetched.stderr.trim()}`
   :tip!==tested?`origin ${this.branch} changed after hosted CI: tested ${short(tested)}, remote ${short(tip)}; run land again`:'';
  if(why!==''){this.receipt(`STOP ${why}`);throw new StopError(why);}
 }

 /** The local branch reached `tip`: some reflog entry of it is `tip` or a descendant (the newest 200).
  * @param {string} tip */
 /** TS10: re-run a red ci run's failed jobs once when every failure is a test file; on a green re-run, give each
  * file a strike and queue a quarantine for one with strikes from two plans in 24 h.
  * @param {string} sha @param {Awaited<ReturnType<Landing['waitCI']>>} verdict @returns {Promise<Awaited<ReturnType<Landing['waitCI']>>|null>} */
 async retryFlaky(sha,verdict){
  const run=verdict.runs.ci;
  if(run===undefined||run.conclusion!=='failure'||run.attempt>1)return null;
  const jobs=runFailures(this.repo,run.id);
  // A failure after the tests (the wall check after the artifact upload, a later step) is never a flaky file.
  if(!onlyPackedStepsFailed(this.repo,run.id))return null;
  mkdirSync(join(this.root,'tmp'),{recursive:true});
  const scratch=mkdtempSync(join(this.root,'tmp','land-flaky-'));
  /** @type {string[]|null} */let files=null;
  try{
   const fetched=spawnSync('gh',['run','download',String(run.id),'-R',this.repo,'-p','engine-ci-*','-D',scratch],{encoding:'utf8',env:readerEnv(this.env),timeout:120_000});
   if(fetched.status===0&&jobs.blocking.length>0)files=flakyFiles(scratch,jobs.blocking);
  }finally{rmSync(scratch,{recursive:true,force:true});}
  if(files===null)return null;
  this.say('flaky',`ci run ${run.id} red only on test files ${files.join(', ')}; re-running its failed jobs once (TS10)`);
  const rerun=spawnSync('gh',['run','rerun',String(run.id),'-R',this.repo,'--failed'],{encoding:'utf8',timeout:60_000});
  if(rerun.status!==0){this.say('flaky',`re-run refused (${rerun.stderr.trim().split('\n').at(-1)??''}); stopping as red`);return null;}
  // Wait for this run's own second attempt: never attempt one's stale verdict, never another run of the SHA.
  let deadline=Date.now()+this.options.timeoutMinutes*60_000;
  for(;;){
   /** @type {unknown} */let data=null;
   try{data=ghApi(this.repo,`actions/runs/${run.id}`);}
   catch(error){if(error instanceof GitHubLimitError){const wait=this.quotaWait(error,`ci run ${run.id} re-run`);deadline+=wait;await sleep(wait);continue;}/* retried below */}
   const field=(/** @type {string} */key)=>data!==null&&typeof data==='object'&&key in data?String(/** @type {Record<string,unknown>} */(data)[key]):'';
   if(Number(field('run_attempt'))>2){this.say('flaky',`ci run ${run.id} is past its second attempt; stopping as red`);return null;}
   if(Number(field('run_attempt'))===2&&field('status')==='completed'){
    if(field('conclusion')!=='success'){
     this.receipt(`TS10 re-run of ci ${run.id} red again on ${files.join(', ')}: not flaky; blocks only ${this.branch}`);
     return {...verdict,failed:[`ci run ${run.id} red on its re-run too (TS10): ${runFailures(this.repo,run.id).blocking.join('; ')}`]};
    }
    break;
   }
   if(Date.now()>deadline)throw new StopError(`the TS10 re-run of ci ${run.id} did not finish in ${this.options.timeoutMinutes} min; run land again to keep waiting`);
   await sleep(this.options.pollSeconds*1000);
  }
  const again=await this.waitCI(sha,`${this.branch} re-run`);
  if(again.state!=='green')return again;
  const book=resolve(this.env.WS_FLAKE_STRIKES??join(homedir(),'.cache/wildshard/flake-strikes.jsonl')),now=Date.now();
  mkdirSync(dirname(book),{recursive:true});
  for(const file of files){
   appendFileSync(book,`${JSON.stringify({at:new Date(now).toISOString(),file,plan:this.branch,sha,run:run.id,lane:this.lane})}\n`);
   const plans=strikePlans(readFileSync(book,'utf8'),file,now);
   this.receipt(`TS10 strike: ${file} flaky on ci ${run.id} (red, then green on its re-run); plans with a strike in 24 h: ${plans.join(', ')}`);
   if(plans.length>=2)this.pendingQuarantine.push({file,plans,run:run.id});
  }
  return again;
 }

 /** TS10: commit the queued quarantine entries on this plan branch, dated to their addedAt (J193's history check);
  * true when a commit was made. The commit must sit on the tested HEAD and change only those entries. */
 quarantineCommit(){
  if(this.pendingQuarantine.length===0)return false;
  const path=join(this.root,'test/quarantine.json'),added=[],now=Date.now(),parent=this.holds('before the TS10 quarantine');
  for(const {file,plans,run} of this.pendingQuarantine.splice(0)){
   const reason=`TS10 (J255): flaky on hosted CI, red then green on its re-run, with strikes from ${plans.join(' and ')} within 24 h (last: ci run ${run}); J200 deadline`;
   if(quarantineFile(path,file,this.env.WS_QUARANTINE_OWNER??'opus-testspeed-lane',reason,now)){
    added.push(file);
    const written=/** @type {{entries:{file:string}[]}} */(JSON.parse(readFileSync(path,'utf8'))).entries.find(entry=>entry.file===file);
    if(written!==undefined)this.quarantinedEntries.push(written);
   }
  }
  if(added.length===0)return false;
  this.quarantined.push(...added);this.quarantineAt=Math.floor(now/1000);
  const message=`test: quarantine ${added.length===1?added[0]?.replace(/^.*\//u,'').replace(/\.test\.[cm]?[jt]s$/u,''):`${added.length} flaky files`}\n\nTEST-SPEED TS10 (J255): strikes from two plans within 24 h. Land added\nthis entry; it expires in 48 h (J200) and the TEST-SPEED lane owns it.\n\nAssisted-by: land:ts10-strikes`;
  const committed=spawnSync('git',['commit','--quiet','-m',message,'--','test/quarantine.json'],{cwd:this.root,env:this.datedEnv(),encoding:'utf8'});
  if(committed.status!==0)throw new StopError(`TS10 quarantine commit failed: ${committed.stderr.trim()}`);
  this.checkQuarantineCommit(parent);
  this.say('quarantine',`${added.join(', ')} quarantined for 48 h on ${this.branch} ${short(this.expected)} (TS10: two plans' strikes in 24 h)`);
  this.receipt(`TS10 quarantined ${added.join(', ')} (commit ${short(this.expected)})`);
  return true;
 }

 /** After a rebase replays it, the quarantine commit takes back its addedAt date (J193 compares the commit time). */
 redateQuarantine(){
  if(this.quarantined.length===0)return;
  const parent=tryGit(this.root,['rev-parse','HEAD^']).stdout.trim();
  const amended=spawnSync('git',['commit','--quiet','--amend','--no-edit','--','test/quarantine.json'],{cwd:this.root,env:this.datedEnv(),encoding:'utf8'});
  if(amended.status!==0)throw new StopError(`TS10 quarantine re-date failed: ${amended.stderr.trim()}`);
  this.checkQuarantineCommit(parent);
 }

 /** @returns {NodeJS.ProcessEnv} git's author and committer dates pinned to the quarantine's addedAt */
 datedEnv(){
  const date=`${String(this.quarantineAt)} +0000`;
  return {...this.env,GIT_AUTHOR_DATE:date,GIT_COMMITTER_DATE:date};
 }

 /** HEAD must be one commit on `parent` that changes only test/quarantine.json by land's own entries.
  * @param {string} parent */
 checkQuarantineCommit(parent){
  const head=this.head(),changed=tryGit(this.root,['diff','--name-only',parent,head]).stdout.trim();
  if(tryGit(this.root,['rev-parse',`${head}^`]).stdout.trim()!==parent||changed!=='test/quarantine.json'||!this.onlyQuarantineAdded(parent,head)){
   this.receipt(`STOP TS10 quarantine commit ${short(head)} is not just land's entries on ${short(parent)}`);
   throw new StopError(`the TS10 quarantine commit ${short(head)} is not exactly land's entries on ${short(parent)}; nothing landed`);
  }
  this.expected=head;
 }

 /** True when `to`'s test/quarantine.json is `from`'s plus exactly land's entries (or equal when land added none).
  * @param {string} from @param {string} to */
 onlyQuarantineAdded(from,to){
  const read=(/** @type {string} */ref)=>{
   const shown=tryGit(this.root,['show',`${ref}:test/quarantine.json`]);
   if(shown.status!==0)return null;
   try{return /** @type {{entries:{file:string,addedAt?:string}[]}&Record<string,unknown>} */(JSON.parse(shown.stdout));}catch{return null;}
  };
  const before=read(from),after=read(to);
  if(this.quarantined.length===0)return JSON.stringify(before)===JSON.stringify(after);
  if(before===null||after===null||!Array.isArray(before.entries)||!Array.isArray(after.entries))return false;
  // Exactly the merged entries, then land's own entries byte for byte, in that order.
  return JSON.stringify(after)===JSON.stringify({...before,entries:[...before.entries,...this.quarantinedEntries]});
 }

 reached(tip){
  const entries=tryGit(this.root,['reflog','show','--format=%H','-n','200',`refs/heads/${this.branch}`]).stdout.split('\n').filter(line=>SHA.test(line));
  return [...new Set(entries)].some(entry=>entry===tip||isAncestor(this.root,tip,entry));
 }

 /** Poll the exact SHA until both landing workflows are complete.
  * @param {string} sha @param {string} what */
 async waitCI(sha,what){
  // MF12: only an answered lookup counts toward `appear`; a quota stop moves both deadlines by its wait.
  let deadline=Date.now()+this.options.timeoutMinutes*60_000,appear=Date.now()+this.options.appearMinutes*60_000;
  let last='';
  const pollMs=this.options.pollSeconds*1000;
  for(;;){
   /** @type {ReturnType<typeof shaVerdict>} */let verdict;
   try{verdict=shaVerdict(ghApi(this.repo,`actions/runs?head_sha=${sha}&event=push&per_page=100`),sha);}
   catch(error){
    if(error instanceof GitHubLimitError){const wait=this.quotaWait(error,`${what} ${short(sha)}`);deadline+=wait;appear+=wait;last='';await sleep(wait);continue;}
    appear+=pollMs;
    verdict={state:'pending',runs:{},summary:`lookup failed (${error instanceof Error?error.message:String(error)}); retrying`};
   }
   if(verdict.summary!==last){this.say('ci',`${what} ${short(sha)}: ${verdict.summary}`);last=verdict.summary;}
   if(verdict.state==='green'){for(const run of Object.values(verdict.runs))this.runs.push(run.id);return verdict;}
   if(verdict.state==='red'){
    // The run conclusion decides, never a job list: quarantine jobs are continue-on-error, so they can't make a run
    // red on their own, and a list (paged, re-run, cancelled) can't prove the blocking jobs passed. The stop line
    // names the blocking failures and sets the quarantine reds apart, so nobody chases a non-blocking job.
    const reds=Object.entries(verdict.runs).filter(([,run])=>run.conclusion!=='success').map(([name,run])=>({name,run,jobs:runFailures(this.repo,run.id)}));
    const failed=reds.map(({name,run,jobs})=>`${name} run ${run.id} ${run.conclusion}: ${jobs.blocking.join('; ')||'no blocking failed job listed'}${jobs.nonblocking.length===0?'':` (non-blocking: ${jobs.nonblocking.join('; ')})`}${run.url===''?'':` ${run.url}`}`);
    return {...verdict,failed};
   }
   if(Object.keys(verdict.runs).length===0&&Date.now()>appear)throw new StopError(`no hosted ci run for ${short(sha)} after ${this.options.appearMinutes} min; is ci.yml triggered on plan/** pushes?`);
   if(Date.now()>deadline)throw new StopError(`hosted CI for ${short(sha)} not finished after ${this.options.timeoutMinutes} min (${verdict.summary}); run land again to keep waiting`);
   await sleep(pollMs);
  }
 }

 /** MF12: say that GitHub's quota is spent (not that CI is missing) and how long land waits for it.
  * @param {GitHubLimitError} error @param {string} what @returns {number} the wait in ms */
 quotaWait(error,what){
  const wait=backoffMs(error,this.options.pollSeconds*1000),span=wait<120_000?`${String(Math.ceil(wait/1000))} s`:`${String(Math.ceil(wait/60_000))} min`;
  this.say('ci',`${what}: GitHub API quota spent (${error.message.split('\n')[0].slice(0,120)}); waiting ${span} for it to reset, then resuming. Not a CI failure; the CI deadlines move by the wait`);
  return wait;
 }

 /** Fast-forward main to HEAD. Refuses before pushing unless origin/main is
  * an ancestor; the refspec has no `+` and no force flag ever.
  * @param {boolean} carried @param {boolean} [local]
  * @param {{baseMain:string,testedHead:string,incomingMain:string,head:string}|null} [delta]
  * @returns {Promise<'landed'|'moved'>} */
 async pushMain(carried,local=false,delta=null){
  const head=this.holds('before the merge'),main=this.fetchMain();
  if(!isAncestor(this.root,main,head))return 'moved';
  if(main===head)return 'landed';
  const args=mainPushArgs(head);
  const hatch=local?this.localHatch:undefined;
  this.say('merging',`main ${short(main)} -> ${short(head)} fast-forward only${hatch===undefined?local?'; full local gate (J400)':carried?'; static pre-push on the rebased tree, no Vitest (LS3)':'; the hosted-green SHA, no local gate':`; J381 SKIP_CHECK=1: ${hatch}; no full proof`}`);
  // LS3 (J258): the pre-push knows this is land's main push and of which kind (.githooks/run-checks.mjs).
  /** @type {NodeJS.ProcessEnv} */
  const env={...this.env,WS_LAND_MAIN_PUSH:`${local?'local':carried?'carried':'exact'}:${head}`};
  // The outer queue authenticates this controller, never a hook or proof.
  for(const key of Object.keys(env))if(key.startsWith('WS_FULL_GATE_'))Reflect.deleteProperty(env,key);
  Reflect.deleteProperty(env,'WS_LOCAL_LAND_DELTA');
  Reflect.deleteProperty(env,'WS_LOCAL_LAND_BASE_MAIN');
  if(local&&hatch===undefined)env.WS_LOCAL_LAND_BASE_MAIN=main;
  if(local&&delta!==null&&hatch===undefined)env.WS_LOCAL_LAND_DELTA=JSON.stringify(delta);
  if(local&&hatch===undefined)Reflect.deleteProperty(env,'SKIP_CHECK');
  if(hatch!==undefined)this.receipt(`J381 SKIP_CHECK=1 ${short(head)}: ${hatch}; no full proof`);
  const result=await gitTee(this.root,args,env);
  if(result.status===0)return 'landed';
  // A lost race is main having moved; anything else (a red pre-push) stops.
  const now=this.fetchMain();
  if(isAncestor(this.root,head,now))return 'landed';
  const rejected=remoteRejection(result.stdout)!==undefined;
  if(!result.interrupted&&(!local||result.hookGreen)&&rejected&&now!==main&&!isAncestor(this.root,now,head))return 'moved';
  const hook=local&&!result.hookGreen?`${result.stderr}\n${result.stdout}`:result.stderr;
  const porcelain=local&&!result.hookGreen?'':result.stdout;
  const cause=result.interrupted?'interrupted; owned push stopped':prePushCause(hook,porcelain);
  this.receipt(`STOP main push of ${short(head)} refused: ${cause}`);
  throw new StopError(`main push of ${short(head)} refused: ${cause}\nFix forward and run land again.`);
 }

 /** lint:game, typecheck and the related Vitest files, here, before anything is pushed; the first red stops land with
  * its log. The logs live in this worktree's git dir, so they never dirty the tree and go when the worktree does.
  * @param {string} main */
 localChecks(main){
  if(!this.options.preflight){this.say('preflight','skipped (--no-preflight)');return;}
  const head=this.head(),files=git(this.root,['diff','--name-only','--no-renames',`${main}...${head}`]).split('\n').filter(Boolean);
  const dir=resolve(this.root,git(this.root,['rev-parse','--git-path','land-preflight']));
  mkdirSync(dir,{recursive:true});
  for(const [name,[command,...args]] of preflightSteps(files)){
   if(command==='node'&&!existsSync(join(this.root,args[0]??''))){this.say('preflight',`${name} skipped: no ${args[0]} here`);continue;}
   const log=join(dir,`${short(head)}-${name.replace(':','-')}.log`),began=Date.now();
   this.say('preflight',`${name} on ${short(head)}`);
   const ran=spawnSync(command==='node'?process.execPath:command??'pnpm',args,{cwd:this.root,env:this.env,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:256<<20});
   writeFileSync(log,`$ ${command} ${args.join(' ')}\n${ran.stdout??''}${ran.stderr??''}${ran.error===undefined?'':`\n${String(ran.error)}\n`}`);
   if(ran.status!==0){
    this.receipt(`STOP preflight ${name} red on ${short(head)}, nothing pushed: ${log}`);
    throw new StopError(`preflight ${name} is red on ${short(head)}; nothing was pushed. Log: ${log}\nFix it on ${this.branch} and run land again (--no-preflight skips the preflight).`);
   }
   this.say('preflight',`${name} green in ${String(Math.round((Date.now()-began)/1000))} s`);
  }
 }

 /** gen:inputs refuses a tree whose `out/` lacks the pins' outputs: a worktree that never ran `pnpm pins` has no PINS_LEDGER
  * (opus-gcm11, 2026-11-15), and one rebased past a pin bump holds the old revision (`stalePinFolders`; codex-netlag and
  * opus-publish1, 2026-11-16). Either way `pnpm pins` runs before gen:inputs; with or without --no-preflight, since
  * gen:inputs needs it either way. */
 pinsOnce(){
  /** @type {{pins?:string}} */let scripts={};
  try{scripts=JSON.parse(readFileSync(join(this.root,'package.json'),'utf8')).scripts??{};}catch{return;}
  if(scripts.pins===undefined)return;
  const stale=stalePinFolders(this.root);
  if(existsSync(join(this.root,PINS_LEDGER))&&stale.length===0)return;
  this.say('pins',stale.length===0?`no ${PINS_LEDGER}: this worktree never ran pnpm pins; running it before gen:inputs`
   :`out/ holds pins main no longer names (${stale.map(row=>`${row.folder} revision ${String(row.revision)}`).join(', ')}); running pnpm pins before gen:inputs`);
  const ran=spawnSync('pnpm',['--silent','pins'],{cwd:this.root,env:this.env,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:256<<20});
  if(ran.status!==0){
   const why=`${ran.stderr??''}${ran.stdout??''}`.trim().split('\n').slice(-3).join(' | ')||String(ran.error??`exit ${String(ran.status)}`);
   this.receipt(`STOP pnpm pins failed before gen:inputs: ${why}`);
   throw new StopError(`pnpm pins failed in ${this.root} (gen:inputs needs its outputs); nothing was pushed: ${why}`);
  }
  this.say('pins',`pnpm pins done; ${PINS_LEDGER} written`);
 }

 async run(){
  const stamps=this.clean();
  const start=this.head();this.expected=start;
  let main=this.fetchMain();
  if(start===main||isAncestor(this.root,start,main)){this.say('nothing',`${this.branch} ${short(start)} has nothing main lacks`);return 0;}
  this.say('start',`${this.branch} ${short(start)} -> main ${short(main)} (repo ${this.repo})`);
  this.sizeWarning=smallPlanWarning(this.root,this.branch);
  if(this.sizeWarning!==null){this.say('warning',this.sizeWarning);this.receipt(`small-plan warning: ${this.sizeWarning}`);}
  // An install a stopped land owed (its rebase had already moved HEAD) runs before anything else (J206 review).
  if(existsSync(this.installMarker()))this.install(['an earlier land\'s rebase']);
  // DS22: gen:inputs rewrites the stamps from the tree after the rebase, so their stale bytes never block it.
  if(stamps.length>0&&!isAncestor(this.root,main,start)){
   git(this.root,['restore','--staged','--worktree','--',...stamps]);
   this.say('stamps',`set aside ${stamps.join(', ')} for the rebase; gen:inputs rewrites them after it`);
   this.receipt(`stamps set aside for the rebase: ${stamps.join(', ')}`);
  }
  if(!isAncestor(this.root,main,start)){
   this.rebase(main);
   if(this.head()===main){this.say('nothing',`every commit on ${this.branch} is already on main`);return 0;}
  }
  this.pinsOnce();
  this.regenerate();
  if(this.options.mode==='local')return this.runLocal(main);
  this.localChecks(main);
  /** @type {{sha:string,base:string}|null} */let tested=null;
  let needHosted=true,rule='exact',why='main had not moved since the hosted run';
  for(let round=1;round<=this.options.rounds;round++){
   if(needHosted){
    const sha=this.holds('before the branch push');
    await this.pushPlan(sha);
    let verdict=await this.waitCI(sha,this.branch);
    this.holds('while hosted CI ran');
    if(verdict.state==='red'){
     const retried=await this.retryFlaky(sha,verdict);
     if(retried!==null){verdict=retried;this.holds('while the re-run ran');}
    }
    if(verdict.state!=='green'){
     const failed='failed'in verdict?verdict.failed:[];
     this.receipt(`STOP hosted CI red for ${short(sha)}: ${failed.join(' | ')}`);
     throw new StopError(`hosted CI is red for ${short(sha)}; main is unchanged.\n  ${failed.join('\n  ')}\nFix forward on ${this.branch} and run land again.`);
    }
    tested={sha,base:git(this.root,['merge-base',sha,'refs/remotes/origin/main'])};
    needHosted=false;rule='exact';why='main had not moved since the hosted run';
    if(this.quarantineCommit()){rule='carried';why=`TS10 quarantine on top of the branch's green run ${short(sha)}: it only adds test/quarantine.json entries`;}
   }
   if(tested===null)throw new Error('unreachable: no hosted-tested SHA');
   main=this.fetchMain();
   if(!isAncestor(this.root,main,this.holds('before the rebase'))){
    this.say('moved',`main moved to ${short(main)}; rebasing (round ${round})`);
    this.rebase(main);
    this.verifyReplay(main,tested.sha);
    this.redateQuarantine();
    rule='carried';why=`clean rebase onto ${short(main)}: the branch's green run ${short(tested.sha)} carries (J249)`;
    this.say('carried',why);
   }
   this.refreshPlanTip(tested.sha);
   const outcome=await this.pushMain(rule==='carried');
   if(outcome==='moved'){this.say('moved','main moved during the merge; rebasing and retrying');continue;}
   return this.landed(rule,why,round,main);
  }
  this.receipt(`STOP gave up after ${this.options.rounds} tries; main kept moving`);
  throw new StopError(`main kept moving: ${this.options.rounds} tries each lost the race to another push (J258 stops at 5). Nothing landed; run land again when main is quieter`);
 }

 /** J400: the real pre-push owns the complete local gate. No plan ref is published.
  * A lost FF race may compose a real full-tree proof with a disjoint delta.
  * The gate authenticates it; missing/overlapping evidence keeps the full suite.
  * WL22's gate-before-lock principle applies: there is no shared main lock while testing.
  * @param {string} base */
 async runLocal(base){
  let main=base;
  /** @type {{baseMain:string,testedHead:string,incomingMain:string,head:string}|null} */let delta=null;
  for(let round=1;round<=this.options.rounds;round++){
   const testedHead=this.head(),baseMain=main;
   if(await this.pushMain(false,true,delta)==='landed'){
    const hatch=this.localHatch;
    return this.landed(hatch===undefined?'local':'local-hatch',hatch===undefined?'local full proof plus verified delta when disjoint; no hosted branch run':`J381 SKIP_CHECK=1: ${hatch}; no full proof`,round,main);
   }
   main=this.fetchMain();
   this.say('moved',`main moved to ${short(main)}; rebase, then verify the prior full proof and incoming delta`);
   this.rebase(main);
   this.pinsOnce();
   this.regenerate();
   // Reuse the directly completed full basis and check the cumulative main
   // delta on later races; never turn a composed receipt into a full basis.
   delta={baseMain:delta?.baseMain??baseMain,testedHead:delta?.testedHead??testedHead,incomingMain:main,head:this.head()};
  }
  throw new StopError(`main kept moving after ${this.options.rounds} local-gate attempts; nothing landed`);
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

 /** LS5 (J258, Jake: "Yes, land cleans up its own"): after landing, delete origin's plan branch (under a lease on the
  * SHA land pushed) and remove this worktree with its local branch, from the canonical checkout. A worktree with
  * uncommitted or untracked work is kept and named. The reaper stays only for abandoned worktrees.
  * @returns {string} what happened */
 cleanUp(){
  const head=this.landedSha;
  if(head===null)return 'nothing landed';
  const canonical=canonicalRoot(this.root),parts=[];
  if(this.planTip!==null){
   const deleted=tryGit(this.root,['push','--quiet',`--force-with-lease=refs/heads/${this.branch}:${this.planTip}`,'origin','--delete',this.branch]);
   parts.push(deleted.status===0?`origin ${this.branch} deleted`:`origin ${this.branch} kept (${deleted.stderr.trim().split('\n').at(-1)??'push refused'})`);
  }
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
    const line=parts.concat(`worktree kept: copy failed (${error instanceof Error?error.message:String(error)})`).join('; ');
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
  this.say('rule',`main's own CI runs on ${short(head)} now. If it goes red, the lane that landed last fixes it forward or reverts it, at once (J249)`);
  const seconds=Math.round((Date.now()-this.started)/1000);
  this.receipt(`landed ${short(head)} on main (${short(before)}..${short(head)}); ${rule}; rounds ${round}; branch ci ${this.runs.join(', ')||'none'}; main ci ${rule==='exact'?'reuses the branch run':'followed by main-watch'}${this.sizeWarning===null?'':'; one-row'}${rule==='local'?`; finished=${new Date().toISOString()}`:''}; ${seconds} s`);
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
  if(landing.options.mode==='local'&&landing.localHatch===undefined){
   if(env.WS_FULL_GATE_TOKEN===undefined){
    // Refuse an active same-tree controller before joining the machine FIFO.
    const release=landing.lock();release();landing.clean();
    const result=await gitTee(landing.root,[resolve(import.meta.dirname,'heavy-lane.py'),'full-gate','--max=45','--admission-wait-seconds=6000','--',process.execPath,resolve(import.meta.dirname,'land.mjs'),...argv],
     {...env,WS_FULL_GATE_EXPECTED_HEAD:landing.head(),WS_FULL_GATE_EXPECTED_BRANCH:landing.branch},'python3');
    return result.interrupted?1:result.status;
   }
   try{assertHeavyLease('full-gate',{...env,WS_HEAVY_ROOT:env.WS_FULL_GATE_ROOT,WS_HEAVY_TOKEN:env.WS_FULL_GATE_TOKEN});}
   catch{throw new StopError('full-gate controller needs its live machine queue ancestor');}
   if(landing.head()!==env.WS_FULL_GATE_EXPECTED_HEAD||landing.branch!==env.WS_FULL_GATE_EXPECTED_BRANCH)throw new StopError('queued worktree changed; run land again');
  }
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
