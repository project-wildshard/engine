// J193 outer-edge CLI proof, explicitly invoked by both CI plan jobs.
// Runs actual Vitest file discovery against every generated config phase.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {relative,resolve} from 'node:path';
import * as v from 'valibot';
import {createEnginePlan,discoverEngineTests,readEnginePlan} from './engine-ci-plan.ts';

const ring=process.argv.includes('--ring=1')?'1':'full';
const directory=resolve(process.argv.find(arg=>arg.startsWith('--out='))?.slice(6)??'tmp/engine-ci-proof');mkdirSync(directory,{recursive:true});
const expected=discoverEngineTests(ring),plan=createEnginePlan(ring,expected),file=resolve(directory,'plan.json');
writeFileSync(file,JSON.stringify(plan));readEnginePlan(file,expected);
const observed:string[]=[];
for(const shard of plan.shards)for(const phase of ['native','ordinary'] as const){
 if(shard[phase].length===0)continue;
 const env={...process.env,CI:'true',WS_TEST_QUARANTINE:'blocking',WILDSHARD_RING:ring==='1'?'1':'',WS_CI_PLAN:file,WS_CI_SHARD:String(shard.index),WS_CI_PHASE:phase};
 const text=execFileSync(process.execPath,['scripts/vitest-tmp.ts','list','--filesOnly','--json','--config','scripts/engine-ci.config.ts'],{env,encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024});
 const actual=v.parse(v.array(v.object({file:v.string()})),JSON.parse(text) as unknown).map(row=>relative(process.cwd(),row.file).replaceAll('\\','/')).sort();
 assert.deepEqual(actual,[...shard[phase]].sort());observed.push(...actual);
}
assert.equal(new Set(observed).size,expected.length);assert.deepEqual(observed.sort(),expected);
const first=plan.shards[0];assert.ok(first!==undefined);const member=first.ordinary[0]??first.native[0];assert.ok(member!==undefined);
first.ordinary.push(member);writeFileSync(file,JSON.stringify(plan));assert.throws(()=>readEnginePlan(file,expected),/inventory/iu);
rmSync(directory,{recursive:true,force:true});
console.log(JSON.stringify({ring,files:expected.length,shards:plan.count,actualPhases:true,duplicateRefused:true}));
