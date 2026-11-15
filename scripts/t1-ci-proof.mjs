#!/usr/bin/env node
// T1E-2's initial hosted harness report. The full four-shard rollout and its
// three-day gate remain separate; a report failure is visible, not blocking.
import { spawnSync } from 'node:child_process';

const started=performance.now();
const result=spawnSync(process.execPath,['scripts/t1-e2e.mjs'],{
  stdio:'inherit',
  env:{...process.env,WS_LANE_NAME:process.env.WS_LANE_NAME??'template-e2e-ci'},
});
const seconds=((performance.now()-started)/1000).toFixed(1);
const build=process.env.WS_T1_BUILD_DIR===undefined?'build included':'reused build';
if(result.status===0)console.log(`T1 harness report: PASS (${process.platform}, ${seconds}s, ${build})`);
else {
  console.log(`::warning title=T1 harness report::${result.error?.message??`exit ${result.status}, signal ${result.signal??'none'}`} after ${seconds}s; report-only until T1E-2 qualification`);
  console.log('T1 harness report: FAILED (report-only)');
}
