// LAND-SIMPLIFY LS5 (J258): main's CI verdict, reported by a small watcher instead of by land. Jake, 2026-11-11:
// land returns as soon as main is pushed; "a receipt line + a direct message to that agent" on red, and the
// coordinator assigns the fix if the lander is gone.
//
//   node scripts/main-watch.mjs                     judge every finished main ci run not judged yet (tick or by hand)
//   node scripts/main-watch.mjs --follow=<sha> [--lane=<name>] [--pane=<herdr pane>] [--after-push=<s>]
//                                                   wait until <sha> has a verdict, then judge (land starts this;
//                                                   a mode-1 main pre-push starts it with --after-push, EV2)
//
// The verdict for a SHA is the newest completed main `ci` run that isn't cancelled and whose SHA is that SHA or a
// descendant of it. A cancelled run is superseded when a later main run exists, never red; with no later run,
// the watcher dispatches `ci` on main once. Each red run gives one `MAIN RED <range>` receipt naming the landers
// of the commits in its range (from their `landed` receipts) and a message to each lander's herdr pane. State
// (~/.cache/wildshard/main-watch.json) keeps the judged run ids, so a run is reported once however often this runs.
// A green run that carries AMBER files (J295: a test file over its time budget, scripts/test-amber.mjs) also gives
// one `main AMBER <sha> <file> <ms>/<budget>` receipt per file: the coordinator hands each out as a queue-skipping
// fix row the same day (meta HOW-WE-BUILD-PLAN.md). AUDIO AU6 (J303): a shard whose audio is over 6 MB gives the same
// kind of receipt, `main AMBER <sha> audio <shard> <tier> <MB>/6.00 MB`, from the cook report's test; never a red main.
import {execFileSync} from 'node:child_process';
import {appendFileSync,existsSync,mkdirSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {setTimeout} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {AMBER,parseAmber,parseAudioAmber} from './test-amber.mjs';
import {RATE_LIMITED,quotaReset,readerEnv} from './gh-limit.mjs';

export const REPO='project-wildshard/engine';
const KEEP=500;

/** @typedef {{id:number,head_sha:string,status:string,conclusion:string|null,created_at:string,event:string}} Run */
/** @typedef {{judged:number[],dispatched:string[]}} State */
/** @typedef {{kind:'green'|'red'|'superseded'|'dispatch',run:Run,from?:string|null,by?:string}} Verdict */

const short=(/** @type {string|null|undefined} */sha)=>(sha??'').slice(0,10);
const finished=(/** @type {Run} */run)=>run.status==='completed';
const cancelled=(/** @type {Run} */run)=>run.conclusion==='cancelled'||run.conclusion==='skipped';
const byCreated=(/** @type {Run} */a,/** @type {Run} */b)=>Date.parse(a.created_at)-Date.parse(b.created_at)||a.id-b.id;

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

/** Landed receipts by short SHA: `HH:MM UTC <lane> land plan/<slug> landed <sha10> on main …`.
 * @param {string} text @returns {Map<string,{lane:string,slug:string,pane?:string}>} */
export function landers(text){
  const out=new Map();
  for(const match of text.matchAll(/^\d\d:\d\d UTC (\S+) land plan\/(\S+) landed(?:, MAIN RED)? ([0-9a-f]{10}) on main/gmu)){
    const [,lane='',slug='',sha='']=match;out.set(sha,{lane,slug});
  }
  return out;
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
    return {judged:Array.isArray(value.judged)?value.judged.filter(Number.isSafeInteger):[],dispatched:Array.isArray(value.dispatched)?value.dispatched.filter(row=>typeof row==='string'):[]};
  }catch{return null;}
}

/** @param {string} file @param {State} state */
function writeState(file,state){
  mkdirSync(dirname(file),{recursive:true});
  const temporary=`${file}.${process.pid}.tmp`;
  writeFileSync(temporary,`${JSON.stringify({judged:state.judged.slice(-KEEP),dispatched:state.dispatched.slice(-50)})}\n`);renameSync(temporary,file);
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
  return {
    repo,
    quotaReset:()=>quotaReset(),
    state:resolve(env.WS_MAIN_WATCH_STATE??join(homedir(),'.cache/wildshard/main-watch.json')),
    // MF12: every land leaves a follow running for up to 90 min, so one machine can hold several; they share one fetch.
    runs:()=>sharedRuns(resolve(env.WS_MAIN_WATCH_RUNS_CACHE??join(homedir(),'.cache/wildshard/main-watch-runs.json')),
      ()=>/** @type {Run[]} */(JSON.parse(read(['api',`repos/${repo}/actions/workflows/ci.yml/runs?branch=main&per_page=50`])).workflow_runs
        .filter((/** @type {Run} */row)=>row.event==='push'||row.event==='workflow_dispatch'))),
    failed:(/** @type {number} */id)=>/** @type {{name:string,conclusion:string|null}[]} */(JSON.parse(read(['api',`repos/${repo}/actions/runs/${id}/jobs?per_page=100`])).jobs)
      .filter(job=>job.name!=='timings'&&job.name!=='quarantine'&&(job.conclusion==='failure'||job.conclusion==='timed_out')).map(job=>job.name),
    // Blocking tests own AMBER evidence. The advisory timings collector only repeats it;
    // its annotations cannot change main's verdict. Quarantine reports separately (J193).
    annotations:(/** @type {number} */id)=>/** @type {{id:number,name:string}[]} */(JSON.parse(read(['api',`repos/${repo}/actions/runs/${id}/jobs?per_page=100`])).jobs)
      .filter(job=>job.name.startsWith('tests'))
      .map(job=>/** @type {{message:string}[]} */(JSON.parse(read(['api',`repos/${repo}/check-runs/${job.id}/annotations?per_page=100`]))).map(row=>row.message).join('\n')).join('\n'),
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
    // name, from WS_FORWARD_FIXER (comma-separated; set on the Mac mini only).
    fixers:()=>(process.env.WS_FORWARD_FIXER??'').split(',').map(name=>name.trim()).filter(name=>/^[\w.-]+$/u.test(name)),
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
    let previous=readState(io.state);
    if(previous===null){
      // A followed SHA's own runs stay unjudged, so the first follow still reports its verdict.
      const baseline=runs.filter(row=>finished(row)&&(hint.sha===undefined||row.head_sha!==hint.sha));
      previous={judged:baseline.map(row=>row.id),dispatched:[]};writeState(io.state,previous);
      io.receipt(`started: ${baseline.length} finished main runs taken as already judged`);
      if(hint.sha===undefined)return [];
    }
    const verdicts=judge(runs,previous,io.tip()),state={judged:[...previous.judged],dispatched:[...previous.dispatched]};
    const who=landers(io.receipts());
    // land names itself and its pane when it starts a follow, before its own receipt may be written.
    if(hint.sha!==undefined&&hint.lane!==undefined)who.set(hint.sha.slice(0,10),{lane:hint.lane,slug:who.get(hint.sha.slice(0,10))?.slug??'',pane:hint.pane});
    for(const verdict of verdicts){
      const {run}=verdict;
      // Everything a report needs is read first; the run is recorded; only then does the report go out. A failed
      // read leaves the run for the next sweep, and a report is never sent twice.
      /** @type {string[]} */const lines=[];/** @type {{lane:string,pane:string|undefined,text:string}[]} */const messages=[];
      if(verdict.kind==='superseded')lines.push(`main ${short(run.head_sha)} superseded by ${short(verdict.by)} (run ${run.id} cancelled; never red)`);
      else if(verdict.kind==='dispatch')lines.push(`main ${short(run.head_sha)} has only a cancelled run (${run.id}) and nothing newer; dispatched ci on main once`);
      else{
        const commits=io.commits(verdict.from??null,run.head_sha),range=`${short(verdict.from)||'start'}..${short(run.head_sha)}`;
        const found=commits.map(sha=>({sha,lander:who.get(sha.slice(0,10))}));
        const names=[...new Set(found.map(row=>row.lander?.lane??'').filter(Boolean))];
        const named=names.length===0?'no land receipt (pushed by hand or the queue)':names.join(', ');
        if(verdict.kind==='green'){
          lines.push(`main green ${short(run.head_sha)} (run ${run.id}; ${range}; landed by ${named})`);
          /** @type {{file:string,ms:number,budget:number}[]} */let ambers=[];
          /** @type {ReturnType<typeof parseAudioAmber>} */let audio=[];
          try{const text=io.annotations(run.id);ambers=parseAmber(text);audio=parseAudioAmber(text);}catch(error){lines.push(`main AMBER ${short(run.head_sha)} unknown (run ${run.id}; its annotations were unreadable: ${error instanceof Error?error.message.split('\n')[0]:String(error)})`);}
          for(const row of ambers)lines.push(`main AMBER ${short(run.head_sha)} ${row.file} ${row.ms}/${row.budget} (run ${run.id}; J295: a queue-skipping fix row today; red at ${AMBER.redFactor}x, after ${AMBER.redAfterHours} h or ${AMBER.redAfterRuns} amber main runs)`);
          const mb=(/** @type {number} */bytes)=>(bytes/1e6).toFixed(2);
          for(const row of audio)lines.push(`main AMBER ${short(run.head_sha)} audio ${row.shard} ${row.tier} ${mb(row.bytes)} MB/${mb(row.budget)} MB (run ${run.id}; J303${row.level==='red'?`, over the ${mb(row.red)} MB red line`:''}: its AUDIO-PLAN source pass; never a red main)`);
        }
        else{
          const failed=io.failed(run.id).join(' | ')||'see the run',url=`https://github.com/${io.repo}/actions/runs/${run.id}`,panes=io.panes();
          lines.push(`MAIN RED ${range} run ${run.id}: landers ${named}; failed: ${failed}`);
          for(const row of found)if(row.lander!==undefined)messages.push({lane:row.lander.lane,pane:row.lander.pane??(row.lander.slug===''?undefined:paneFor(panes,row.lander.slug)),
            text:`main-watch: MAIN RED on engine main ${range} (${url}); failed: ${failed}. You landed ${short(row.sha)}: fix forward now (J249).`});
          for(const fixer of io.fixers())messages.push({lane:fixer,pane:undefined,
            text:`main-watch: MAIN RED on engine main ${range} (${url}); landers ${named}; failed: ${failed}. You are the forward fixer (M2): fix forward now, or confirm a lander has it.`});
        }
      }
      state.judged.push(run.id);if(verdict.kind==='dispatch')state.dispatched.push(run.head_sha);writeState(io.state,state);
      if(verdict.kind==='dispatch')io.dispatch();
      for(const line of lines)io.receipt(line);
      for(const message of messages){
        const how=message.pane!==undefined&&io.send(message.pane,message.text)?`sent to pane ${message.pane}`
          :io.prompt(message.lane,message.text)?`prompted herdr agent ${message.lane}`:'';
        io.receipt(`MAIN RED message to ${message.lane} ${how===''?'not delivered (no pane, no herdr agent by that name): the coordinator assigns the fix':how}`);
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
}
