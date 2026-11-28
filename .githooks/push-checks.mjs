import {execFileSync,spawn} from 'node:child_process';
import {availableParallelism,constants,getPriority,homedir,loadavg} from 'node:os';
import {appendFileSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {basename,dirname,join,resolve,delimiter} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fullSuiteWorkers,gateTestEnvironment,gateWorkers} from './gate-workers.mjs';
import {expectedSuiteSeconds,progressReport} from '../src/scripts/vitest-progress.mjs';
import {readTimings} from '../src/scripts/test-timings.mjs';
import {assertHeavyLease} from '../src/scripts/heavy-lane-lease.mjs';
import {gateSlot} from '../src/scripts/push-gate-slot.mjs';
import {PUSH_BUDGET, PUSH_PROFILE, SPLIT_PROFILE} from '../src/scripts/push-budget.mjs';
import {BROWSER_TESTS,TIMING_TESTS,logHostedOnly,planBaseRefs,splitLocalTests,splitRequested} from '../src/scripts/push-local-split.mjs';
import {pushSelection} from '../src/scripts/push-selection.mjs';
import {capturePushTree,pushProofDisposition,readPushProof,writePushProof} from '../src/scripts/push-proof-cache.mjs';
import {gateEnvironment} from '../src/scripts/push-environment.mjs';
import {gateReport,printGateReport} from '../src/scripts/gate-report.mjs';
import {discoverLocalDeltaPlan,localDeltaPlan} from '../src/scripts/local-land-delta.mjs';
import {fs27Plan,pinChanges,simRingSlugs} from '../src/scripts/push-path-edges.mjs';
import {shardPinTests} from '../src/scripts/gate-related-tests.mjs';
import {freshenPush} from '../src/scripts/typecheck-fresh.mjs';

/** Identical proof identity before/inside a real lease; no heavy work is done on reuse.
 * @param {NodeJS.ProcessEnv} [environment] */
export function pushEnvironment(environment=process.env){
  // This environment drops WS_GATE_NODE. Remove the test shim that needs it before running any probes.
  const searchPath=environment.PATH?.split(delimiter)
    .filter(path=>basename(path)!=='gate-bin'||basename(dirname(path))!=='.githooks').join(delimiter);
  const source=searchPath===undefined?environment:{...environment,PATH:searchPath};
  const env={...gateEnvironment(source),PWD:process.cwd(),WS_PUSH_GATE_PROFILE:PUSH_PROFILE,
    WS_PUSH_LINT_THREADS:String(PUSH_BUDGET.lintThreads),GOMAXPROCS:String(PUSH_BUDGET.lintGo),UV_THREADPOOL_SIZE:'1',WS_CPU_ADMISSION:'1',
    WS_HEAVY_SCHEDULER_ROOT:resolve(environment.WS_HEAVY_SCHEDULER_ROOT??environment.WS_HEAVY_ROOT??resolve(homedir(),'.wildshard-heavy-lanes'))};
  if(environment.WS_LOCAL_LAND_SOURCE_REF!==undefined){
    env.npm_config_enable_global_virtual_store='false';
    env.npm_config_package_import_method='clone-or-copy';
    if(environment.PLAYWRIGHT_BROWSERS_PATH!==undefined)env.PLAYWRIGHT_BROWSERS_PATH=environment.PLAYWRIGHT_BROWSERS_PATH;
  }
  // Git prepends its exec directory when it invokes a hook. Execute both gate
  // entries with that same effective search order; duplicate entries add no tool.
  if(searchPath!==undefined){
    const gitPath=execFileSync('git',['--exec-path'],{env:source,encoding:'utf8'}).trim();
    env.PATH=[...new Set([gitPath,...searchPath.split(delimiter)])].join(delimiter);
  }
  // Apple's Git launcher also selects compiler paths before starting a hook.
  // Observe its real child now so the pre-gate and hook execute under the same
  // SDK, rather than omitting compiler inputs from the proof fingerprint.
  if(process.platform==='darwin'){
    const bin=resolve(import.meta.dirname,'bin');
    /** @type {Record<string,unknown>} */
    const sdk=JSON.parse(execFileSync('git',['wildshard-push-env'],{env:{...env,PATH:[bin,searchPath??''].join(delimiter)},encoding:'utf8'}));
    for(const key of ['CPATH','LIBRARY_PATH','MANPATH','SDKROOT']){
      const value=sdk[key];
      if(value!==undefined){if(typeof value!=='string')throw new Error('Invalid Git compiler environment');env[key]=value;}
    }
    // xcrun appends the same manual search directory on every nested invocation.
    // Repeating a directory changes no lookup but would change the runtime hash.
    if(env.MANPATH!==undefined)env.MANPATH=[...new Set(env.MANPATH.split(delimiter))].join(delimiter);
  }
  Reflect.deleteProperty(env,'WILDSHARD_RING');Reflect.deleteProperty(env,'WS_TEST_QUARANTINE');
  const workers=String(gateWorkers(env));
  return {...env,WS_GATE_WORKERS:workers,WS_VITEST_MAX_WORKERS:workers};
}

/** J505 (Jake, 2026-11-23: "make it a permanent fix"): a push gate step that runs past ~3x its normal time is stuck, not
 * slow. On 11-23 an engine-quickfix main-push sat 35 min in run-checks until it was killed by hand. The whole gate runs
 * in ~74 s, so a step gets 240 s (`WS_PUSH_STUCK_S`), a Vitest step 900 s, each scaled up when the machine's 1-minute
 * load is over its cores; then the gate stops it, says "STUCK in <step> after N min", logs a STUCK receipt and fails,
 * which refuses the push and keeps the commit. */
export const STUCK_STEP_SECONDS=240,STUCK_VITEST_SECONDS=900;

/** Meta QA70: the full suite is ~2,450 files, ~6,700 hosted seconds; 900 s was ~3x a related run, not ~3x the full one.
 * A full Vitest step's stuck limit is 2x the timings table's expected wall on its workers, never under 900 s. Hosted
 * seconds already run slow here: 6,686 / 9 workers is 743 s, and the measured MacBook full run took 449 s at load 6-14.
 * @param {Record<string,number>|undefined} table @param {number} workers */
export const FULL_STUCK_FACTOR=2;
export function fullStuckSeconds(table,workers){
  const expected=expectedSuiteSeconds(table,workers);
  return expected===null?STUCK_VITEST_SECONDS:Math.max(STUCK_VITEST_SECONDS,Math.ceil(FULL_STUCK_FACTOR*expected));
}

/** Meta QA70: a Vitest step writes per-file progress so its end or STUCK line names the files that held it.
 * @param {string[]} command */
export function withProgressReporter(command){
  if(!command[1]?.endsWith('vitest-tmp.ts'))return command;
  const own=resolve('src/scripts/vitest-progress.mjs');
  return [...command,...(command.some(arg=>arg.startsWith('--reporter'))?[]:['--reporter=default']),`--reporter=${own}`];
}

/** A step's unscaled stuck limit, in s. @param {{name:string,stuckSeconds?:number}} task @param {NodeJS.ProcessEnv} [env] */
function stuckBaseSeconds(task,env=process.env){
  const override=Number(env.WS_PUSH_STUCK_S);
  return task.stuckSeconds??(Number.isFinite(override)&&override>0?override:task.name.startsWith('vitest')?STUCK_VITEST_SECONDS:STUCK_STEP_SECONDS);
}

/** The stuck limit for one gate step, in ms. @param {{name:string,stuckSeconds?:number}} task @param {NodeJS.ProcessEnv} [env] @param {number} [load] @param {number} [cores] */
export function stuckLimitMs(task,env=process.env,load=loadavg()[0]??0,cores=availableParallelism()){
  return Math.round(stuckBaseSeconds(task,env)*Math.max(1,load/Math.max(1,cores))*1000);
}

/** Vitest's loaded limit: at most this many times its base. Re-sampled this often while loaded. */
export const STUCK_LOAD_CAP=3,STUCK_RESAMPLE_MS=60_000;

/** QA 11-24 row 33 (v0.1.83): the start-time scale missed load that rose after a Vitest step began. When a Vitest step's
 * watchdog fires, the 1-minute load per core is sampled again: while it is over 1 the step gets up to another minute, never
 * past 3x its base limit (or its start limit, when that was larger); otherwise it is stuck. Other steps never extend.
 * @param {{name:string,stuckSeconds?:number}} task @param {number} elapsedMs @param {number} limitMs the step's start limit
 * @param {NodeJS.ProcessEnv} [env] @param {number} [load] @param {number} [cores] @returns {number} ms more to wait, 0 when stuck */
export function stuckExtensionMs(task,elapsedMs,limitMs,env=process.env,load=loadavg()[0]??0,cores=availableParallelism()){
  if(!task.name.startsWith('vitest')||load/Math.max(1,cores)<=1)return 0;
  const cap=Math.max(limitMs,stuckBaseSeconds(task,env)*STUCK_LOAD_CAP*1000);
  return Math.max(0,Math.min(STUCK_RESAMPLE_MS,Math.round(cap-elapsedMs)));
}

/** Append one STUCK receipt line (lane-receipts.log, or `WS_LANE_RECEIPTS`); never on a hosted runner, never fatal. @param {string} line @param {NodeJS.ProcessEnv} [env] */
function stuckReceipt(line,env=process.env){
  if(env.GITHUB_ACTIONS==='true')return;
  const at=new Date().toISOString().slice(11,16);
  try{appendFileSync(env.WS_LANE_RECEIPTS??join(homedir(),'.cache/wildshard/lane-receipts.log'),`${at} UTC ${env.WS_LANE_NAME||'push-gate'} STUCK ${line}\n`);}catch{ /* the gate's own line stands */ }
}

/** Run actual process groups, drain each one, and never start a later step after failure.
 * @param {{name:string,commands:string[][],stuckSeconds?:number,env?:NodeJS.ProcessEnv}[]} tasks
 * @param {{cwd?:string,env?:NodeJS.ProcessEnv,graceMs?:number,timeoutMs?:number,stuck?:boolean}} [options] */
export async function parallelChecks(tasks,options={}) {
  if(options.timeoutMs!==undefined&&(!Number.isFinite(options.timeoutMs)||options.timeoutMs<=0))throw new Error('Invalid owned command deadline');
  if(options.env?.WS_CPU_ADMISSION==='1')tasks=tasks.map(task=>({...task,commands:task.commands.map(command=>{
    if(task.name.startsWith('vitest'))return command; // Actual files own their grants.
    const slots=command.includes('--builders')?PUSH_BUDGET.builders:task.name.startsWith('lint')?Math.min(Math.max(2,availableParallelism()-2),Math.max(2,Number(options.env?.WS_PUSH_LINT_THREADS)||0)):1;
    return ['python3',resolve('src/scripts/cpu-admission.py'),'run','--slots',String(slots),'--',...command];
  })}));
  const active=new Set(),results=[],started=Date.now(),grace=options.graceMs??1500;
  // CPU-BROKER: the first failure stops every other task. A task that ends after that was stopped, not refused on its
  // own: its line names the cause, so the first RED is the real one (a stopped vitest once read as a broker fault).
  let refused=false,cause='';
  // A group gone (ESRCH) or no longer ours to signal (EPERM: its id taken by another user's process) holds nothing of the gate's.
  const signal=(group,name)=>{if(typeof group!=='number')return;try{process.kill(-group,name);}catch(error){if(error.code!=='ESRCH'&&error.code!=='EPERM')throw error;}};
  const groups=child=>{
    if(typeof child.pid!=='number')return [];
    const rows=execFileSync('ps',['-Ao','pid=,ppid=,pgid='],{encoding:'utf8'}).trim().split('\n').map(line=>line.trim().split(/\s+/u).map(Number));
    const descendants=new Set([child.pid]);let changed=true;
    while(changed){changed=false;for(const [pid,parent] of rows)if(descendants.has(parent)&&!descendants.has(pid)){descendants.add(pid);changed=true;}}
    return [...new Set([child.pid,...rows.filter(([pid])=>descendants.has(pid)).map(([, ,group])=>group)])];
  };
  const stop=why=>{
    if(refused)return;refused=true;cause=why;
    for(const child of active){child.groups=groups(child);for(const group of child.groups)signal(group,'SIGTERM');child.escalation=setTimeout(()=>{for(const group of child.groups)signal(group,'SIGKILL');},grace);}
  };
  const interrupted=()=>stop('an interrupt');process.on('SIGINT',interrupted);process.on('SIGTERM',interrupted);
  let timedOut=false;
  const deadline=options.timeoutMs===undefined?undefined:setTimeout(()=>{timedOut=true;stop('the deadline');},options.timeoutMs);
  try {
    await Promise.all(tasks.map(async (task,index)=>{
      const at=Date.now();let output='',code=0,own=false,stuck=false;
      // Meta QA70: a Vitest step's per-file progress, read when it ends or is stopped.
      const progress=task.name.startsWith('vitest')?resolve('tmp',`vitest-progress-${process.pid}-${index}.jsonl`):undefined;
      if(progress!==undefined){mkdirSync(dirname(progress),{recursive:true});rmSync(progress,{force:true});}
      // J505: the step's watchdog. Stuck is this step's own red; the others it stops name it.
      const env={...(options.env??process.env),...task.env,...(progress===undefined?{}:{WS_VITEST_PROGRESS:progress})},limit=options.stuck===false?undefined:stuckLimitMs(task,env);
      let watchdog;
      const arm=ms=>{watchdog=setTimeout(()=>{
        if(refused)return;
        const more=limit===undefined?0:stuckExtensionMs(task,Date.now()-at,limit,env);
        if(more>0){arm(more);return;}
        const minutes=((Date.now()-at)/60_000).toFixed(1);stuck=true;
        const files=progressReport(progress);
        const line=`push gate: STUCK in ${task.name} after ${minutes} min (limit ${((limit??0)/1000).toFixed(0)} s, ~3x its normal time); stopped it, the push is refused and the commit is kept; rerun the push${files?`; ${files}`:''}`;
        console.error(`  X ${line}`);stuckReceipt(line,env);
        stop(`STUCK in ${task.name} after ${minutes} min`);
      },ms);watchdog.unref?.();};
      if(limit!==undefined)arm(limit);
      for(const command of task.commands){
        if(refused){code=1;break;}
        const argv=progress===undefined?command:withProgressReporter(command);
        const child=spawn(argv[0],argv.slice(1),{cwd:options.cwd,env:task.env===undefined&&progress===undefined?options.env:env,detached:true,stdio:['ignore','pipe','pipe']});
        active.add(child);child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{output+=data;});
        code=await new Promise(resolveCode=>{
          child.once('error',error=>{output+=`${error}\n`;resolveCode(1);});
          child.once('close',(value,termination)=>resolveCode(value??(termination===null?1:128+(constants.signals[termination]??1))));
        });
        active.delete(child);clearTimeout(child.escalation);
        // Drain grandchildren even if their immediate parent exits first.
        for(const group of child.groups??[child.pid])signal(group,'SIGKILL');
        if(code!==0){own=!refused||stuck;stop(`${task.name} failed`);break;}
      }
      clearTimeout(watchdog);
      const seconds=(Date.now()-at)/1000,stopped=code!==0&&!own;results.push({name:task.name,code,seconds,...(stopped?{stoppedBy:cause}:{}),...(stuck?{stuck:true}:{})});
      if(process.env.GITHUB_ACTIONS)console.log(`::group::${task.name}`);
      if(output.trim())console.log(output.trim());
      console.error(`  - ${task.name} ${code===0?'green':stopped?'stopped':stuck?'STUCK':'RED'} in ${seconds.toFixed(1)} s${stopped?`: ${cause}`:''}`);
      if(progress!==undefined){const files=progressReport(progress);if(files&&!stuck)console.error(`    ${task.name} files: ${files}`);rmSync(progress,{force:true});}
      if(process.env.GITHUB_ACTIONS)console.log('::endgroup::');
    }));
  } finally {clearTimeout(deadline);process.off('SIGINT',interrupted);process.off('SIGTERM',interrupted);}
  return {ok:!refused&&results.every(row=>row.code===0),seconds:(Date.now()-started)/1000,results,timedOut};
}

/** The static half of the gate: no test runs here. @param {number} [lintThreads] */
export function staticChecks(lintThreads=PUSH_BUDGET.lintThreads){
  return [
    {name:'typecheck (kit + layers)',commands:[['pnpm','run','--silent','typecheck:kit'],['pnpm','exec','npr','tsc','-b','tsconfig.layers.json','--builders',String(PUSH_BUDGET.builders)]]},
    {name:'lint (kit + game)',commands:[['pnpm','run','--silent','lint:kit','--threads',String(lintThreads)],['pnpm','run','--silent','lint:game']]},
    {name:'format:check',commands:[['pnpm','run','--silent','format:check']]},
    {name:'check:sides',commands:[['pnpm','run','--silent','check:sides']]},
    {name:'check:asks',commands:[['pnpm','run','--silent','check:asks'],[process.execPath,'src/scripts/.kit/asks.mjs','check','--all']]},
    {name:'check:page-events',commands:[['pnpm','run','--silent','check:page-events']]},
    // DL21: index.html's inlined shell CSS is today's base.css + loading.css. Its test reads the sheets by path, so the
    // related selection never maps a loading.css edit to it (red 44617020403, after 60e6a0696).
    {name:'check:inline-shell-css',commands:[[process.execPath,'src/scripts/inline-shell-css.mjs','--check']]},
    // WIRE-STABILITY WR6: the bound wire's lock is current against v0, under 1 s (release rules come with a newer pin).
    {name:'check:wire',commands:[['pnpm','run','--silent','check:wire']]},
    // WIRE-STABILITY WR7: saves.lock.json, every save key's version, shape and migrations (test/saves-lock.test.ts).
    // One focused Vitest file; its script drops the push cohort's profile.
    {name:'check:saves',commands:[['pnpm','run','--silent','check:saves']]},
    // Meta QA 11-25 row 25: every TypeScript file Node runs strip-only is erasable (no parameter property; fc0832b52's red).
    {name:'check:strip-only',commands:[[process.execPath,'--no-warnings','src/scripts/strip-only.mjs']]},
    // Meta QA 11-25 row 42: every installed org package's engines.node admits each Node engine's range lets CI pick
    // (format 0.79.2's <25 under engine's <27 broke server-release 45703635653 at pnpm install on Node 26).
    {name:'check:node-ranges',commands:[[process.execPath,'src/scripts/node-ranges.mjs']]},
    // SF15 (opus-pine): cook-version.json names the cook inputs being pushed, about 5 s with no golden cook when the
    // hash matches (8f5a53c1d and 4589161e3 moved cookedKtx2Table.ts and imageKtx2Wasm.ts unrecorded: red 45922304788).
    {name:'check:cook-record',commands:[[process.execPath,'src/scripts/cookVersion.ts']]},
  ];
}

async function main(){
  assertHeavyLease('full-test');
  const env=pushEnvironment(),testEnv=gateTestEnvironment(env);
  const began=Date.now();
  // DS9: a plan branch push or a watching driver runs the split gate; hosted CI runs the rest.
  const split=splitRequested(env),profile=split?SPLIT_PROFILE:PUSH_PROFILE;
  /** @type {{mode:'full'|'related'|'docs',files:string[],reason:string,tests?:string[]}} */
  let selection=pushSelection(split?planBaseRefs(env.WS_PUSH_REFS):env.WS_PUSH_REFS,process.cwd(),{releaseDestination:env.WS_PUSH_DESTINATION});
  const context=capturePushTree(profile,env),proof=context===null?null:readPushProof(context,selection);
  /** @type {unknown} */let basis=null;
  if(!split&&context!==null&&process.env.WS_LOCAL_LAND_HEAD===context.commit&&process.env.WS_LOCAL_LAND_DELTA){
    try{basis=JSON.parse(process.env.WS_LOCAL_LAND_DELTA);}catch{ /* Malformed evidence keeps the full gate. */ }
  }
  const planDelta=current=>{
    const planned=localDeltaPlan(current,basis);
    return !planned.eligible&&process.env.WS_LOCAL_LAND_HEAD===current?.commit
      ?discoverLocalDeltaPlan(current,process.env.WS_LOCAL_LAND_BASE_MAIN,process.env.WS_LOCAL_LAND_SOURCE_REF):planned;
  };
  const delta=planDelta(context);
  if(delta.eligible&&delta.selection!==null){
    selection=delta.selection;
    console.error(`  - local disjoint delta: ${delta.reason}; ${selection.files.join(', ')}`);
  }else if(basis!==null)console.error(`  - local delta refused: ${delta.reason}; complete full gate retained`);
  console.error(`  - tests: ${selection.mode}; ${selection.reason}; ${selection.files.length} changed paths${split?'; split gate (DS9): hosted CI runs the full suite, browser and timing files':''}`);
  if(proof!==null){
    console.error(`  - exact-tree green reuse: ${proof.tree}; run ${proof.run}; commit ${proof.commit}; ${proof.mode}; ${proof.seconds.toFixed(1)} s; ${proof.finished}`);
    return;
  }
  // Build-max C5: over a 1-minute load of 24, one gate at a time on this machine; held until this process exits.
  process.once('exit',await gateSlot());
  const record=seconds=>{
    // A full fallback actually reruns every check, so it starts fresh proof
    // lineage even when an older delta basis admitted the attempt.
    const composed=delta.eligible&&selection.mode!=='full';
    const after=capturePushTree(profile,env);
    // A split full-mode gate ran no complete suite, so it proves nothing reusable.
    if(context!==null&&!(split&&selection.mode==='full')){
      const disposition=pushProofDisposition(context,after,{full:!split&&selection.mode==='full',inherited:composed});
      if(disposition==='uncached'){console.error('  - full gate green; installed inputs unavailable for a reusable receipt; no proof saved');return;}
      if(after===null)throw new Error('Missing checked tree');
      const current=composed?planDelta(after):null;
      if(composed&&(!current?.eligible||current.proof?.run!==delta.proof?.run))throw new Error('Prior full proof changed or expired during the delta gate; rerun the full gate');
      // Only authenticated disjoint composition covers the complete new tree.
      const covered=composed?{mode:/** @type {const} */('full'),files:[]}:selection;
      const recorded=writePushProof(context,covered,seconds,composed&&delta.proof!==null?{run:delta.proof.run,commit:delta.proof.commit}:undefined);
      console.error(`  - saved exact-tree proof run ${recorded.run} (${covered.mode})${composed?`; inherited full ${delta.proof?.run} plus incoming delta`:''}`);
    }
  };
  console.error(`  - full push budget ${JSON.stringify({...PUSH_BUDGET,workers:Number(env.WS_GATE_WORKERS)})}; nice ${getPriority()}; load ${loadavg().map(v=>v.toFixed(1)).join('/')}`);
  if(selection.mode==='docs'&&!delta.eligible){
    const result=await parallelChecks([
      {name:'lint (docs-only)',commands:[['pnpm','run','--silent','lint:kit','--threads',String(PUSH_BUDGET.lintThreads)],['pnpm','run','--silent','lint:game']]},
      {name:'format:check (docs-only; history scan already green)',commands:[['pnpm','run','--silent','format:check']]},
      {name:'check:asks (committed docs)',commands:[['pnpm','run','--silent','check:asks'],[process.execPath,'src/scripts/.kit/asks.mjs','check','--all']]},
      // EV9: agent-parity reads AGENTS.md and CLAUDE.md; a test that reads a changed doc runs too.
      {name:'check:parity (docs-only)',commands:[['pnpm','run','--silent','check:parity']]},
      ...(selection.tests?.length?[{name:`vitest (docs readers: ${selection.tests.length})`,commands:[[process.execPath,'src/scripts/vitest-tmp.ts','run','--passWithNoTests',...selection.tests]]}]:[]),
    ],{env:testEnv});
    console.error(`  - docs-only push lane ${result.ok?'green':'RED'} in ${result.seconds.toFixed(1)} s`);if(result.ok)record(result.seconds);process.exitCode=result.ok?0:1;return;
  }
  // Meta QA 11-25 row 53: tsc -b trusts mtimes, and the cloned cache can predate a pushed file (5068a7365's red).
  console.error(`  - ${freshenPush(split?planBaseRefs(env.WS_PUSH_REFS):env.WS_PUSH_REFS,process.cwd())}`);
  const generated=await parallelChecks([{name:'gen:inputs',commands:[['pnpm','run','--silent','gen:inputs']]}],{env:testEnv});
  if(!generated.ok){process.exitCode=1;return;}
  if(selection.mode==='related'){
    const {completePushSelection}=await import('../src/scripts/push-related.mjs');
    selection=await completePushSelection(selection);
    console.error(`  - verified tests: ${selection.mode}; ${selection.reason}`);
  }
  const refs=split?planBaseRefs(env.WS_PUSH_REFS):env.WS_PUSH_REFS;
  const pins=selection.mode==='docs'?{pins:[],ring:[]}:pinChanges(refs,process.cwd());
  /** @type {string[]|null} */let local=null;
  if(split){
    const plan=splitLocalTests(selection);
    // Browser and exclusive timing proofs keep their hosted runners. Pin
    // readers bypass the normal file-cost cutoff: a replay can be slow and
    // still need to catch a stale save or physics digest before the push.
    const pinReaders=shardPinTests(process.cwd(),pins.pins)
      .filter(file=>!BROWSER_TESTS.includes(file)&&!TIMING_TESTS.includes(file));
    local=[...new Set([...plan.local,...pinReaders])];
    if(pinReaders.length>0)console.error(`  - shard pin readers: ${pinReaders.length} Vitest file(s) for ${pins.pins.join(', ')}`);
    const hosted=plan.hosted.filter(row=>!pinReaders.includes(row.file));
    for(const row of hosted)console.error(`  - hosted-only (${row.reason}): ${row.file}`);
    logHostedOnly(hosted,{sha:context?.commit??'unknown',lane:process.env.WS_LANE_NAME});
    console.error(`  - split gate: ${local.length} local Vitest file(s), ${hosted.length} sent to hosted CI`);
  }
  // FS27: declared readers with no import edge, CI static's cheap checks, and the Ring 1 slugs a pin push moves.
  // FP53b's red: sim-state source moves every Ring 1 digest though no pin or digest changed, so it steps them all.
  const simSlugs=selection.mode==='docs'?[]:simRingSlugs(selection.files,JSON.parse(readFileSync('test/pins/ring-digests.json','utf8')),`${process.platform}-${process.arch}`);
  const fs27=fs27Plan(selection,{split,slugs:[...new Set([...pins.ring,...simSlugs])].sort()});
  if(local!==null)local=[...new Set([...local,...fs27.tests])].sort();
  const readers=local===null&&fs27.tests.length>0?[{name:`vitest (FS27 readers: ${fs27.tests.length})`,commands:[[process.execPath,'src/scripts/vitest-tmp.ts','run','--passWithNoTests=false',...fs27.tests]]}]:[];
  if(fs27.tests.length>0||fs27.tasks.length>0)console.error(`  - FS27: ${fs27.tests.length} declared reader file(s); ${fs27.tasks.map(task=>task.name).join(', ')}`);
  // Known reds (src/scripts/push-known-red.mjs): a split gate keeps a JSON report, so a red that origin/main has too never
  // refuses the push. WS_KNOWN_RED=0 refuses on every red again.
  const knownRed=split&&env.WS_KNOWN_RED!=='0'&&(local?.length??0)>0;
  const localReport=gateReport(process.env,process.env.WS_LOCAL_LAND_REPORT_ROOT);
  const report=localReport??(knownRed?resolve('tmp',`push-known-red-${process.pid}.json`):undefined);
  if(report!==undefined&&env.WS_PUSH_TIMINGS===undefined)mkdirSync(dirname(report),{recursive:true});
  const reporters=report===undefined?[]:['--reporter=default','--reporter=json',`--outputFile=${report}`];
  // Meta QA70: the full suite gets half the cores (each file still holds its own machine CPU grant) and a stuck limit
  // scaled from the timings table; the quarter-core cap (33c59458d) put a full run at ~1,670 hosted s on 4 workers.
  const fullWorkers=fullSuiteWorkers(env);
  const fullVitest=selection.mode==='full'?{env:{WS_VITEST_MAX_WORKERS:String(fullWorkers)},stuckSeconds:fullStuckSeconds(readTimings(env)?.full,fullWorkers)}:{};
  if(selection.mode==='full'&&local===null)console.error(`  - full Vitest: ${fullWorkers} workers; stuck limit ${fullVitest.stuckSeconds} s`);
  const vitest=delta.eligible&&selection.mode==='docs'
    ?(selection.tests?.length?[{name:'vitest (incoming docs readers)',commands:[[process.execPath,'src/scripts/vitest-tmp.ts','run','--passWithNoTests=false',...selection.tests,...reporters]]}]:[])
    :local===null
    ?[{name:`vitest (${selection.mode})`,commands:[[process.execPath,'src/scripts/vitest-tmp.ts',...(selection.mode==='related'?['related','--run','--passWithNoTests=false',...selection.files]:['run']),...reporters]],...fullVitest}]
    :local.length===0?[]:[{name:`vitest (split ${selection.mode}: ${local.length} local)`,commands:[[process.execPath,'src/scripts/vitest-tmp.ts','run','--passWithNoTests=false',...local,...reporters]]}];
  // With known reds on, Vitest runs beside the static lane, not inside it: a Vitest red must not stop the static checks,
  // since a known red still lets the push go when everything else is green.
  const [rest,tests]=await Promise.all([
    parallelChecks([...staticChecks(),...fs27.tasks,...readers,...(delta.eligible&&selection.mode==='docs'?[{name:'check:parity (incoming docs)',commands:[['pnpm','run','--silent','check:parity']]}]:[]),{name:'test:kit',commands:[['pnpm','run','--silent','test:kit']]},...(knownRed?[]:vitest)],{env:testEnv}),
    knownRed?parallelChecks(vitest,{env:testEnv}):Promise.resolve({ok:true,seconds:0,results:[],timedOut:false}),
  ]);
  let result={...rest,ok:rest.ok&&tests.ok,results:[...rest.results,...tests.results]},tolerated=false;
  if(knownRed&&rest.ok&&!tests.ok&&report!==undefined){
    const {failingIds,mainReds,newReds}=await import('../src/scripts/push-known-red.mjs');
    const pushed=failingIds(report,process.cwd());
    if(pushed===null||pushed.size===0)console.error('  !! known-red: the Vitest report names no failing test; the red stands');
    else{
      try{
        const {sha,main:known}=await mainReds(process.cwd(),[...pushed.keys()],{env:testEnv});
        const fresh=newReds(pushed,known),old=[...pushed.values()].reduce((sum,ids)=>sum+ids.size,0)-fresh.length;
        if(fresh.length===0){
          console.error(`  - known-red: all ${old} failing test(s) fail on origin/main ${sha.slice(0,10)} too; not this push's red (main's CI and the forward fixer own them):`);
          for(const ids of pushed.values())for(const id of ids)console.error(`     known red: ${id}`);
          result={...result,ok:true};tolerated=true;
        }else{
          console.error(`  X known-red: ${fresh.length} NEW red(s) not on origin/main ${sha.slice(0,10)} (${old} known red(s) ignored):`);
          for(const id of fresh.slice(0,20))console.error(`     NEW red: ${id}`);
        }
      }catch(error){console.error(`  !! known-red: could not read origin/main's reds (${error instanceof Error?error.message:String(error)}); the red stands`);}
    }
  }
  if(report!==undefined&&process.env.WS_LOCAL_LAND_HEAD){
    if(result.ok)console.error(`  - Vitest report retained: ${report}`);
    else printGateReport(report,process.cwd());
  }
  if(report!==undefined&&localReport===undefined)rmSync(report,{force:true});
  const seconds=(Date.now()-began)/1000;
  if(seconds>PUSH_BUDGET.warnSeconds)console.error(`  !! full pre-push ${seconds.toFixed(1)} s exceeds ${PUSH_BUDGET.warnSeconds} s target (warning; all proofs retained)`);
  console.error(`  - ${split?'split ':''}push lane ${result.ok?'green':'RED'} in ${seconds.toFixed(1)} s; load ${loadavg().map(v=>v.toFixed(1)).join('/')}`);
  // A push that passed on known reds proves no green tree.
  if(result.ok&&!tolerated)record(seconds);
  process.exitCode=result.ok?0:1;
}
if(process.argv[1]!==undefined&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
