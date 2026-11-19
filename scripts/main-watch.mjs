// LAND-SIMPLIFY LS5 (J258): main's CI verdict, reported by a small watcher instead of by land. Jake, 2026-11-11:
// land returns as soon as main is pushed; "a receipt line + a direct message to that agent" on red, and the
// buddy-engine gets the red if a lander is unreachable.
//
//   node scripts/main-watch.mjs                     judge every finished main ci run not judged yet (tick or by hand)
//   node scripts/main-watch.mjs --follow=<sha> [--lane=<name>] [--pane=<herdr pane>] [--after-push=<s>]
//                                                   wait until <sha> has a verdict, then judge (land starts this;
//                                                   a mode-1 main pre-push starts it with --after-push, EV2)
//
// The verdict for a SHA is the newest completed main `ci` run that isn't cancelled and whose SHA is that SHA or a
// descendant of it. A cancelled run is superseded when a later main run exists, never red; with no later run,
// the watcher dispatches `ci` on main once. A started run cancelled with a blocking job failed, timed out or
// cancelled is red, not superseded: main cancels a started run only for a timeout (J422) or when it is red already (FS24). Each red run gives one `MAIN RED <range>` receipt naming the landers
// of the commits in its range (from their `landed` receipts) and a message to each lander's herdr pane. State
// (~/.cache/wildshard/main-watch.json) keeps the judged run ids, so a run is reported once however often this runs.
// A green run that carries AMBER files (J295: a test file over its time budget, scripts/test-amber.mjs) also gives
// one `main AMBER <sha> <file> <ms>/<budget>` receipt per file: the coordinator hands each out as a queue-skipping
// fix row the same day (meta HOW-WE-BUILD-PLAN.md). AUDIO AU6 (J303): a shard whose audio is over 6 MB gives the same
// kind of receipt, `main AMBER <sha> audio <shard> <tier> <MB>/6.00 MB`, from the cook report's test; never a red main.
import {execFileSync,spawn} from 'node:child_process';
import {appendFileSync,existsSync,mkdirSync,openSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {setTimeout} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {AMBER,parseAmber,parseAudioAmber,parseMemoryWarnings} from './test-amber.mjs';
import {RATE_LIMITED,quotaReset,readerEnv} from './gh-limit.mjs';
import {budgetReport,budgetSourceRun,parseBudgetResults} from './budgets/watch.mjs';

export const REPO='project-wildshard/engine';
const KEEP=500;
/** FS22 (J443): a red with no green this long after its first alert goes to the keeper. */
export const KEEPER_MS=20*60_000;
// NB6's street and EM35's Chromium diagnostic jobs are advisory.
const ADVISORY_VERSION=7;
const NATIVE_FOOTPRINT='memory-footprint-guard';
const NATIVE_CHECKS=new Set(['Check armed native footprints and report Template', "Check or report Nine's online native WebKit ledger"]);
/** @typedef {{name:string,conclusion:string|null,started_at?:string|null,runner_id?:number|null,steps?:readonly {name:string,conclusion:string|null}[]}} Job */
/** @param {{conclusion:string|null}} job */
const unsuccessful=job=>['failure','timed_out','cancelled','startup_failure'].includes(job.conclusion??'');

/** J426: keep a completed failed check even if the runner is later canceled.
 * @param {Job} job @returns {string|undefined} */
function nativeInfrastructure(job){
  if(job.name!==NATIVE_FOOTPRINT||job.steps?.some(step=>NATIVE_CHECKS.has(step.name)&&step.conclusion==='failure'))return undefined;
  if(job.conclusion==='startup_failure')return 'runner failed to start';
  if(!unsuccessful(job))return undefined;
  if((job.runner_id===null||job.runner_id===0)&&job.steps?.length===0)return 'no xcode-27 runner assigned';
  if(job.conclusion==='timed_out')return 'runner timed out';
  if(job.conclusion==='cancelled')return 'runner was canceled';
  return undefined;
}

/** @param {Job} job */
export const advisory=job=>job.name==='timings'||job.name==='quarantine'||job.name==='nine-ring1 (street, macos-15)'||job.name==='nine-ledger-diagnostic'
  ||nativeInfrastructure(job)!==undefined;

/** The blocking jobs a red names. FS24's early red cancels a red run's other jobs, so `cancelled` ones are named only
 * when no job failed outright (a job over its timeout-minutes concludes `cancelled`).
 * @param {readonly Job[]} jobs @returns {string[]} */
export function failedNames(jobs){
  const blocking=jobs.filter(job=>!advisory(job)&&unsuccessful(job)),failed=blocking.filter(job=>job.conclusion!=='cancelled');
  return (failed.length>0?failed:blocking).map(job=>job.name);
}

/** @typedef {{id:number,head_sha:string,status:string,conclusion:string|null,created_at:string,event:string,display_title?:string,run_attempt?:number,blockingChecked?:boolean,advisoryVersion?:number,started?:boolean,blockingFailed?:boolean,nativeInfra?:string}} Run */
/** @typedef {{id:number,sha:string,created:string,warnings?:ReturnType<typeof parseMemoryWarnings>,pusher?:string,results?:ReturnType<typeof parseBudgetResults>}} MemoryQa */
/** A red span main-watch has reported: the first red run, when it was reported (ms), its alert, and whether the keeper
 * (buddy-engine, FS22) already has it.
 * @typedef {{run:number,at:number,text:string,keeper:boolean}} RedSpan */
/** @typedef {{judged:number[],dispatched:string[],memoryQa?:MemoryQa[],red?:RedSpan}} State */
/** @typedef {{kind:'green'|'red'|'superseded'|'dispatch',run:Run,from?:string|null,by?:string}} Verdict */

const short=(/** @type {string|null|undefined} */sha)=>(sha??'').slice(0,10);
const finished=(/** @type {Run} */run)=>run.status==='completed';
/** FM11: a failure-mode run older than a nightly's day is history when the watcher first meets it, not today's fix row. */
const FAILMODE_WINDOW_MS=26*60*60_000;
/** Superseded, never red: a cancel that hid no blocking failure. Main pushes never cancel a started run (ci.yml's
 * cancel-in-progress is false for main) unless it is red already (ci-early-red.yml, FS24), so a started run whose
 * blocking job failed, timed out or was cancelled (a job over its timeout-minutes concludes `cancelled`:
 * nine-ring1-build in run 44361972035) is red (J422). */
const cancelled=(/** @type {Run} */run)=>(run.conclusion==='cancelled'||run.conclusion==='skipped')&&run.blockingFailed!==true;
const byCreated=(/** @type {Run} */a,/** @type {Run} */b)=>Date.parse(a.created_at)-Date.parse(b.created_at)||a.id-b.id;

/** Preserve the workflow verdict until every required job is clear.
 * @param {Run} run @param {readonly Job[]} jobs @returns {Run} */
export function blockingRun(run,jobs){
  if(!finished(run))return run;
  const native=jobs.find(job=>job.name===NATIVE_FOOTPRINT);
  const nativeInfra=native===undefined?undefined:nativeInfrastructure(native);
  if(nativeInfra===undefined&&run.conclusion!=='failure'&&run.conclusion!=='timed_out')return run;
  const required=jobs.filter(job=>!advisory(job));
  const clear=required.some(job=>job.conclusion==='success')&&required.every(job=>['success','skipped','neutral'].includes(job.conclusion??''));
  const advisoryFailure=jobs.some(job=>advisory(job)&&unsuccessful(job));
  return {...run,conclusion:clear&&advisoryFailure?'success':run.conclusion,blockingChecked:true,advisoryVersion:ADVISORY_VERSION,nativeInfra};
}

/** What each newly finished run means, oldest first. Pure: `runs` is main's ci runs, newest or oldest first.
 * @param {readonly Run[]} runs @param {State} state @param {string|null} tip origin/main's SHA
 * @returns {Verdict[]} */
export function judge(runs,state,tip){
  const ordered=[...runs].sort(byCreated),judged=new Set(state.judged),out=/** @type {Verdict[]} */([]);
  for(const [index,run] of ordered.entries()){
    if(!finished(run)||judged.has(run.id))continue;
    const later=ordered.slice(index+1);
    if(cancelled(run)){
      const next=later[0];
      if(next!==undefined)out.push({kind:'superseded',run,by:next.head_sha});
      // No later run: main's newest commit has no verdict coming. Dispatch once, while it is still the tip.
      else if(run.head_sha===tip&&!state.dispatched.includes(run.head_sha))out.push({kind:'dispatch',run});
      continue;
    }
    const before=ordered.slice(0,index).findLast(row=>finished(row)&&!cancelled(row)&&row.head_sha!==run.head_sha);
    out.push({kind:run.conclusion==='success'?'green':'red',run,from:before?.head_sha??null});
  }
  return out;
}

/** The verdict for one SHA, or null while it has none.
 * @param {readonly Run[]} runs @param {string} sha @param {(ancestor:string,descendant:string)=>boolean} contains */
export function verdictFor(runs,sha,contains){
  const run=[...runs].sort(byCreated).reverse().find(row=>finished(row)&&!cancelled(row)&&(row.head_sha===sha||contains(sha,row.head_sha)));
  return run===undefined?null:{state:run.conclusion==='success'?'green':'red',run};
}

/** Who pushed each SHA, by short SHA: land's `HH:MM UTC <lane> land plan/<slug> landed <sha10> on main …`, and
 * main-push's `HH:MM Cancún <lane> main-push pushed main <sha10>: <n> commit(s)[ pane <id>]…` (FS19: half of 11-18's
 * reds came through main-push and named no one). A main-push line covers its tip and the n-1 commits under it.
 * @param {string} text @returns {Map<string,{lane:string,slug:string,pane?:string,count?:number}>} */
export function landers(text){
  const out=new Map();
  for(const match of text.matchAll(/^\d\d:\d\d (?:UTC|Cancún) (\S+) main-push pushed main ([0-9a-f]{10}): (\d+) commit\(s\)(?: pane (\S+?)(?=[,\s]|$))?/gmu)){
    const [,lane='',sha='',count='1',pane]=match;out.set(sha,{lane,slug:'',count:Number(count),...(pane===undefined?{}:{pane})});
  }
  for(const match of text.matchAll(/^\d\d:\d\d UTC (\S+) land plan\/(\S+) landed(?:, MAIN RED)? ([0-9a-f]{10}) on main/gmu)){
    const [,lane='',slug='',sha='']=match;out.set(sha,{lane,slug});
  }
  return out;
}

/** Each commit of a red range with its lander. `commits` is newest first (rev-list); a main-push lander also owns the
 * older commits its push carried (its count), unless they have a lander of their own.
 * @template {{lane:string,count?:number}} L
 * @param {readonly string[]} commits @param {ReadonlyMap<string,L>} who @returns {{sha:string,lander:L|undefined}[]} */
export function attribute(commits,who){
  const found=commits.map(sha=>({sha,lander:who.get(sha.slice(0,10))}));
  const own=found.map(row=>row.lander);
  for(const [index,row] of found.entries()){
    if(own[index]===undefined)continue;
    const count=row.lander?.count??1;
    for(let under=index+1;under<Math.min(found.length,index+count);under++){
      const older=found[under];
      if(older!==undefined&&older.lander===undefined)older.lander=row.lander;
    }
  }
  return found;
}

/** The herdr pane of a lander: its worktree's pane label (`engine plan/<slug>`) or working directory.
 * @param {readonly {pane_id:string,label?:string,cwd?:string,foreground_cwd?:string}[]} panes @param {string} slug */
export function paneFor(panes,slug){
  return panes.find(pane=>pane.label===`engine plan/${slug}`)?.pane_id
    ??panes.find(pane=>[pane.cwd,pane.foreground_cwd].some(path=>path?.endsWith(`/.worktrees/${slug}`)))?.pane_id;
}

/** @param {string} file @returns {State|null} */
export function readState(file){
  if(!existsSync(file))return null;
  try{
    const value=JSON.parse(readFileSync(file,'utf8'));
    const red=value.red;
    return {judged:Array.isArray(value.judged)?value.judged.filter(Number.isSafeInteger):[],dispatched:Array.isArray(value.dispatched)?value.dispatched.filter(row=>typeof row==='string'):[],
      ...(Array.isArray(value.memoryQa)?{memoryQa:value.memoryQa}:{}),
      ...(red!==null&&typeof red==='object'&&Number.isSafeInteger(red.run)&&typeof red.at==='number'&&typeof red.text==='string'?{red:{run:red.run,at:red.at,text:red.text,keeper:red.keeper===true}}:{})};
  }catch{return null;}
}

/** @param {string} file @param {State} state */
function writeState(file,state){
  mkdirSync(dirname(file),{recursive:true});
  const temporary=`${file}.${process.pid}.tmp`;
  writeFileSync(temporary,`${JSON.stringify({judged:state.judged.slice(-KEEP),dispatched:state.dispatched.slice(-50),...(state.memoryQa?.length?{memoryQa:state.memoryQa}:{}),...(state.red===undefined?{}:{red:state.red})})}\n`);renameSync(temporary,file);
}

/** One watcher at a time judges, so two never report the same run. The lock file holds its owner's pid; only a
 * dead owner's lock is taken, by an atomic rename that exactly one contender wins.
 * @param {string} file @returns {()=>void} */
function lock(file){
  const path=`${file}.lock`;mkdirSync(dirname(path),{recursive:true});
  const alive=(/** @type {number} */pid)=>{try{process.kill(pid,0);return true;}catch(error){return error instanceof Error&&'code'in error&&error.code==='EPERM';}};
  for(let tries=0;;tries++){
    try{writeFileSync(path,String(process.pid),{flag:'wx'});return ()=>{try{if(readFileSync(path,'utf8')===String(process.pid))rmSync(path,{force:true});}catch{/* already gone */}};}
    catch(error){
      if(!(error instanceof Error&&'code'in error&&error.code==='EEXIST'))throw error;
      let owner=Number.NaN;try{owner=Number(readFileSync(path,'utf8'));}catch{continue;}
      if(Number.isSafeInteger(owner)&&owner>0&&!alive(owner)){
        const stale=`${path}.stale-${process.pid}`;
        try{renameSync(path,stale);rmSync(stale,{force:true});}catch{/* another contender took it */}
        continue;
      }
      if(tries>120)throw new Error(`main-watch: ${path} held by pid ${owner} for over two minutes`,{cause:error});
      execFileSync('sleep',['1']);
    }
  }
}

/** MF12: main's run list, fetched at most once per `freshMs` across every main-watch on this machine. The cache file is
 * replaced whole (write, then rename), so a reader never sees half of it; a stale or unreadable cache fetches.
 * @param {string} cache @param {() => Run[]} fetch @param {number} [now] @param {number} [freshMs] @returns {Run[]} */
export function sharedRuns(cache,fetch,now=Date.now(),freshMs=45_000){
  try{
    const kept=/** @type {{at:number,runs:Run[]}} */(JSON.parse(readFileSync(cache,'utf8')));
    if(typeof kept.at==='number'&&now-kept.at>=0&&now-kept.at<freshMs&&Array.isArray(kept.runs))return kept.runs;
  }catch{/* No cache yet. */}
  const runs=fetch();
  try{mkdirSync(dirname(cache),{recursive:true});const draft=`${cache}.${process.pid}`;writeFileSync(draft,JSON.stringify({at:now,runs}));renameSync(draft,cache);}
  catch{/* A cache that cannot be written only costs the next fetch. */}
  return runs;
}

/** The real world: GitHub through gh, git, the receipts log and herdr. Tests pass their own.
 * @param {NodeJS.ProcessEnv} env */
export function liveIo(env=process.env){
  // The canonical checkout: land's follow outlives the worktree that started it.
  const here=resolve(import.meta.dirname,'..');
  const root=env.WS_MAIN_WATCH_ROOT??dirname(resolve(here,execFileSync('git',['rev-parse','--git-common-dir'],{cwd:here,encoding:'utf8'}).trim()));
  const repo=env.WS_MAIN_WATCH_REPO??REPO;
  const receipts=resolve(env.WS_LANE_RECEIPTS??join(homedir(),'.cache/wildshard/lane-receipts.log'));
  const run=(/** @type {string} */command,/** @type {string[]} */args)=>execFileSync(command,args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60_000,maxBuffer:32<<20});
  // MF12 (4): reads go through the reader App when this machine has it; the dispatch stays on the user's login.
  const read=(/** @type {string[]} */args)=>execFileSync('gh',args,{cwd:root,encoding:'utf8',env:readerEnv(env),stdio:['ignore','pipe','pipe'],timeout:60_000,maxBuffer:32<<20});
  const runsCache=resolve(env.WS_MAIN_WATCH_RUNS_CACHE??join(homedir(),'.cache/wildshard/main-watch-runs.json'));
  const state=resolve(env.WS_MAIN_WATCH_STATE??join(homedir(),'.cache/wildshard/main-watch.json'));
  /** @param {number} id @returns {Job[]} */
  const jobsFor=id=>JSON.parse(read(['api',`repos/${repo}/actions/runs/${id}/jobs?per_page=100`])).jobs;
  return {
    repo,
    quotaReset:()=>quotaReset(),
    state,
    // MF12: every land leaves a follow running for up to 90 min, so one machine can hold several; they share one fetch.
    runs:()=>sharedRuns(runsCache,()=>{
      /** @type {Run[]} */let prior=[];
      try{const kept=JSON.parse(readFileSync(runsCache,'utf8')).runs;if(Array.isArray(kept))prior=kept;}catch{/* First fetch. */}
      const judged=new Set(readState(state)?.judged);
      return /** @type {Run[]} */(JSON.parse(read(['api',`repos/${repo}/actions/workflows/ci.yml/runs?branch=main&per_page=50`])).workflow_runs)
        .filter(row=>row.event==='push'||row.event==='workflow_dispatch').map(row=>{
          if(!finished(row)||row.conclusion==='success')return row;
          const kept=prior.find(old=>old.id===row.id&&old.blockingChecked===true&&old.advisoryVersion===ADVISORY_VERSION&&(old.run_attempt??1)===(row.run_attempt??1));
          if(kept!==undefined)return kept;
          if(cancelled(row)&&judged.has(row.id))return row;
          const jobs=jobsFor(row.id);
          if(cancelled(row)){
            // CIQ1 replaces pending runs without starting a single job. run_started_at is also set on those runs;
            // the jobs, rather than that workflow timestamp, say whether any work actually started.
            row.started=jobs.some(job=>typeof job.started_at==='string');
            row.blockingFailed=jobs.some(job=>!advisory(job)&&unsuccessful(job))&&row.started;
            row.blockingChecked=true;
            row.advisoryVersion=ADVISORY_VERSION;
          }
          return blockingRun(row,jobs);
        });
    }),
    failed:(/** @type {number} */id)=>failedNames(jobsFor(id)),
    // Blocking tests own AMBER evidence. The advisory timings collector only repeats it;
    // its annotations cannot change main's verdict. Quarantine reports separately (J193).
    annotations:(/** @type {number} */id)=>/** @type {{id:number,name:string}[]} */(JSON.parse(read(['api',`repos/${repo}/actions/runs/${id}/jobs?per_page=100`])).jobs)
      .filter(job=>job.name.startsWith('tests')||job.name==='memory-ledger-guard'||job.name===NATIVE_FOOTPRINT)
      .map(job=>read(['api','--paginate',`repos/${repo}/check-runs/${job.id}/annotations?per_page=100`,'--jq','.[].message'])).join('\n'),
    // BUDGET-CAPS BC9: the budgets workflow follows ci; its failures are fix rows, never main's verdict.
    budgetRuns:()=>sharedRuns(`${runsCache}.budgets`,()=>/** @type {Run[]} */(
      JSON.parse(read(['api',`repos/${repo}/actions/workflows/budgets.yml/runs?branch=main&per_page=15`])).workflow_runs)),
    budgetAnnotations:(/** @type {number} */id)=>/** @type {{id:number,name:string}[]} */(JSON.parse(read(['api',`repos/${repo}/actions/runs/${id}/jobs?per_page=100`])).jobs)
      .filter(job=>job.name==='budgets')
      .map(job=>read(['api','--paginate',`repos/${repo}/check-runs/${job.id}/annotations?per_page=100`,'--jq','.[].message'])).join('\n'),
    // FM11 (meta MMO-FAILURE-MODES, J229): the failure-mode browser proof (nightly, related pushes) reports beside ci.
    failmodeRuns:()=>sharedRuns(`${runsCache}.failmodes`,()=>/** @type {Run[]} */(
      JSON.parse(read(['api',`repos/${repo}/actions/workflows/failmodes.yml/runs?branch=main&per_page=15`])).workflow_runs)),
    runSha:(/** @type {number} */id)=>String(JSON.parse(read(['api',`repos/${repo}/actions/runs/${id}`])).head_sha),
    nativeRuns:()=>sharedRuns(`${runsCache}.memory-footprint`,()=>/** @type {Run[]} */(
      JSON.parse(read(['api',`repos/${repo}/actions/workflows/memory-footprint.yml/runs?branch=main&per_page=15`])).workflow_runs)),
    memoryQa:(/** @type {MemoryQa[]} */rows)=>{
      const meta=env.WS_META_ROOT??join(homedir(),'projects/games/project-wildshard-meta');
      const script=join(meta,'scripts/memory-gate-qa.mjs');
      if(!existsSync(script))throw new Error('meta memory-gate QA writer is unavailable');
      execFileSync(process.execPath,[script,JSON.stringify(rows)],{cwd:meta,encoding:'utf8',
        stdio:['ignore','pipe','pipe'],timeout:60_000,maxBuffer:1<<20});
    },
    tip:()=>{run('git',['fetch','--quiet','origin','main']);return run('git',['rev-parse','origin/main']).trim();},
    commits:(/** @type {string|null} */from,/** @type {string} */to)=>{
      try{return run('git',['rev-list','--max-count=200',from===null?to:`${from}..${to}`]).trim().split('\n').filter(Boolean);}catch{return [to];}
    },
    contains:(/** @type {string} */ancestor,/** @type {string} */descendant)=>{try{run('git',['merge-base','--is-ancestor',ancestor,descendant]);return true;}catch{return false;}},
    receipts:()=>existsSync(receipts)?readFileSync(receipts,'utf8'):'',
    receipt:(/** @type {string} */line)=>{mkdirSync(dirname(receipts),{recursive:true});appendFileSync(receipts,`${new Date().toISOString().slice(11,16)} UTC main-watch ${line}\n`);},
    panes:()=>{try{return JSON.parse(run('herdr',['pane','list'])).result.panes;}catch{return [];}},
    send:(/** @type {string} */pane,/** @type {string} */text)=>{try{run('herdr',['pane','run',pane,text]);return true;}catch{return false;}},
    // A lane that is a herdr agent by name (the Codex lanes) has no pane main-watch can find: prompt it by name.
    prompt:(/** @type {string} */agent,/** @type {string} */text)=>{try{run('herdr',['agent','prompt',agent,text]);return true;}catch{return false;}},
    // Mini M2 (meta MINI-DECISIONS): every engine main red also goes straight to the forward fixer(s), herdr agents by
    // name, from WS_FORWARD_FIXER (comma-separated), else the machine's ~/.config/wildshard/forward-fixer file (the Mac
    // mini has one; a lane's environment need not carry it).
    fixers:()=>{
      let names=process.env.WS_FORWARD_FIXER;
      if(names===undefined){try{names=readFileSync(join(homedir(),'.config/wildshard/forward-fixer'),'utf8');}catch{names='';}}
      return names.split(/[,\s]+/u).filter(name=>/^[\w.-]+$/u.test(name));
    },
    dispatch:()=>{run('gh',['workflow','run','ci.yml','--ref','main','-R',repo]);},
  };
}

/** Judge every newly finished run and report it. A first run with no state only records what is already finished.
 * @param {ReturnType<typeof liveIo>} io @param {{sha?:string,lane?:string,pane?:string}} [hint] who landed `sha`, from land
 * @returns {Verdict[]} */
export function sweep(io,hint={}){
  const unlock=lock(io.state);
  try{
    const runs=io.runs();
    let native=/** @type {Run[]} */([]);
    try{native=io.nativeRuns?.()??[];}catch(error){
      io.receipt(`memory footprint status unavailable: ${error instanceof Error?error.message.split('\n')[0]:String(error)}`);
    }
    let previous=readState(io.state);
    if(previous===null){
      // A followed SHA's own runs stay unjudged, so the first follow still reports its verdict.
      const baseline=[...runs,...native].filter(row=>finished(row)&&(hint.sha===undefined||row.head_sha!==hint.sha));
      previous={judged:baseline.map(row=>row.id),dispatched:[]};writeState(io.state,previous);
      io.receipt(`started: ${baseline.length} finished main runs taken as already judged`);
      if(hint.sha===undefined)return [];
    }
    const verdicts=judge(runs,previous,io.tip()),state=/** @type {State & {memoryQa:MemoryQa[]}} */({judged:[...previous.judged],dispatched:[...previous.dispatched],memoryQa:[...previous.memoryQa??[]],...(previous.red===undefined?{}:{red:previous.red})});
    const now=io.now?.()??Date.now();
    /** @param {Run} run @param {string} annotations @param {string[]} lines */
    const memoryWarnings=(run,annotations,lines)=>{
      const warnings=parseMemoryWarnings(annotations);
      for(const row of warnings){
        const detail=`${short(run.head_sha)} ${row.zone} ${row.mode} ${row.metric} ${row.arm} +${row.delta} B over ${row.limit} B at ${row.bytes} B${row.median===undefined?'':`, confirmation median ${row.median} B`} (run ${run.id}; J431)`;
        lines.push(`main WARNING memory ${detail}`);
        if(row.kind==='gate-flake')lines.push(`gate-flake ${detail}`);
      }
      if(warnings.length>0)state.memoryQa.push({id:run.id,sha:run.head_sha,created:run.created_at,warnings});
    };
    const who=landers(io.receipts());
    // land names itself and its pane when it starts a follow, before its own receipt may be written.
    if(hint.sha!==undefined&&hint.lane!==undefined){const kept=who.get(hint.sha.slice(0,10));who.set(hint.sha.slice(0,10),{lane:hint.lane,slug:kept?.slug??'',pane:hint.pane??kept?.pane,...(kept?.count===undefined?{}:{count:kept.count})});}
    for(const verdict of verdicts){
      const {run}=verdict;
      // Everything a report needs is read first; the run is recorded; only then does the report go out. A failed
      // read leaves the run for the next sweep, and a report is never sent twice.
      /** @type {string[]} */const lines=[];/** @type {{lane:string,pane:string|undefined,text:string,lander?:true}[]} */const messages=[];
      /** @type {string|undefined} */let buddyAlert;
      if(run.nativeInfra!==undefined)lines.push(`main advisory ${short(run.head_sha)} ${NATIVE_FOOTPRINT}: ${run.nativeInfra} (run ${run.id})`);
      if(verdict.kind==='superseded')lines.push(run.started===false
        ?`main ${short(run.head_sha)} skipped (pending, replaced) by ${short(verdict.by)} (run ${run.id}; never started; never red)`
        :`main ${short(run.head_sha)} superseded by ${short(verdict.by)} (run ${run.id} cancelled; never red)`);
      else if(verdict.kind==='dispatch')lines.push(`main ${short(run.head_sha)} has only a cancelled run (${run.id}) and nothing newer; dispatched ci on main once`);
      else{
        const commits=io.commits(verdict.from??null,run.head_sha),range=`${short(verdict.from)||'start'}..${short(run.head_sha)}`;
        const found=attribute(commits,who);
        const names=[...new Set(found.map(row=>row.lander?.lane??'').filter(Boolean))];
        const named=names.length===0?'no land receipt (pushed by hand or the queue)':names.join(', ');
        let annotations='';
        try{annotations=io.annotations(run.id);}catch(error){
          if(verdict.kind==='green')lines.push(`main AMBER ${short(run.head_sha)} unknown (run ${run.id}; its annotations were unreadable: ${error instanceof Error?error.message.split('\n')[0]:String(error)})`);
        }
        if(verdict.kind==='green'){
          lines.unshift(`main green ${short(run.head_sha)} (run ${run.id}; ${range}; landed by ${named})`);
          const ambers=parseAmber(annotations),audio=parseAudioAmber(annotations);
          for(const row of ambers)lines.push(`main AMBER ${short(run.head_sha)} ${row.file} ${row.ms}/${row.budget} (run ${run.id}; J295: a queue-skipping fix row today; red at ${AMBER.redFactor}x, after ${AMBER.redAfterHours} h or ${AMBER.redAfterRuns} amber main runs)`);
          const mb=(/** @type {number} */bytes)=>(bytes/1e6).toFixed(2);
          for(const row of audio)lines.push(`main AMBER ${short(run.head_sha)} audio ${row.shard} ${row.tier} ${mb(row.bytes)} MB/${mb(row.budget)} MB (run ${run.id}; J303${row.level==='red'?`, over the ${mb(row.red)} MB red line`:''}: its AUDIO-PLAN source pass; never a red main)`);
        }
        else{
          const failed=io.failed(run.id).join(' | ')||'see the run',url=`https://github.com/${io.repo}/actions/runs/${run.id}`,panes=io.panes();
          lines.push(`MAIN RED ${range} run ${run.id}: landers ${named}; failed: ${failed}`);
          for(const row of found)if(row.lander!==undefined)messages.push({lane:row.lander.lane,lander:true,pane:row.lander.pane??(row.lander.slug===''?undefined:paneFor(panes,row.lander.slug)),
            text:`main-watch: MAIN RED on engine main ${range} (${url}); failed: ${failed}. You landed ${short(row.sha)}: fix forward now (J249).`});
          buddyAlert=`main-watch: MAIN RED on engine main ${range} (${url}); landers ${named}; failed: ${failed}. A lander could not be reached. Please fix forward now (J249).`;
          for(const fixer of new Set(io.fixers()))messages.push({lane:fixer,pane:undefined,
            text:`main-watch: MAIN RED on engine main ${range} (${url}); landers ${named}; failed: ${failed}. You are the forward fixer (M2): fix forward now, or confirm a lander has it.`});
        }
        memoryWarnings(run,annotations,lines);
      }
      if(verdict.kind==='green')delete state.red;
      // FS22: a red span starts at its first reported red; the keeper's 20-minute clock runs from there.
      if(verdict.kind==='red'&&buddyAlert!==undefined&&state.red===undefined)state.red={run:run.id,at:now,text:buddyAlert,keeper:false};
      state.judged.push(run.id);if(verdict.kind==='dispatch')state.dispatched.push(run.head_sha);writeState(io.state,state);
      if(verdict.kind==='dispatch')io.dispatch();
      for(const line of lines)io.receipt(line);
      let needsBuddy=!messages.some(message=>message.lander);
      let buddyAttempted=false;
      for(const message of messages){
        const how=message.pane!==undefined&&io.send(message.pane,message.text)?`sent to pane ${message.pane}`
          :io.prompt(message.lane,message.text)?`prompted herdr agent ${message.lane}`:'';
        if(message.lander&&how==='')needsBuddy=true;
        if(message.lane==='buddy-engine')buddyAttempted=true;
        io.receipt(`MAIN RED message to ${message.lane} ${how===''?'not delivered (no reachable pane or herdr agent)':how}`);
      }
      if(needsBuddy&&!buddyAttempted&&buddyAlert!==undefined){
        const delivered=io.prompt('buddy-engine',buddyAlert);
        io.receipt(`main red fallback to buddy-engine ${delivered?'prompted herdr agent buddy-engine':'not delivered (herdr agent unreachable)'}`);
        buddyAttempted=delivered;
      }
      if(verdict.kind==='red'&&buddyAttempted&&state.red!==undefined&&!state.red.keeper){state.red.keeper=true;writeState(io.state,state);}
    }
    // FS22 (J443): the keeper owns a red no pusher fixed. KEEPER_MS after the span's first alert with no green verdict,
    // buddy-engine gets it, once per span; the pushers were pinged first and nobody else stops.
    if(state.red!==undefined&&!state.red.keeper&&now-state.red.at>=KEEPER_MS){
      const minutes=Math.round((now-state.red.at)/60_000);
      const delivered=io.prompt('buddy-engine',`main-watch: keeper (J443): engine main is still red ${minutes} min after this alert, with no green since. ${state.red.text}`);
      io.receipt(`main red keeper: buddy-engine ${delivered?'prompted':'not delivered (herdr agent unreachable)'} after ${minutes} min red with no green (run ${state.red.run})`);
      if(delivered){state.red.keeper=true;writeState(io.state,state);}
    }
    for(const run of native.filter(row=>finished(row)&&!state.judged.includes(row.id))){
      /** @type {string[]} */const lines=[];
      if(run.conclusion==='success'||run.conclusion==='failure'){
        try{memoryWarnings(run,io.annotations(run.id),lines);}catch(error){
          io.receipt(`memory footprint annotations unavailable for run ${run.id}: ${error instanceof Error?error.message.split('\n')[0]:String(error)}`);
          continue;
        }
      }
      state.judged.push(run.id);writeState(io.state,state);
      for(const line of lines)io.receipt(line);
    }
    // BUDGET-CAPS BC9: a failed budgets run names its pushers (the landers of the commits since the previous budgets run).
    let budgetRuns=/** @type {Run[]} */([]);
    try{budgetRuns=io.budgetRuns?.()??[];}catch(error){
      io.receipt(`budgets status unavailable: ${error instanceof Error?error.message.split('\n')[0]:String(error)}`);
    }
    for(const run of budgetRuns.filter(row=>finished(row)&&!state.judged.includes(row.id))){
      /** @type {ReturnType<typeof budgetReport>} */let report={lines:[],qa:null};
      if(run.conclusion==='failure'){
        try{
          // BC15: the commit a budgets run measured is its ci run's (the run name says which), not its own head_sha
          const measured=(/** @type {Run} */row)=>{const source=budgetSourceRun(row);return source===null||io.runSha===undefined?row.head_sha:io.runSha(source);};
          const sha=measured(run);
          const earlier=budgetRuns.filter(row=>row.id<run.id&&finished(row));
          const before=earlier.map(measured).find(other=>other!==sha)??null;
          const pushers=[...new Set(attribute(io.commits(before,sha),who).map(row=>row.lander?.lane??'').filter(Boolean))];
          report=budgetReport({...run,head_sha:sha},parseBudgetResults(io.budgetAnnotations?.(run.id)??''),pushers);
        }catch(error){
          io.receipt(`budgets results unavailable for run ${run.id}: ${error instanceof Error?error.message.split('\n')[0]:String(error)}`);
          continue;
        }
      }
      if(report.qa!==null)state.memoryQa.push(report.qa);
      state.judged.push(run.id);writeState(io.state,state);
      for(const line of report.lines)io.receipt(line);
    }
    // FM11 (J229): a red failure-mode proof (the nightly all-46 or a related push) is a fix row for today, never main's verdict.
    let failmodeRuns=/** @type {Run[]} */([]);
    try{failmodeRuns=io.failmodeRuns?.()??[];}catch(error){
      io.receipt(`failure-mode proof status unavailable: ${error instanceof Error?error.message.split('\n')[0]:String(error)}`);
    }
    const dayAgo=(io.now?.()??Date.now())-FAILMODE_WINDOW_MS;
    for(const run of failmodeRuns.filter(row=>finished(row)&&!state.judged.includes(row.id))){
      state.judged.push(run.id);writeState(io.state,state);
      if(run.conclusion==='success'||run.conclusion==='cancelled'||run.conclusion==='skipped'||Date.parse(run.created_at)<dayAgo)continue;
      io.receipt(`main FAILMODES ${short(run.head_sha)} run ${run.id} (${run.event}) ${run.conclusion??'unknown'}: a fix row today, never main red (FM11, J229); receipt artifact failmodes-${run.head_sha}`);
    }
    if(state.memoryQa.length>0&&io.memoryQa!==undefined){
      try{io.memoryQa(state.memoryQa);state.memoryQa=[];writeState(io.state,state);}catch(error){
        io.receipt(`memory QA deferred: ${error instanceof Error?error.message.split('\n')[0]:String(error)}`);
      }
    }
    return verdicts;
  }finally{unlock();}
}

/** Sweep until `sha` has a verdict. Each sweep fetches main first, so a newer run that supersedes a cancelled one
 * is seen, and a cancelled tip with nothing newer gets its one dispatch. @param {ReturnType<typeof liveIo>} io
 * @param {{sha:string,lane?:string,pane?:string,pollMs?:number,timeoutMs?:number}} options */
export async function follow(io,options){
  const pollMs=options.pollMs??60_000,seen=/** @type {Verdict[]} */([]);
  let deadline=Date.now()+(options.timeoutMs??90*60_000);
  while(Date.now()<deadline){
    try{
      // Judged from the runs seen before the sweep, which sees them too: a verdict is never returned unreported.
      // One fetch per pass: the sweep judges the same list (MF12).
      const runs=io.runs(),done=verdictFor(runs,options.sha,io.contains)!==null;
      seen.push(...sweep({...io,runs:()=>runs},options));
      if(done)return seen;
    }catch(error){
      // MF12: a spent GitHub quota is a wait until it resets, not a missing verdict; the deadline moves by the wait.
      const detail=`${error instanceof Error?error.message:String(error)} ${error!==null&&typeof error==='object'&&'stderr'in error?String(error.stderr):''}`;
      if(RATE_LIMITED.test(detail)){
        const wait=Math.max(pollMs,(io.quotaReset?.()??Date.now()+60_000)-Date.now()+1000);
        process.stderr.write(`main-watch: GitHub API quota spent; waiting ${Math.ceil(wait/60_000)} min for it to reset\n`);
        deadline+=wait;
        await setTimeout(wait);
        continue;
      }
      process.stderr.write(`main-watch: ${detail.trim()}; retrying\n`);
    }
    await setTimeout(pollMs);
  }
  io.receipt(`main ${short(options.sha)} has no verdict after ${Math.round((options.timeoutMs??90*60_000)/60_000)} min; the next sweep judges it`);
  return [];
}

/** EV2: wait until origin/main contains `sha` (a hand push started this from its pre-push, before git pushed).
 * False when it never arrives: the push lost a race or was refused, and nothing is reported.
 * @param {{tip:()=>string,contains:(a:string,d:string)=>boolean}} io @param {string} sha @param {number} waitMs
 * @param {number} [pollMs] */
export async function reached(io,sha,waitMs,pollMs=10_000){
  const deadline=Date.now()+waitMs;
  for(;;){
    try{if(io.contains(sha,io.tip()))return true;}catch{/* A failed fetch retries. */}
    if(Date.now()+pollMs>deadline)return false;
    await setTimeout(pollMs);
  }
}

if(process.argv[1]!==undefined&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const arg=(/** @type {string} */name)=>process.argv.find(row=>row.startsWith(`--${name}=`))?.slice(name.length+3);
  const io=liveIo(),sha=arg('follow'),afterPush=Number(arg('after-push')??'0');
  // EV2: the pre-push starts a follow before git pushes; follow only once the SHA is on main, else quit quietly.
  const lost=sha!==undefined&&afterPush>0&&!await reached(io,sha,afterPush*1000);
  const verdicts=lost?[]:sha===undefined?sweep(io):await follow(io,{sha,lane:arg('lane'),pane:arg('pane')});
  for(const verdict of verdicts)process.stdout.write(`main-watch ${verdict.kind} ${short(verdict.run.head_sha)} run ${verdict.run.id}\n`);
  // Meta STAGING-BUGBASH SB45: each pass also checks staging's placement serial and sweeps an upload's new card (a no-op fetch
  // when nothing moved), detached from the canonical checkout so it outlives a land's worktree.
  const {sweepOptedIn}=await import('./placement-sweep.mjs');
  if(sweepOptedIn(process.env,existsSync,homedir())){
    const here=resolve(import.meta.dirname,'..');
    const root=dirname(resolve(here,execFileSync('git',['rev-parse','--git-common-dir'],{cwd:here,encoding:'utf8'}).trim()));
    mkdirSync(join(root,'tmp/placement-sweep'),{recursive:true});
    const log=openSync(join(root,'tmp/placement-sweep/sweep.log'),'a');
    spawn(process.execPath,[join(root,'scripts/placement-sweep.mjs')],{cwd:root,detached:true,stdio:['ignore',log,log]}).unref();
  }
}
