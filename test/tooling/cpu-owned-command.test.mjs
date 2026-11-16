import {expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Real command publication crosses the process boundary.
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep all fixture output in this run's owned scratch.
import {resolve} from 'node:path';

test('owned CPU commands publish kernel identity before actual execution',()=>{
 const report=JSON.parse(execFileSync('python3',['scripts/cpu-owned-command-proof.py',resolve(process.env.VITEST_TMP_ROOT??'tmp/vitest','cpu-owned-command'),process.execPath],{encoding:'utf8',timeout:20000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}}));
 expect(report.controls).toHaveLength(9);
 expect(report.allChildrenDrained).toBe(true);
});
