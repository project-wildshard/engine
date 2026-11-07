// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the fixed Node worker and its original request clock.
import {resolve as resolvePath} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The source loader is fixed by the native test host.
import {pathToFileURL} from 'node:url';
// oxlint-disable-next-line import/no-nodejs-modules -- Compare the actual host request clock across payload admission.
import {hrtime} from 'node:process';
import {expect, test} from 'vitest';
import {TickWorkerHost} from '../src/server/host/tickWorkerHost';

const workerURL=new URL('fixtures/headless/initialization-worker.mjs',import.meta.url);
const args=['--experimental-transform-types','--import',pathToFileURL(resolvePath('scripts/sim-node-loader.mjs')).href];
const budget={tickMicros:16_666,commandsPerTick:1};

test('deferred admission keeps the same checkpoint and does not reset the original request clock',async()=>{
  let release:(value:unknown)=>void=()=>undefined;
  const deferred=new TickWorkerHost(workerURL,undefined,budget,args,'advisory',()=>new Promise(resolve=>{release=resolve;}));
  const immediate=new TickWorkerHost(workerURL,{snapshot:'all original bytes'},budget,args,'advisory');
  try{
    // The clock remains constructor-owned even while trusted code imports.
    const start:unknown=Reflect.get(deferred,'requestStarted');
    expect(typeof start).toBe('bigint');expect(start).not.toBe(0n);
    if(typeof start!=='bigint')throw new Error('Missing original worker request clock');
    expect(deferred.checkpoint).toBeUndefined();
    release({snapshot:'all original bytes'});
    await Promise.all([deferred.initialized(),immediate.initialized()]);
    expect(deferred.checkpoint).toEqual(immediate.checkpoint);
    expect(Reflect.get(deferred,'requestStarted')).toBe(start);
    expect(hrtime.bigint()).toBeGreaterThan(start);
    expect(await deferred.step()).toEqual(await immediate.step());
  }finally{await deferred.dispose();await immediate.dispose();}
  await expect(deferred.step()).rejects.toThrow();
});

test('admission refusal, disposal before admission and malformed payload never publish a checkpoint',async()=>{
  const refusal=new Error('Parent asset admission refused');
  const rejected=new TickWorkerHost(workerURL,undefined,budget,args,'advisory',()=>Promise.reject(refusal));
  try{await expect(rejected.initialized()).rejects.toBe(refusal);expect(rejected.quarantined).toBe(true);expect(rejected.checkpoint).toBeUndefined();}
  finally{await rejected.dispose();}
  let release:(value:unknown)=>void=()=>undefined;
  const retired=new TickWorkerHost(workerURL,undefined,budget,args,'advisory',()=>new Promise(resolve=>{release=resolve;}));
  const ready=expect(retired.initialized()).rejects.toThrow('disposed');
  await retired.dispose();release({snapshot:'late assets'});await ready;
  expect(retired.checkpoint).toBeUndefined();
  const malformed=new TickWorkerHost(workerURL,undefined,budget,args,'advisory',()=>Promise.resolve({foreign:true}));
  try{await expect(malformed.initialized()).rejects.toThrow('Original payload refused');expect(malformed.checkpoint).toBeUndefined();}
  finally{await malformed.dispose();}
  expect(()=>new TickWorkerHost(workerURL,{},budget,args,'advisory',()=>Promise.resolve({}))).toThrow('one owner');
});

test('a stalled payload admission still expires under the original thirty-second watchdog',async()=>{
  let release:(value:unknown)=>void=()=>undefined;
  const host=new TickWorkerHost(workerURL,undefined,budget,args,'advisory',()=>new Promise(resolve=>{release=resolve;}));
  try{
    // Age the existing clock; do not change the production deadline or wait thirty seconds.
    Reflect.set(host,'requestStarted',hrtime.bigint()-31_000_000_000n);
    await expect(host.initialized()).rejects.toThrow('request deadline exceeded');
    expect(host.quarantined).toBe(true);expect(host.checkpoint).toBeUndefined();
    release({snapshot:'too late'});
  }finally{await host.dispose();}
});
