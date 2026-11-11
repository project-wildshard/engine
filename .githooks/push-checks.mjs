import {execFileSync,spawn} from 'node:child_process';
import {availableParallelism,constants,getPriority,homedir,loadavg} from 'node:os';
import {resolve,delimiter} from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertHeavyLease} from '../scripts/heavy-lane-lease.mjs';
import {PUSH_BUDGET, PUSH_PROFILE, SPLIT_PROFILE} from '../scripts/push-budget.mjs';
import {logHostedOnly,planBaseRefs,splitLocalTests,splitRequested} from '../scripts/push-local-split.mjs';
import {pushSelection} from '../scripts/push-selection.mjs';
import {capturePushTree,readPushProof,writePushProof} from '../scripts/push-proof-cache.mjs';
import {gateEnvironment} from '../scripts/push-environment.mjs';

/** Identical proof identity before/inside a real lease; no heavy work is done on reuse.
 * @param {NodeJS.ProcessEnv} [environment] */
export function pushEnvironment(environment=process.env){
  const env={...gateEnvironment(environment),PWD:process.cwd(),WS_PUSH_GATE_PROFILE:PUSH_PROFILE,WS_VITEST_MAX_WORKERS:String(PUSH_BUDGET.workers),
    WS_PUSH_LINT_THREADS:String(PUSH_BUDGET.lintThreads),GOMAXPROCS:String(PUSH_BUDGET.lintGo),UV_THREADPOOL_SIZE:'1',WS_CPU_ADMISSION:'1',
    WS_HEAVY_SCHEDULER_ROOT:resolve(environment.WS_HEAVY_SCHEDULER_ROOT??environment.WS_HEAVY_ROOT??resolve(homedir(),'.wildshard-heavy-lanes'))};
  // Git prepends its exec directory when it invokes a hook. Execute both gate
  // entries with that same effective search order; duplicate entries add no tool.
  if(environment.PATH!==undefined){
    const gitPath=execFileSync('git',['--exec-path'],{env:environment,encoding:'utf8'}).trim();
    env.PATH=[...new Set([gitPath,...environment.PATH.split(delimiter)])].join(delimiter);
  }
  // Apple's Git launcher also selects compiler paths before starting a hook.
  // Observe its real child now so the pre-gate and hook execute under the same
  // SDK, rather than omitting compiler inputs from the proof fingerprint.
  if(process.platform==='darwin'){
    const bin=resolve(import.meta.dirname,'bin');
    /** @type {Record<string,unknown>} */
    const sdk=JSON.parse(execFileSync('git',['wildshard-push-env'],{env:{...env,PATH:[bin,environment.PATH??''].join(delimiter)},encoding:'utf8'}));
    for(const key of ['CPATH','LIBRARY_PATH','MANPATH','SDKROOT']){
      const value=sdk[key];
      if(value!==undefined){if(typeof value!=='string')throw new Error('Invalid Git compiler environment');env[key]=value;}
    }
    // xcrun appends the same manual search directory on every nested invocation.
    // Repeating a directory changes no lookup but would change the runtime hash.
    if(env.MANPATH!==undefined)env.MANPATH=[...new Set(env.MANPATH.split(delimiter))].join(delimiter);
  }
  Reflect.deleteProperty(env,'WILDSHARD_RING');Reflect.deleteProperty(env,'WS_TEST_QUARANTINE');return env;
}

/** Run actual process groups, drain each one, and never start a later step after failure.
 * @param {{name:string,commands:string[][]}[]} tasks
 * @param {{cwd?:string,env?:NodeJS.ProcessEnv,graceMs?:number,timeoutMs?:number}} [options] */
export async function parallelChecks(tasks,options={}) {
  if(options.timeoutMs!==undefined&&(!Number.isFinite(options.timeoutMs)||options.timeoutMs<=0))throw new Error('Invalid owned command deadline');
  if(options.env?.WS_CPU_ADMISSION==='1')tasks=tasks.map(task=>({...task,commands:task.commands.map(command=>{
    if(task.name.startsWith('vitest'))return command; // Actual files own their grants.
    const slots=command.includes('--builders')?PUSH_BUDGET.builders:task.name.startsWith('lint')?Math.min(Math.max(2,availableParallelism()-2),Math.max(2,Number(options.env?.WS_PUSH_LINT_THREADS)||0)):1;
    return ['python3',resolve('scripts/cpu-admission.py'),'run','--slots',String(slots),'--',...command];
  })}));
  const active=new Set(),results=[],started=Date.now(),grace=options.graceMs??1500;
  let refused=false;
  const signal=(group,name)=>{if(typeof group!=='number')return;try{process.kill(-group,name);}catch(error){if(error.code!=='ESRCH')throw error;}};
  const groups=child=>{
    if(typeof child.pid!=='number')return [];
    const rows=execFileSync('ps',['-Ao','pid=,ppid=,pgid='],{encoding:'utf8'}).trim().split('\n').map(line=>line.trim().split(/\s+/u).map(Number));
    const descendants=new Set([child.pid]);let changed=true;
    while(changed){changed=false;for(const [pid,parent] of rows)if(descendants.has(parent)&&!descendants.has(pid)){descendants.add(pid);changed=true;}}
    return [...new Set([child.pid,...rows.filter(([pid])=>descendants.has(pid)).map(([, ,group])=>group)])];
  };
  const stop=()=>{
    if(refused)return;refused=true;
    for(const child of active){child.groups=groups(child);for(const group of child.groups)signal(group,'SIGTERM');child.escalation=setTimeout(()=>{for(const group of child.groups)signal(group,'SIGKILL');},grace);}
  };
  const interrupted=()=>stop();process.on('SIGINT',interrupted);process.on('SIGTERM',interrupted);
  let timedOut=false;
  const deadline=options.timeoutMs===undefined?undefined:setTimeout(()=>{timedOut=true;stop();},options.timeoutMs);
  try {
    await Promise.all(tasks.map(async task=>{
      const at=Date.now();let output='',code=0;
      for(const command of task.commands){
        if(refused){code=1;break;}
        const child=spawn(command[0],command.slice(1),{cwd:options.cwd,env:options.env,detached:true,stdio:['ignore','pipe','pipe']});
        active.add(child);child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{output+=data;});
        code=await new Promise(resolveCode=>{
          child.once('error',error=>{output+=`${error}\n`;resolveCode(1);});
          child.once('close',(value,termination)=>resolveCode(value??(termination===null?1:128+(constants.signals[termination]??1))));
        });
        active.delete(child);clearTimeout(child.escalation);
        // Drain grandchildren even if their immediate parent exits first.
        for(const group of child.groups??[child.pid])signal(group,'SIGKILL');
        if(code!==0){stop();break;}
      }
      const seconds=(Date.now()-at)/1000;results.push({name:task.name,code,seconds});
      if(process.env.GITHUB_ACTIONS)console.log(`::group::${task.name}`);
      if(output.trim())console.log(output.trim());
      console.error(`  - ${task.name} ${code===0?'green':'RED'} in ${seconds.toFixed(1)} s`);
      if(process.env.GITHUB_ACTIONS)console.log('::endgroup::');
    }));
  } finally {clearTimeout(deadline);process.off('SIGINT',interrupted);process.off('SIGTERM',interrupted);}
  return {ok:!refused&&results.every(row=>row.code===0),seconds:(Date.now()-started)/1000,results,timedOut};
}

/** The static half of the gate: no test runs here. @param {number} [lintThreads] */
function staticChecks(lintThreads=PUSH_BUDGET.lintThreads){
  return [
    {name:'typecheck (kit + layers)',commands:[['pnpm','run','--silent','typecheck:kit'],['pnpm','exec','npr','tsc','-b','tsconfig.layers.json','--builders',String(PUSH_BUDGET.builders)]]},
    {name:'lint (kit + game)',commands:[['pnpm','run','--silent','lint:kit','--threads',String(lintThreads)],['pnpm','run','--silent','lint:game']]},
    {name:'format:check',commands:[['pnpm','run','--silent','format:check']]},
    {name:'check:sides',commands:[['pnpm','run','--silent','check:sides']]},
    {name:'check:asks',commands:[['pnpm','run','--silent','check:asks'],[process.execPath,'src/scripts/asks.mjs','check','--all']]},
    {name:'check:page-events',commands:[['pnpm','run','--silent','check:page-events']]},
    // WIRE-STABILITY WR6: the bound wire's lock is current against v0, under 1 s (release rules come with a newer pin).
    {name:'check:wire',commands:[['pnpm','run','--silent','check:wire']]},
    // WIRE-STABILITY WR7: saves.lock.json, every save key's version, shape and migrations (test/saves-lock.test.ts).
    // One focused Vitest file; its script drops the push cohort's profile so land's carried push (LS3, no lease) runs it.
    {name:'check:saves',commands:[['pnpm','run','--silent','check:saves']]},
  ];
}

/** Lint workers on land's carried main push: 6 took lint:game from 27 s to 11.5 s on the Mac (2026-11-11). Never
 * more than the CPU broker grants one request (all cores but two, scripts/cpu-admission.py). */
const LAND_LINT_THREADS=Math.max(1,Math.min(6,availableParallelism()-2));

/** LAND-SIMPLIFY LS3 (J258): land's main push after a clean rebase. Lint, TypeScript and the static checks, in
 * parallel under the CPU broker; no Vitest, no heavy lane. Branch CI ran the suite on the same diff.
 * @param {NodeJS.ProcessEnv} env @returns {Promise<number>} the exit code */
export async function landMainChecks(env){
  const began=Date.now();
  // Lint is the long pole (type-aware, 27 s on one thread); with no tests beside it, it gets LAND_LINT_THREADS,
  // and the broker meters that many slots.
  const lint={...env,WS_PUSH_LINT_THREADS:String(LAND_LINT_THREADS),GOMAXPROCS:String(LAND_LINT_THREADS)};
  const generated=await parallelChecks([{name:'gen:inputs',commands:[['pnpm','run','--silent','gen:inputs']]}],{env});
  const result=generated.ok?await parallelChecks(staticChecks(LAND_LINT_THREADS),{env:lint}):generated;
  console.error(`  - land main push (carried, LS3): static lane ${result.ok?'green':'RED'} in ${((Date.now()-began)/1000).toFixed(1)} s; no Vitest (branch CI ran it)`);
  return result.ok?0:1;
}

async function main(){
  assertHeavyLease('full-test');
  const env=pushEnvironment();
  const began=Date.now();
  // DS9: a plan branch push or a watching driver runs the split gate; hosted CI runs the rest.
  const split=splitRequested(env),profile=split?SPLIT_PROFILE:PUSH_PROFILE;
  /** @type {{mode:'full'|'related'|'docs',files:string[],reason:string,tests?:string[]}} */
  let selection=pushSelection(split?planBaseRefs(env.WS_PUSH_REFS):env.WS_PUSH_REFS,process.cwd());
  const context=capturePushTree(profile,env),proof=context===null?null:readPushProof(context,selection);
  console.error(`  - tests: ${selection.mode}; ${selection.reason}; ${selection.files.length} changed paths${split?'; split gate (DS9): hosted CI runs the full suite, browser and timing files':''}`);
  if(proof!==null){
    console.error(`  - exact-tree green reuse: ${proof.tree}; run ${proof.run}; commit ${proof.commit}; ${proof.mode}; ${proof.seconds.toFixed(1)} s; ${proof.finished}`);
    return;
  }
  const record=seconds=>{
    const after=capturePushTree(profile,env);
    // A split full-mode gate ran no complete suite, so it proves nothing reusable.
    if(context!==null&&!(split&&selection.mode==='full')){
      if(after===null||after.tree!==context.tree||after.runtime!==context.runtime)throw new Error('Checked tree or runtime changed during the gate; no publication proof, rerun the exact tree');
      const recorded=writePushProof(context,selection,seconds);console.error(`  - saved exact-tree proof run ${recorded.run} (${selection.mode})`);
    }
  };
  console.error(`  - full push budget ${JSON.stringify(PUSH_BUDGET)}; nice ${getPriority()}; load ${loadavg().map(v=>v.toFixed(1)).join('/')}`);
  if(selection.mode==='docs'){
    const result=await parallelChecks([
      {name:'lint (docs-only)',commands:[['pnpm','run','--silent','lint:kit','--threads',String(PUSH_BUDGET.lintThreads)],['pnpm','run','--silent','lint:game']]},
      {name:'format:check (docs-only; history scan already green)',commands:[['pnpm','run','--silent','format:check']]},
      {name:'check:asks (committed docs)',commands:[['pnpm','run','--silent','check:asks'],[process.execPath,'src/scripts/asks.mjs','check','--all']]},
    ],{env});
    console.error(`  - docs-only push lane ${result.ok?'green':'RED'} in ${result.seconds.toFixed(1)} s`);if(result.ok)record(result.seconds);process.exitCode=result.ok?0:1;return;
  }
  const generated=await parallelChecks([{name:'gen:inputs',commands:[['pnpm','run','--silent','gen:inputs']]}],{env});
  if(!generated.ok){process.exitCode=1;return;}
  if(selection.mode==='related'){
    const {completePushSelection}=await import('../scripts/push-related.mjs');
    selection=await completePushSelection(selection);
    console.error(`  - verified tests: ${selection.mode}; ${selection.reason}`);
  }
  /** @type {string[]|null} */let local=null;
  if(split){
    const plan=splitLocalTests(selection);
    local=plan.local;
    for(const row of plan.hosted)console.error(`  - hosted-only (${row.reason}): ${row.file}`);
    logHostedOnly(plan.hosted,{sha:context?.commit??'unknown',lane:process.env.WS_LANE_NAME});
    console.error(`  - split gate: ${local.length} local Vitest file(s), ${plan.hosted.length} sent to hosted CI`);
  }
  const reporters=env.WS_PUSH_TIMINGS===undefined?[]:['--reporter=default','--reporter=json',`--outputFile=${env.WS_PUSH_TIMINGS}`];
  const vitest=local===null
    ?[{name:`vitest (${selection.mode})`,commands:[[process.execPath,'scripts/vitest-tmp.ts',...(selection.mode==='related'?['related','--run','--passWithNoTests=false',...selection.files]:['run']),...reporters]]}]
    :local.length===0?[]:[{name:`vitest (split ${selection.mode}: ${local.length} local)`,commands:[[process.execPath,'scripts/vitest-tmp.ts','run','--passWithNoTests=false',...local,...reporters]]}];
  const result=await parallelChecks([
    ...staticChecks(),
    {name:'test:kit',commands:[['pnpm','run','--silent','test:kit']]},
    ...vitest,
  ],{env});
  const seconds=(Date.now()-began)/1000;
  if(seconds>PUSH_BUDGET.warnSeconds)console.error(`  !! full pre-push ${seconds.toFixed(1)} s exceeds ${PUSH_BUDGET.warnSeconds} s target (warning; all proofs retained)`);
  console.error(`  - ${split?'split ':''}push lane ${result.ok?'green':'RED'} in ${seconds.toFixed(1)} s; load ${loadavg().map(v=>v.toFixed(1)).join('/')}`);
  if(result.ok)record(seconds);
  process.exitCode=result.ok?0:1;
}
if(process.argv[1]!==undefined&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
