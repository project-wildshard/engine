import {expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Real ancestor providers and resistant descendants cross processes.
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Every ledger stays under the current test run's scratch root.
import {resolve} from 'node:path';

test('borrowed commands retain their lifetime without a second ancestor budget',()=>{
 const report=JSON.parse(execFileSync('python3',['scripts/cpu-borrowed-command-proof.py',resolve(process.env.VITEST_TMP_ROOT??'tmp/vitest','cpu-borrowed-command')],{encoding:'utf8',timeout:20000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}}));
 expect(report.controls).toHaveLength(12);
 expect(report).toMatchObject({bothActualProviders:true,noSecondCpuBudget:true,allChildrenDrained:true});
},25000);
