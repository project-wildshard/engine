import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,relative,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as v from 'valibot';
import {packShards} from './test-shard-plan.ts';
import {CI_NATIVE_GROUPS} from './vitest-ci-files.ts';

const number=v.pipe(v.number(),v.finite(),v.minValue(0));
const positive=v.pipe(v.number(),v.integer(),v.minValue(1));
const paths=v.array(v.string());
const schema=v.object({version:v.literal(1),sha:v.string(),ring:v.picklist(['full','1']),inventoryHash:v.string(),
  files:paths,unknown:paths,count:positive,setupSeconds:number,factor:number,
  curve:v.array(v.object({count:positive,seconds:number,gain:number})),
  shards:v.array(v.object({index:positive,native:paths,ordinary:paths,expectedSeconds:number}))});
export type EnginePlan=v.InferOutput<typeof schema>;
interface PlanEnvironment extends NodeJS.ProcessEnv {WILDSHARD_RING?:string}
const weightsSchema=v.record(v.string(),number);
const timingSource=v.object({run:v.string(),wallSeconds:number,fileSeconds:number,calibration:v.optional(v.object({factor:number,setupSeconds:number}))});
const metadata=v.object({full:timingSource,ring1:timingSource});
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
  const baseline=v.parse(weightsSchema,JSON.parse(readFileSync(ring==='1'?'test/durations-ring1.json':'test/durations.json','utf8')) as unknown);
  const source=v.parse(metadata,JSON.parse(readFileSync('test/durations-source.json','utf8')) as unknown)[ring==='1'?'ring1':'full'];
  // An unmeasured file must satisfy the existing sixty-second CI file gate.
  // A median made the new real 20/40-second socket proofs nearly free.
  const fallback=60;
  const weights=new Map(files.map(file=>[file,baseline[file]??fallback]));
  const active=new Set(files),nativeGroups=Object.entries(CI_NATIVE_GROUPS).map(([name,members])=>({name:`@native:${name}`,files:members.filter(file=>active.has(file))})).filter(group=>group.files.length>0);
  const grouped=new Set<string>(nativeGroups.flatMap(group=>group.files));
  const units=files.filter(file=>!grouped.has(file));
  const cost=new Map(units.map(file=>[file,weights.get(file)??fallback]));
  const sum=(members:readonly string[]):number=>members.reduce((total,file)=>total+(weights.get(file)??fallback),0);
  for(const group of nativeGroups){units.push(group.name);cost.set(group.name,2*sum(group.files));}
  const factor=source.calibration?.factor??2*source.wallSeconds/source.fileSeconds,setupSeconds=source.calibration?.setupSeconds??40;
  const shards=(count:number):EnginePlan['shards']=>packShards(units,cost,count,0).map((members,index)=>{
    const native=members.flatMap(name=>nativeGroups.find(group=>group.name===name)?.files??[]);
    const ordinary=members.filter(name=>!name.startsWith('@native:'));
    const normal=packShards(ordinary,weights,2,0);
    return {index:index+1,native,ordinary,expectedSeconds:setupSeconds+(sum(native)+Math.max(0,...normal.map(sum)))*factor};
  });
  const curve=Array.from({length:12},(_,index)=>({count:index+1,seconds:Math.max(...shards(index+1).map(shard=>shard.expectedSeconds)),gain:0}));
  const first=curve[0]?.seconds??0,best=Math.min(...curve.map(row=>row.seconds));
  for(const row of curve)row.gain=first===best?1:(first-row.seconds)/(first-best);
  // Keep a full minute (20 percent) below the five-minute wall gate, including
  // measured setup/import/admission costs rather than only test-body seconds.
  const selected=curve.find(row=>row.gain>=.9&&row.seconds<=240);
  if(selected===undefined)throw new Error('No shard count meets 90% gain with 20% five-minute headroom; optimize the measured floor');
  return {version:1,sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),ring,files:[...files],inventoryHash:digest(files),
    unknown:files.filter(file=>baseline[file]===undefined),count:selected.count,setupSeconds,factor,curve,shards:shards(selected.count)};
}

if(process.argv[1]!==undefined&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const ring=process.argv.includes('--ring=1')?'1':'full',out=process.argv.find(arg=>arg.startsWith('--out='))?.slice(6)??'tmp/engine-ci/plan.json';
  const plan=createEnginePlan(ring,discoverEngineTests(ring));mkdirSync(dirname(out),{recursive:true});writeFileSync(out,`${JSON.stringify(plan,null,2)}\n`);
  readEnginePlan(out,plan.files);
  console.log(JSON.stringify({ring:plan.ring,files:plan.files.length,unmeasured:plan.unknown.length,selected:plan.count,curve:plan.curve}));
  const {GITHUB_OUTPUT:output}=process.env;if(output!==undefined){const {appendFileSync}=await import('node:fs');appendFileSync(output,`matrix=${JSON.stringify({shard:plan.shards.map(shard=>shard.index)})}\n`);}
}
