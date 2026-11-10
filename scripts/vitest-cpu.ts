import {afterAll,expect} from 'vitest';
import {relative} from 'node:path';
import {holdCpu} from './cpu-admission.mjs';
import {assertHeavyLease} from './heavy-lane-lease.mjs';
import {CI_SERIAL_TESTS,CPU_EXCLUSIVE_TESTS} from './vitest-ci-files.ts';
import {PUSH_BUDGET} from './push-budget.mjs';

interface CookEnvironment extends NodeJS.ProcessEnv { WS_CPU_SLOTS?:string }
const {WS_CPU_ADMISSION:enabled}=process.env;
// The cook worker's cases, split over three files, each still run their jobs under the admitted grant.
const COOK_WORKER_TESTS=new Set(['test/cook-worker.test.ts','test/cook-worker-publish.test.ts','test/cook-worker-limits.test.ts']);
if(enabled==='1'){
  assertHeavyLease('full-test');
  const filename=expect.getState().testPath;
  if(filename===undefined)throw new Error('Missing CPU-admitted test file');
  const file=relative(process.cwd(),filename).replaceAll('\\','/');
  // The explicit no-grant encoder proof still needs the whole machine budget.
  // Production cook jobs now consume the real admitted grant (e1946bc).
  const cook=COOK_WORKER_TESTS.has(file);
  const exclusive=new Set<string>(CPU_EXCLUSIVE_TESTS).has(file);
  const native=new Set<string>(CI_SERIAL_TESTS).has(file);
  const lease=await holdCpu(exclusive?'all':cook?PUSH_BUDGET.cookSlots:native?2:1);
  const cookEnvironment:CookEnvironment=process.env,previousCookGrant=cookEnvironment.WS_CPU_SLOTS;
  if(cook)cookEnvironment.WS_CPU_SLOTS=String(lease.proof.slots);
  const restoreCookGrant=():void=>{
    if(cook){if(previousCookGrant===undefined)delete cookEnvironment.WS_CPU_SLOTS;else cookEnvironment.WS_CPU_SLOTS=previousCookGrant;}
  };
  void (async()=>{await lease.lost;console.error(`CPU admission lost: ${file}`);process.kill(process.pid,'SIGTERM');})();
  // Setup admission occurs before collection and case clocks; teardown stays
  // inside the grant. Default stacked afterAll runs this after file cleanup.
  afterAll(async()=>{try{await lease.release();}finally{restoreCookGrant();}});
  process.once('exit',()=>{restoreCookGrant();void lease.release();});
}
