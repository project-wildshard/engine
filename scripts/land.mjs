// J240 (Jake, 2026-11-10): land a plan worktree on main by fast-forward only.
// From a linked worktree on plan/<slug>: push the branch, wait until the exact
// SHA is green in hosted `ci` and `ring-1`, rebase onto origin/main, and push
// that SHA to main as a fast-forward. Never a forced main push; if main moved,
// rebase and retry. Each worktree lands on its own: there is no lock between
// worktrees except git's own fast-forward check (and GitHub's protect-main rule).
//
// After a rebase (J249, Jake, 2026-11-10 ~23:35 Cancún: "if CI passes on the branch/worktree and the merge/rebase
// is clean with no conflicts then it goes in… they don't have to re-CI on rebase… we just risk main going red
// because of edge cases." And: "no locking… people collaborate together without locks."):
//   exact    main had not moved: main gets the SHA hosted CI proved.
//   carried  main moved and the rebase was clean (a conflict only in the generated stamps, which land regenerates,
//            counts as clean): the stamps are regenerated for the rebased tree and it goes straight to main on the
//            branch's green run. The pre-push still runs its split gate there (WS_PUSH_POST_CI=1); then land watches
//            main's own hosted run. No path, harness or dependency rule sends it back to branch CI.
//   A real conflict stops land with the paths. The resolved commit is new, so it needs its own branch CI.
// Main's CI runs after every landing; if it goes red, the lane that landed last fixes it forward or reverts it.
import {execFileSync,spawnSync} from 'node:child_process';
import {appendFileSync,existsSync,linkSync,mkdirSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {canonicalRoot,followMain} from './worktree.mjs';

/** The hosted workflows a landing needs green, by workflow name (J195, J240). */
export const LAND_WORKFLOWS=Object.freeze(['ci','ring-1']);
const PLAN_BRANCH=/^plan\/[a-z0-9][a-z0-9._-]*$/u;
/** Generated stamps: a rebase conflict in them alone is resolved by regenerating, never by a person. */
export const STAMPS=Object.freeze(['scripts/renderer-revision.json','scripts/validation-revision.json']);
const SHA=/^[a-f0-9]{40}$/u;

class StopError extends Error{name='StopError';}

/** @param {string} cwd @param {string[]} args @param {NodeJS.ProcessEnv} [env] */
const git=(cwd,args,env=process.env)=>execFileSync('git',args,{cwd,env,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:64<<20}).trim();
/** @param {string} cwd @param {string[]} args @param {NodeJS.ProcessEnv} [env] */
const tryGit=(cwd,args,env=process.env)=>spawnSync('git',args,{cwd,env,encoding:'utf8',maxBuffer:64<<20});
/** @param {string} cwd @param {string} ancestor @param {string} descendant */
const isAncestor=(cwd,ancestor,descendant)=>tryGit(cwd,['merge-base','--is-ancestor',ancestor,descendant]).status===0;
/** @param {string} cwd @param {string} from @param {string} to */
const short=(/** @type {string} */ sha)=>sha.slice(0,10);

/** `owner/name` of a GitHub remote URL, or null.
 * @param {string} remote */
export function githubSlug(remote){
 const match=/^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/)([-\w.]+\/[-\w.]+?)(?:\.git)?\/?$/u.exec(remote.trim());
 return match?.[1]??null;
}

/** Refuse anything but the known options. Any spelling of force is refused by name.
 * @param {string[]} argv */
export function parseArgs(argv){
 const options={pollSeconds:30,timeoutMinutes:60,appearMinutes:5,rounds:6,watchMain:true};
 for(const arg of argv){
  if(/^-f$|force/iu.test(arg))throw new StopError(`refused ${arg}: land never force-pushes main (J240: fast-forward only). If main moved, land rebases and retries by itself`);
  const [name,value]=arg.split('=',2);
  const number=Number(value);
  if(name==='--no-watch-main'&&value===undefined)options.watchMain=false;
  else if(value!==undefined&&Number.isFinite(number)&&number>0&&name==='--poll')options.pollSeconds=number;
  else if(value!==undefined&&Number.isFinite(number)&&number>0&&name==='--timeout')options.timeoutMinutes=number;
  else if(value!==undefined&&Number.isFinite(number)&&number>0&&name==='--appear')options.appearMinutes=number;
  else if(value!==undefined&&Number.isSafeInteger(number)&&number>0&&name==='--rounds')options.rounds=number;
  else throw new StopError(`unknown option ${arg}; usage: node scripts/land.mjs [--poll=SECONDS] [--timeout=MINUTES] [--appear=MINUTES] [--rounds=N] [--no-watch-main]`);
 }
 return options;
}

/** Exact-SHA verdict from the Actions `runs?head_sha=` response: the newest
 * push run of each landing workflow, decided only when all are complete.
 * @param {unknown} data @param {string} sha */
export function shaVerdict(data,sha){
 const runs=data!==null&&typeof data==='object'&&'workflow_runs'in data&&Array.isArray(data.workflow_runs)?data.workflow_runs:[];
 /** @type {Record<string,{id:number,status:string,conclusion:string|null,branch:string,url:string}>} */const latest={};
 for(const run of runs){
  if(run===null||typeof run!=='object'||run.head_sha!==sha||run.event!=='push'||typeof run.id!=='number'||!LAND_WORKFLOWS.includes(run.name))continue;
  const current=latest[run.name];
  if(current===undefined||run.id>current.id)latest[run.name]={id:run.id,status:String(run.status),conclusion:run.conclusion===null||run.conclusion===undefined?null:String(run.conclusion),branch:String(run.head_branch??''),url:String(run.html_url??'')};
 }
 const rows=LAND_WORKFLOWS.map(name=>({name,run:latest[name]}));
 const state=rows.some(row=>row.run===undefined||row.run.status!=='completed')?'pending':rows.every(row=>row.run?.conclusion==='success')?'green':'red';
 return {state,runs:latest,summary:rows.map(row=>`${row.name} ${row.run===undefined?'none':row.run.status==='completed'?row.run.conclusion:row.run.status}`).join(', ')};
}

/** @param {string} repo @param {string} path */
function ghApi(repo,path){
 const result=spawnSync('gh',['api',`repos/${repo}/${path}`],{encoding:'utf8',timeout:30_000,maxBuffer:64<<20});
 if(result.error!==undefined||result.status!==0)throw new Error(`gh api ${path} failed: ${`${result.stderr}${result.error?.message??''}`.trim().slice(0,300)}`);
 return /** @type {unknown} */(JSON.parse(result.stdout));
}

/** J193/J200: `quarantine (n)` jobs run quarantined files with their ordinary exit code and are continue-on-error;
 * they are red by design until rewritten and never block a landing. */
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

/** One landing, start to finish, for the worktree at `cwd`. */
class Landing{
 /** @param {string} cwd @param {ReturnType<typeof parseArgs>} options @param {NodeJS.ProcessEnv} env */
 constructor(cwd,options,env){
  this.options=options;this.env=env;this.started=Date.now();
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
  this.tipFile=resolve(this.root,git(this.root,['rev-parse','--git-path','wildshard-land-tip']));
  this.attemptFile=resolve(this.root,git(this.root,['rev-parse','--git-path','wildshard-plan-pushes']));
  this.reruns=0;
 }

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
  const fetched=tryGit(this.root,['fetch','--quiet','origin','+refs/heads/main:refs/remotes/origin/main']);
  if(fetched.status!==0)throw new StopError(`git fetch origin main failed: ${fetched.stderr.trim()}`);
  return git(this.root,['rev-parse','refs/remotes/origin/main']);
 }

 clean(){
  for(const name of ['rebase-merge','rebase-apply','MERGE_HEAD','CHERRY_PICK_HEAD']){
   if(existsSync(resolve(this.root,git(this.root,['rev-parse','--git-path',name]))))throw new StopError(`a ${name} is in progress in this worktree; finish or abort it first`);
  }
  const dirty=git(this.root,['status','--porcelain','--untracked-files=no']);
  if(dirty!=='')throw new StopError(`commit or drop tracked changes first:\n${dirty}`);
 }

 /** After a rebase that took main's side of a stamp conflict: regenerate the stamps for the finished tree and fold
  * them into the plan's tip commit (its own message, hooks on). A plan with no commit left on main has nothing to fix.
  * @param {string} main */
 regenerateStamps(main){
  if(this.head()===main)return;
  if(git(this.root,['status','--porcelain','--untracked-files=no'])!=='')throw new StopError('the worktree changed during the rebase; commit or drop those changes and run land again');
  const generated=spawnSync(process.execPath,['scripts/gen.mjs','--inputs-only'],{cwd:this.root,env:this.env,encoding:'utf8',maxBuffer:64<<20});
  if(generated.status!==0){
   this.receipt(`STOP stamp regeneration failed after rebase onto ${short(main)}`);
   throw new StopError(`gen.mjs --inputs-only failed after the rebase onto ${short(main)}: ${`${generated.stderr}${generated.stdout}`.trim().split('\n').slice(-3).join(' ')}\nRegenerate by hand, amend, and run land again.`);
  }
  const changed=git(this.root,['diff','--name-only']).split('\n').filter(Boolean);
  // Only the stamps are folded in. gen.mjs also rewrites tables built from local, untracked products; those are
  // land's own side effect on a tree that was clean a moment ago, so they go back to the committed bytes.
  const others=changed.filter(path=>!STAMPS.includes(path)),rewritten=changed.filter(path=>STAMPS.includes(path));
  if(others.length>0&&tryGit(this.root,['checkout','--',...others]).status!==0)throw new StopError(`could not restore ${others.join(', ')} after regenerating stamps`);
  if(rewritten.length===0)return;
  const amended=tryGit(this.root,['add','--',...rewritten]).status===0?tryGit(this.root,['commit','--quiet','--amend','--no-edit','--',...rewritten]):undefined;
  if(amended===undefined||amended.status!==0){
   this.receipt(`STOP stamp amend failed after rebase onto ${short(main)}`);
   throw new StopError(`regenerated ${rewritten.join(', ')} but could not amend ${short(this.head())}: ${amended?.stderr.trim()??'git add failed'}\nCommit them by hand and run land again.`);
  }
  this.say('stamps',`regenerated ${rewritten.join(', ')} into ${short(this.head())}`);
 }

 /** A plain both-modified conflict: base, main and plan stages all present as regular files. A modify/delete or other
  * structural conflict is not resolved by taking main's side. @param {string} path */
 contentConflict(path){
  const stages=git(this.root,['ls-files','-u','-z','--',path]).split('\0').filter(Boolean).map(row=>/^(\d{6}) [0-9a-f]+ (\d)\t/u.exec(row));
  return stages.length===3&&stages.every(match=>match!==null&&/^100(?:644|755)$/u.test(match[1]??''))&&new Set(stages.map(match=>match?.[2])).size===3;
 }

 /** True while a rebase is in progress in this worktree. */
 rebasing(){return ['rebase-merge','rebase-apply'].some(name=>existsSync(resolve(this.root,git(this.root,['rev-parse','--git-path',name]))));}

 /** Rebase onto origin/main; a conflict aborts and stops with the paths.
  * @param {string} main */
 rebase(main){
  const before=this.head();
  let result=tryGit(this.root,['-c','rebase.autoStash=false','-c','rebase.updateRefs=false','rebase','--quiet',main]);
  /** @returns {string[]} */
  const unmerged=()=>git(this.root,['diff','--name-only','--diff-filter=U']).split('\n').filter(Boolean);
  let resolved=0;
  // A conflict only in generated stamps: take main's side (`--ours` while rebasing) and continue. The stamps are
  // regenerated once, below, from the finished tree: gen.mjs reads the committed file list, which mid-rebase is not
  // yet the replayed commit's. Any other conflicted path stops.
  for(let step=0;result.status!==0&&step<200;step++){
   const conflicts=unmerged();
   if(conflicts.length===0&&tryGit(this.root,['diff','--cached','--quiet']).status===0&&this.rebasing()){
    // The commit became empty (a stamp-only commit): drop it.
    result=tryGit(this.root,['-c','core.editor=true','rebase','--skip']);
    continue;
   }
   if(conflicts.length===0||!conflicts.every(path=>STAMPS.includes(path)&&this.contentConflict(path))||!this.rebasing())break;
   if(tryGit(this.root,['checkout','--ours','--',...conflicts]).status!==0||tryGit(this.root,['add','--',...conflicts]).status!==0)break;
   resolved++;
   this.say('stamps',`took main's ${conflicts.join(', ')} for a stamp-only conflict; regenerating after the rebase`);
   result=tryGit(this.root,['-c','core.editor=true','rebase','--continue']);
  }
  if(result.status===0){
   // Every clean rebase gets stamps that match the rebased tree (J249: no rerun for a stale stamp either).
   if(resolved>0||existsSync(join(this.root,'scripts/gen.mjs')))this.regenerateStamps(main);
   this.expected=this.head();
   this.say('rebased',`${short(before)} -> ${short(this.expected)} onto main ${short(main)}${resolved===0?'':`; ${resolved} stamp conflict(s) regenerated`}`);
   return;
  }
  const conflicts=unmerged();
  const aborted=tryGit(this.root,['rebase','--abort']);
  const paths=conflicts.length>0?conflicts.join(', '):'(none reported)';
  if(aborted.status!==0||this.head()!==before||existsSync(resolve(this.root,git(this.root,['rev-parse','--git-path','rebase-merge'])))){
   this.receipt(`STOP rebase onto ${short(main)} failed and its abort did not restore ${short(before)}`);
   throw new StopError(`rebase onto main ${short(main)} failed (${paths}) and git rebase --abort did not restore ${short(before)}: ${aborted.stderr.trim()}\nInspect the worktree by hand: git status, git rebase --abort.`);
  }
  this.receipt(`STOP rebase conflict onto main ${short(main)}: ${paths}`);
  throw new StopError(`rebase onto main ${short(main)} conflicts in: ${paths}\nResolve: git rebase origin/main, fix those paths (stamp conflicts alone land regenerates itself), git rebase --continue, then run land again. HEAD is back at ${short(before)}.`);
 }

 /** J249 provenance: what goes to main on the branch's green run must be exactly main plus that run's SHA, stamps
  * aside. Git's own three-way merge of the two is computed apart from the rebase, and the rebased HEAD must match it
  * file for file; a commit made during the rebase or the stamp regeneration, or anything else, stops land (J206
  * review). The stamps are excluded because land regenerates them for the rebased tree.
  * @param {string} main @param {string} tested */
 verifyReplay(main,tested){
  const merged=tryGit(this.root,['merge-tree','--write-tree','--name-only','--no-messages',main,tested]);
  const [tree='',...conflicted]=merged.stdout.split('\n').map(line=>line.trim()).filter(Boolean);
  const excluded=STAMPS.map(path=>`:(exclude)${path}`);
  const same=SHA.test(tree)&&(merged.status===0||merged.status===1)&&conflicted.every(path=>STAMPS.includes(path))
   &&tryGit(this.root,['diff','--quiet',tree,'HEAD','--','.',...excluded]).status===0;
  if(same)return;
  this.receipt(`STOP rebased ${short(this.head())} is not main ${short(main)} plus the hosted-green ${short(tested)}`);
  throw new StopError(`after the rebase, ${short(this.head())} is not main ${short(main)} plus the hosted-green ${short(tested)} (stamps aside): a commit or edit came in during the land. Check git log, keep what you meant, and run land again; a new commit gets its own branch CI.`);
 }

 /** Push the exact SHA to this worktree's own plan branch. After a rebase the
  * branch is rewritten under a lease on the tip land last saw; main never is.
  * @param {string} sha */
 pushPlan(sha){
  const listed=git(this.root,['ls-remote','origin',`refs/heads/${this.branch}`]).split(/\s+/u)[0]??'';
  const tip=SHA.test(listed)?listed:null;
  if(tip===sha){this.say('pushed',`${this.branch} already at ${short(sha)}`);this.planTip=sha;return;}
  const rewrite=tip!==null&&!isAncestor(this.root,tip,sha);
  // Rewrite only a tip this worktree made itself; anyone else's commits stop it.
  if(rewrite&&!this.ownsTip(tip)){
   const mine=this.shas(this.tipFile).at(-1)??null;
   this.receipt(`STOP origin ${this.branch} is at ${short(tip)}, not this worktree's last push`);
   throw new StopError(`origin ${this.branch} is at ${short(tip)}, which this worktree did not push last (${mine===null?'no record':short(mine)}). Someone else pushed it: fetch and integrate their commits, or rename this plan's branch.`);
  }
  if(rewrite&&tryGit(this.root,['cat-file','-e',`${tip}^{commit}`]).status!==0)tryGit(this.root,['fetch','--quiet','origin',tip]);
  const args=['push','--porcelain',...rewrite?[`--force-with-lease=refs/heads/${this.branch}:${tip}`]:[],'origin',`${sha}:refs/heads/${this.branch}`];
  this.say('pushing',`${this.branch} ${short(sha)}${rewrite?` (rebased; replaces its own ${short(tip)} under a lease)`:''}; the pre-push runs`);
  const result=spawnSync('git',args,{cwd:this.root,env:this.env,encoding:'utf8',stdio:['ignore','pipe','inherit']});
  if(result.status!==0){
   this.receipt(`STOP plan push ${short(sha)} refused (pre-push red or lease lost)`);
   throw new StopError(`push of ${this.branch} ${short(sha)} failed: ${result.stdout.trim()}\nA red pre-push names its failing check above; fix forward and run land again.`);
  }
  this.planTip=sha;appendFileSync(this.tipFile,`${sha}\n`);
 }

 /** SHAs from one of this worktree's records, oldest first. @param {string} file @returns {string[]} */
 shas(file){
  return [...new Set(existsSync(file)?readFileSync(file,'utf8').split('\n').map(line=>line.trim()).filter(line=>SHA.test(line)):[])];
 }

 /** The origin tip is this worktree's own when land itself pushed it, or pushed a descendant of it (a confirmed push:
  * land records only after git reports success), or when this worktree attempted to push exactly that SHA (the
  * pre-push hook records every plan/* push, hand pushes included, before the gate decides:
  * .githooks/record-plan-push.mjs). An attempt never vouches for ancestors: a refused push of a descendant of
  * someone else's commit must not make theirs ours. Reflogs prove nothing about who pushed, so they don't count.
  * @param {string} tip */
 ownsTip(tip){
  const confirmed=this.shas(this.tipFile);
  if(confirmed.includes(tip)||this.shas(this.attemptFile).includes(tip))return true;
  if(tryGit(this.root,['cat-file','-e',`${tip}^{commit}`]).status!==0)return false;
  return confirmed.slice(-50).some(sha=>tryGit(this.root,['cat-file','-e',`${sha}^{commit}`]).status===0&&isAncestor(this.root,tip,sha));
 }

 /** Poll the exact SHA until both landing workflows are complete.
  * @param {string} sha @param {string} what */
 async waitCI(sha,what){
  const deadline=Date.now()+this.options.timeoutMinutes*60_000,appear=Date.now()+this.options.appearMinutes*60_000;
  let last='';
  for(;;){
   /** @type {ReturnType<typeof shaVerdict>} */let verdict;
   try{verdict=shaVerdict(ghApi(this.repo,`actions/runs?head_sha=${sha}&event=push&per_page=100`),sha);}
   catch(error){verdict={state:'pending',runs:{},summary:`lookup failed (${error instanceof Error?error.message:String(error)}); retrying`};}
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
   if(Object.keys(verdict.runs).length===0&&Date.now()>appear)throw new StopError(`no hosted ci/ring-1 run for ${short(sha)} after ${this.options.appearMinutes} min; are ci.yml and ring-1.yml triggered on plan/** pushes?`);
   if(Date.now()>deadline)throw new StopError(`hosted CI for ${short(sha)} not finished after ${this.options.timeoutMinutes} min (${verdict.summary}); run land again to keep waiting`);
   await sleep(this.options.pollSeconds*1000);
  }
 }

 /** Fast-forward main to HEAD. Refuses before pushing unless origin/main is
  * an ancestor; the refspec has no `+` and no force flag ever.
  * @param {boolean} carried @returns {'landed'|'moved'} */
 pushMain(carried){
  const head=this.holds('before the merge'),main=this.fetchMain();
  if(!isAncestor(this.root,main,head))return 'moved';
  if(main===head)return 'landed';
  const args=mainPushArgs(head);
  this.say('merging',`main ${short(main)} -> ${short(head)} fast-forward only${carried?'; split pre-push on the rebased tree (WS_PUSH_POST_CI=1)':'; hosted-green SHA'}`);
  const env=carried?{...this.env,WS_PUSH_POST_CI:'1',WS_PUSH_TIMING_RECORDS:'1'}:this.env;
  const result=spawnSync('git',args,{cwd:this.root,env,encoding:'utf8',stdio:['ignore','pipe','inherit']});
  if(result.status===0)return 'landed';
  // A lost race is main having moved; anything else (a red pre-push) stops.
  const now=this.fetchMain();
  if(now!==main&&!isAncestor(this.root,now,head))return 'moved';
  this.receipt(`STOP main push of ${short(head)} refused: ${result.stdout.trim().split('\n').slice(-2).join(' ')}`);
  throw new StopError(`main push of ${short(head)} failed and main did not move: ${result.stdout.trim()}\nA red pre-push names its failing check above; fix forward and run land again.`);
 }

 async run(){
  this.clean();
  const start=this.head();this.expected=start;
  let main=this.fetchMain();
  if(start===main||isAncestor(this.root,start,main)){this.say('nothing',`${this.branch} ${short(start)} has nothing main lacks`);return 0;}
  this.say('start',`${this.branch} ${short(start)} -> main ${short(main)} (repo ${this.repo})`);
  if(!isAncestor(this.root,main,start)){
   this.rebase(main);
   if(this.head()===main){this.say('nothing',`every commit on ${this.branch} is already on main`);return 0;}
  }
  /** @type {{sha:string,base:string}|null} */let tested=null;
  let needHosted=true,rule='exact',why='main had not moved since the hosted run';
  for(let round=1;round<=this.options.rounds;round++){
   if(needHosted){
    const sha=this.holds('before the branch push');
    this.pushPlan(sha);
    const verdict=await this.waitCI(sha,this.branch);
    this.holds('while hosted CI ran');
    if(verdict.state!=='green'){
     const failed='failed'in verdict?verdict.failed:[];
     this.receipt(`STOP hosted CI red for ${short(sha)}: ${failed.join(' | ')}`);
     throw new StopError(`hosted CI is red for ${short(sha)}; main is unchanged.\n  ${failed.join('\n  ')}\nFix forward on ${this.branch} and run land again.`);
    }
    tested={sha,base:git(this.root,['merge-base',sha,'refs/remotes/origin/main'])};
    needHosted=false;rule='exact';why='main had not moved since the hosted run';
   }
   if(tested===null)throw new Error('unreachable: no hosted-tested SHA');
   main=this.fetchMain();
   if(!isAncestor(this.root,main,this.holds('before the rebase'))){
    this.say('moved',`main moved to ${short(main)}; rebasing (round ${round})`);
    this.rebase(main);
    this.verifyReplay(main,tested.sha);
    rule='carried';why=`clean rebase onto ${short(main)}: the branch's green run ${short(tested.sha)} carries (J249)`;
    this.say('carried',why);
   }
   const outcome=this.pushMain(rule==='carried');
   if(outcome==='moved'){this.say('moved','main moved during the merge; rebasing and retrying');continue;}
   return this.landed(rule,why,round,main);
  }
  this.receipt(`STOP gave up after ${this.options.rounds} rounds; main kept moving`);
  throw new StopError(`main kept moving for ${this.options.rounds} rounds; run land again`);
 }

 /** After GitHub's main moved, bring the canonical checkout's main along (Jake, 2026-11-10 ~23:50 Cancún: "go to
  * the main checkout, pull main, make sure it's up to date, and then merge fast forward only in the main checkout").
  * The push came first, so the canonical checkout is never ahead of GitHub. Only a fast-forward, under worktree.mjs's
  * followMain guards (on main, clean, not diverged, no git operation or other process in it); anything else is a
  * warning and a receipt, never a reset or a stash. The landing stands either way. */
 followCanonical(){
  let canonical='',outcome='';
  try{
   canonical=canonicalRoot(this.root);
   git(canonical,['fetch','--quiet','origin','main']);
   outcome=followMain(canonical,git(canonical,['rev-parse','origin/main']).trim());
  }catch(error){outcome=`could not check it (${error instanceof Error?error.message.split('\n')[0]:String(error)})`;}
  if(/fast-forwarded|current$/u.test(outcome)){this.say('canonical',outcome);return;}
  this.say('canonical',`WARNING ${outcome}; canonical ${canonical||'checkout'} was not updated`);
  this.receipt(`canonical checkout not fast-forwarded after landing: ${outcome}`);
 }

 /** @param {string} rule @param {string} why @param {number} round @param {string} before */
 async landed(rule,why,round,before){
  const head=this.head();
  this.say('landed',`main ${short(before)} -> ${short(head)} (${rule}: ${why})`);
  this.followCanonical();
  this.say('rule',`main's own CI runs on ${short(head)} now. If it goes red, the lane that landed last fixes it forward or reverts it, at once (J249)`);
  // origin plan/<slug> stays: the next land rewrites it under a lease, and the
  // DS13 reaper deletes it with the worktree (a delete push would run the pre-push).
  let code=0,mainCI='reuses the branch run';
  if(rule==='carried'){
   if(this.options.watchMain){
    const verdict=await this.waitCI(head,'main');
    mainCI=verdict.state==='green'?`green (${Object.values(verdict.runs).map(run=>run.id).join(', ')})`:`RED: ${('failed'in verdict?verdict.failed:[]).join(' | ')}`;
    if(verdict.state!=='green'){code=3;this.say('red',`main's hosted run is red for ${short(head)}: fix forward now`);}
   }else mainCI='not watched';
  }
  const seconds=Math.round((Date.now()-this.started)/1000);
  this.receipt(`${code===0?'landed':'landed, MAIN RED'} ${short(head)} on main (${short(before)}..${short(head)}); ${rule}; rounds ${round}; hosted reruns ${this.reruns}; branch ci ${this.runs.join(', ')||'none'}; main ci ${mainCI}; ${seconds} s`);
  return code;
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
  const landing=new Landing(cwd,parseArgs(argv),env);
  unlock=landing.lock();
  return await landing.run();
 }catch(error){
  if(error instanceof StopError){process.stdout.write(`land STOP ${error.message}\n`);return 1;}
  throw error;
 }finally{unlock?.();}
}

if(process.argv[1]!==undefined&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)process.exitCode=await land(process.argv.slice(2));
