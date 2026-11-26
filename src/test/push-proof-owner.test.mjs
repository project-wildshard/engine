import {expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the real cache writer, Git and kernel process APIs.
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Runner-managed fixture scratch.
import {resolve} from 'node:path';

test('TS12c preserves the real proof producer and actual scope across cache reuse',()=>{
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
 const report=JSON.parse(execFileSync(process.execPath,['src/scripts/push-proof-owner-proof.mjs',resolve(process.env.VITEST_TMP_ROOT??'tmp/vitest')],{env,encoding:'utf8',timeout:20000}));
 expect(report).toEqual({kernelOwnerBound:true,ownerMismatchRefused:true,leaseBound:true,producerPreservedOnReuse:true,legacyCompatible:true,partialScopePreserved:true,splitProfilePreserved:true,wrongLeaseUnavailable:true,discardedCapturesUnprobed:true,freshWriterProbedOnce:true,initialNullChildPreserved:true});
},20000);
