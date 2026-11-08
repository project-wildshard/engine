// A named five-minute wall gate, independent of GitHub's infrastructure timeout.
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {parallelChecks} from '../.githooks/push-checks.mjs';

const limit=Number(process.env.WS_CI_SHARD_BUDGET_MS??300000),began=Number(process.env.WS_CI_SHARD_STARTED_MS??Date.now());
if(!Number.isSafeInteger(limit)||limit<1||limit>300000||!Number.isSafeInteger(began)||began<0||began>Date.now())throw new Error('Invalid fixed CI shard wall budget');
const index=process.env.WS_CI_SHARD??'local',out=resolve(process.env.WS_CI_SHARD_WALL_REPORT??`tmp/engine-ci/shard-${index}-wall.json`);
/** @param {boolean} timedOut @param {string} phase */
function verdict(timedOut,phase){
 const elapsedMs=Date.now()-began,overBudget=timedOut||elapsedMs>=limit;
 mkdirSync(resolve(out,'..'),{recursive:true});
 writeFileSync(out,`${JSON.stringify({sha:process.env.GITHUB_SHA??null,run:process.env.GITHUB_RUN_ID??null,shard:index,phase,limitMs:limit,elapsedMs,overBudget})}\n`);
 if(overBudget)console.error(`::error file=scripts/ci-shard-wall.mjs,title=CI_SHARD_BUDGET_EXCEEDED::Shard ${index} used ${elapsedMs} ms against ${limit} ms from its first job step (${phase}); original five-minute gate failed`);
 return overBudget;
}
const separator=process.argv.indexOf('--'),command=separator===-1?[]:process.argv.slice(separator+1);
if(process.argv.includes('--check'))process.exitCode=verdict(false,'final including artifact upload')?1:0;
else{
 if(command.length===0)throw new Error('Pass the actual shard command after --');
 const remaining=limit-(Date.now()-began);
 if(remaining<=0){verdict(true,'setup exhausted budget');process.exitCode=1;}
 else{
  const result=await parallelChecks([{name:`CI shard ${index}`,commands:[command]}],{env:process.env,timeoutMs:remaining});
  const overBudget=verdict(result.timedOut,'test command and owned descendant drain');
  process.exitCode=overBudget?1:result.ok?0:result.results.find(row=>row.code!==0)?.code??1;
 }
}
