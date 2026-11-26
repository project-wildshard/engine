import {expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Production borrowing contracts run with an injected kernel and clock.
import {execFileSync} from 'node:child_process';

test.each([undefined,1,2])('borrowed commands retain their lifetime without a second ancestor budget (limit %s)',limit=>{
 const report=JSON.parse(execFileSync('python3',['-I','src/scripts/cpu-contract-proof.py','borrowed',...(limit===undefined?['3']:[String(limit)])],{encoding:'utf8',timeout:60000}));
 expect(report.controls).toHaveLength(12);
},65000);
