import {expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise real direct and broker grants with independent children.
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- All proof outputs stay under the test run's scratch root.
import {resolve} from 'node:path';

test('TS22a both real providers lend only live ancestor budgets without adding a grant',()=>{
 const report=JSON.parse(execFileSync(process.execPath,['scripts/cpu-ancestor-proof.mjs',resolve(process.env.VITEST_TMP_ROOT??'tmp/vitest','cpu-ancestor-proof')],{encoding:'utf8',timeout:20000}));
 expect(report).toMatchObject({controls:36,realAncestorBudgetBorrowed:true,noSecondBudget:true,independentWorkStillBlocked:true,expiredForeignAndForgedRefused:true,privateRootDistinct:true,providerLossRefused:true,actualNonAncestorRefused:true,unsafeStateRefused:true,contextNeverEchoed:true,allChildrenReaped:true});
});
