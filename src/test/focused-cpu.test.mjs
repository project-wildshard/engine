import {expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Real Vitest child processes drive the admission boundary.
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep every fixture inside the run's scratch root.
import {resolve} from 'node:path';

test('TS22b focused work waits, nested workers borrow and private roots stay distinct',()=>{
 const report=JSON.parse(execFileSync(process.execPath,['src/scripts/focused-cpu-proof.mjs',resolve(process.env.VITEST_TMP_ROOT??'tmp/vitest','focused-cpu-proof'),'admission'],{encoding:'utf8',timeout:25000}));
 expect(report).toMatchObject({group:'admission',ordinaryFocusedWaits:true,resumesAfterRelease:true,realNestedVitestBorrows:true,noSecondGrant:true,privateBrokerRootStaysDistinct:true,allGrantsReleased:true,actors:3});
});

test('TS22b admitted command children avoid exclusive deadlock and stop on grant loss',()=>{
 const report=JSON.parse(execFileSync(process.execPath,['src/scripts/focused-cpu-proof.mjs',resolve(process.env.VITEST_TMP_ROOT??'tmp/vitest','focused-cpu-proof'),'command'],{encoding:'utf8',timeout:25000}));
 expect(report).toMatchObject({group:'command',noSecondGrant:true,admittedCommandAvoidsExclusiveDeadlock:true,lostParentStopsWork:true,allGrantsReleased:true,actors:2});
});
