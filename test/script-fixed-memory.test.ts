import { expect, test, vi } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { FixedMemory, fixedMemoryCensus, prewarmFixedMemories, freshScriptMemory } from '../src/shared/engine/script/fixedMemory';
import { ScriptModuleV2, prepareScriptMemory } from '../src/shared/engine/script/moduleV2';
import { titanModuleBytes, titanPrograms } from './fixtures/titanInlineWitness';
import { ReturnProgram } from '../src/shared/game/population/returnProgram';

const options = { seed: [0, 0] as const, initFuel: 400000, output: [] };
test('boot reserves the entire observed 33-instance fixed demand without depending on any retirement', async () => {
  const incoming = fixedMemoryCensus(), memory = vi.spyOn(WebAssembly, 'Memory'), turn = vi.fn(() => Promise.resolve());
  const held: FixedMemory[] = [];
  try {
    await prewarmFixedMemories([32, 0, 1, 0], turn);
    const allocations = memory.mock.calls.length;
    expect(allocations).toBeLessThanOrEqual(33); expect(turn).toHaveBeenCalledTimes(allocations);
    const before = fixedMemoryCensus();
    for (let n = 0; n < 25; n++) held.push(new FixedMemory(1, true));
    held.push(new FixedMemory(3, true));
    expect(memory).toHaveBeenCalledTimes(allocations);
    const beforeLegacy = fixedMemoryCensus();
    expect(beforeLegacy).toMatchObject({ hits: before.hits + 26, misses: before.misses });
    const legacy = Array.from({ length: 7 }, () => freshScriptMemory(1, 1)), after = fixedMemoryCensus();
    // A shared worker may contain recycled V2 stock. Legacy consumers must
    // allocate fresh storage rather than consume any of those returned rows.
    const fresh = after.misses - beforeLegacy.misses;
    expect(memory).toHaveBeenCalledTimes(allocations + fresh);
    expect(after.recycledHits).toBe(beforeLegacy.recycledHits);
    expect(after.virginHits - beforeLegacy.virginHits + fresh).toBe(7);
    if (incoming.retained === 0) {
      expect(allocations).toBe(33); expect(fresh).toBe(0);
      expect(after).toMatchObject({ hits: before.hits + 33, misses: before.misses, available: 0, bytes: 0 });
    }
    expect(new Set([...held.map(row => row.value), ...legacy]).size).toBe(33);
    for (const row of held) expect(new Uint8Array(row.value.buffer).every(x => x === 0)).toBe(true);
  } finally { memory.mockRestore(); for (const row of held) row.retire(); }
});

test('retirement clears every byte; exact page counts and escaped storage remain independent', () => {
  const first = new FixedMemory(1, true), identity = first.value;
  new Uint8Array(identity.buffer).fill(0xa5); first.retire();
  expect(() => first.value).toThrow('ended');
  const second = new FixedMemory(1, true), wide = new FixedMemory(3, true);
  expect(second.value).toBe(identity); expect(wide.value).not.toBe(identity);
  expect(new Uint8Array(second.value.buffer).every(x => x === 0)).toBe(true);
  const escaped = second.expose(); escaped.grow(0); second.retire();
  const next = new FixedMemory(1, true); expect(next.value).not.toBe(escaped);
  new Uint8Array(escaped.buffer)[0] = 19; expect(new Uint8Array(next.value.buffer)[0]).toBe(0);
  wide.retire(); next.retire();
});

test('a held closed module releases its instance and forbids use; busy disposal cannot lend its memory to a nested owner', () => {
  const scope = new Scope('memory.busy'), nestedScope = new Scope('memory.nested');
  const module = new ScriptModuleV2(titanModuleBytes, { ...options, owner: scope });
  const before = fixedMemoryCensus();
  let nested: ScriptModuleV2 | undefined;
  try {
    expect(() => module.project(400000, view => {
      view.setUint8(65535, 87); scope.dispose();
      expect(fixedMemoryCensus().returned).toBe(before.returned);
      nested = new ScriptModuleV2(titanModuleBytes, { ...options, owner: nestedScope });
      expect(fixedMemoryCensus().returned).toBe(before.returned);
      throw new Error('Original write refusal');
    }, () => 0)).toThrow('Original write refusal');
    expect(fixedMemoryCensus().returned).toBe(before.returned + 1);
    expect(() => module.project(1, () => undefined, () => 0)).toThrow('ended');
    const reusedScope = new Scope('memory.reused');
    try {
      const reused = new ScriptModuleV2(titanModuleBytes, { ...options, owner: reusedScope });
      expect(() => reused.project(400000, view => {
        expect(view.getUint8(65535)).toBe(0); throw new Error('Detached read proof');
      }, () => 0)).toThrow('Detached read proof');
      expect(nested).toBeDefined();
    } finally { reusedScope.dispose(); }
  } finally { scope.dispose(); nestedScope.dispose(); }
});

test('public memory access and arbitrary initialization permanently exclude recycling', () => {
  for (const initialize of [undefined, (view: DataView): void => { view.setUint8(65535, 91); }]) {
    const scope = new Scope('memory.escaped');
    const module = new ScriptModuleV2(titanModuleBytes, { ...options, owner: scope, ...(initialize === undefined ? {} : { initialize }) });
    const memory = module.memory, before = fixedMemoryCensus();
    scope.dispose(); expect(fixedMemoryCensus().returned).toBe(before.returned);
    new Uint8Array(memory.buffer)[65535] = 17;
    expect(() => module.project(1, () => undefined, () => 0)).toThrow('ended');
  }
});

test('sliced teardown cannot lend retired storage until all original owner cleanups finish', () => {
  const scope = new Scope('memory.sliced'); scope.onDispose(() => undefined);
  const module = new ScriptModuleV2(titanModuleBytes, { ...options, owner: scope });
  const before = fixedMemoryCensus();
  const steps = scope.disposeSteps(); steps.next();
  expect(scope.disposing).toBe(true);
  expect(fixedMemoryCensus()).toMatchObject({ available: before.available, returned: before.returned + 1 });
  expect(() => module.project(1, () => undefined, () => 0)).toThrow('ended');
  while (steps.next().done !== true) { /* drain the original teardown */ }
  expect(fixedMemoryCensus().available).toBe(before.available + 1);
});

test('abandoned reservations return only on their original owner and reject stale tokens', () => {
  const scope = new Scope('memory.abandoned'), other = new Scope('memory.foreign');
  const token = prepareScriptMemory(titanModuleBytes, scope), before = fixedMemoryCensus();
  try {
    expect(() => new ScriptModuleV2(titanModuleBytes, { ...options, owner: other, prepared: { memory: token, scope } })).toThrow('ended');
    expect(fixedMemoryCensus().returned).toBe(before.returned);
    scope.dispose(); expect(fixedMemoryCensus().returned).toBe(before.returned + 1);
    expect(() => new ScriptModuleV2(titanModuleBytes, { ...options, prepared: { memory: token, scope } })).toThrow('reservation');
  } finally { scope.dispose(); other.dispose(); }
});

test('a retired return wrapper and detached candidate cannot read or affect its next owner', () => {
  const scope = new Scope('return.previous'), nextScope = new Scope('return.next');
  try {
    const original = ReturnProgram.page(titanPrograms.attack, scope);
    const candidate = original.prepare?.('bossClamp', { fullHp: 100, share: .3 });
    if (candidate === undefined) throw new Error('Missing original candidate');
    const before = fixedMemoryCensus(); scope.dispose();
    expect(fixedMemoryCensus().returned).toBe(before.returned + 1);
    const next = ReturnProgram.page(titanPrograms.attack, nextScope);
    expect(fixedMemoryCensus().hits).toBe(before.hits + 1);
    expect(next.project('bossClamp', { fullHp: 200, share: .4 })).toEqual({ hp: 80 });
    expect(candidate.values).toEqual({ hp: 30 });
    expect(() => candidate.accept()).toThrow('Return owner disposed');
    expect(() => original.project('bossClamp', { fullHp: 1, share: 1 })).toThrow('Return owner disposed');
    expect(next.project('bossClamp', { fullHp: 200, share: .4 })).toEqual({ hp: 80 });
  } finally { scope.dispose(); nextScope.dispose(); }
});

test('the census separates reusable bank bytes from scope-fenced storage without mutating either', () => {
  const owner = new Scope('memory.census'), lease = new FixedMemory(2, true), identity = lease.value;
  const borrowed = fixedMemoryCensus();
  try {
    lease.retire(new WeakRef(owner));
    const blocked = fixedMemoryCensus();
    expect(blocked).toMatchObject({ retained: borrowed.retained + 1, available: borrowed.available,
      availableBytes: borrowed.availableBytes, blocked: borrowed.blocked + 1,
      blockedBytes: borrowed.blockedBytes + 2 * 65536, bytes: borrowed.bytes + 2 * 65536 });
    expect(fixedMemoryCensus()).toEqual(blocked);
    owner.dispose();
    const ready = fixedMemoryCensus();
    expect(ready).toMatchObject({ retained: blocked.retained, available: borrowed.available + 1,
      availableBytes: borrowed.availableBytes + 2 * 65536, blocked: borrowed.blocked,
      blockedBytes: borrowed.blockedBytes, bytes: blocked.bytes });
    expect(fixedMemoryCensus()).toEqual(ready);
    const next = new FixedMemory(2, true);
    try {
      expect(next.value).toBe(identity);
      expect(fixedMemoryCensus()).toMatchObject({ retained: ready.retained - 1,
        available: ready.available - 1, availableBytes: ready.availableBytes - 2 * 65536,
        blocked: ready.blocked, blockedBytes: ready.blockedBytes, bytes: ready.bytes - 2 * 65536 });
    } finally { next.retire(); }
  } finally { owner.dispose(); lease.retire(); }
});

test('the idle bank is bounded and invalid warmup does not allocate', async () => {
  const memory = vi.spyOn(WebAssembly, 'Memory');
  try {
    await expect(prewarmFixedMemories([46, 0, 0, 0], () => Promise.resolve())).rejects.toThrow('Invalid');
    await expect(prewarmFixedMemories([0, 0, 0, 45], () => Promise.resolve())).rejects.toThrow('Invalid');
    expect(memory).not.toHaveBeenCalled();
    const held = Array.from({ length: 48 }, () => new FixedMemory(4, true));
    for (const value of held) value.retire();
    expect(fixedMemoryCensus().available).toBeLessThanOrEqual(45);
    expect(fixedMemoryCensus().bytes).toBeLessThanOrEqual(10 * 1024 * 1024);
  } finally { memory.mockRestore(); }
});

test('legacy consumers never reuse returned V2 storage and growables cannot consume fixed stock', () => {
  const before = fixedMemoryCensus(), legacy = freshScriptMemory(1, 1), after = fixedMemoryCensus();
  // A prior boot may leave virgin stock; recycled V2 storage is never eligible.
  expect(after.recycledHits).toBe(before.recycledHits);
  expect(after.hits - before.hits + after.misses - before.misses).toBe(1);
  expect(after.hits - before.hits).toBe(after.virginHits - before.virginHits);
  const current = fixedMemoryCensus(), growable = freshScriptMemory(1, 2);
  expect(fixedMemoryCensus()).toEqual({ ...current, misses: current.misses + 1 });
  expect(growable).not.toBe(legacy); expect(growable.grow(1)).toBe(1);
  expect(() => legacy.grow(1)).toThrow();
});
