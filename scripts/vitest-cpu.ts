import {afterAll,expect} from 'vitest';
import {relative} from 'node:path';
import {holdCpu} from './cpu-admission.mjs';
import {assertHeavyLease} from './heavy-lane-lease.mjs';
import {CI_SERIAL_TESTS} from './vitest-ci-files.ts';

const {WS_CPU_ADMISSION:enabled}=process.env;
if(enabled==='1'){
  assertHeavyLease('full-test');
  const filename=expect.getState().testPath;
  if(filename===undefined)throw new Error('Missing CPU-admitted test file');
  const file=relative(process.cwd(),filename).replaceAll('\\','/');
  // Performance and uncapped encoder proofs reserve the complete managed budget.
  // No environment variable is claimed to cap their native inner workers.
  const exclusive=file==='test/net-bots.test.ts'||file==='test/cook-worker.test.ts';
  const native=new Set<string>(CI_SERIAL_TESTS).has(file);
  const lease=await holdCpu(exclusive?'all':native?2:1);
  void (async()=>{await lease.lost;console.error(`CPU admission lost: ${file}`);process.kill(process.pid,'SIGTERM');})();
  // Setup admission occurs before collection and case clocks; teardown stays
  // inside the grant. Default stacked afterAll runs this after file cleanup.
  afterAll(async()=>{await lease.release();});
  process.once('exit',()=>{void lease.release();});
}
