import { beforeAll, expect, test, vi } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { FixedMemory, fixedMemoryCensus, freshScriptMemory, prewarmFixedMemories } from '../src/shared/engine/script/fixedMemory';
import { prepareScriptMemoryLease, ScriptHost } from '../src/shared/engine/script/host';
import { ScriptWorld } from '../src/shared/engine/script/effects';
import { compileScript } from '@wildshard/sharddev/compileScript';

let bytes: Uint8Array = new Uint8Array();
beforeAll(async () => {
  bytes = await compileScript(`let value:i32=0;
    export function abi_version():i32{return 0;}
    export function init(lo:i32,hi:i32):void{value=lo;store<i32>(32768,value);}
    export function in_ptr():i32{return 16384;}export function in_cap():i32{return 4096;}
    export function out_ptr():i32{return 24576;}export function out_cap():i32{return 32;}
    export function out_count():i32{return 0;}
    export function on_tick():void{value++;store<i32>(32768,value);}`, { maximumPages: 2 });
});
function host(): ScriptHost {
  return new ScriptHost({ world: new ScriptWorld({ fields: {}, archetypes: [], events: [], maxEntities: 1 },
    [{ id: 1, name: 'door', position: [0, 0, 0], fields: {}, frozen: false, interactive: true }]), query: () => [] });
}

test('initial install, repeated install and saved restore each consume a distinct virgin growable memory', async () => {
  const scope = new Scope('virgin.restore'), allocated: WebAssembly.Memory[] = [], NativeMemory = WebAssembly.Memory;
  const memory = vi.spyOn(WebAssembly, 'Memory').mockImplementation(class extends NativeMemory {
    constructor(descriptor: WebAssembly.MemoryDescriptor) { super(descriptor); allocated.push(this); }
  });
  let release: (() => void) | undefined;
  try {
    await prewarmFixedMemories([0, 0, 0, 0], () => Promise.resolve(), [{ initial: 1, maximum: 2, count: 3 }]);
    expect(allocated).toHaveLength(3); const before = fixedMemoryCensus();
    release = await prepareScriptMemoryLease([bytes], scope, 'task');
    const first = scope.run(host); scope.run(() => first.install('door', bytes, 13, 17));
    first.beginTick(1); expect(first.call('door', 1, [1]).ok).toBe(true); const saved = first.snapshot('door');
    const second = scope.run(host); scope.run(() => second.install('door', bytes, 99, 101));
    scope.run(() => second.restore('door', saved));
    expect(memory).toHaveBeenCalledTimes(3);
    expect(fixedMemoryCensus()).toMatchObject({ hits: before.hits + 3, misses: before.misses, available: before.available - 3 });
    expect(second.snapshot('door')).toEqual(saved); expect(first.snapshot('door')).toEqual(saved);
    expect(new Set(allocated).size).toBe(3);
    const active = allocated[0], prior = allocated[2];
    if (active === undefined || prior === undefined) throw new Error('Missing isolated memories');
    // The bank lends in reverse order; the last reservation is the first host.
    new Uint8Array(prior.buffer)[65535] = 81;
    expect(new Uint8Array(active.buffer)[65535]).toBe(0);
    expect(second.snapshot('door').memory[65535]).toBe(0);
    second.beginTick(1); expect(second.call('door', 1, [1]).ok).toBe(true);
    expect(second.snapshot('door').memory[32768]).toBe(15);
    expect(first.snapshot('door').memory[32768]).toBe(14);
  } finally { release?.(); scope.dispose(); memory.mockRestore(); }
});

test('virgin growable reservations match both page limits and never accept returned fixed storage', async () => {
  const fixed = new FixedMemory(1, true), retired = fixed.value; fixed.retire();
  await prewarmFixedMemories([0, 0, 0, 0], () => Promise.resolve(), [{ initial: 1, maximum: 64, count: 2 }]);
  const before = fixedMemoryCensus(), different = freshScriptMemory(2, 64);
  expect(different.buffer.byteLength).toBe(2 * 65536);
  expect(fixedMemoryCensus()).toMatchObject({ hits: before.hits, misses: before.misses + 1, available: before.available });
  const first = freshScriptMemory(1, 64), second = freshScriptMemory(1, 64);
  expect(first).not.toBe(second); expect(first).not.toBe(retired); expect(second).not.toBe(retired);
  new Uint8Array(first.buffer).fill(91); expect(first.grow(1)).toBe(1);
  expect(second.buffer.byteLength).toBe(65536); expect(new Uint8Array(second.buffer).every(value => value === 0)).toBe(true);
  expect(second.grow(63)).toBe(1); expect(() => second.grow(1)).toThrow();
});

test('unused prepared growables leave with their owner and are never returned to stock', async () => {
  const scope = new Scope('virgin.abandoned');
  await prewarmFixedMemories([0, 0, 0, 0], () => Promise.resolve(), [{ initial: 1, maximum: 2, count: 1 }]);
  const before = fixedMemoryCensus(), release = await prepareScriptMemoryLease([bytes], scope, 'task');
  scope.dispose(); release();
  expect(fixedMemoryCensus()).toMatchObject({ available: before.available - 1, returned: before.returned });
  freshScriptMemory(1, 2);
  expect(fixedMemoryCensus()).toMatchObject({ hits: before.hits + 1, misses: before.misses + 1 });
});

test('all virgin descriptors and combined bounds refuse before the first allocation', async () => {
  const memory = vi.spyOn(WebAssembly, 'Memory');
  try {
    for (const demand of [
      [{ initial: 1, maximum: 2, count: 1 }, { initial: 1, maximum: 0, count: 1 }],
      [{ initial: 1, maximum: 2, count: 1 }, { initial: 1, maximum: 2, count: 1 }],
      [{ initial: 1, maximum: 64, count: 45 }],
      [{ initial: 4, maximum: 64, count: 40 }],
    ]) await expect(prewarmFixedMemories([1, 0, 0, 0], () => Promise.resolve(), demand)).rejects.toThrow('Invalid virgin');
    const sparse: { initial: number; maximum: number; count: number }[] = []; sparse.length = 1;
    await expect(prewarmFixedMemories([1, 0, 0, 0], () => Promise.resolve(), sparse)).rejects.toThrow();
    expect(memory).not.toHaveBeenCalled();
  } finally { memory.mockRestore(); }
});

test('the full-route reserve fits the approved 45-memory and unchanged 10 MiB bounds', async () => {
  await prewarmFixedMemories([35, 0, 1, 0], () => Promise.resolve(), [
    { initial: 1, maximum: 2, count: 5 }, { initial: 1, maximum: 64, count: 4 },
  ]);
  expect(fixedMemoryCensus()).toMatchObject({ available: 45, bytes: 47 * 65536 });
  const before = fixedMemoryCensus(), memory = vi.spyOn(WebAssembly, 'Memory');
  try {
    for (let i = 0; i < 5; i++) freshScriptMemory(1, 2);
    for (let i = 0; i < 4; i++) freshScriptMemory(1, 64);
    expect(memory).not.toHaveBeenCalled();
    expect(fixedMemoryCensus()).toMatchObject({ hits: before.hits + 9, virginHits: before.virginHits + 9, misses: before.misses, available: 36 });
  } finally { memory.mockRestore(); }
});
