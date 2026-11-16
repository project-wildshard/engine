import {expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Actual maintained cache/lease/recorder producers, in owned fixtures.
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Managed per-run scratch only.
import {resolve} from 'node:path';

test('TS12e1 joins real owners and refuses stale, partial, foreign or incomplete evidence',()=>{
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
 const report=JSON.parse(execFileSync('python3',['scripts/gate-census-proof.py','--scratch',resolve(process.env.VITEST_TMP_ROOT??'tmp/vitest')],{env,encoding:'utf8',timeout:30000}));
 expect(report).toMatchObject({realProducerJoins:2,metadataRefusals:25,foreignOwnerRefused:true,unsafeAndIncompleteRefused:true,evidenceRetained:true,sampledCounterCensoringSeparate:true});
 expect(report.commandCpuSeconds).toBeGreaterThan(0);
 expect(report.unreapedRoot).toMatchObject({drainedOnlyAfterReap:true,rootCpuMeasured:true,observerNeverSignalledOwner:true});
 expect(report.unreapedRoot.actualZombieSamples).toBeGreaterThanOrEqual(3);
},30000);
