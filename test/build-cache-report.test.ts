// oxlint-disable-next-line import/no-nodejs-modules -- Fixtures own isolated cache and source directories.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- No shared author cache is mutated by a counter control.
import { resolve } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { createBuildCacheCounters, observeBuildCache, buildCacheReportReader, formatBuildCacheReport, BUILD_CACHE_REPORT_PREFIX } from '../scripts/build-cache-report.mjs';
import { reportBuildCache } from '../src/sharddev/buildCacheMetrics';
import { encodeZstdBytesMemo } from '../src/sharddev/bake/zstdBytesMemo';
import { memoAssemblyScript } from '../src/sharddev/bake/assemblyscriptMemo';
import { createProjectGeneration } from '../src/sharddev/projectGeneration';
import * as compiler from '../src/sharddev/projectCompilerIdentity';

const owned:string[]=[];
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();for(const root of owned.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){mkdirSync('tmp',{recursive:true});const root=mkdtempSync(resolve('tmp/build-cache-report-'));owned.push(root);return root;}

test('actual cold, disk and in-process generation paths count only validated payloads and successful populations',async()=>{
  const root=fixture(),project=resolve(root,'pine-hollow'),cache=resolve(root,'cache');mkdirSync(project);
  const counters=createBuildCacheCounters(),stop=observeBuildCache(counters),step={id:`pine-map-${'a'.repeat(64)}`};
  const body=new Uint8Array([1,2,3]),generate=vi.fn(()=>new Map([['body',body]]));
  try{
    const first=createProjectGeneration(project,'a'.repeat(64),new Map(),cache);
    const [cold,shared]=await Promise.all([first.cached(step,generate),first.cached(step,generate)]);
    const disk=await createProjectGeneration(project,'a'.repeat(64),new Map(),cache).cached(step,generate);
    expect(cold).toEqual(shared);expect(disk).toEqual(cold);expect(generate).toHaveBeenCalledTimes(1);
    const row=counters.snapshot(true).caches.find(value=>value.cache==='pine-map');
    expect(row).toMatchObject({lookups:3,hits:2,diskHits:1,memoryHits:1,misses:1,populations:1,bytesComputed:3,bytesReused:6,bytesStored:3});
    const index=resolve(cache,'pine-hollow',step.id,readdirSync(resolve(cache,'pine-hollow',step.id))[0]??'missing','index.json');
    writeFileSync(index,'broken');
    await expect(createProjectGeneration(project,'a'.repeat(64),new Map(),cache).cached(step,generate)).rejects.toThrow();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(counters.snapshot(false).caches.find(value=>value.cache==='pine-map')).toMatchObject({lookups:4,hits:2,misses:1,populations:1});
  }finally{stop();}
});

test('real AS and Zstd caches retain exact bytes across hit, corruption repair and failed storage',async()=>{
  const root=fixture();vi.stubEnv('WILDSHARD_ZSTD_BYTES_CACHE',resolve(root,'zstd'));vi.stubEnv('WILDSHARD_AS_RAW_CACHE',resolve(root,'as'));
  vi.spyOn(compiler,'rawAssemblyScriptCompilerIdentity').mockResolvedValue('a'.repeat(64));
  const counters=createBuildCacheCounters(),stop=observeBuildCache(counters);
  try{
    const input=new Uint8Array([1,2,3]),cold=encodeZstdBytesMemo(input),warm=encodeZstdBytesMemo(input);
    expect(warm).toEqual(cold);expect(warm).not.toBe(cold);
    const sources=new Map([['main.ts','export function value():i32{return 1;}']]),wasm=new Uint8Array([0,97,115,109,1,0,0,0]);
    const generate=vi.fn(()=>Promise.resolve(wasm));
    expect(await memoAssemblyScript([],sources,generate)).toEqual(wasm);expect(await memoAssemblyScript([],sources,generate)).toEqual(wasm);
    const body=readdirSync(resolve(root,'as')).find(name=>name.endsWith('.wasm'));if(body===undefined)throw new Error('Missing original AS memo');
    writeFileSync(resolve(root,'as',body),'broken');expect(await memoAssemblyScript([],sources,generate)).toEqual(wasm);expect(generate).toHaveBeenCalledTimes(2);
    const blocked=resolve(root,'not-a-directory');writeFileSync(blocked,'owned');vi.stubEnv('WILDSHARD_AS_RAW_CACHE',blocked);
    expect(await memoAssemblyScript([],sources,generate)).toEqual(wasm);
    expect(counters.snapshot(true).caches.find(row=>row.cache==='assemblyscript-raw')).toMatchObject({lookups:4,hits:1,misses:3,populations:2,writeFailures:1,bytesReused:8,bytesComputed:24,bytesStored:16});
    expect(counters.snapshot(true).caches.find(row=>row.cache==='zstd-bytes')).toMatchObject({lookups:2,hits:1,misses:1,populations:1,bytesReused:cold.length,bytesComputed:cold.length,bytesStored:cold.length});
    const failure=new Error('original compiler failure');await expect(memoAssemblyScript([],sources,()=>Promise.reject(failure))).rejects.toBe(failure);
    expect(counters.snapshot(false).complete).toBe(false);
    expect(counters.snapshot(false).caches.find(row=>row.cache==='assemblyscript-raw')).toMatchObject({misses:4,bytesComputed:24,populations:2});
  }finally{stop();}
});

test('reports label non-invocation, distinguish cast/map paths and do not leak between phases',()=>{
  const first=createBuildCacheCounters(),stop=observeBuildCache(first);
  try{for(const step of ['casts','world-map',`world-map-${'b'.repeat(64)}`]){
    reportBuildCache({cache:'generation-step',project:'nine-dragon-stack',step,event:'lookup',bytes:0});
    reportBuildCache({cache:'generation-step',project:'nine-dragon-stack',step,event:'miss',bytes:0});
  }}finally{stop();}
  const report=first.snapshot(true);expect(report.caches.find(row=>row.cache==='nine-casts')?.misses).toBe(1);expect(report.caches.find(row=>row.cache==='nine-map')?.misses).toBe(2);
  const next=createBuildCacheCounters();next.product(false);expect(next.snapshot(true).products).toEqual({built:0,reused:1,failed:0});
  expect(next.snapshot(true).zeroLookups).toBe('not-invoked');expect(next.snapshot(true).caches.every(row=>row.lookups===0&&row.hits===0&&row.misses===0)).toBe(true);
  expect(next.snapshot(true).units).toBe('payload-bytes');
});

test('chunked child reports aggregate once while all ordinary stderr remains exact',()=>{
  const child=createBuildCacheCounters();child.record({version:1,cache:'zstd-bytes',event:'lookup',bytes:0});child.record({version:1,cache:'zstd-bytes',event:'disk-hit',bytes:13});
  const line=`${formatBuildCacheReport(child.snapshot(true))}\n`,parent=createBuildCacheCounters();let stderr='';
  const reader=buildCacheReportReader(report=>{parent.merge(report);},text=>{stderr+=text;});
  const data=`before\n${line}after without newline`;for(let at=0;at<data.length;at+=7)reader.write(data.slice(at,at+7));reader.end();
  expect(stderr).toBe('before\nafter without newline');expect(parent.snapshot(true).caches.find(row=>row.cache==='zstd-bytes')).toMatchObject({hits:1,bytesReused:13});
  const bad=createBuildCacheCounters();let original='';const refusal=buildCacheReportReader(report=>{bad.merge(report);},text=>{original+=text;});
  const malformed=`${BUILD_CACHE_REPORT_PREFIX}{"version":1}\n`;refusal.write(malformed);refusal.end();expect(original).toBe(malformed);expect(bad.snapshot(true).complete).toBe(false);
  expect(bad.snapshot(true).invalidReports).toBe(1);
});


test('missing or duplicate author reports and partial product failures stay explicitly incomplete',()=>{
  const valid=`${formatBuildCacheReport(createBuildCacheCounters().snapshot(true))}\n`;
  for(const input of ['',valid+valid]){
    const parent=createBuildCacheCounters();let forwarded='';
    const reader=buildCacheReportReader(report=>{parent.merge(report);},text=>{forwarded+=text;},true);
    reader.write(input);reader.end();
    expect(parent.snapshot(true).complete).toBe(false);expect(parent.snapshot(true).invalidReports).toBe(1);
    expect(forwarded).toBe(input===''?'':valid);
  }
  const partial=createBuildCacheCounters();partial.product(true);partial.failure();
  expect(partial.snapshot(true).products).toEqual({built:1,reused:0,failed:1});
  expect(partial.snapshot(true).complete).toBe(false);
});


test('cast slot identities share only the exact reviewed cast report family',()=>{
  const counters=createBuildCacheCounters(),stop=observeBuildCache(counters);
  try{for(const [project,step]of [
    ['nine-dragon-stack','casts'],['nine-dragon-stack',`casts-slots-${'c'.repeat(64)}`],
    ['nine-dragon-stack',`casts-slots-${'c'.repeat(63)}`],['nine-dragon-stack',`casts-slots-${'g'.repeat(64)}`],
    ['pine-hollow',`casts-slots-${'c'.repeat(64)}`],
  ] as const)reportBuildCache({cache:'generation-step',project,step,event:'lookup',bytes:0});
  }finally{stop();}
  const report=counters.snapshot(true);
  expect(report.caches.find(row=>row.cache==='nine-casts')?.lookups).toBe(2);
  expect(report.caches.find(row=>row.cache==='other-generation')?.lookups).toBe(3);
  expect(report.invalidReports).toBe(0);
});
