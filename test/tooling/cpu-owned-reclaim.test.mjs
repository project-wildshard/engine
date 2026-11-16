import {expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Actual provider loss and descendant cleanup cross processes.
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep every private ledger in the current run's scratch root.
import {resolve} from 'node:path';

test('owned CPU reservations survive provider loss until the actual command group drains',()=>{
 const report=JSON.parse(execFileSync('python3',['scripts/cpu-owned-reclaim-proof.py',resolve(process.env.VITEST_TMP_ROOT??'tmp/vitest','cpu-owned-reclaim')],{encoding:'utf8',timeout:25000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}}));
 expect(report.controls).toHaveLength(6);
 expect(report).toMatchObject({allActualCommandGroupsDrained:true,reservationRetainedThroughReclaim:true});
},30000);
