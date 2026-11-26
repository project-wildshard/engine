import {expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Production publication contracts run with an injected kernel and clock.
import {execFileSync} from 'node:child_process';

test('owned CPU commands publish kernel identity before command execution',()=>{
 const report=JSON.parse(execFileSync('python3',['-I','src/scripts/cpu-contract-proof.py','command'],{encoding:'utf8',timeout:60000}));
 expect(report.controls).toHaveLength(9);
},65000);
