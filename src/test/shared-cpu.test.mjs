import {expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Real shared Vitest files exercise stale-owner teardown and refusal.
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Every fixture stays under the current test run's owned scratch.
import {resolve} from 'node:path';

test('TS22b reused workers replace only their own stale contexts',()=>{
 const report=JSON.parse(execFileSync(process.execPath,['src/scripts/shared-cpu-proof.mjs',resolve(process.env.VITEST_TMP_ROOT??'tmp/vitest','shared-cpu-proof'),'src/scripts/vitest-cpu.ts','ordinary'],{encoding:'utf8',timeout:20000}));
 expect(report).toMatchObject({actualSharedFiles:3,staleOwnedContextsReplaced:true,oneActiveGrantPerFile:true,allGrantsReleased:true});
});
test('TS22b reused workers refuse forged contexts without exposing them',()=>{
 const report=JSON.parse(execFileSync(process.execPath,['src/scripts/shared-cpu-proof.mjs',resolve(process.env.VITEST_TMP_ROOT??'tmp/vitest','shared-cpu-proof'),'src/scripts/vitest-cpu.ts','forged'],{encoding:'utf8',timeout:20000}));
 expect(report).toMatchObject({actualSharedFiles:3,forgedContextsRefused:2,capabilityNeverEchoed:true,allGrantsReleased:true});
});
