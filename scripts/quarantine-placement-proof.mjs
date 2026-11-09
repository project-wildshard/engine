// Actual planned native dispatch, using real Vitest file discovery, outside hooks.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join,relative,resolve as resolvePath} from 'node:path';
import {createEnginePlan} from './engine-ci-plan.ts';

const files=['test/nalati-bot-taming.test.ts','test/nalati-taming-verbs.test.ts','test/nalati-awareness-verbs.test.ts','test/driftwood-long-session.test.ts','test/physics-open-plots-headless.test.ts','test/standalone-grid.test.ts'];
const base=resolvePath(process.argv[2]??'tmp/quarantine-placement-proof');mkdirSync(base,{recursive:true});
const work=mkdtempSync(join(base,'run-')),filename=join(work,'plan.json');
try{
 for(const ring of /** @type {const} */(['full','1'])){
  // Simulate promotion membership, using original files and measured weights.
  // No test executes, no production inventory or budget is relaxed.
  const plan=createEnginePlan(ring,files);writeFileSync(filename,JSON.stringify(plan));
  assert.deepEqual(plan.shards.flatMap(shard=>shard.native).sort(),[...files].sort(),'Every promoted file must dispatch in the native cohort');
  const found=[];
  for(const shard of plan.shards){
   if(shard.native.length===0)continue;
   /** @type {NodeJS.ProcessEnv} */const env={...process.env,CI:'true',WS_TEST_QUARANTINE:'only',WS_CI_PLAN:filename,WS_CI_SHARD:String(shard.index),WS_CI_PHASE:'native'};
   delete env.WS_PUSH_GATE_PROFILE;delete env.WS_CPU_ADMISSION;delete env.WILDSHARD_RING;
   const rows=JSON.parse(execFileSync(process.execPath,['scripts/vitest-tmp.ts','list','--config','scripts/engine-ci.config.ts','--filesOnly','--json'],{env,encoding:'utf8',stdio:'pipe'}));
   for(const row of rows)found.push(relative(process.cwd(),row.file));
  }
  assert.deepEqual(found.sort(),[...files].sort(),'Actual exact native configuration must discover each original file once');
 }
 console.log(JSON.stringify({promotedFiles:6,fullAndRing1:true,actualNativeDiscovery:true,oneWorkerPhase:true}));
}finally{rmSync(work,{recursive:true,force:true});}
