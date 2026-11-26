import {expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Real owned broker and socket lifetimes.
import {availableParallelism} from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- Real owned broker and socket lifetimes.
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- All evidence stays inside the test scratch root.
import {resolve} from 'node:path';

test.skipIf(availableParallelism()<14)('J402 and DS20c: browsers share the CPU budget, one per four free cores, and the next waits',()=>{
 const result=JSON.parse(execFileSync(process.execPath,['src/scripts/browser-slots-proof.mjs',resolve(process.env.VITEST_TMP_ROOT??'tmp/vitest','browser-slots')],{encoding:'utf8',timeout:20000}));
 expect(result.skipped).toBeUndefined();
 expect(result).toEqual({freeCoreSlots:true,thirdWaits:true,ordinaryWorkContinues:true,weightedCpu:10,releaseAdmitsNext:true,cancellation:true,exclusiveParentLent:true,ancestorBrowserReleased:true,crashedOwnerReclaimed:true});
});
