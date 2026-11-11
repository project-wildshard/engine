import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,relative,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as v from 'valibot';
import {packShards} from './test-shard-plan.ts';
import {DEFAULT_SECONDS,readWeights} from './test-timings.mjs';
import {CI_NATIVE_GROUPS} from './vitest-ci-files.ts';

const number=v.pipe(v.number(),v.finite(),v.minValue(0));
const positive=v.pipe(v.number(),v.integer(),v.minValue(1));
const paths=v.array(v.string());
const schema=v.object({version:v.literal(1),sha:v.string(),ring:v.picklist(['full','1']),inventoryHash:v.string(),
  files:paths,unknown:paths,count:positive,setupSeconds:number,factor:number,
  curve:v.array(v.object({count:positive,seconds:number,gain:number})),
  shards:v.array(v.object({index:positive,native:paths,ordinary:paths,expectedSeconds:number})),
  timings:v.optional(v.picklist(['measured','default']))});
export type EnginePlan=v.InferOutput<typeof schema>;
interface PlanEnvironment extends NodeJS.ProcessEnv {WILDSHARD_RING?:string}
/** Linux CI wall per measured file-second and per-shard setup, calibrated on run 42501721151 (full and Ring 1). */
const CALIBRATION=Object.freeze({factor:1.35,setupSeconds:70});
const digest=(files:readonly string[]):string=>createHash('sha256').update(JSON.stringify([...files].sort())).digest('hex');

/** Discover configured paths, without collecting or executing a test. */
export function discoverEngineTests(ring:'full'|'1'):string[]{
  const env:PlanEnvironment={...process.env,CI:'true',WS_TEST_QUARANTINE:'blocking'};
  if(ring==='1')env.WILDSHARD_RING='1';else Reflect.deleteProperty(env,'WILDSHARD_RING');
  const text=execFileSync(process.execPath,['scripts/vitest-tmp.ts','list','--filesOnly','--json'],{env,encoding:'utf8',timeout:30_000,maxBuffer:16*1024*1024});
  const rows=v.parse(v.array(v.object({file:v.string()})),JSON.parse(text) as unknown).map(row=>relative(process.cwd(),row.file).replaceAll('\\','/')).sort();
  if(rows.length===0||new Set(rows).size!==rows.length)throw new Error('Empty or duplicated discovered test inventory');
  return rows;
}

/** Validate actual membership before even one shard can execute. */
export function readEnginePlan(file:string,expected?:readonly string[]):EnginePlan{
  const plan=v.parse(schema,JSON.parse(readFileSync(file,'utf8')) as unknown);
  const flat=plan.shards.flatMap(shard=>[...shard.native,...shard.ordinary]);
  if(plan.shards.length!==plan.count||plan.shards.some((shard,index)=>shard.index!==index+1)
    ||new Set(flat).size!==flat.length||digest(flat)!==digest(plan.files)||digest(plan.files)!==plan.inventoryHash
    ||(expected!==undefined&&digest(expected)!==plan.inventoryHash))throw new Error('Actual shard inventory is incomplete, duplicated or different');
  const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  if(plan.sha!==sha)throw new Error('Shard plan is for another commit');
  return plan;
}

export function createEnginePlan(ring:'full'|'1',files:readonly string[]):EnginePlan{
  // LS2 (J250): the weights are main's last measured run (scripts/test-timings.mjs), not a committed file.
  const baseline=readWeights(ring),measured=Object.keys(baseline).length>0;
  // An unmeasured file must satisfy the existing sixty-second CI file gate.
  // A median made the new real 20/40-second socket proofs nearly free.
  // With no table at all every file is the measured median, and the run takes every shard it may.
  if(!measured)console.log('::warning title=No test timings::No Actions cache or main artifact; planning with default weights and the most shards');
  const active=new Set(files),nativeGroups=Object.entries(CI_NATIVE_GROUPS).map(([name,members])=>({name:`@native:${name}`,files:members.filter(file=>active.has(file))})).filter(group=>group.files.length>0);
  const grouped=new Set<string>(nativeGroups.flatMap(group=>group.files));
  const {factor,setupSeconds}=CALIBRATION;
  // Full CI can use two overflow jobs without increasing its concurrent
  // runner allotment. Ring 1 retains its existing search range.
  // 14 -> 15 (coordinator call, reversible, 2026-11-11, FAST-SLOW-TESTS FS6):
  // since CI packing (7c97b585) shards run one after another inside the five
  // packed jobs, so one more shard only lengthens a job a little. It lets
  // FL11-FL13 leave quarantine: 14 shards floor at 247 s with them, 15 plan
  // at 235.7 s, still under the 240 s per-shard ceiling.
  const maxShards=ring==='full'?15:12;
  /** Shards and their curve, charging every unmeasured file `fallback` seconds. */
  const build=(fallback:number)=>{
    const weights=new Map(files.map(file=>[file,baseline[file]??fallback]));
    const units=files.filter(file=>!grouped.has(file));
    const cost=new Map(units.map(file=>[file,weights.get(file)??fallback]));
    const sum=(members:readonly string[]):number=>members.reduce((total,file)=>total+(weights.get(file)??fallback),0);
    for(const group of nativeGroups){units.push(group.name);cost.set(group.name,2*sum(group.files));}
    const shards=(count:number):EnginePlan['shards']=>packShards(units,cost,count,0).map((members,index)=>{
      const native=members.flatMap(name=>nativeGroups.find(group=>group.name===name)?.files??[]);
      const ordinary=members.filter(name=>!name.startsWith('@native:'));
      const normal=packShards(ordinary,weights,2,0);
      return {index:index+1,native,ordinary,expectedSeconds:setupSeconds+(sum(native)+Math.max(0,...normal.map(sum)))*factor};
    });
    const curve=Array.from({length:maxShards},(_,index)=>({count:index+1,seconds:Math.max(...shards(index+1).map(shard=>shard.expectedSeconds)),gain:0}));
    const first=curve[0]?.seconds??0,best=Math.min(...curve.map(row=>row.seconds));
    for(const row of curve)row.gain=first===best?1:(first-row.seconds)/(first-best);
    // Keep a full minute (20 percent) below the five-minute wall gate, including
    // measured setup/import/admission costs rather than only test-body seconds.
    const eligible=curve.filter(row=>row.gain>=.9&&row.seconds<=240);
    return {shards,curve,eligible};
  };
  // An unmeasured file must satisfy the existing sixty-second CI file gate.
  // A median made the new real 20/40-second socket proofs nearly free.
  // With no table at all every file is the measured median, and the run takes every shard it may.
  const known=Object.values(baseline).sort((a,b)=>a-b),median=known[Math.floor(known.length/2)]??DEFAULT_SECONDS;
  const unknown=files.filter(file=>baseline[file]===undefined);
  let plan=build(measured?60:DEFAULT_SECONDS);
  // A recently measured file split consumed five seconds of predicted reserve.
  // Prefer ten spare seconds when full CI can buy that within its job budget.
  let selected=measured?(ring==='full'?plan.eligible.find(row=>row.seconds<=230):undefined)??plan.eligible[0]:plan.curve.at(-1);
  // LS2 fix (coordinator call within J258): a new or split file has no clock until main's next run measures it. When
  // only those guesses push the floor over budget, plan them at the measured median on every shard, and warn. The
  // failure is judged on the measured files alone, the new ones at zero, so no estimate decides it (J206 review).
  if(selected===undefined&&unknown.length>0&&build(0).eligible.length>0){
    plan=build(median);selected=plan.curve.at(-1);
    console.log(`::warning title=Unmeasured test files::${unknown.length} file(s) have no clock yet (${unknown.slice(0,5).join(', ')}${unknown.length>5?', …':''}); planned at the ${median.toFixed(1)} s median on all ${maxShards} shards. Main's next run measures them.`);
  }
  if(selected===undefined)throw new Error('No shard count meets 90% gain with 20% five-minute headroom; optimize the measured floor');
  const {shards,curve}=plan;
  return {version:1,sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),ring,files:[...files],inventoryHash:digest(files),
    unknown,count:selected.count,setupSeconds,factor,curve,shards:shards(selected.count),timings:measured?'measured':'default'};
}

if(process.argv[1]!==undefined&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const ring=process.argv.includes('--ring=1')?'1':'full',out=process.argv.find(arg=>arg.startsWith('--out='))?.slice(6)??'tmp/engine-ci/plan.json';
  const plan=createEnginePlan(ring,discoverEngineTests(ring));mkdirSync(dirname(out),{recursive:true});writeFileSync(out,`${JSON.stringify(plan,null,2)}\n`);
  readEnginePlan(out,plan.files);
  console.log(JSON.stringify({ring:plan.ring,timings:plan.timings,files:plan.files.length,unmeasured:plan.unknown.length,selected:plan.count,curve:plan.curve}));
  const {GITHUB_OUTPUT:output}=process.env;if(output!==undefined){const {appendFileSync}=await import('node:fs');appendFileSync(output,`matrix=${JSON.stringify({shard:plan.shards.map(shard=>shard.index)})}\n`);}
}
