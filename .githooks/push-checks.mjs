import {execFileSync,spawn} from 'node:child_process';
import {constants, getPriority, loadavg} from 'node:os';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertHeavyLease} from '../scripts/heavy-lane-lease.mjs';
import {PUSH_BUDGET, PUSH_PROFILE} from '../scripts/push-budget.mjs';
import {pushSelection} from '../scripts/push-selection.mjs';

/** Run actual process groups, drain each one, and never start a later step after failure.
 * @param {{name:string,commands:string[][]}[]} tasks
 * @param {{cwd?:string,env?:NodeJS.ProcessEnv,graceMs?:number}} [options] */
export async function parallelChecks(tasks,options={}) {
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
  } finally {process.off('SIGINT',interrupted);process.off('SIGTERM',interrupted);}
  return {ok:!refused&&results.every(row=>row.code===0),seconds:(Date.now()-started)/1000,results};
}

async function main(){
  assertHeavyLease('full-test');
  const env={...process.env,WS_PUSH_GATE_PROFILE:PUSH_PROFILE,WS_VITEST_MAX_WORKERS:String(PUSH_BUDGET.workers),
    WS_PUSH_LINT_THREADS:String(PUSH_BUDGET.lintThreads),GOMAXPROCS:String(PUSH_BUDGET.lintGo),UV_THREADPOOL_SIZE:'1'};
  Reflect.deleteProperty(env,'WILDSHARD_RING');
  Reflect.deleteProperty(env,'WS_TEST_QUARANTINE');
  const began=Date.now();
  const selection=pushSelection(env.WS_PUSH_REFS);
  console.error(`  - tests: ${selection.mode}; ${selection.reason}; ${selection.files.length} changed paths`);
  console.error(`  - full push budget ${JSON.stringify(PUSH_BUDGET)}; nice ${getPriority()}; load ${loadavg().map(v=>v.toFixed(1)).join('/')}`);
  if(selection.mode==='docs'){
    const result=await parallelChecks([
      {name:'lint (docs-only)',commands:[['pnpm','run','--silent','lint:kit','--threads',String(PUSH_BUDGET.lintThreads)],['pnpm','run','--silent','lint:game']]},
      {name:'format:check (docs-only; history scan already green)',commands:[['pnpm','run','--silent','format:check']]},
    ],{env});
    console.error(`  - docs-only push lane ${result.ok?'green':'RED'} in ${result.seconds.toFixed(1)} s`);process.exitCode=result.ok?0:1;return;
  }
  const generated=await parallelChecks([{name:'gen:inputs',commands:[['pnpm','run','--silent','gen:inputs']]}],{env});
  if(!generated.ok){process.exitCode=1;return;}
  const result=await parallelChecks([
    {name:'typecheck (kit + layers)',commands:[['pnpm','run','--silent','typecheck:kit'],['pnpm','exec','tsc','-b','tsconfig.layers.json','--builders',String(PUSH_BUDGET.builders)]]},
    {name:'lint (kit + game)',commands:[['pnpm','run','--silent','lint:kit','--threads',String(PUSH_BUDGET.lintThreads)],['pnpm','run','--silent','lint:game']]},
    {name:'format:check',commands:[['pnpm','run','--silent','format:check']]},
    {name:'check:sides',commands:[['pnpm','run','--silent','check:sides']]},
    {name:'check:asks',commands:[['pnpm','run','--silent','check:asks']]},
    {name:'test:kit',commands:[['pnpm','run','--silent','test:kit']]},
    {name:`vitest (${selection.mode})`,commands:[[process.execPath,'scripts/vitest-tmp.ts',...(selection.mode==='related'?['related','--run',...selection.files]:['run']),...(env.WS_PUSH_TIMINGS===undefined?[]:['--reporter=default','--reporter=json',`--outputFile=${env.WS_PUSH_TIMINGS}`])]]},
  ],{env});
  const seconds=(Date.now()-began)/1000;
  if(seconds>PUSH_BUDGET.warnSeconds)console.error(`  !! full pre-push ${seconds.toFixed(1)} s exceeds ${PUSH_BUDGET.warnSeconds} s target (warning; all proofs retained)`);
  console.error(`  - push lane ${result.ok?'green':'RED'} in ${seconds.toFixed(1)} s; load ${loadavg().map(v=>v.toFixed(1)).join('/')}`);
  process.exitCode=result.ok?0:1;
}
if(process.argv[1]!==undefined&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
