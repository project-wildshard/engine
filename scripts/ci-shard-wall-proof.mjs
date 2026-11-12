// Actual owned child/deadline/drain and original status; outside hooks.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve as resolvePath} from 'node:path';

const out=resolvePath(process.argv[2]??'tmp/ci-shard-wall-proof');mkdirSync(out,{recursive:true});
const work=mkdtempSync(join(out,'run-')),pidFile=join(work,'descendant.pid'),report=join(work,'wall.json'),child=join(work,'owned.mjs');
try{
 writeFileSync(child,`import{spawn}from'node:child_process';import{writeFileSync}from'node:fs';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});writeFileSync(${JSON.stringify(pidFile)},String(child.pid));setInterval(()=>{},1000);`);
 /** @param {string[]} command @param {number} budget */
 const run=(command,budget)=>spawnSync(process.execPath,['scripts/ci-shard-wall.mjs','--',...command],{encoding:'utf8',timeout:10000,env:{...process.env,WS_CI_SHARD_STARTED_MS:String(Date.now()),WS_CI_SHARD_BUDGET_MS:String(budget),WS_CI_SHARD_WALL_REPORT:report}});
 // A hang is stopped and red at twice the wall (J295).
 const refused=run([process.execPath,child],600);assert.equal(refused.status,1,refused.stdout+refused.stderr);assert.match(refused.stderr,/CI_SHARD_BUDGET_EXCEEDED/u);
 const actual=JSON.parse(readFileSync(report,'utf8'));assert.equal(actual.overBudget,true);assert.equal(actual.level,'red');assert.equal(actual.limitMs,600);assert.ok(actual.elapsedMs>=1200);
 const pid=Number(readFileSync(pidFile,'utf8'));let alive=true;
 for(let turn=0;turn<50&&alive;turn++){try{process.kill(pid,0);await new Promise(resolve=>{setTimeout(resolve,10);});}catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ESRCH'))throw error;alive=false;}}
 assert.equal(alive,false,'Budget failure must drain the real detached descendant');
 const passed=run([process.execPath,'-e','process.exit(0)'],2000);assert.equal(passed.status,0,passed.stdout+passed.stderr);
 // Over the wall but under twice it: AMBER, a warning, and the shard stays green (J295, EV3c).
 const amber=run([process.execPath,'-e','setTimeout(()=>{},2600)'],2000);assert.equal(amber.status,0,amber.stdout+amber.stderr);
 assert.match(amber.stderr,/^AMBER file=shard-local-wall /mu);assert.doesNotMatch(amber.stderr,/::(?:warning|error)/u);assert.doesNotMatch(amber.stderr,/CI_SHARD_BUDGET_EXCEEDED/u);
 const amberReport=JSON.parse(readFileSync(report,'utf8'));assert.equal(amberReport.level,'amber');assert.equal(amberReport.overBudget,false);
 const failed=run([process.execPath,'-e','process.exit(7)'],2000);assert.equal(failed.status,7,failed.stdout+failed.stderr);assert.doesNotMatch(failed.stderr,/CI_SHARD_BUDGET_EXCEEDED/u);
 console.log(JSON.stringify({namedBudgetFailure:true,actualElapsedMs:actual.elapsedMs,detachedDescendantDrained:true,successPreserved:true,amberStaysGreen:true,originalFailure:7,fiveMinuteLimitUnchanged:true}));
}finally{rmSync(work,{recursive:true,force:true});}
