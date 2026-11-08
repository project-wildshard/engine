import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {readEnginePlan,discoverEngineTests} from './engine-ci-plan.ts';
import * as v from 'valibot';

const plan=readEnginePlan(process.env.WS_CI_PLAN??'tmp/engine-ci/plan.json');
readEnginePlan(process.env.WS_CI_PLAN??'tmp/engine-ci/plan.json',discoverEngineTests(plan.ring));
const index=Number(process.env.WS_CI_SHARD),shard=plan.shards[index-1];
if(shard===undefined)throw new Error('Missing matrix shard');
const started=Date.now();let failed=false;
mkdirSync('tmp/engine-ci',{recursive:true});
for(const phase of /** @type {const} */ (['native','ordinary'])){
  if(shard[phase].length===0)continue;
  const report=resolve(`tmp/engine-ci/shard-${index}-${phase}.json`);
  /** @type {NodeJS.ProcessEnv} */ const env={...process.env,WS_CI_PHASE:phase,WS_CI_TIMINGS:report};
  if(plan.ring==='1')env.WILDSHARD_RING='1';else Reflect.deleteProperty(env,'WILDSHARD_RING');
  const result=spawnSync('python3',['scripts/heavy-lane.py','full-test','--',process.execPath,'scripts/vitest-tmp.ts','run','--config','scripts/engine-ci.config.ts','--reporter=default','--reporter=./scripts/engine-ci-budget.ts'],{env,stdio:'inherit',timeout:300000});
  if(result.error!==undefined||result.status!==0)failed=true;
  const measured=v.parse(v.object({files:v.array(v.object({file:v.string(),durationMs:v.number()}))}),JSON.parse(readFileSync(report,'utf8')));
  if(measured.files.some(file=>file.durationMs>60_000))failed=true;
  const actual=measured.files.map(file=>file.file).sort(),expected=[...shard[phase]].sort();
  if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error('Executed shard membership differs from its exact plan');
}
const seconds=(Date.now()-started)/1000;
if(seconds>300){console.error(`::error::CI shard ${seconds.toFixed(1)} s exceeds 300 s`);failed=true;}
console.log(JSON.stringify({shard:index,files:shard.native.length+shard.ordinary.length,seconds,failed}));process.exitCode=failed?1:0;
