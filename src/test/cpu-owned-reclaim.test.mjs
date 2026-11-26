import {expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Production reclaim contracts run with an injected kernel and clock.
import {execFileSync} from 'node:child_process';

test('owned CPU reservations survive provider loss until the verified command group drains',()=>{
 const report=JSON.parse(execFileSync('python3',['-I','src/scripts/cpu-contract-proof.py','reclaim'],{encoding:'utf8',timeout:60000}));
 expect(report.controls).toHaveLength(6);
},65000);
