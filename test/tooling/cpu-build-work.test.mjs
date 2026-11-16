import {expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Real service groups and killed admission providers cross processes.
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Every service and ledger belongs to this run's scratch.
import {resolve} from 'node:path';

test('service CPU work releases only on completion or actual group drain',()=>{
 const report=JSON.parse(execFileSync('python3',['scripts/cpu-build-work-proof.py',resolve(process.env.VITEST_TMP_ROOT??'tmp/vitest','cpu-build-work'),process.execPath],{encoding:'utf8',timeout:20000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}}));
 expect(report.controls).toHaveLength(3);
 expect(report.actualServicesAndHelpersDrained).toBe(true);
},25000);
