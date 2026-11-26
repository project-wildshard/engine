import {expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Real owned processes, CPU counters and private lease fixtures.
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- All fixtures use the managed per-run scratch root.
import {resolve} from 'node:path';

test('TS12d command CPU excludes bookkeeping and retains the existing lifecycle',()=>{
 const report=JSON.parse(execFileSync('python3',['src/scripts/heavy-lane-command-proof.py','--wrapper',resolve('src/scripts/heavy-lane.py'),'--scratch',resolve(process.env.VITEST_TMP_ROOT??'tmp/vitest')],{encoding:'utf8',timeout:30000}));
 expect(report.cases.map(row=>[row.mode,row.exitCode])).toEqual([['busy',0],['sleep',0],['nonzero',7],['timeout',124],['refused',124],['launch-failed',1],['no-counters',0]]);
 expect(report).toMatchObject({bookkeepingExcluded:true,independentClocksAgree:true,oldLeaseTotalsRetained:true,lifecyclePreserved:true});
},30000);
