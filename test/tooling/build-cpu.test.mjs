import {expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Actual authenticated builds cross heavy and CPU admission.
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Every command and private ledger stays in the current scratch.
import {resolve} from 'node:path';

// The proof takes ~14 s on a hosted runner and passed 25 s on a loaded packed share (main run 45275610381): headroom, not a budget.
test('actual app-build commands preserve admission, ownership and nested ordering',()=>{
 const report=JSON.parse(execFileSync(process.execPath,['scripts/build-cpu-proof.mjs',resolve(process.env.VITEST_TMP_ROOT??'tmp/vitest','build-cpu')],{encoding:'utf8',timeout:55000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}}));
 expect(report.controls).toHaveLength(15);
 expect(report.allChildrenDrained).toBe(true);
},60000);
