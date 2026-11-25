import {afterAll,expect} from 'vitest';
import {relative} from 'node:path';
import process from 'node:process';
import {holdCpu,parentCpuContext,PARENT_CONTEXT} from './cpu-admission.mjs';
import {assertHeavyLease} from './heavy-lane-lease.mjs';
import {CI_SERIAL_TESTS,CPU_EXCLUSIVE_TESTS} from './vitest-ci-files.ts';
import {PUSH_BUDGET} from './push-budget.mjs';

interface CookEnvironment extends NodeJS.ProcessEnv { WS_CPU_SLOTS?:string }
const {WS_CPU_ADMISSION:enabled}=process.env;
// The limits file drives no real cook. Pin the two real cook callers to their admitted grant.
const COOK_WORKER_TESTS=new Set(['test/cook-worker.test.ts','test/cook-worker-publish.test.ts','test/cook-worker-publish-budget.test.ts','test/cook-worker-publish-full.test.ts']);
if(enabled==='1'||(!process.env.CI&&!process.env.GITHUB_ACTIONS)){
  if(enabled==='1')assertHeavyLease('full-test');
  // Reused workers can return after failed collection or a fixture can
  // restore an old environment snapshot. Drain only this worker's own file
  // grants, then remove only contexts it actually published itself.
  const held=heldGrants(),published=publishedContexts();
  for(const cleanup of held)await cleanup();
  const seen=new Set<string>();
  for(let current=process.env[PARENT_CONTEXT];current!==undefined&&published.has(current)&&!seen.has(current);current=process.env[PARENT_CONTEXT]){
    seen.add(current);
    const previous=published.get(current);
    if(previous===undefined)delete process.env[PARENT_CONTEXT];else process.env[PARENT_CONTEXT]=previous;
  }
  const filename=expect.getState().testPath;
  if(filename===undefined)throw new Error('Missing CPU-admitted test file');
  const file=relative(process.cwd(),filename).replaceAll('\\','/');
  // The explicit no-grant encoder proof still needs the whole machine budget.
  // Production cook jobs now consume the real admitted grant (e1946bc).
  const cook=COOK_WORKER_TESTS.has(file);
  const exclusive=new Set<string>(CPU_EXCLUSIVE_TESTS).has(file);
  const native=new Set<string>(CI_SERIAL_TESTS).has(file);
  // TEMPLATE-E2E T1E-8 (J434) deleted net-strip-browser.test.ts, the one file that held a machine browser slot here.
  const lease=await holdCpu(exclusive?'all':cook?PUSH_BUDGET.cookSlots:native?2:1,{inherit:true});
  const cookEnvironment:CookEnvironment=process.env,previousCookGrant=cookEnvironment.WS_CPU_SLOTS;
  const previousParentGrant=process.env[PARENT_CONTEXT];
  try{
    const inherited='parentContext' in lease?lease.parentContext:undefined;
    const current=inherited??parentCpuContext(lease.proof);
    process.env[PARENT_CONTEXT]=current;
    if(inherited===undefined)published.set(current,previousParentGrant);
  }
  catch(error){await lease.release();throw error;}
  if(cook)cookEnvironment.WS_CPU_SLOTS=String(lease.proof.slots);
  const restoreCookGrant=():void=>{
    if(cook){if(previousCookGrant===undefined)delete cookEnvironment.WS_CPU_SLOTS;else cookEnvironment.WS_CPU_SLOTS=previousCookGrant;}
    if(previousParentGrant===undefined)delete process.env[PARENT_CONTEXT];else process.env[PARENT_CONTEXT]=previousParentGrant;
  };
  void (async()=>{await lease.lost;console.error(`CPU admission lost: ${file}`);process.kill(process.pid,'SIGTERM');})();
  // Setup admission occurs before collection and case clocks; teardown stays
  // inside the grant. Default stacked afterAll runs this after file cleanup.
  // A shared worker (VB14 `isolate: false`) re-runs this setup per file: one exit
  // listener per process releases whatever grant the current file still holds.
  let closing:Promise<void>|undefined;
  const cleanup=():Promise<void>=>{
    closing??=(async()=>{try{await lease.release();}finally{held.delete(cleanup);restoreCookGrant();}})();
    return closing;
  };
  held.add(cleanup);
  afterAll(cleanup);
}
function heldGrants():Set<()=>Promise<void>>{
  const registry=globalThis as typeof globalThis&{__wildshardHeldCpuGrants?:Set<()=>Promise<void>>};
  const existing=registry.__wildshardHeldCpuGrants;
  if(existing!==undefined)return existing;
  const created=new Set<()=>Promise<void>>();
  registry.__wildshardHeldCpuGrants=created;
  process.once('exit',()=>{for(const cleanup of created)void cleanup();});
  return created;
}
function publishedContexts():Map<string,string|undefined>{
  const registry=globalThis as typeof globalThis&{__wildshardCpuPublishedContexts?:Map<string,string|undefined>};
  return (registry.__wildshardCpuPublishedContexts??=new Map<string,string|undefined>());
}
