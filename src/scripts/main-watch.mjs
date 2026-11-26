// LAND-SIMPLIFY LS5 (J258): main's CI verdict, reported by a small watcher instead of by land. Jake, 2026-11-11:
// land returns as soon as main is pushed; "a receipt line + a direct message to that agent" on red. Every red also
// writes `NOTE RED <lane>: run <id> <range> <jobs>` per lander, which a lane's background wait on the receipts matches
// (an Agent-tool lane has no pane), and the builder's hc terminal gets the red if a lander is unreachable (meta QA 11-25
// row 21; it replaces build-max C1's coordinator pane, gone since 11-24).
//
//   node src/scripts/main-watch.mjs                     judge every finished main ci run not judged yet (tick or by hand)
//   node src/scripts/main-watch.mjs --follow=<sha> [--lane=<name>] [--pane=<herdr pane>] [--after-push=<s>]
//                                                   wait until <sha> has a verdict, then judge (land starts this;
//                                                   a mode-1 main pre-push starts it with --after-push, EV2)
//
// The verdict for a SHA is the newest completed main `ci` run that isn't cancelled and whose SHA is that SHA or a
// descendant of it. A cancelled run is superseded when a later main run exists, never red; with no later run,
// the watcher dispatches `ci` on main once. A started run cancelled with a blocking job that failed, timed out or
// never started is red, not superseded (FS24's early red); jobs the cancel itself left `cancelled` are not failures
// (build-max A5). Each red run gives one `MAIN RED <range>` receipt naming the landers
// of the commits in its range (from their landed receipts). A later run in the same red span with no newly failing test
// or job is `main still red`, never MAIN RED, and prompts nobody (A5); a new failure prompts its suspect and new landers. State (~/.cache/wildshard/main-watch.json) keeps the
// judged run ids and span history.
// Meta QA 11-25 row 67 (J505, no freezes): a red on a run's first attempt with no suspect (no commit in its range touches
// a file its failed jobs name: row 57's cook-worker-limits flake) is not MAIN RED yet. Its failed jobs rerun once
// (`main flake rerun <range> run <id>: ...`), nothing is prompted, and the run is judged again on attempt 2: green is
// the usual `main green` (which lifts an engine land HOLD), red is the usual MAIN RED. A follow waits for attempt 2.
// A green run that carries AMBER files (J295: a test file over its time budget, src/scripts/test-amber.mjs) also gives
// one `main AMBER <sha> <file> <ms>/<budget>` receipt per file: the coordinator hands each out as a queue-skipping
// fix row the same day (meta HOW-WE-BUILD-PLAN.md). AUDIO AU6 (J303): a shard whose audio is over 6 MB gives the same
// kind of receipt, `main AMBER <sha> audio <shard> <tier> <MB>/6.00 MB`, from the cook report's test; never a red main.
import {execFileSync,spawn} from 'node:child_process';
import {appendFileSync,existsSync,mkdirSync,openSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {homedir,hostname} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {setTimeout} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {stripVTControlCharacters} from 'node:util';
import {AMBER,parseAmber,parseAudioAmber,parseMemoryWarnings} from './test-amber.mjs';
import {RATE_LIMITED,quotaReset,readerEnv} from './gh-limit.mjs';
import {budgetReport,budgetSourceRun,confirmBudgetResults,parseBudgetResults} from './budgets/watch.mjs';
import {messageLanes} from './lane-commits.mjs';

export const REPO='project-wildshard/engine';
const KEEP=500;
/** FS22 (J443): a red with no green this long after its first alert goes to the keeper. */
export const KEEPER_MS=20*60_000;
// NB6's street and EM35's Chromium diagnostic jobs are advisory.
const ADVISORY_VERSION=8;
const NATIVE_FOOTPRINT='memory-footprint-guard';
const NATIVE_CHECKS=new Set(['Check armed native footprints and report Template', "Check or report Nine's online native WebKit ledger"]);
/** @typedef {{id?:number,name:string,conclusion:string|null,started_at?:string|null,runner_id?:number|null,steps?:readonly {name:string,conclusion:string|null}[]}} Job */
/** @param {{conclusion:string|null}} job */
const unsuccessful=job=>['failure','timed_out','cancelled','startup_failure'].includes(job.conclusion??'');
/** A job that broke on its own: a cancel leaves its other jobs `cancelled`, which is not a failure (build-max A5).
 * @param {{conclusion:string|null}} job */
const broke=job=>['failure','timed_out','startup_failure'].includes(job.conclusion??'');

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
function failedJobs(jobs){
  const blocking=jobs.filter(job=>!advisory(job)&&unsuccessful(job)),failed=blocking.filter(job=>job.conclusion!=='cancelled');
  return failed.length>0?failed:blocking;
}

/** @param {readonly Job[]} jobs */
export const failedNames=jobs=>failedJobs(jobs).map(job=>job.name);

/** @typedef {{id:number,head_sha:string,status:string,conclusion:string|null,created_at:string,event:string,display_title?:string,run_attempt?:number,blockingChecked?:boolean,advisoryVersion?:number,started?:boolean,blockingFailed?:boolean,nativeInfra?:string}} Run */
/** @typedef {{id:number,sha:string,created:string,warnings?:ReturnType<typeof parseMemoryWarnings>,pusher?:string,results?:ReturnType<typeof parseBudgetResults>}} MemoryQa */
/** @typedef {{commits:string[],files:string[],jobs:string[]}} RedHistory */
/** The first red run, its alert and keeper, plus the range of each attempted prompt and the failures seen in the span.
 * @typedef {{run:number,at:number,text:string,keeper:boolean,history?:RedHistory}} RedSpan */
/** A flake rerun waiting on its second attempt: the run id and when it was asked for. @typedef {{id:number,at:number}} Rerun */
/** @typedef {{judged:number[],dispatched:string[],reruns?:Rerun[],memoryQa?:MemoryQa[],budgetPending?:Record<string,{sha:string,contentKey:string,baseline:number|null,line:number|null}>,red?:RedSpan,notified?:Record<string,string[]>}} State */
/** @typedef {{kind:'green'|'red'|'superseded'|'dispatch'|'rerun',run:Run,from?:string|null,by?:string}} Verdict */

const short=(/** @type {string|null|undefined} */sha)=>(sha??'').slice(0,10);
const finished=(/** @type {Run} */run)=>run.status==='completed';
/** Row 67: a rerun that never shows its second attempt this long after it was asked for is judged as it stands. */
export const RERUN_STALE_MS=30*60_000;
/** Row 67: the reruns still waiting on attempt 2, from the state. @param {State|null} state @param {readonly Run[]} runs @param {number} now */
export function pendingReruns(state,runs,now=Date.now()){
  const out=new Set();
  for(const row of state?.reruns??[]){
    const run=runs.find(candidate=>candidate.id===row.id);
    if(run!==undefined&&((run.run_attempt??1)>1?!finished(run):now-row.at<RERUN_STALE_MS))out.add(row.id);
  }
  return out;
}
/** The builds a driftwood-fps.yml run graded, from its run name (`driftwood fps <build> since <sha|none>`).
 * @param {{display_title?:string}} run @returns {{build:string,since:string|null}|null} */
export function fpsNight(run){
  const match=/^driftwood fps ([0-9a-f]{40}) since ([0-9a-f]{40}|none)$/u.exec(run.display_title??'');
  return match===null?null:{build:match[1],since:match[2]==='none'?null:match[2]};
}
/** FM11: a failure-mode run older than a nightly's day is history when the watcher first meets it, not today's fix row. */
const FAILMODE_WINDOW_MS=26*60*60_000;
/** Superseded, never red: a cancel that hid no blocking failure. Main pushes never cancel a started run (ci.yml's
 * cancel-in-progress is false for main) unless it is red already (ci-early-red.yml, FS24), so a started run whose
 * blocking job failed, timed out or never started is red (J422; run 44361972035's tests failed beside its cancelled
 * nine-ring1-build). Jobs the cancel left `cancelled` are not failures (`cancelledJobs`, build-max A5). */
const cancelled=(/** @type {Run} */run)=>(run.conclusion==='cancelled'||run.conclusion==='skipped')&&run.blockingFailed!==true;
/** What a cancelled run's jobs say: whether any work started, and whether a blocking job broke before the cancel.
 * Build-max A5 (2026-11-20): four of the day's reds (runs 44763550438, 44768998830, 44774041972, 44780910229) were
 * cancels whose only unsuccessful jobs were the ones the cancel stopped; they are superseded, never MAIN RED.
 * @param {readonly Job[]} jobs @returns {{started:boolean,blockingFailed:boolean}} */
export function cancelledJobs(jobs){
  // CIQ1 replaces pending runs without starting a single job. run_started_at is also set on those runs;
  // the jobs, rather than that workflow timestamp, say whether any work actually started.
  const started=jobs.some(job=>typeof job.started_at==='string');
  return {started,blockingFailed:started&&jobs.some(job=>!advisory(job)&&broke(job))};
}
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
export function judge(runs,state,tip,now=Date.now()){
  const ordered=[...runs].sort(byCreated),judged=new Set(state.judged),out=/** @type {Verdict[]} */([]);
  // Row 67: a flake rerun's run waits for its second attempt.
  const pending=pendingReruns(state,runs,now);
  for(const [index,run] of ordered.entries()){
    if(!finished(run)||judged.has(run.id)||pending.has(run.id))continue;
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
  // Meta QA 11-25 row 54: the land queue's own `<lane> LAND PUSHED engine <sha>` (its short SHA may be 9 long).
  for(const match of text.matchAll(/^\d\d:\d\d (?:UTC|Cancún) (\S+) LAND PUSHED engine ([0-9a-f]{7,40})\b/gmu)){
    const [,lane='',sha='']=match;if(!out.has(sha.slice(0,10)))out.set(sha.slice(0,10),{lane,slug:''});
  }
  return out;
}

/** The lander of `sha` in `who`: by its 10-character short SHA, else by a shorter receipt SHA it starts with.
 * @template L @param {ReadonlyMap<string,L>} who @param {string} sha @returns {L|undefined} */
function landerOf(who,sha){
  const exact=who.get(sha.slice(0,10));
  if(exact!==undefined)return exact;
  for(const [key,lander] of who)if(key.length<10&&sha.startsWith(key))return lander;
  return undefined;
}

/**
 * Meta QA 11-25 row 54: a red range names every lane that landed a commit in it, not only the pusher. engine run
 * 45662209325 named opus-fr13, whose main-push carried opus-trailer's 5068a7365 (M1), and missed opus-trailer, whose
 * commit was the red. Each commit's `Lane:` trailers (`authored`, by full SHA) add a row for every author lane the
 * pusher is not, so the receipt, the NOTE RED lines and the prompts reach the author too.
 * @template {{lane:string,slug:string}} L
 * @param {readonly {sha:string,lander:L|undefined}[]} found @param {ReadonlyMap<string,readonly string[]>} authored
 * @returns {{sha:string,lander:L|{lane:string,slug:string}|undefined}[]} */
export function withAuthors(found,authored){
  /** @type {{sha:string,lander:L|{lane:string,slug:string}|undefined}[]} */const rows=[...found];
  for(const {sha,lander} of found){
    for(const lane of authored.get(sha)??[])if(lane!==lander?.lane&&!rows.some(row=>row.sha===sha&&row.lander?.lane===lane))rows.push({sha,lander:{lane,slug:''}});
  }
  return rows;
}

/** Each commit of a red range with its lander. `commits` is newest first (rev-list); a main-push lander also owns the
 * older commits its push carried (its count), unless they have a lander of their own.
 * @template {{lane:string,count?:number}} L
 * @param {readonly string[]} commits @param {ReadonlyMap<string,L>} who @returns {{sha:string,lander:L|undefined}[]} */
export function attribute(commits,who){
  const found=commits.map(sha=>({sha,lander:landerOf(who,sha)}));
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

/** Read file names from failure lines and stack frames, excluding ordinary pass/progress output.
 * @param {readonly string[]} logs */
export function failurePaths(logs){
  const paths=new Set();
  const pathPattern=/(?<![\w./-])\/?(?:[\w@.-]+\/)*[\w.-]+\.(?:[cm]?[jt]sx?|json|yml|yaml|css)(?=$|[^\w./-])/gu;
  for(const log of logs)for(const line of stripVTControlCharacters(log).split('\n')){
    const message=line.replace(/^\s*\d{4}-\d\d-\d\dT\S+\s+/u,'').trim();
    if(!/^(?:FAIL\b|❯\s|✖\s|×\s|::error\b|##\[error\]|[\w.-]*Error\b)/u.test(message)&&
      !/\berror TS\d+:/u.test(message))continue;
    for(const match of message.matchAll(pathPattern)){
      const file=match[0].replace(/^(?:\.\/|\/)/u,'');
      if(!file.includes('node_modules/'))paths.add(file);
    }
  }
  return [...paths];
}

/** Newest change in the red range supported by a path from a failed job.
 * @param {readonly string[]} commits @param {readonly string[]} files
 * @param {ReadonlyMap<string,readonly string[]>} changes */
export function redSuspect(commits,files,changes){
  const named=new Set(files);
  const touched=new Set(commits.flatMap(sha=>changes.get(sha)??[]));
  for(const file of files)if(!file.includes('/')){
    const matches=[...touched].filter(path=>path===file||path.endsWith(`/${file}`));
    if(matches.length===1)named.add(matches[0]);
  }
  for(const sha of commits){
    const file=changes.get(sha)?.find(path=>[...named].some(reported=>reported===path||reported.endsWith(`/${path}`)));
    if(file!==undefined)return {sha,file};
  }
  return undefined;
}

/** @typedef {{lane:string,sendPane?:string,sendTerminal?:string,key:string,lanes:Set<string>,commits:Set<string>,fixer:boolean}} RedRecipient */
/** @typedef {{lane:string,slug:string,pane?:string}} RedLander */
/** @param {readonly {sha:string,lander?:RedLander}[]} rows @param {Parameters<typeof paneFor>[0]} panes
 * @param {ReadonlyMap<string,string>} agents @param {readonly string[]} fixers */
export function redRecipients(rows,panes,agents,fixers){
  const groups=new Map();
  /** @param {string} lane @param {string|undefined} pane @param {string} [sha] */
  const add=(lane,pane,sha)=>{
    const address=pane??agents.get(lane);
    const key=address===undefined?`agent:${lane}`:`pane:${address}`;
    const group=/** @type {RedRecipient} */(groups.get(key)??{lane,sendPane:pane,key,lanes:new Set(),commits:new Set(),fixer:false});
    group.lanes.add(lane);
    if(sha===undefined)group.fixer=true;else group.commits.add(sha);
    groups.set(key,group);
  };
  for(const {sha,lander} of rows)if(lander!==undefined)add(lander.lane,lander.pane??paneFor(panes,lander.slug),sha);
  for(const lane of fixers)add(lane,undefined);
  return /** @type {RedRecipient[]} */([...groups.values()]);
}

/** Meta QA 11-25 row 21 (J505): the builder takes a red no lander was reached for, and the keeper's red (J443), once per
 * red span, by `hc send` to its terminal: `WS_MAIN_WATCH_BUILDER`, else the live hc terminal labelled `goal=saga-builder`.
 * It replaces build-max C1's coordinator pane (w2:p5), gone since 11-24: engine run 45569694131 reached no one. */
export const BUILDER_LABEL='goal=saga-builder';
/** @param {string|undefined} terminal the builder's hc terminal; undefined when none is found (then nothing is sent)
 * @returns {RedRecipient} */
export function fallbackRecipient(terminal){
  return {lane:'builder',...(terminal===undefined?{}:{sendTerminal:terminal}),key:'hc:builder',lanes:new Set(['builder']),commits:new Set(),fixer:false};
}

/** The receipt a lane's background wait matches (`NOTE RED <lane>:`), one per lander lane of a reported red.
 * @param {string} lane @param {number} run @param {string} range @param {string} failed */
export function redNote(lane,run,range,failed){
  return `NOTE RED ${lane}: run ${run} ${range} ${failed}`;
}

/** @param {RedRecipient} recipient @param {{range:string,url:string,failed:string,named:string,
 * suspect?:ReturnType<typeof redSuspect>}} red */
export function redMessage(recipient,{range,url,failed,named,suspect}){
  const ownsSuspect=suspect!==undefined&&recipient.commits.has(suspect.sha);
  const commits=[...recipient.commits].filter(sha=>!ownsSuspect||sha!==suspect?.sha).map(short).join(', ');
  const lead=suspect===undefined?' Suspect unconfirmed.':` Suspect ${short(suspect.sha)}${ownsSuspect?' (yours)':''} last changed ${suspect.file}.`;
  const owned=commits===''?'':` You ${ownsSuspect?'also ':''}landed ${commits}.`;
  const why=recipient.fixer?' You are the forward fixer (M2): fix forward now, or confirm a lander has it.'
    :recipient.commits.size>0?' Please fix forward now (J249).':' A lander could not be reached. Please fix forward now (J249).';
  return `main-watch: MAIN RED.${lead} Engine main ${range} (${url}); failed: ${failed}.${recipient.commits.size===0?` Landers: ${named}.`:owned}${why}`;
}

/** @param {unknown} value @returns {value is string} */
const isString=value=>typeof value==='string';

/** @param {string} file @returns {State|null} */
export function readState(file){
  if(!existsSync(file))return null;
  try{
    const value=JSON.parse(readFileSync(file,'utf8'));
    const red=value.red,notified=value.notified,history=red?.history;
    const kept=history!==null&&history!==undefined&&Array.isArray(history.commits)&&Array.isArray(history.files)&&Array.isArray(history.jobs)
      ?{commits:history.commits.filter(isString),files:history.files.filter(isString),jobs:history.jobs.filter(isString)}:undefined;
    return {judged:Array.isArray(value.judged)?value.judged.filter(Number.isSafeInteger):[],dispatched:Array.isArray(value.dispatched)?value.dispatched.filter(row=>typeof row==='string'):[],
      ...(Array.isArray(value.memoryQa)?{memoryQa:value.memoryQa}:{}),
      ...(Array.isArray(value.reruns)?{reruns:value.reruns.filter((/** @type {any} */row)=>row&&Number.isSafeInteger(row.id)&&typeof row.at==='number').map((/** @type {Rerun} */row)=>({id:row.id,at:row.at}))}:{}),
      ...(value.budgetPending&&typeof value.budgetPending==='object'&&!Array.isArray(value.budgetPending)?{budgetPending:Object.fromEntries(Object.entries(value.budgetPending).filter(([,row])=>row&&typeof row==='object'&&typeof row.sha==='string'&&typeof row.contentKey==='string'&&(row.baseline===null||Number.isFinite(row.baseline))&&(row.line===null||Number.isFinite(row.line))))}:{}),
      ...(notified!==null&&typeof notified==='object'&&!Array.isArray(notified)?{notified}:{}),
      ...(red!==null&&typeof red==='object'&&Number.isSafeInteger(red.run)&&typeof red.at==='number'&&typeof red.text==='string'?{red:{run:red.run,at:red.at,text:red.text,keeper:red.keeper===true,...(kept===undefined?{}:{history:kept})}}:{})};
  }catch{return null;}
}

/** @param {string} file @param {State} state */
function writeState(file,state){
  mkdirSync(dirname(file),{recursive:true});
  const temporary=`${file}.${process.pid}.tmp`;
  writeFileSync(temporary,`${JSON.stringify({judged:state.judged.slice(-KEEP),dispatched:state.dispatched.slice(-50),...(state.reruns?.length?{reruns:state.reruns.slice(-50)}:{}),...(state.memoryQa?.length?{memoryQa:state.memoryQa}:{}),...(state.budgetPending===undefined?{}:{budgetPending:state.budgetPending}),...(state.red===undefined?{}:{red:state.red}),...(state.notified===undefined?{}:{notified:state.notified})})}\n`);renameSync(temporary,file);
}

/** MD8: only mini routing changes. MacBook landers keep their existing prompts, including claimed runs.
 * @param {{machine:string,run:number,commits:readonly string[],recipientLanes:readonly string[],
 * localLanes:ReadonlySet<string>,receipts:string,trailers:ReadonlyMap<string,readonly string[]>}} scope */
export function shouldPromptRed({machine,run,commits,recipientLanes,localLanes,receipts,trailers}){
  if(machine!=='mini')return true;
  const local=(/** @type {string} */lane)=>localLanes.has(lane)||lane.startsWith('mini-');
  if(!recipientLanes.some(local))return false;
  const namedRun=new RegExp(`(?:run\\s*|actions/runs/)${run}(?!\\d)`,'iu');
  const claimed=receipts.split('\n').some(line=>/\b(?:NOTE|CLAIM)\b/u.test(line)&&namedRun.test(line)
    &&/MacBook/iu.test(line)&&/claim|owns?|owner|routed|not mini|stand down|stood down/iu.test(line));
  if(claimed)return false;
  return commits.some(sha=>(trailers.get(sha)??[]).some(local));
}

/** Save the address before submitting: an interrupted transport might already have delivered the prompt.
 * @param {Pick<ReturnType<typeof liveIo>,'state'|'send'|'prompt'|'redAllowed'|'hcSend'>} io @param {State} state
 * @param {number} run @param {RedRecipient} recipient @param {string} text @param {readonly string[]} [commits] */
function notifyRed(io,state,run,recipient,text,commits=[]){
  const seen=state.notified??={};
  const previous=Array.isArray(seen[run])?seen[run]:[];
  const pane=recipient.key.startsWith('pane:'),aliases=[...recipient.lanes].map(lane=>`agent:${lane}`);
  if(previous.includes(recipient.key)||aliases.some(alias=>previous.includes(alias)
    ||(!pane&&previous.some(key=>key.startsWith(`${alias}@pane:`)))))return null;
  if(io.redAllowed!==undefined&&!io.redAllowed(run,commits.length>0?commits:state.red?.history?.commits??[],[...recipient.lanes]))return null;
  const keys=[recipient.key,...pane?aliases.map(alias=>`${alias}@${recipient.key}`):[]];
  seen[run]=[...new Set([...previous,...keys])];
  const history=state.red?.history;
  if(history!==undefined&&commits.length>0)history.commits=[...new Set([...history.commits,...commits])];
  writeState(io.state,state);
  if(recipient.sendTerminal!==undefined)return io.hcSend?.(recipient.sendTerminal,text)?`sent to hc terminal ${recipient.sendTerminal}`:'';
  if(recipient.lane==='builder')return '';
  if(recipient.sendPane!==undefined)return io.send(recipient.sendPane,text)?`sent to pane ${recipient.sendPane}`:'';
  return io.prompt(recipient.lane,text)?`prompted herdr agent ${recipient.lane}`:'';
}

/** @param {readonly string[]} files */
function failedTestFiles(files){
  return [...new Set(files.filter(file=>/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file))
    .map(file=>file.replace(/^.*\/engine\/engine\//u,'')))];
}

/** Recover a span written by the previous watcher from the reported runs still in the CI window.
 * @param {Pick<ReturnType<typeof liveIo>,'commits'|'failed'>} io @param {State} state @param {readonly Run[]} runs
 * @returns {RedHistory} */
function restoreRedHistory(io,state,runs){
  const start=runs.find(run=>run.id===state.red?.run);
  const commits=new Set(),files=new Set(),jobs=new Set();
  if(start!==undefined){
    const judged=new Set(state.judged);
    for(const {run,kind,from} of judge(runs,{judged:[],dispatched:[]},null)){
      if(kind!=='red'||byCreated(run,start)<0||!judged.has(run.id))continue;
      if(state.notified?.[run.id]?.length)for(const sha of io.commits(from??null,run.head_sha))commits.add(sha);
      try{
        const failure=io.failed(run.id);
        for(const file of failedTestFiles(failurePaths(failure.logs)))files.add(file);
        for(const job of failure.names)jobs.add(job);
      }catch{/* Old logs may have expired. */}
    }
  }
  return {commits:[...commits],files:[...files],jobs:[...jobs]};
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
  const here=resolve(import.meta.dirname,'..', '..');
  const root=env.WS_MAIN_WATCH_ROOT??dirname(resolve(here,execFileSync('git',['rev-parse','--git-common-dir'],{cwd:here,encoding:'utf8'}).trim()));
  const repo=env.WS_MAIN_WATCH_REPO??REPO;
  const receipts=resolve(env.WS_LANE_RECEIPTS??join(homedir(),'.cache/wildshard/lane-receipts.log'));
  const run=(/** @type {string} */command,/** @type {string[]} */args)=>execFileSync(command,args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60_000,maxBuffer:32<<20});
  // MF12 (4): reads go through the reader App when this machine has it; the dispatch stays on the user's login.
  const read=(/** @type {string[]} */args,timeout=60_000)=>execFileSync('gh',args,{cwd:root,encoding:'utf8',env:readerEnv(env),stdio:['ignore','pipe','pipe'],timeout,maxBuffer:32<<20});
  const runsCache=resolve(env.WS_MAIN_WATCH_RUNS_CACHE??join(homedir(),'.cache/wildshard/main-watch-runs.json'));
  const state=resolve(env.WS_MAIN_WATCH_STATE??join(homedir(),'.cache/wildshard/main-watch.json'));
  /** @param {number} id @returns {Job[]} */
  const jobsFor=id=>JSON.parse(read(['api',`repos/${repo}/actions/runs/${id}/jobs?per_page=100`])).jobs;
  const io={
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
            Object.assign(row,cancelledJobs(jobs));
            row.blockingChecked=true;
            row.advisoryVersion=ADVISORY_VERSION;
          }
          return blockingRun(row,jobs);
        });
    }),
    failed:(/** @type {number} */id)=>{
      const jobs=failedJobs(jobsFor(id)),deadline=Date.now()+25_000;
      /** @type {string[]} */const logs=[];
      for(const job of jobs){
        const remaining=deadline-Date.now();
        if(remaining<=0)break;
        if(job.id===undefined)continue;
        try{logs.push(read(['api','--allow-escape-sequences',`repos/${repo}/actions/jobs/${job.id}/logs`],Math.min(remaining,10_000)));}
        catch{/* An expired or unavailable log cannot stop a red alert. */}
      }
      return {names:jobs.map(job=>job.name),logs};
    },
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
    // DF7 (meta DRIFTWOOD-FPS): the mini's nightly Driftwood floors report; after DF15 a red one is a fix row.
    fpsRuns:()=>sharedRuns(`${runsCache}.driftwood-fps`,()=>/** @type {Run[]} */(
      JSON.parse(read(['api',`repos/${repo}/actions/workflows/driftwood-fps.yml/runs?branch=main&per_page=15`])).workflow_runs)),
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
    changes:(/** @type {string|null} */from,/** @type {string} */to)=>{
      const out=new Map();
      try{
        const log=run('git',['log','--format=%x1e%H','--name-only','-z','--diff-merges=first-parent','--max-count=200',from===null?to:`${from}..${to}`]);
        for(const record of log.split('\u001E').filter(Boolean)){
          const [sha,...paths]=record.split('\0');
          out.set(sha,paths.filter(Boolean).map(file=>file.replace(/^\n/u,'')));
        }
      }catch{/* No local history means no suspect. */}
      return /** @type {Map<string,string[]>} */(out);
    },
    contains:(/** @type {string} */ancestor,/** @type {string} */descendant)=>{try{run('git',['merge-base','--is-ancestor',ancestor,descendant]);return true;}catch{return false;}},
    receipts:()=>existsSync(receipts)?readFileSync(receipts,'utf8'):'',
    receipt:(/** @type {string} */line)=>{mkdirSync(dirname(receipts),{recursive:true});appendFileSync(receipts,`${new Date().toISOString().slice(11,16)} UTC main-watch ${line}\n`);},
    panes:()=>{try{return JSON.parse(run('herdr',['pane','list'])).result.panes;}catch{return [];}},
    agents:()=>{
      /** @type {Map<string,string>} */const panes=new Map();
      try{
        /** @type {{name?:string,pane_id?:string,workspace_id?:string}[]} */
        const agents=JSON.parse(run('herdr',['agent','list'])).result.agents;
        for(const {name,pane_id: pane,workspace_id: workspace} of agents)if(name&&pane)
          panes.set(name,pane.includes(':')||workspace===undefined?pane:`${workspace}:${pane}`);
      }catch{/* A missing agent list still allows direct pane and lane-name delivery. */}
      return panes;
    },
    send:(/** @type {string} */pane,/** @type {string} */text)=>{try{run('herdr',['pane','run',pane,text]);return true;}catch{return false;}},
    // QA 11-25 row 21: the builder's hc terminal, which relays a red to lanes with no pane (Agent-tool subagents).
    builder:()=>{
      if(env.WS_MAIN_WATCH_BUILDER)return env.WS_MAIN_WATCH_BUILDER;
      try{
        /** @type {{address?:string,state?:string}[]} */const terminals=JSON.parse(run('hc',['ls','--json','--label',BUILDER_LABEL])).terminals??[];
        return terminals.find(row=>row.state===undefined||row.state==='live')?.address;
      }catch{return undefined;}
    },
    // hc refuses (non-zero) a terminal that is gone or sitting on a question; that counts as not delivered.
    hcSend:(/** @type {string} */terminal,/** @type {string} */text)=>{try{run('hc',['send',terminal,text]);return true;}catch{return false;}},
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
    redAllowed:(/** @type {number} */id,/** @type {readonly string[]} */commits,/** @type {readonly string[]} */recipientLanes)=>{
      const machine=env.WS_MACHINE??(/mini/iu.test(hostname())?'mini':'macbook');
      if(machine!=='mini')return true;
      const text=io.receipts(),localLanes=new Set([...io.agents().keys(),...io.fixers(),...[...landers(text).values()].map(row=>row.lane)]);
      return shouldPromptRed({machine,run:id,commits,recipientLanes,localLanes,receipts:text,trailers:io.lanes(commits)});
    },
    // Each commit's `Lane:` trailers, by full SHA (row 54 names their authors; MD8 routes by them).
    lanes:(/** @type {readonly string[]} */commits)=>{
      /** @type {Map<string,string[]>} */const trailers=new Map();
      if(commits.length>0){
        // Row 54: the whole body, since main-push writes `Lane:` in its own paragraph, which `%(trailers)` never sees.
        const log=run('git',['show','-s','--format=%H%x00%B%x1e',...commits]);
        for(const entry of log.split('\u001E')){
          const [sha,body]=entry.trim().split('\0');
          if(sha&&body!==undefined)trailers.set(sha,messageLanes(body));
        }
      }
      return trailers;
    },
    dispatch:()=>{run('gh',['workflow','run','ci.yml','--ref','main','-R',repo]);},
    // Row 67: a flake rerun of a red run's failed jobs, on the user's login like the dispatch.
    rerun:(/** @type {number} */id)=>{run('gh',['run','rerun',String(id),'--failed','-R',repo]);},
  };
  return io;
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
    const verdicts=judge(runs,previous,io.tip(),io.now?.()??Date.now()),state=/** @type {State & {memoryQa:MemoryQa[]}} */({ ...previous,
      judged:[...previous.judged],dispatched:[...previous.dispatched],memoryQa:[...previous.memoryQa??[]],reruns:[...previous.reruns??[]] });
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
      /** @type {string[]} */const lines=[];
      /** @type {{recipient:RedRecipient,text:string}[]} */const messages=[];
      /** @type {RedRecipient|undefined} */let fallback;
      /** @type {string|undefined} */let fallbackAlert;
      /** @type {string[]} */let redCommits=[];
      let firstRed=false;
      if(run.nativeInfra!==undefined)lines.push(`main advisory ${short(run.head_sha)} ${NATIVE_FOOTPRINT}: ${run.nativeInfra} (run ${run.id})`);
      if(verdict.kind==='superseded')lines.push(run.started===false
        ?`main ${short(run.head_sha)} skipped (pending, replaced) by ${short(verdict.by)} (run ${run.id}; never started; never red)`
        :`main ${short(run.head_sha)} superseded by ${short(verdict.by)} (run ${run.id} cancelled; never red)`);
      else if(verdict.kind==='dispatch')lines.push(`main ${short(run.head_sha)} has only a cancelled run (${run.id}) and nothing newer; dispatched ci on main once`);
      else{
        const commits=io.commits(verdict.from??null,run.head_sha),range=`${short(verdict.from)||'start'}..${short(run.head_sha)}`;
        const found=withAuthors(attribute(commits,who),io.lanes?.(commits)??new Map());
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
          const jobs=io.failed(run.id),files=failurePaths(jobs.logs),tests=failedTestFiles(files);
          const failed=jobs.names.join(' | ')||'see the run',url=`https://github.com/${io.repo}/actions/runs/${run.id}`;
          const changes=files.length===0?new Map():io.changes(verdict.from??null,run.head_sha);
          const suspect=redSuspect(commits,files,changes);
          // Row 67 (J505): a first-attempt red on a green main with no suspect in its range reruns its failed jobs once,
          // prompts nobody and is judged again on attempt 2. A red with a suspect, on attempt 2 or in a red span is as before.
          if(suspect===undefined&&(run.run_attempt??1)===1&&state.red===undefined&&io.rerun!==undefined&&!state.reruns.some(row=>row.id===run.id)){
            const shown=tests.length===0?failed:`${failed} (${tests.join(', ')})`;
            let why='';
            try{io.rerun(run.id);}catch(error){why=error instanceof Error?error.message.split('\n')[0]:String(error);}
            if(why===''){
              state.reruns.push({id:run.id,at:now});writeState(io.state,state);
              for(const line of [...lines,`main flake rerun ${range} run ${run.id}: no suspect in range; failed jobs rerun once (J505); failed: ${shown}`])io.receipt(line);
              verdict.kind='rerun';
              continue;
            }
            lines.push(`main flake rerun of run ${run.id} did not start (${why}); judged red now`);
          }
          const details={range,url,failed:tests.length===0?failed:`${failed} (${tests.join(', ')})`,named,suspect},agents=io.agents();
          fallback=fallbackRecipient(io.builder?.());
          fallbackAlert=redMessage(fallback,details);
          firstRed=state.red===undefined;
          const history=firstRed?{commits:[],files:[],jobs:[]}:state.red?.history??restoreRedHistory(io,state,runs);
          const prompted=new Set(history.commits),seenFiles=new Set(history.files),seenJobs=new Set(history.jobs);
          const newFiles=tests.filter(file=>!seenFiles.has(file));
          const newJobs=jobs.names.filter(job=>!seenJobs.has(job));
          const fresh=tests.length===0?newJobs:newFiles,newFailures=fresh.join(' | ');
          // A5: a later run in the span that fails only what already failed is still the same red: a receipt, no prompts
          const repeat=!firstRed&&fresh.length===0;
          lines.push(repeat?`main still red ${range} run ${run.id}: no new failures; failed: ${failed}`
            :`MAIN RED ${range} run ${run.id}: landers ${named}; failed: ${failed}`);
          // QA 11-25 row 21: the receipt every lander's background wait matches, pane or no pane.
          if(!repeat)for(const lane of names)lines.push(redNote(lane,run.id,range,details.failed));
          const newSuspects=newFiles.map(file=>redSuspect(commits,[file],changes)).filter(candidate=>candidate!==undefined);
          // The failing test can point to a change in its source. Only use the run-wide suspect if every failed test is new.
          if(newFiles.length>0&&newFiles.length===tests.length&&suspect!==undefined)newSuspects.push(suspect);
          if(!repeat)for(const recipient of redRecipients(found,io.panes(),agents,io.fixers())){
            const ownsNewFailure=newSuspects.find(candidate=>recipient.commits.has(candidate.sha));
            const ownsNewCommits=new Set([...recipient.commits].filter(sha=>!prompted.has(sha)||sha===ownsNewFailure?.sha));
            if(firstRed)messages.push({recipient,text:redMessage(recipient,details)});
            else if(ownsNewCommits.size>0){
              const target={...recipient,commits:ownsNewCommits};
              messages.push({recipient:target,text:redMessage(target,{...details,failed:newFailures,suspect:ownsNewFailure??newSuspects[0]})});
            }
          }
          // FS22: the keeper's clock starts at the first reported red.
          state.red??={run:run.id,at:now,text:fallbackAlert??failed,keeper:false};
          state.red.history={commits:history.commits,files:[...seenFiles,...newFiles],jobs:[...seenJobs,...newJobs]};
          redCommits=commits;
        }
        memoryWarnings(run,annotations,lines);
      }
      if(verdict.kind==='green')delete state.red;
      state.judged.push(run.id);if(verdict.kind==='dispatch')state.dispatched.push(run.head_sha);writeState(io.state,state);
      if(verdict.kind==='dispatch')io.dispatch();
      for(const line of lines)io.receipt(line);
      let needsFallback=!messages.some(message=>message.recipient.commits.size>0);
      let fallbackAttempted=false;
      for(const {recipient,text} of messages){
        const how=notifyRed(io,state,run.id,recipient,text,redCommits);
        if(recipient.commits.size>0&&how==='')needsFallback=true;
        if(recipient.key===fallback?.key||recipient.lanes.has('builder'))fallbackAttempted=true;
        if(how!==null)io.receipt(`MAIN RED message to ${[...recipient.lanes].join(', ')} ${how===''?'not delivered (no reachable pane or herdr agent)':how}`);
      }
      if(firstRed&&needsFallback&&!fallbackAttempted&&fallbackAlert!==undefined&&fallback!==undefined){
        const how=notifyRed(io,state,run.id,fallback,fallbackAlert,redCommits);
        if(how!==null)io.receipt(`main red fallback to builder ${how||'not delivered (no builder hc terminal reached)'}`);
        fallbackAttempted=true;
      }
      if(verdict.kind==='red'&&fallbackAttempted&&state.red!==undefined&&!state.red.keeper){state.red.keeper=true;writeState(io.state,state);}
    }
    // FS22 (J443): the keeper owns a red no pusher fixed. KEEPER_MS after the span's first alert with no green verdict,
    // the builder's hc terminal gets it, once per span; the pushers were pinged first and nobody else stops.
    if(state.red!==undefined&&!state.red.keeper&&now-state.red.at>=KEEPER_MS){
      const minutes=Math.round((now-state.red.at)/60_000);
      const keeper=fallbackRecipient(io.builder?.());
      const how=notifyRed(io,state,state.red.run,keeper,`main-watch: keeper (J443): engine main is still red ${minutes} min after this alert, with no green since. ${state.red.text}`);
      if(how!==null)io.receipt(`main red keeper: builder ${how||'not delivered (no builder hc terminal reached)'} after ${minutes} min red with no green (run ${state.red.run})`);
      state.red.keeper=true;writeState(io.state,state);
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
    for(const run of budgetRuns.filter(row=>finished(row)&&!state.judged.includes(row.id)).sort(byCreated)){
      /** @type {ReturnType<typeof budgetReport>} */let report={lines:[],qa:null};
      if(run.conclusion==='failure'){
        try{
          // BC15: the commit a budgets run measured is its ci run's (the run name says which), not its own head_sha
          const measured=(/** @type {Run} */row)=>{const source=budgetSourceRun(row);return source===null||io.runSha===undefined?row.head_sha:io.runSha(source);};
          const sha=measured(run);
          const earlier=budgetRuns.filter(row=>row.id<run.id&&finished(row));
          const before=earlier.map(measured).find(other=>other!==sha)??null;
          const pushers=[...new Set(attribute(io.commits(before,sha),who).map(row=>row.lander?.lane??'').filter(Boolean))];
          const results=parseBudgetResults(io.budgetAnnotations?.(run.id)??'');
          const observed=confirmBudgetResults({head_sha:sha},results,state.budgetPending);
          state.budgetPending=observed.pending;
          // Preserve infrastructure errors, but a first soft reading has no QA/fix row.
          report=results.length===0?budgetReport({...run,head_sha:sha},[],pushers)
            :observed.confirmed.length===0?{lines:[],qa:null}:budgetReport({...run,head_sha:sha},observed.confirmed,pushers);
          for(const result of observed.quiet)report.lines.push(`main budget observation ${short(sha)} ${result.key} ${result.measured}, line ${result.line??'-'} (run ${run.id}; waiting for a second distinct-SHA miss)`);
        }catch(error){
          io.receipt(`budgets results unavailable for run ${run.id}: ${error instanceof Error?error.message.split('\n')[0]:String(error)}`);
          continue;
        }
      }
      if(run.conclusion==='success')state.budgetPending={};
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
    // DF7 (J444, J464): a red Driftwood floors night (DF15 turns the gate on) is a fix row for whoever pushed since the
    // last green night, never main red. The run name carries both builds (driftwood-fps.yml run-name).
    let fpsRuns=/** @type {Run[]} */([]);
    try{fpsRuns=io.fpsRuns?.()??[];}catch(error){
      io.receipt(`driftwood fps status unavailable: ${error instanceof Error?error.message.split('\n')[0]:String(error)}`);
    }
    for(const run of fpsRuns.filter(row=>finished(row)&&!state.judged.includes(row.id)).sort(byCreated)){
      state.judged.push(run.id);writeState(io.state,state);
      if(run.conclusion!=='failure')continue;
      const night=fpsNight(run);
      if(night===null){io.receipt(`main DRIFTWOOD-FPS run ${run.id} failed with no night in its name (see the run; DF7)`);continue;}
      let pushers=/** @type {string[]} */([]);
      try{pushers=[...new Set(attribute(io.commits(night.since,night.build),who).map(row=>row.lander?.lane??'').filter(Boolean))];}
      catch{/* a build main-watch cannot read still gets its receipt */}
      io.receipt(`main DRIFTWOOD-FPS ${short(night.build)} run ${run.id} failure: a floor miss or a p95 more than 10% over the last green night`
        +` ${night.since===null?'(none)':short(night.since)}; a fix row for ${pushers.length>0?pushers.join(', '):'no land receipt (pushed by hand or the queue)'}, never a red main (DF7, J444)`);
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
      const runs=io.runs();
      seen.push(...sweep({...io,runs:()=>runs},options));
      // Row 67: a run whose failed jobs were rerun has no verdict until its second attempt finishes.
      const pending=pendingReruns(readState(io.state),runs,io.now?.()??Date.now());
      if(verdictFor(runs.filter(row=>!pending.has(row.id)),options.sha,io.contains)!==null)return seen;
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
    const here=resolve(import.meta.dirname,'..', '..');
    const root=dirname(resolve(here,execFileSync('git',['rev-parse','--git-common-dir'],{cwd:here,encoding:'utf8'}).trim()));
    mkdirSync(join(root,'tmp/placement-sweep'),{recursive:true});
    const log=openSync(join(root,'tmp/placement-sweep/sweep.log'),'a');
    spawn(process.execPath,[join(root,'src/scripts/placement-sweep.mjs')],{cwd:root,detached:true,stdio:['ignore',log,log]}).unref();
  }
}
