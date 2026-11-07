import { afterEach, expect, test, vi } from 'vitest';
import { BufferAttribute, BufferGeometry, MeshStandardMaterial } from 'three';
import { AssetService } from '../src/client/engine/app/assets';
import { Scope } from '../src/shared/engine/app/scope';
import { initializeTier, TIER } from '../src/client/engine/core/tier';
import { CONTENT_CAPS } from '../src/shared/engine/core/config';
import { AssetResidencyBridge } from '../src/client/game/grid/assetResidency';
import { ResidencyAllocator } from '../src/shared/game/grid/allocator';
import { MemoryAdmission } from '@wildshard/format/memoryAdmission';
import { staticGlb } from '../src/sharddev/bake/glb';
import { cachedWorldSceneGeometry, readWorldSceneGeometries, readWorldSceneGeometry } from '../src/client/game/shardfile/worldSceneGeometry';
import { createOwnedGeometry } from '../src/client/engine/models/ownedGeometry';
import { PreparationReads } from '../src/client/game/shardfile/preparationReads';

const originalTier = TIER;
afterEach(() => { initializeTier(originalTier); vi.restoreAllMocks(); });
function fixture(limit = 10000) {
  const source = new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  source.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  source.setAttribute('uv', new BufferAttribute(new Float32Array(6), 2));
  const material = new MeshStandardMaterial();
  const bytes = staticGlb([{ geometry: source, material, nativeAttributes: true }]);
  source.dispose(); material.dispose();
  const file = vi.fn((_name: string) => Promise.resolve(bytes));
  const product = { url: (name: string) => `/blobs/fixture/${name}`, file };
  const assets = new AssetService<BufferGeometry>();
  const allocator = new ResidencyAllocator({ playing: CONTENT_CAPS.engineBase + CONTENT_CAPS.overlap + Math.ceil(limit * CONTENT_CAPS.residentFactor), memory: new MemoryAdmission() });
  const bridge = new AssetResidencyBridge(allocator, geometry => {
    if (!(geometry instanceof BufferGeometry)) throw new Error('Expected fixture geometry');
    const attribute: unknown = geometry.getAttribute('position');
    if (!(attribute instanceof BufferAttribute)) throw new Error('Missing fixture position');
    return [{ identity: attribute.array.buffer, bytes: attribute.array.byteLength, kind: 'cpu' },
      { identity: attribute, bytes: attribute.array.byteLength, kind: 'gpu' }];
  });
  const detach = assets.bindResidency(bridge);
  return { assets, product, allocator, bridge, bytes, close: () => {
    for (const row of assets.retained()) assets.evictCached(row.key);
    detach(); bridge.dispose();
  } };
}
const row = { file: 'fixed.glb' };

function orderedIntake() {
  const f = fixture(), owner = new Scope('ordered-model-window');
  const rows = Array.from({ length: 10 }, (_, index) => ({ file: `model-${String(index)}.glb` }));
  const pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>(), started: string[] = [];
  const product = { ...f.product, file: (name: string): Promise<Uint8Array> => {
    started.push(name);
    return new Promise((resolve, reject) => { pending.set(name, { resolve: () => { resolve(f.bytes); }, reject }); });
  } };
  const intake = readWorldSceneGeometries(owner, product, rows, f.assets);
  const release = (): void => { for (const entry of pending.values()) entry.resolve(); };
  return { ...f, owner, rows, pending, started, intake, release };
}

test('six transport reads refill independently of four decoded leases and close drains both', async () => {
  const f = orderedIntake(), next = f.intake.next();
  try {
    expect(f.started).toEqual(f.rows.slice(0, 6).map(source => source.file));
    f.pending.get('model-0.glb')?.resolve();
    const first = await next;
    if (first.done) throw new Error('Missing first prepared model');
    expect(f.started).toEqual(f.rows.slice(0, 7).map(source => source.file));
    let closed = false;
    const closing = (async () => { await f.intake.return(); closed = true; })();
    await Promise.resolve(); expect(closed).toBe(false);
    f.release(); await closing;
    expect(f.started).toHaveLength(7);
    expect(f.assets.retained().map(entry => entry.refs).sort((a, b) => a - b)).toEqual([0, 0, 0, 0, 1]);
    const copy = first.value.copy();
    expect([...copy.getAttribute('position').array]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    copy.dispose(); first.value.done();
    expect(f.assets.retained().every(entry => entry.refs === 0)).toBe(true);
  } finally { f.release(); await f.intake.return(); f.owner.dispose(); f.close(); }
});

test('an ordered model failure drains later reads and preserves the cursor failure', async () => {
  const f = orderedIntake(), first = f.intake.next();
  try {
    f.pending.get('model-1.glb')?.reject(new Error('cursor failure'));
    f.pending.get('model-0.glb')?.resolve();
    const result = await first;
    if (result.done) throw new Error('Missing first model');
    result.value.done();
    let settled = false;
    const outcome = (async () => {
      try { await f.intake.next(); return null; }
      catch (error: unknown) { return error; }
      finally { settled = true; }
    })();
    await Promise.resolve(); await Promise.resolve();
    expect(settled).toBe(false);
    f.pending.get('model-3.glb')?.reject(new Error('later failure'));
    f.release();
    expect(String(await outcome)).toContain('cursor failure');
    expect(f.started).toHaveLength(6);
    expect(f.assets.retained().every(entry => entry.refs === 0)).toBe(true);
  } finally { f.release(); await f.intake.return(); f.owner.dispose(); f.close(); }
});

test('a retired model window drains its six reads without starting a suffix', async () => {
  const f = orderedIntake(), next = f.intake.next();
  const refused = expect(next).rejects.toThrow('disposed or retiring');
  try {
    f.owner.dispose(); f.release(); await refused;
    expect(f.started).toHaveLength(6);
    expect(f.assets.retained()).toEqual([]);
  } finally { f.release(); await f.intake.return(); f.owner.dispose(); f.close(); }
});

test('a warm model window reads no bytes and closing preserves only its taken lease', async () => {
  const f = fixture(), owner = new Scope('warm-model-window');
  const rows = Array.from({ length: 6 }, (_, index) => ({ file: `cached-${String(index)}.glb` }));
  for (const source of rows) (await readWorldSceneGeometry(owner, f.product, source, f.assets)).done();
  expect(f.product.file).toHaveBeenCalledTimes(6);
  const intake = readWorldSceneGeometries(owner, f.product, rows, f.assets);
  try {
    const first = await intake.next();
    if (first.done) throw new Error('Missing cached model');
    await intake.return();
    expect(f.product.file).toHaveBeenCalledTimes(6);
    expect(f.assets.retained().map(entry => entry.refs)).toEqual([1, 0, 0, 0, 0, 0]);
    const a = first.value.copy(), b = first.value.copy();
    try {
      expect(a.getAttribute('position').array).not.toBe(b.getAttribute('position').array);
      expect(a.getAttribute('position').array).toEqual(b.getAttribute('position').array);
      a.getAttribute('position').setX(0, 100);
      expect(b.getAttribute('position').getX(0)).toBe(0);
    } finally { a.dispose(); b.dispose(); first.value.done(); }
  } finally { await intake.return(); owner.dispose(); f.close(); }
});

test('segmented geometry starts every read with its primary and restores the original segment order', async () => {
  const f = fixture(), scope = new Scope('segment-reads'), names = ['fixed.glb', 'part-a.glb', 'part-b.glb'];
  const pending = new Map<string, (bytes: Uint8Array) => void>(), started: string[] = [];
  const product = { ...f.product, file: (name: string): Promise<Uint8Array> => {
    started.push(name); return new Promise(resolve => { pending.set(name, resolve); });
  } };
  const loading = readWorldSceneGeometry(scope, product, { ...row, segments: names.slice(1) }, f.assets);
  expect(started).toEqual(names);
  try {
    for (const name of [...names].reverse()) {
      const finish = pending.get(name); if (finish === undefined) throw new Error('Missing segment read'); finish(f.bytes);
    }
    const held = await loading, actual = held.copy(), oracle = createOwnedGeometry(product.url(row.file));
    await oracle.load(f.bytes, [f.bytes, f.bytes]);
    const expected = oracle.take();
    try { for (const name of Object.keys(expected.attributes)) expect(actual.getAttribute(name).array).toEqual(expected.getAttribute(name).array); }
    finally { actual.dispose(); expected.dispose(); held.done(); }
  } finally { scope.dispose(); f.close(); }
});

test('a primary read refusal drains started segments without decoding or publishing a template', async () => {
  const f = fixture(), scope = new Scope('segment-refusal');
  let finish = (): void => undefined, settled = false;
  const segment = new Promise<Uint8Array>(resolve => { finish = () => { resolve(f.bytes); }; });
  const product = { ...f.product, file: (name: string): Promise<Uint8Array> => name === row.file ? Promise.reject(new Error('Primary refused')) : segment };
  const loading = (async (): Promise<unknown> => {
    try { await readWorldSceneGeometry(scope, product, { ...row, segments: ['part.glb'] }, f.assets); return null; }
    catch (error) { return error; }
    finally { settled = true; }
  })();
  try {
    await Promise.resolve(); await Promise.resolve(); expect(settled).toBe(false);
    finish(); expect(String(await loading)).toContain('Primary refused');
    expect(f.assets.retained()).toEqual([]); expect(f.allocator.entries()).toEqual([]);
  } finally { finish(); scope.dispose(); f.close(); }
});

test('runtime retirement evicts its idle template and re-entry decodes fresh equal geometry', async () => {
  const f = fixture(), first = new Scope('first-runtime'), second = new Scope('second-runtime');
  const a = f.allocator.reserve({ id: 'sim:first', owner: 'first', category: 'sim', bytes: 100, needed: true, distance: 0 });
  if (a === null) throw new Error('Missing first runtime');
  f.bridge.cover(first, a);
  const held = await readWorldSceneGeometry(first, f.product, row, f.assets), original = held.copy();
  held.done(); first.dispose(); a.release();
  expect(f.assets.retained()).toEqual([]); expect(f.allocator.cost().input.commons).toBe(0);
  const b = f.allocator.reserve({ id: 'sim:second', owner: 'second', category: 'sim', bytes: 100, needed: true, distance: 0 });
  if (b === null) throw new Error('Missing second runtime');
  f.bridge.cover(second, b);
  const next = await readWorldSceneGeometry(second, f.product, row, f.assets), replacement = next.copy();
  expect(f.product.file).toHaveBeenCalledTimes(2);
  expect(replacement.getAttribute('position').array).toEqual(original.getAttribute('position').array);
  expect(replacement.getAttribute('position').array.buffer).not.toBe(original.getAttribute('position').array.buffer);
  expect(replacement.getAttribute('normal').array).toEqual(original.getAttribute('normal').array);
  next.done(); second.dispose(); b.release();
  expect(f.assets.retained()).toEqual([]); expect(f.allocator.cost().input.commons).toBe(0);
  original.dispose(); replacement.dispose(); f.close();
});

test('re-entry skips decoding but every consumer gets a private deep copy and its own lease', async () => {
  const f = fixture(), first = new Scope('first'), second = new Scope('second');
  const a = await readWorldSceneGeometry(first, f.product, row, f.assets);
  const b = await readWorldSceneGeometry(second, f.product, row, f.assets);
  expect(f.product.file).toHaveBeenCalledTimes(1);
  expect(f.assets.retained().map(entry => entry.refs)).toEqual([2]);
  expect(f.allocator.cost().input.commons).toBe(72);
  const copyA = a.copy(), copyB = b.copy();
  expect(copyA.getAttribute('position').array.buffer).not.toBe(copyB.getAttribute('position').array.buffer);
  copyA.getAttribute('position').setX(0, 99);
  expect(copyB.getAttribute('position').getX(0)).toBe(0);
  a.done(); a.done(); first.dispose();
  expect(() => a.copy()).toThrow('disposed');
  expect(f.assets.retained().map(entry => entry.refs)).toEqual([1]);
  second.dispose(); b.done(); expect(f.assets.retained().map(entry => entry.refs)).toEqual([0]);
  const third = new Scope('third'), c = await readWorldSceneGeometry(third, f.product, row, f.assets);
  const copyC = c.copy(); expect(copyC.getAttribute('position').getX(0)).toBe(0);
  expect(f.product.file).toHaveBeenCalledTimes(1);
  c.done(); expect(() => c.copy()).toThrow('finished'); third.dispose();
  copyA.dispose(); copyB.dispose(); copyC.dispose(); f.close();
  expect(f.allocator.cost().input.commons).toBe(0);
});

test('content, tier, segment order and sorted channel mappings identify completed templates', async () => {
  const f = fixture(), scope = new Scope('profiles');
  initializeTier('phone');
  const declarations = [row, { file: 'changed.glb' },
    { ...row, segments: ['a.glb', 'b.glb'] }, { ...row, segments: ['b.glb', 'a.glb'] },
    { ...row, attributes: { normal: 'customNormal', uv: 'customUv' } }];
  for (const declaration of declarations) (await readWorldSceneGeometry(scope, f.product, declaration, f.assets)).done();
  initializeTier('desktop'); (await readWorldSceneGeometry(scope, f.product, row, f.assets)).done();
  expect(f.assets.retained()).toHaveLength(6);
  const reads = f.product.file.mock.calls.length;
  initializeTier('phone'); (await readWorldSceneGeometry(scope, f.product, { ...row, attributes: {} }, f.assets)).done();
  (await readWorldSceneGeometry(scope, f.product, { ...row, attributes: { uv: 'customUv', normal: 'customNormal' } }, f.assets)).done();
  expect(f.product.file).toHaveBeenCalledTimes(reads);
  scope.dispose(); f.close();
});

test.each([false, true])('pressure protects live leases and evicts idle templates (revisit=%s)', async revisit => {
  const f = fixture(80), scope = new Scope('live');
  const a = await readWorldSceneGeometry(scope, f.product, row, f.assets, { revisit });
  expect(f.allocator.reserve({ id: 'pressure', owner: 'platform', category: 'commons', bytes: 72, needed: true, distance: 0 })).toBeNull();
  a.done(); scope.dispose();
  const pressure = f.allocator.reserve({ id: 'pressure', owner: 'platform', category: 'commons', bytes: 72, needed: true, distance: 0 });
  expect(pressure).not.toBeNull(); expect(f.assets.retained()).toEqual([]); pressure?.release();
  const next = new Scope('next'); (await readWorldSceneGeometry(next, f.product, row, f.assets, { revisit })).done();
  expect(f.product.file).toHaveBeenCalledTimes(2);
  next.dispose(); f.close();
});

test('overlapping and overwritten aliases preserve the original decoder order instead of sharing a sorted key', async () => {
  const f = fixture(), scope = new Scope('aliases');
  const profiles = [{ normal: 'custom', uv: 'custom' }, { uv: 'custom', normal: 'custom' },
    { normal: 'uv', uv: 'custom' }, { uv: 'custom', normal: 'uv' }];
  for (const attributes of profiles) {
    const oracle = createOwnedGeometry(f.product.url(row.file), attributes); await oracle.load(f.bytes);
    const original = oracle.take(), held = await readWorldSceneGeometry(scope, f.product, { ...row, attributes }, f.assets), actual = held.copy();
    for (const name of ['position', 'normal', 'uv', 'custom']) {
      expect(actual.hasAttribute(name)).toBe(original.hasAttribute(name));
      if (!original.hasAttribute(name)) continue;
      expect(actual.getAttribute(name).itemSize).toBe(original.getAttribute(name).itemSize);
      expect(actual.getAttribute(name).array).toEqual(original.getAttribute(name).array);
    }
    actual.dispose(); original.dispose(); held.done();
  }
  expect(f.assets.retained()).toHaveLength(4);
  scope.dispose(); f.close();
});

test('cancelled readers neither publish nor strand a live claim, and concurrent readers share only completed geometry', async () => {
  const f = fixture(), cancelled = new Scope('cancelled'), live = new Scope('live');
  let release = (): void => undefined;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const product = { ...f.product, file: async (name: string) => { await wait; return f.product.file(name); } };
  const abandoned = readWorldSceneGeometry(cancelled, product, row, f.assets);
  const rejected = expect(abandoned).rejects.toThrow('disposed');
  const pending = readWorldSceneGeometry(live, product, row, f.assets);
  cancelled.dispose(); release(); await rejected;
  const held = await pending;
  expect(f.assets.retained().map(entry => entry.refs)).toEqual([1]);
  held.done(); live.dispose(); f.close();
});

test('concurrent cold readers do not retain duplicate templates', async () => {
  const f = fixture(), a = new Scope('a'), b = new Scope('b');
  const leases = await Promise.all([readWorldSceneGeometry(a, f.product, row, f.assets), readWorldSceneGeometry(b, f.product, row, f.assets)]);
  expect(f.assets.retained().map(entry => entry.refs)).toEqual([2]);
  expect(f.allocator.cost().input.commons).toBe(72);
  for (const held of leases) held.done(); a.dispose(); b.dispose(); f.close();
});

test('retiring ancestors refuse reads and acquisitions; malformed decode and refused claims leave no retained build', async () => {
  const f = fixture(), ancestor = new Scope('retiring'), child = ancestor.child('child');
  ancestor.onDispose(() => undefined); const steps = ancestor.disposeSteps(); steps.next();
  const acquire = vi.spyOn(f.assets, 'acquireResource');
  await expect(readWorldSceneGeometry(child, f.product, row, f.assets)).rejects.toThrow('retiring');
  expect(f.product.file).not.toHaveBeenCalled(); expect(acquire).not.toHaveBeenCalled();
  for (const step of steps) void step;
  const failed = new Scope('failed');
  await expect(readWorldSceneGeometry(failed, { ...f.product, file: () => Promise.resolve(new Uint8Array(1)) }, row, f.assets)).rejects.toThrow();
  const register = vi.spyOn(f.assets, 'register').mockImplementation(() => { throw new Error('Refused fixture allocation'); });
  await expect(readWorldSceneGeometry(failed, f.product, row, f.assets)).rejects.toThrow('Refused fixture allocation');
  expect(f.assets.retained()).toEqual([]); expect(f.allocator.entries()).toEqual([]);
  register.mockRestore(); failed.dispose(); f.close();
});


test('resident revisit templates stay charged after retirement and reuse only independent copies under a recycled sim id', async () => {
  const f = fixture(300), first = new Scope('revisit-first'), second = new Scope('revisit-next');
  const initial = f.allocator.reserve({ id: 'sim:reused', owner: 'first', category: 'sim', bytes: 100, needed: true, distance: 0 });
  if (initial === null) throw new Error('Missing initial runtime');
  f.bridge.cover(first, initial);
  const held = await readWorldSceneGeometry(first, f.product, row, f.assets, { revisit: true }), original = held.copy();
  expect(f.allocator.cost().input.commons).toBe(72);
  held.done(); first.dispose(); initial.release();
  expect(f.assets.retained().map(entry => entry.refs)).toEqual([0]);
  expect(f.allocator.cost().input.commons).toBe(72);
  const next = f.allocator.reserve({ id: 'sim:reused', owner: 'next', category: 'sim', bytes: 100, needed: true, distance: 0 });
  if (next === null) throw new Error('Missing returning runtime');
  f.bridge.cover(second, next);
  const returning = await readWorldSceneGeometry(second, f.product, row, f.assets, { revisit: true }), replacement = returning.copy();
  try {
    expect(f.product.file).toHaveBeenCalledTimes(1);
    expect(f.allocator.cost().input.commons).toBe(72);
    expect(f.allocator.entries().filter(entry => entry.category === 'commons').every(entry => entry.coveredBy === undefined)).toBe(true);
    expect(replacement.getAttribute('position').array).toEqual(original.getAttribute('position').array);
    expect(replacement.getAttribute('position').array.buffer).not.toBe(original.getAttribute('position').array.buffer);
    original.getAttribute('position').setX(0, 99);
    expect(replacement.getAttribute('position').getX(0)).toBe(0);
    expect(() => held.copy()).toThrow('disposed');
    expect(f.assets.evictCached(f.assets.retained()[0]?.key ?? '')).toBe(false);
  } finally {
    returning.done(); second.dispose(); next.release(); original.dispose(); replacement.dispose(); f.close();
  }
  expect(f.allocator.cost().input.commons).toBe(0);
});

test('resident revisit keys remain separate from ordinary templates and policy is captured before awaited input', async () => {
  const f = fixture(), ordinary = new Scope('ordinary-policy'), resident = new Scope('resident-policy');
  const first = await readWorldSceneGeometry(ordinary, f.product, row, f.assets); first.done();
  expect(cachedWorldSceneGeometry(f.product, row, f.assets)).toBe(true);
  expect(cachedWorldSceneGeometry(f.product, row, f.assets, { revisit: true })).toBe(false);
  let release = (): void => undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const product = { ...f.product, file: async (name: string) => { await gate; return f.product.file(name); } }, policy = { revisit: true };
  const pending = readWorldSceneGeometry(resident, product, row, f.assets, policy);
  policy.revisit = false; release();
  const held = await pending;
  try {
    expect(f.product.file).toHaveBeenCalledTimes(2);
    expect(f.assets.retained()).toHaveLength(2);
    expect(cachedWorldSceneGeometry(f.product, row, f.assets, { revisit: true })).toBe(true);
    const warm = await readWorldSceneGeometry(resident, f.product, row, f.assets, { revisit: true });
    warm.done(); expect(f.product.file).toHaveBeenCalledTimes(2);
  } finally { held.done(); ordinary.dispose(); resident.dispose(); f.close(); }
});


test('pressure may evict a warm suffix before its decode cursor without stranding its verified reread', async () => {
  const f = fixture(), owner = new Scope('evicted-warm-suffix');
  const rows = Array.from({length: 6}, (_, index) => ({file: `pressure-${String(index)}.glb`}));
  for (const source of rows) (await readWorldSceneGeometry(owner, f.product, source, f.assets)).done();
  const suffix = f.assets.retained()[5];
  if (suffix === undefined) throw new Error('Missing warm suffix');
  const intake = readWorldSceneGeometries(owner, f.product, rows, f.assets), leases = [];
  try {
    const first = await intake.next();
    if (first.done) throw new Error('Missing first model'); leases.push(first.value);
    expect(f.product.file).toHaveBeenCalledTimes(6);
    expect(f.assets.evictCached(suffix.key)).toBe(true);
    for (;;) {
      const next = await intake.next(); if (next.done) break; leases.push(next.value);
    }
    expect(leases).toHaveLength(6); expect(f.product.file).toHaveBeenCalledTimes(7);
    for (const lease of leases) {
      const copy = lease.copy();
      try { expect(copy.getAttribute('position').array).toEqual(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])); }
      finally { copy.dispose(); }
    }
  } finally { await intake.return(); for (const lease of leases) lease.done(); owner.dispose(); f.close(); }
});


test('closing an evicted warm suffix cancels its queued reread without waiting for another phase', async () => {
  const f = fixture(), owner = new Scope('queued-warm-suffix');
  const rows = Array.from({length: 6}, (_, index) => ({file: `queued-${String(index)}.glb`}));
  for (const source of rows) (await readWorldSceneGeometry(owner, f.product, source, f.assets)).done();
  const suffix = f.assets.retained()[5]; if (suffix === undefined) throw new Error('Missing warm suffix');
  const intake = readWorldSceneGeometries(owner, f.product, rows, f.assets), leases = [];
  const release: (() => void)[] = [];
  let blocker: PreparationReads<number> | undefined;
  try {
    const first = await intake.next(); if (first.done) throw new Error('Missing first model'); leases.push(first.value);
    expect(f.assets.evictCached(suffix.key)).toBe(true);
    blocker = new PreparationReads([0, 1, 2, 3, 4, 5], () => new Promise(resolve => { release.push(() => { resolve(new Uint8Array()); }); }), () => true);
    expect(release).toHaveLength(6);
    const second = await intake.next(); if (second.done) throw new Error('Missing second model'); leases.push(second.value);
    let closed = false;
    const closing = intake.return().then(() => { closed = true; return undefined; });
    await vi.waitFor(() => { expect(closed).toBe(true); });
    await closing; // All six other-phase reads remain held throughout this close.
    expect(f.product.file).toHaveBeenCalledTimes(6);
    expect(release).toHaveLength(6);
    for (const lease of leases) { const copy = lease.copy(); expect(copy.getAttribute('position').count).toBe(3); copy.dispose(); }
  } finally {
    const closing = blocker?.close(); for (const finish of release) finish(); await closing;
    await intake.return(); for (const lease of leases) lease.done(); owner.dispose(); f.close();
  }
});
