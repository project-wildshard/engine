// A named five-minute wall gate, independent of GitHub's infrastructure timeout. J295 (EV3c): over the wall is AMBER, an
// AMBER line with the shard still green (its one ::warning:: is ci-pack.mjs --check-walls', after the upload, so a
// shard's amber never takes more than one of a step's few annotations from the test files' own); at `AMBER.redFactor` times it, red, and the shard is stopped
// there. `overBudget` in the report means red, so land's flaky re-run never retries a shard that hung.
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {parallelChecks} from '../.githooks/push-checks.mjs';
import {AMBER,amberLine,judgeWall} from './test-amber.mjs';

const limit=Number(process.env.WS_CI_SHARD_BUDGET_MS??300000),began=Number(process.env.WS_CI_SHARD_STARTED_MS??Date.now());
if(!Number.isSafeInteger(limit)||limit<1||limit>300000||!Number.isSafeInteger(began)||began<0||began>Date.now())throw new Error('Invalid fixed CI shard wall budget');
const index=process.env.WS_CI_SHARD??'local',out=resolve(process.env.WS_CI_SHARD_WALL_REPORT??`tmp/engine-ci/shard-${index}-wall.json`);
/** @param {boolean} timedOut @param {string} phase */
function verdict(timedOut,phase){
 const elapsedMs=Date.now()-began,judged=judgeWall(index,elapsedMs,limit),run=process.env.GITHUB_RUN_ID??null;
 const level=timedOut?'red':judged.level,overBudget=level==='red',row={...judged,level,why:timedOut?`stopped at ${AMBER.redFactor}x its wall`:judged.why};
 mkdirSync(resolve(out,'..'),{recursive:true});
 writeFileSync(out,`${JSON.stringify({sha:process.env.GITHUB_SHA??null,run,shard:index,phase,limitMs:limit,elapsedMs,level,overBudget})}\n`);
 if(level==='amber')console.error(`${amberLine(row,run)}; shard ${index} used ${elapsedMs} ms against ${limit} ms from its charged start (${phase}), green under ${AMBER.redFactor}x`);
 if(overBudget)console.error(`::error file=scripts/ci-shard-wall.mjs,title=CI_SHARD_BUDGET_EXCEEDED::Shard ${index} used ${elapsedMs} ms against ${limit} ms from its charged start (${phase}), red: ${row.why}. ${amberLine(row,run)}`);
 return overBudget;
}
const separator=process.argv.indexOf('--'),command=separator===-1?[]:process.argv.slice(separator+1);
if(process.argv.includes('--check'))process.exitCode=verdict(false,'final including artifact upload')?1:0;
else{
 if(command.length===0)throw new Error('Pass the actual shard command after --');
 // The shard is stopped only where it would be red (J295): an amber shard runs to its end.
 const remaining=limit*AMBER.redFactor-(Date.now()-began);
 if(remaining<=0){verdict(true,'setup exhausted budget');process.exitCode=1;}
 else{
  const result=await parallelChecks([{name:`CI shard ${index}`,commands:[command]}],{env:process.env,timeoutMs:remaining});
  const overBudget=verdict(result.timedOut,'test command and owned descendant drain');
  process.exitCode=overBudget?1:result.ok?0:result.results.find(row=>row.code!==0)?.code??1;
 }
}
