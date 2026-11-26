import {expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Verify production ancestry policy with an injected kernel and ledger.
import {execFileSync} from 'node:child_process';

test('TS22a only a live same-domain ancestor grant lends its CPU budget',()=>{
 const report=JSON.parse(execFileSync('python3',['-I','src/scripts/cpu-contract-proof.py','ancestor'],{encoding:'utf8',timeout:60000}));
 expect(report.controls).toHaveLength(16);
},65000);
