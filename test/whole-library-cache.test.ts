import { afterEach, expect, test, vi } from 'vitest';
import { BufferAttribute, BufferGeometry, Matrix4, MeshBasicMaterial } from 'three';
import { AssetService } from '../src/client/engine/app/assets';
import { Scope } from '../src/shared/engine/app/scope';
import { CONTENT_CAPS } from '../src/shared/engine/core/config';
import { initializeTier, TIER } from '../src/client/engine/core/tier';
import { AssetResidencyBridge } from '../src/client/game/grid/assetResidency';
import { ResidencyAllocator } from '../src/shared/game/grid/allocator';
import { MemoryAdmission } from '@wildshard/format/memoryAdmission';
import { emptyShardfile } from '../src/shared/host/author';
import { staticGlb } from '../src/sharddev/bake/glb';
import { hashImmutableBytes } from '../src/shared/host/immutable';
import { provideRuntimeProduct, runtimeProduct } from '../src/client/game/shardfile/runtimeProduct';
import { createShardProduct } from '../src/shared/game/shardfile/shardProduct';
import { readWholeLibrary } from '../src/client/game/shardfile/wholeLibrary';
import { parseWorldScenes } from '@wildshard/format/worldScenes';
import * as geometryModule from '../src/client/game/plugin/geometry';

const originalTier = TIER;
afterEach(() => { initializeTier(originalTier); vi.restoreAllMocks(); });
function fixture(limit = 10000, transform = new Matrix4(), part = 'draw', readCold?: () => Promise<Uint8Array | null>) {
  const owner = new Scope('whole-source'), shape = new BufferGeometry();
  shape.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  shape.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2, 0, 0, 2]), 3));
  const paint = new MeshBasicMaterial(), bytes = staticGlb([{ geometry: shape, material: paint, nativeAttributes: true, transform,
    extras: { wholePartition: { id: part, vertices: { runs: [0, 3] }, triangles: { runs: [0, 1] }, vertexCount: 3, indexCount: 0, index: 'none' } } }]);
  shape.dispose(); paint.dispose();
  const hash = hashImmutableBytes(bytes), source = emptyShardfile({ slug: 'whole-cache', name: 'Whole cache', author: 'Fixture', revision: 1, seed: 1 });
  source.files.push({ hash, kind: 'glb', compressed: bytes.length, decoded: bytes.length, gpu: 72, triangles: 1, draws: 1, dependencies: [], critical: false });
  source.library.push(hash);
  provideRuntimeProduct({ source, assets: readCold === undefined ? new Map([[hash, bytes]]) : new Map(), cached: false }, owner, {
    base: 'https://test.example/shardfiles/whole-cache/', offline: false, firstParty: true,
    fetch: () => Promise.reject(new Error('Use admitted bytes')), hash: wire => Promise.resolve(hashImmutableBytes(wire)),
    ...(readCold === undefined ? {} : { cache: { product: () => Promise.resolve(null), asset: () => Promise.reject(new Error('Use verified cold source')),
      putProduct: () => Promise.resolve(), putAsset: () => Promise.resolve(true), verifiedAsset: readCold } }),
  });
  const product = createShardProduct({ slug: source.identity.slug, revision: 1, shardfile: source, sections: new Map(), files: new Map(), read: () => Promise.resolve(bytes) });
  const parsed = parseWorldScenes({ version: 1, libraries: [{ id: 'parts', kind: 'whole', models: [
    { id: 'plain', part, files: [hash] }, { id: 'alias', part, files: [hash] },
    { id: 'posed', part, files: [hash], matrix: new Matrix4().makeTranslation(4, 2, 1).elements },
  ] }], materials: [], steps: [] }).libraries[0];
  if (parsed?.kind !== 'whole' || 'storage' in parsed) throw new Error('Missing whole library');
  const assets = new AssetService<BufferGeometry>();
  const allocator = new ResidencyAllocator({ playing: CONTENT_CAPS.engineBase + CONTENT_CAPS.overlap + Math.ceil(limit * CONTENT_CAPS.residentFactor), memory: new MemoryAdmission() });
  const bridge = new AssetResidencyBridge(allocator, geometry => {
    if (!(geometry instanceof BufferGeometry)) throw new Error('Expected geometry');
    return ['position', 'normal'].flatMap(name => {
      const attribute: unknown = geometry.getAttribute(name);
      if (!(attribute instanceof BufferAttribute)) throw new Error('Expected plain channels');
      return [{ identity: attribute.array.buffer, bytes: attribute.array.byteLength, kind: 'cpu' as const }, { identity: attribute, bytes: attribute.array.byteLength, kind: 'gpu' as const }];
    });
  });
  const detach = assets.bindResidency(bridge);
  return { owner, product, hash, bytes, row: parsed, assets, allocator, close: () => {
    owner.dispose(); for (const row of assets.retained()) assets.evictCached(row.key); detach(); bridge.dispose();
  } };
}
const ids = new Set(['plain', 'alias', 'posed']);

test('a cold non-play reader awaits its exact whole source instead of requiring eager play transport', async () => {
  let deliver: (bytes: Uint8Array) => void = () => undefined;
  const bytes = new Promise<Uint8Array>(resolve => { deliver = resolve; });
  const readCold = vi.fn(() => bytes), f = fixture(10000, new Matrix4(), 'draw', readCold);
  let completed = false;
  const pending = readWholeLibrary(f.owner, f.product, f.row, ids).then(value => { completed = true; return value; });
  try {
    await vi.waitFor(() => { expect(readCold).toHaveBeenCalledOnce(); });
    expect(readCold).toHaveBeenCalledWith(f.hash);
    expect(completed).toBe(false);
    deliver(Uint8Array.from(f.bytes));
    const reader = await pending, geometry = reader.geometry('plain');
    expect(words(geometry)).toMatchObject({ position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) });
    expect(f.product.shardfile.library).toContain(f.hash);
    geometry?.dispose(); reader.done();
  } finally { deliver(Uint8Array.from(f.bytes)); f.close(); await pending.catch(() => undefined); }
});

function words(geometry: BufferGeometry | null): unknown {
  if (geometry === null) throw new Error('Missing geometry');
  return Object.fromEntries(Object.entries(geometry.attributes).map(([name, attribute]) => [name, attribute.array]));
}

test.each([false, true])('cached construction preserves original first/repeated/posed transform branches (posed source=%s)', async posed => {
  const f = fixture(10000, posed ? new Matrix4().makeTranslation(3, 2, 1) : new Matrix4());
  const legacyOwner = f.owner.child('legacy'), owner = f.owner.child('first');
  const oracle = await readWholeLibrary(legacyOwner, f.product, f.row, ids);
  const cached = await readWholeLibrary(owner, f.product, f.row, ids, undefined, f.assets);
  const copies: BufferGeometry[] = [];
  try {
    for (const id of ['plain', 'plain', 'alias', 'posed']) {
      const a = oracle.geometry(id), b = cached.geometry(id);
      expect(words(b)).toEqual(words(a));
      if (a === null || b === null) throw new Error('Missing fixture geometry');
      expect(b.getAttribute('position').array.buffer).not.toBe(a.getAttribute('position').array.buffer);
      copies.push(a, b);
    }
    cached.done(); oracle.done();
    const next = await readWholeLibrary(f.owner.child('next'), f.product, f.row, ids, undefined, f.assets);
    const first = next.geometry('plain'); if (first === null) throw new Error('Missing revisited geometry'); copies.push(first);
    if (!posed) expect(first.getAttribute('normal').getZ(0)).toBe(2);
    next.done();
  } finally { cached.done(); oracle.done(); for (const copy of copies) copy.dispose(); f.close(); }
});

test('idle re-entry skips reconstruction; pressure protects live references and invalidates completed maps', async () => {
  const f = fixture(150), decode = vi.spyOn(geometryModule, 'readWholeGeometry');
  const first = await readWholeLibrary(f.owner.child('first'), f.product, f.row, ids, undefined, f.assets);
  expect(decode).toHaveBeenCalledTimes(1);
  expect(f.allocator.cost().input.commons).toBe(144);
  expect(f.allocator.reserve({ id: 'pressure', owner: 'platform', category: 'commons', bytes: 144, needed: true, distance: 0 })).toBeNull();
  first.done(); first.done();
  const second = await readWholeLibrary(f.owner.child('second'), f.product, f.row, ids, undefined, f.assets);
  expect(decode).toHaveBeenCalledTimes(1); second.done();
  const pressure = f.allocator.reserve({ id: 'pressure', owner: 'platform', category: 'commons', bytes: 144, needed: true, distance: 0 });
  expect(pressure).not.toBeNull(); expect(f.assets.retained()).toEqual([]); pressure?.release();
  (await readWholeLibrary(f.owner.child('third'), f.product, f.row, ids, undefined, f.assets)).done();
  expect(decode).toHaveBeenCalledTimes(2); f.close();
});

test('concurrent readers publish once and cancellation cannot strand live claims', async () => {
  const f = fixture(), a = f.owner.child('a'), b = f.owner.child('b');
  const [first, second] = await Promise.all([readWholeLibrary(a, f.product, f.row, ids, undefined, f.assets), readWholeLibrary(b, f.product, f.row, ids, undefined, f.assets)]);
  expect(f.assets.retained().map(row => row.refs)).toEqual([2]);
  first.done(); b.dispose(); second.done(); expect(f.assets.retained().map(row => row.refs)).toEqual([0]);
  for (const row of f.assets.retained()) f.assets.evictCached(row.key);
  const cancelled = f.owner.child('cancelled');
  await expect(readWholeLibrary(cancelled, f.product, f.row, ids, () => { cancelled.dispose(); return Promise.resolve(); }, f.assets)).rejects.toThrow('unloaded');
  expect(f.assets.retained()).toEqual([]); f.close();
});

test('tier changes miss and refused registration leaves no partially owned template', async () => {
  const f = fixture(), decode = vi.spyOn(geometryModule, 'readWholeGeometry');
  initializeTier('phone'); (await readWholeLibrary(f.owner.child('phone'), f.product, f.row, ids, undefined, f.assets)).done();
  initializeTier('desktop'); (await readWholeLibrary(f.owner.child('desktop'), f.product, f.row, ids, undefined, f.assets)).done();
  expect(decode).toHaveBeenCalledTimes(2);
  for (const row of f.assets.retained()) f.assets.evictCached(row.key);
  const register = vi.spyOn(f.assets, 'register').mockImplementation(() => { throw new Error('Refused whole claim'); });
  await expect(readWholeLibrary(f.owner.child('refused'), f.product, f.row, ids, undefined, f.assets)).rejects.toThrow('Refused whole claim');
  expect(f.assets.retained()).toEqual([]); expect(f.allocator.entries()).toEqual([]);
  register.mockRestore(); f.close();
});

test('ordered content hashes identify reconstructions and partial registration unwinds every original', async () => {
  const f = fixture(), other = fixture(10000, new Matrix4(), 'other');
  const source = emptyShardfile({ slug: 'whole-pair', name: 'Pair', author: 'Fixture', revision: 1, seed: 1 });
  source.files.push(...f.product.shardfile.files, ...other.product.shardfile.files); source.library.push(f.hash, other.hash);
  provideRuntimeProduct({ source, assets: new Map([[f.hash, f.bytes], [other.hash, other.bytes]]), cached: false }, f.owner, {
    base: 'https://test.example/shardfiles/whole-pair/', offline: false, firstParty: true,
    fetch: () => Promise.reject(new Error('Use admitted bytes')), hash: wire => Promise.resolve(hashImmutableBytes(wire)),
  });
  const product = createShardProduct({ slug: source.identity.slug, revision: 1, shardfile: source, sections: new Map(), files: new Map(), read: () => Promise.reject(new Error('Use runtime reader')) });
  const rows = (files: string[]) => ({ ...f.row, models: f.row.models.map(model => ({ ...model, files })) });
  const decode = vi.spyOn(geometryModule, 'readWholeGeometry');
  for (const files of [[f.hash, other.hash], [other.hash, f.hash], [f.hash]]) {
    (await readWholeLibrary(f.owner.child('profile'), product, rows(files), ids, undefined, f.assets)).done();
  }
  expect(decode).toHaveBeenCalledTimes(3);
  for (const row of f.assets.retained()) f.assets.evictCached(row.key);
  const nativeRegister = f.assets.register.bind(f.assets);
  const register = vi.spyOn(f.assets, 'register').mockImplementationOnce((key, geometry, options) => nativeRegister(key, geometry, options))
    .mockImplementationOnce(() => { throw new Error('Refuse second claim'); });
  await expect(readWholeLibrary(f.owner.child('partial'), product, rows([f.hash, other.hash]), ids, undefined, f.assets)).rejects.toThrow('Refuse second claim');
  expect(f.assets.retained()).toEqual([]); expect(f.allocator.entries()).toEqual([]);
  register.mockRestore();
  (await readWholeLibrary(f.owner.child('retry'), product, rows([f.hash, other.hash]), ids, undefined, f.assets)).done();
  expect(f.assets.retained()).toHaveLength(2); f.close(); other.close();
});

test('a sliced retiring ancestor refuses before creating a child, registering or acquiring', async () => {
  const f = fixture(), parent = f.owner.child('retiring'), child = parent.child('open');
  parent.onDispose(() => undefined); const retirement = parent.disposeSteps(); retirement.next();
  const makeChild = vi.spyOn(child, 'child'), register = vi.spyOn(f.assets, 'register'), acquire = vi.spyOn(f.assets, 'acquireResource');
  await expect(readWholeLibrary(child, f.product, f.row, ids, undefined, f.assets)).rejects.toThrow('retiring');
  expect(makeChild).not.toHaveBeenCalled(); expect(register).not.toHaveBeenCalled(); expect(acquire).not.toHaveBeenCalled();
  for (const step of retirement) void step;
  f.close();
});

test('cache hits retain transport release authority and cancellation releases the construction lease', async () => {
  const f = fixture();
  (await readWholeLibrary(f.owner.child('cold'), f.product, f.row, ids, undefined, f.assets)).done();
  const runtime = runtimeProduct(f.product.shardfile);
  const owner = f.owner.child('warm');
  let resume = (): void => undefined;
  const wait = new Promise<void>(resolve => { resume = resolve; });
  const release = vi.spyOn(runtime, 'releaseTransport').mockImplementation(async () => { await wait; });
  const pending = readWholeLibrary(owner, f.product, f.row, ids, undefined, f.assets);
  const rejected = expect(pending).rejects.toThrow('disposed');
  owner.dispose(); resume(); await rejected;
  expect(release).toHaveBeenCalledWith([f.hash]);
  expect(f.assets.retained().map(row => row.refs)).toEqual([0]);
  release.mockRestore(); f.close();
});


test.each([false, true])('only Explorer whole libraries borrow fine tile GLBs (cached=%s)', async cached => {
  const f = fixture(), source = f.product.shardfile;
  source.library.splice(0);
  const fine = { lod: 0 as const, x: 4, z: 4, geometricError: 0, bounds: { min: [0, 0, 0] as [number, number, number], max: [62.5, 1, 62.5] as [number, number, number] },
    files: [f.hash], compressed: f.bytes.length, decoded: f.bytes.length, gpu: 72, triangles: 1, draws: 1 };
  source.tiles.push(fine);
  const assets = cached ? f.assets : undefined;
  try {
    await expect(readWholeLibrary(f.owner, f.product, f.row, ids, undefined, assets)).rejects.toThrow('Missing whole library file');
    const reader = await readWholeLibrary(f.owner, f.product, { ...f.row, load: 'explorer' }, ids, undefined, assets);
    const geometry = reader.geometry('plain');
    expect(words(geometry)).toMatchObject({ position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) });
    geometry?.dispose(); reader.done();
    source.tiles.splice(0, source.tiles.length, { ...fine, lod: 1 });
    await expect(readWholeLibrary(f.owner, f.product, { ...f.row, load: 'explorer' }, ids, undefined, assets)).rejects.toThrow('Missing whole library file');
    source.tiles.splice(0, source.tiles.length, fine);
    const file = source.files.find(row => row.hash === f.hash);
    if (file === undefined) throw new Error('Missing fixture GLB');
    file.kind = 'json';
    await expect(readWholeLibrary(f.owner, f.product, { ...f.row, load: 'explorer' }, ids, undefined, assets)).rejects.toThrow('Missing whole library file');
  } finally { f.close(); }
});

test('cold whole transport refills six shared slots before the first ordered decode is ready', async () => {
  const pieces = Array.from({ length: 8 }, (_, i) => fixture(10000, new Matrix4(), `phase-${String(i)}`));
  const owner = new Scope('whole-phase-source'), source = emptyShardfile({ slug: 'whole-phase', name: 'Phase', author: 'Fixture', revision: 1, seed: 1 });
  for (const piece of pieces) { source.files.push(...piece.product.shardfile.files); source.library.push(piece.hash); }
  const started: string[] = [], deliver = new Map<string, () => void>();
  provideRuntimeProduct({ source, assets: new Map(), cached: false }, owner, {
    base: 'https://test.example/shardfiles/whole-phase/', offline: false, firstParty: true,
    fetch: () => Promise.reject(new Error('Use verified source')), hash: wire => Promise.resolve(hashImmutableBytes(wire)),
    cache: { product: () => Promise.resolve(null), asset: () => Promise.reject(new Error('Use verified source')),
      putProduct: () => Promise.resolve(), putAsset: () => Promise.resolve(true), verifiedAsset: hash => {
        const piece = pieces.find(row => row.hash === hash);
        if (piece === undefined) return Promise.reject(new Error('Unexpected source file'));
        started.push(hash); return new Promise(resolve => { deliver.set(hash, () => { resolve(Uint8Array.from(piece.bytes)); }); });
      } },
  });
  let completed = false;
  const pending = geometryModule.readWholeGeometry(owner, source, source.library).then(result => { completed = true; return result; });
  const finish = (index: number): void => {
    const piece = pieces[index]; if (piece === undefined) throw new Error('Missing whole phase piece');
    const resolve = deliver.get(piece.hash); if (resolve === undefined) throw new Error('Read never started'); resolve();
  };
  try {
    await vi.waitFor(() => { expect(started).toEqual(pieces.slice(0, 6).map(row => row.hash)); });
    finish(5); await vi.waitFor(() => { expect(started).toHaveLength(7); });
    finish(6); await vi.waitFor(() => { expect(started).toHaveLength(8); });
    expect(completed).toBe(false); // Decode still waits for phase-0, not the fastest response.
    for (let i = 0; i < pieces.length; i++) finish(i);
    const views = await pending;
    expect([...views.keys()]).toEqual(pieces.map((_row, i) => `phase-${String(i)}`));
    for (const view of views.values()) {
      expect(words(view.geometry)).toEqual({ position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), normal: new Float32Array([0, 0, 2, 0, 0, 2, 0, 0, 2]) });
      expect(view.matrix.equals(new Matrix4())).toBe(true);
    }
  } finally {
    for (const resolve of deliver.values()) resolve();
    owner.dispose(); await pending.catch(() => undefined); for (const piece of pieces) piece.close();
  }
});
