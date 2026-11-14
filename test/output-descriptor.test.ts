// oxlint-disable-next-line import/no-nodejs-modules -- Device-cost source fixture uses one tracked bounded KTX2 file.
import { readFileSync } from 'node:fs';
import { parseKtx2, ktx2DeviceCosts, ktx2DeviceGpu } from '@wildshard/format/ktx2Cost';
import { runtimeOnlyProductFiles, deviceLibraryCostPaced, productResidentBytes, productResidentBytesSteps, productPostCost } from '../src/client/game/shardfile/productCost';
import { expect, test, vi } from 'vitest';
import { emptyShardfile } from '../src/shared/host/author';
import { encodeCanonicalJson as canonicalJson, hashImmutableBytes } from '../src/shared/host/immutable';
import { parseOutputIndex, type OutputIndex } from '@wildshard/format/outputIndex';
import { OUTPUT_SECTIONS, outputSectionPayloads } from '@wildshard/format/outputFields';
import { parseShardfile, type Shardfile } from '@wildshard/format/shardSchema';
import { parseStateLineage } from '@wildshard/format/stateLineage';
import { readProductDescriptor, admitProduct, type CachedProduct, type ProductCache, type ProductOptions } from '../src/client/game/shardfile/product';
import { provideHybridDeclaration, runtimeProduct, loadShardProduct, completeManifestCache } from '../src/client/game/shardfile/runtimeProduct';
import { ClientAssets } from '../src/client/game/shardfile/clientAssets';
import { isBuildValidatedOutput, outputBlobUrl, outputDescriptor, resolveOutputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { saves } from '../src/shared/engine/saves/runtime';
import { installManifestShardfile, installShardfileProduct } from '../src/client/game/shardfile/clientSource';
import { prepareBootImports } from '../src/client/app/bootDownloads';
import { sourceManifest } from '../src/client/game/plugin/context';
import { installShards, shards } from '../src/client/game/shard/list';
import { findShard, game, setActiveChunk } from '../src/client/game/shard/registry';
import { Scope } from '../src/shared/engine/app/scope';
import { ResidencyAllocator } from '../src/shared/game/grid/allocator';
import { ProductLeases } from '../src/client/game/grid/productLeases';
import { accountTransportRelease } from '../src/client/game/grid/products';
import type { AdmittedProduct } from '../src/client/game/shardfile/product';
import { leaseClientLibrary } from '../src/client/game/shardfile/clientLibrary';
import { entryReadPlan } from '../src/client/game/grid/entryReadPrefetch';
import { parseEntryReadSet } from '@wildshard/format/entryReads';
import { installCatalogueFixture } from './fixtures/bootSetup';
import { setPageMode } from '../src/shared/game/grid/pageMode';
import { PageResidency } from '../src/client/game/grid/pageResidency';

await installCatalogueFixture();

const encodeCanonicalJson = (value: unknown): Uint8Array => new TextEncoder().encode(canonicalJson(value));
const base = 'https://example.test/shardfiles/loader-fixture/';
const hash = (bytes: Uint8Array): Promise<string> => Promise.resolve(hashImmutableBytes(bytes));
function fixture(blob = false, spawnX = 0, revision = 1, slug = 'loader-fixture', late = false, declaredLate = false, texture?: Uint8Array): { source: Shardfile; index: OutputIndex; wires: Map<string, Uint8Array> } {
  const source = emptyShardfile({ slug, name: 'Loader', author: 'Test', revision, seed: 1 });
  source.spawn.x = spawnX;
  const wires = new Map<string, Uint8Array>();
  if (blob) {
    const bytes = texture ?? new Uint8Array([1, 2, 3]), ref = hashImmutableBytes(bytes);
    const cost = texture === undefined ? {decoded:3,gpu:0,triangles:0,draws:0} : parseKtx2(bytes);
    source.files.push({ hash: ref, kind: texture === undefined ? 'binary' : 'ktx2', compressed: bytes.length, ...cost, dependencies: [], critical: false });
    if (!late) { source.library.push(ref); source.budgets.library = { resident: cost.decoded+cost.gpu, compressed: bytes.length }; }
    if (declaredLate) source.late = [{hash:ref,at:[25,0]}];
    wires.set(texture === undefined ? `blobs/bin/${ref}.bin` : `blobs/ktx2/${ref}.ktx2`, bytes);
  }
  const sections = [...outputSectionPayloads(source)].map(([name, payload]) => {
    const mapping = OUTPUT_SECTIONS.find(row => row.name === name);
    if (mapping === undefined) throw new Error('Missing section mapping');
    const bytes = encodeCanonicalJson(payload), path = `sections/${name}.json`;
    wires.set(path, bytes);
    return { name, path, schema: `wildshard:${name}@1`, hash: hashImmutableBytes(bytes), bytes: bytes.length };
  });
  const index = parseOutputIndex({ format: 'wildshard.shardfile', formatVersion: 2, sdk: '0.2', version: source.version,
    identity: source.identity, build: { sourceHash: hashImmutableBytes(encodeCanonicalJson(source)), validator: 'test' }, requires: source.requires,
    admission: { budgets: source.budgets, serverBudget: source.serverBudget, authorCaps: source.authorCaps, critical: source.critical, library: source.library, ...(source.late === undefined ? {} : {late:source.late}) },
    ...(texture === undefined ? {} : {ktx2Costs:{[hashImmutableBytes(texture)]:ktx2DeviceCosts(texture)}}),
    sections, schemas: [], files: source.files.map(file => ({ ...file, kind: texture === undefined ? 'bin' : 'ktx2', ...(declaredLate ? {name:'late.bin'} : {}), path: texture === undefined ? `blobs/bin/${file.hash}.bin` : `blobs/ktx2/${file.hash}.ktx2` })), runtime: null });
  wires.set('shard.json', encodeCanonicalJson(index));
  return { source, index, wires };
}
function options(wires: ReadonlyMap<string, Uint8Array>, cache?: ProductCache): ProductOptions {
  // Each fixture owns its transport/verifier service. Repeated reads through
  // these options still coalesce; unrelated fixtures cannot lend verified packs.
  return { base, offline: false, firstParty: true, hash: bytes => hash(bytes), ...(cache === undefined ? {} : { cache }), fetch: url => {
    const bytes = wires.get(url.slice(base.length));
    return Promise.resolve(bytes === undefined ? new Response(null, { status: 404 }) : new Response(Uint8Array.from(bytes)));
  } };
}
function cacheStore(): { cache: ProductCache; bytes: Map<string, Uint8Array>; product: () => CachedProduct | null } {
  const bytes = new Map<string, Uint8Array>(); let product: CachedProduct | null = null;
  return { bytes, product: () => product, cache: {
    product: () => Promise.resolve(product), asset: (_base, ref) => Promise.resolve(bytes.get(ref) ?? null),
    putAsset: (_base, ref, wire) => { bytes.set(ref, Uint8Array.from(wire)); return Promise.resolve(true); },
    putProduct: (_base, value) => { product = structuredClone(value); return Promise.resolve(); },
  } };
}

test('a rejected descriptor request uses a checked revisit, never elapsed time', async () => {
  const f = fixture(), store = cacheStore(), opts = options(f.wires, store.cache);
  await admitProduct(await readProductDescriptor(opts), opts);
  let fail = (_error: Error): void => { throw new Error('Missing request'); };
  const transport = new Promise<Response>((_resolve, reject) => { fail = reject; });
  const refreshes: (() => Promise<void>)[] = [];
  const held: ProductOptions = { ...opts, descriptorHash: hashImmutableBytes(encodeCanonicalJson(f.index)),
    revalidateAfterControl: run => { refreshes.push(run); }, fetch: () => transport };
  vi.useFakeTimers();
  try {
    let resolved = false;
    const pending = readProductDescriptor(held).then(value => { resolved = true; return value; });
    await vi.advanceTimersByTimeAsync(180_000); expect(resolved).toBe(false); expect(refreshes).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    fail(new TypeError('Native connection failed'));
    expect(await pending).toStrictEqual(f.source); expect(refreshes).toHaveLength(1);
    held.fetch = opts.fetch;
    const refresh = refreshes[0]; if (refresh === undefined) throw new Error('Missing refresh');
    await refresh(); expect(store.product()?.source).toStrictEqual(f.index);
  } finally { vi.useRealTimers(); }
});

test('a failed request cannot admit an absent, foreign, changed or incomplete visited product', async () => {
  for (const refused of ['absent', 'foreign', 'changed', 'catalogue', 'incomplete'] as const) {
    const f = fixture(), store = cacheStore(), opts = options(f.wires, store.cache);
    if (refused !== 'absent') await admitProduct(await readProductDescriptor(opts), opts);
    if (refused === 'foreign') await store.cache.putProduct(base, { source: f.index, firstParty: false });
    if (refused === 'incomplete') store.bytes.clear();
    const held: ProductOptions = { ...opts, ...(refused === 'changed' ? { descriptorHash: 'f'.repeat(64) } : {}),
      ...(refused === 'catalogue' ? { built: { indexes: new Set<string>(), stale: () => Promise.resolve() } } : {}), fetch: () => Promise.reject(new TypeError('Native connection failed')) };
    vi.useFakeTimers();
    try {
      const expected = expect(readProductDescriptor(held)).rejects.toThrow(refused === 'changed' ? 'descriptor hash mismatch'
        : refused === 'catalogue' ? 'older than the shard' : refused === 'incomplete' ? 'incomplete section cache' : 'Native connection failed');
      await expected;
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  }
});

test('descriptor deadline retains immediate network hash, HTTP and size refusals even on a revisit', async () => {
  const f = fixture(), store = cacheStore(), opts = options(f.wires, store.cache);
  await admitProduct(await readProductDescriptor(opts), opts);
  await expect(readProductDescriptor({ ...opts, descriptorHash: 'f'.repeat(64) })).rejects.toThrow('descriptor hash mismatch');
  await expect(readProductDescriptor({ ...opts, fetch: () => Promise.resolve(new Response(null, { status: 503 })) })).rejects.toThrow('Unavailable');
  await expect(readProductDescriptor({ ...opts, fetch: () => Promise.resolve(new Response('{}', { headers: { 'content-length': '999999999' } })) })).rejects.toThrow('size exceeds cap');
});

test('descriptor deadline does not make a healthy first visit depend on a failed cache read', async () => {
  const f = fixture(), store = cacheStore(), opts = options(f.wires, store.cache);
  store.cache.product = () => { throw new Error('Disk unavailable'); };
  expect(await readProductDescriptor(opts)).toStrictEqual(f.source);
});

test('descriptor deadline retains the declared index filename and refuses crossed or qualified URLs', async () => {
  const f = fixture(), wire = f.wires.get('shard.json');
  if (wire === undefined) throw new Error('Missing index fixture');
  f.wires.delete('shard.json'); f.wires.set('entry.json', wire);
  const opts = options(f.wires), fetcher = opts.fetch, requests: string[] = [];
  opts.fetch = (url, signal) => { requests.push(url); return fetcher(url, signal); };
  expect(await readProductDescriptor(opts, new URL('entry.json', base))).toStrictEqual(f.source);
  expect(requests).toContain(new URL('entry.json', base).href);
  expect(requests).not.toContain(new URL('shard.json', base).href);
  requests.length = 0;
  for (const path of ['../other/entry.json', 'https://other.test/entry.json', 'entry.json?v=1', 'entry.json#part', './']) {
    await expect(readProductDescriptor(opts, new URL(path, base))).rejects.toThrow('unqualified file in its product directory');
  }
  expect(requests).toEqual([]);
});

function installIndexReceipt(index: OutputIndex, path?: string): () => void {
  const values = { __SHARDFILE_VALIDATOR__: 'index-receipt-test', __SHARDFILE_VERDICTS__: [{ revision: 'index-receipt-test', sourceHash: index.build.sourceHash,
    indexHash: hashImmutableBytes(encodeCanonicalJson(index)), ...(path === undefined ? {} : { path }), worst: { playing: 0, loading: 0, accounted: 0, location: [0, 0] } }] };
  const previous = new Map(Object.keys(values).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const));
  for (const [name, value] of Object.entries(values)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  return () => {
    for (const [name, descriptor] of previous) {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
      else Object.defineProperty(globalThis, name, descriptor);
    }
  };
}
function sectionReader(wires: ReadonlyMap<string, Uint8Array>): (path: string) => Promise<Uint8Array> {
  return path => {
    const bytes = wires.get(path); if (bytes === undefined) throw new Error('Missing fixture section');
    return Promise.resolve(new Uint8Array(bytes));
  };
}

test('receipted phone admission defers unused bytes and publishes offline only after their verified storage', async () => {
  const row = fixture(true, 0, 1, 'loader-fixture', true), restore = installIndexReceipt(row.index), store = cacheStore();
  const scope = new Scope('offline-completion'), requests: string[] = [], opts = options(row.wires, store.cache), fetcher = opts.fetch;
  opts.tier = 'phone'; opts.fetch = url => { requests.push(url); return fetcher(url); };
  try {
    const admitted = await admitProduct(row.index, opts), finish = admitted.completeCache;
    if (finish === undefined) throw new Error('Missing deferred offline completion');
    expect(admitted.assets.size).toBe(0); expect(store.product()).toBeNull();
    expect(requests.some(url => url.includes('/blobs/'))).toBe(false);
    await finish(scope);
    expect(store.product()?.source).toStrictEqual(row.index);
    expect(admitted.assets.size).toBe(0); // warming never refills the page's released transport map
    expect(requests.filter(url => url.includes('/blobs/'))).toHaveLength(1);
  } finally { scope.dispose(); restore(); }
});

test('poisoned late cache or a retired owner cannot publish a complete offline product', async () => {
  for (const retired of [false, true]) {
    const row = fixture(true, 0, 1, 'loader-fixture', true), restore = installIndexReceipt(row.index), store = cacheStore();
    const scope = new Scope('offline-refusal'), opts = options(row.wires, store.cache); opts.tier = 'phone';
    try {
      const admitted = await admitProduct(row.index, opts), finish = admitted.completeCache;
      if (finish === undefined) throw new Error('Missing deferred offline completion');
      if (retired) scope.dispose();
      else { const file = row.source.files[0]; if (file === undefined) throw new Error('Missing fixture file'); store.bytes.set(file.hash, new Uint8Array([9, 9, 9])); }
      await expect(finish(scope)).rejects.toThrow(retired ? 'owner retired' : 'hash or size');
      expect(store.product()).toBeNull(); expect(admitted.assets.size).toBe(0);
    } finally { scope.dispose(); restore(); }
  }
});

test('receipt lookup refuses authored accessors without invoking them', async () => {
  const f = fixture(); let reads = 0;
  const input = { ...f.index };
  Object.defineProperty(input, 'build', { enumerable: true, get: () => { reads++; return f.index.build; } });
  await expect(resolveOutputDescriptor(input, { read: sectionReader(f.wires), hash, offline: false, firstParty: true })).rejects.toThrow('bounded plain JSON');
  expect(reads).toBe(0);
});

test('an unchanged entry-read hash cannot prefetch a newly tagged other-device payload', async () => {
  const f = fixture(true), file = f.index.files[0];
  if (file === undefined) throw new Error('Missing device fixture file');
  file.tier = 'desktop';
  const restore = installIndexReceipt(f.index);
  try {
    const source = await resolveOutputDescriptor(f.index, { read: sectionReader(f.wires), hash, offline: false, firstParty: true });
    if (!isBuildValidatedOutput(source)) throw new Error('Missing exact fixture receipt');
    const read = { url: `/shardfiles/${f.index.identity.slug}/${file.path}`, hash: file.hash, bytes: file.compressed };
    const rows = parseEntryReadSet(['phone', 'desktop'].map(tier => ({ region: f.index.identity.slug, tier, at: [0, 0], reads: [read] })));
    expect(entryReadPlan(rows, 'phone', f.index.identity.slug, source)).toEqual([]);
    expect(entryReadPlan(rows, 'desktop', f.index.identity.slug, source)).toEqual([read]);
    expect(source.library).toContain(file.hash); // Scheduling never rewrites admission or actual demand authority.
    expect(source.files).toHaveLength(1);
  } finally { restore(); }
});

test('build receipt skips descriptor grammar and owns the index across pauses', async () => {
  const f = fixture(), restore = installIndexReceipt(f.index);
  const grammar = vi.spyOn(await import('@wildshard/format/outputIndex'), 'parseOutputDescriptorIndex');
  let paused = false;
  try {
    const source = await resolveOutputDescriptor(f.index, { read: sectionReader(f.wires), hash, offline: false, firstParty: true,
      pause: () => { paused = true; f.index.identity.name = 'Changed after intake'; return Promise.resolve(); } });
    expect(paused).toBe(true);
    expect(source).toEqual(f.source);
    expect(isBuildValidatedOutput(source)).toBe(true);
    expect(grammar).not.toHaveBeenCalled();
  } finally { grammar.mockRestore(); restore(); }
});

test('build index proof still refuses changed section bytes', async () => {
  const f = fixture(), restore = installIndexReceipt(f.index);
  const grammar = vi.spyOn(await import('@wildshard/format/outputIndex'), 'parseOutputDescriptorIndex');
  const entry = f.index.sections[0]; if (entry === undefined) throw new Error('Missing fixture section');
  const wire = f.wires.get(entry.path); if (wire === undefined) throw new Error('Missing fixture wire');
  const changed = new Uint8Array(wire), first = changed[0]; if (first === undefined) throw new Error('Empty fixture wire');
  changed[0] = first ^ 1; f.wires.set(entry.path, changed);
  try {
    await expect(resolveOutputDescriptor(f.index, { read: sectionReader(f.wires), hash, offline: false, firstParty: true }))
      .rejects.toThrow(/section hash or size mismatch/u);
    expect(grammar).not.toHaveBeenCalled();
  } finally { grammar.mockRestore(); restore(); }
});

test('a changed index cannot borrow its original build receipt', async () => {
  const f = fixture(), restore = installIndexReceipt(f.index);
  const grammar = vi.spyOn(await import('@wildshard/format/outputIndex'), 'parseOutputDescriptorIndex');
  f.index.identity.name = 'Changed before intake';
  try {
    const source = await resolveOutputDescriptor(f.index, { read: sectionReader(f.wires), hash, offline: false, firstParty: true });
    expect(source).toMatchObject({ identity: { name: 'Changed before intake' } });
    expect(isBuildValidatedOutput(source)).toBe(false);
    expect(grammar).toHaveBeenCalledOnce();
  } finally { grammar.mockRestore(); restore(); }
});

test.each([true, false])('first-party data admission retains Explore=%s without restoring the native loader', async (withExplore) => {
  const { source, wires } = fixture(false, 0, 1, 'template');
  const explore = { art: { world: '/assets/world.webp', models: '/assets/models.webp', sets: '/assets/sets.webp', practice: '/assets/practice.webp' } };
  const legacyLoad = () => Promise.reject(new Error('Native loader must not run'));
  const descriptorName = withExplore ? 'entry.json' : 'shard.json';
  if (withExplore) {
    const wire = wires.get('shard.json');
    if (wire === undefined) throw new Error('Missing fixture descriptor');
    wires.set(descriptorName, wire);
  }
  const manifest = { ...sourceManifest(source), ...(withExplore ? { explore } : {}), load: legacyLoad, shardfile: `${base}${descriptorName}` };
  const previous = shards(), active = game.shard;
  const descriptorDetails: string[] = [];
  try {
    installShards([manifest]);
    const installed = await installManifestShardfile(manifest, {...options(wires), progress: row => {
      if (row.phase === 'descriptor') descriptorDetails.push(row.detail);
    }}, {
      instance: 'template-solo', recipes: new Map(), items: new Map(), catalogue: [],
      voices: () => new Map(), icon: () => { throw new Error('No fixture item'); },
    });
    expect(installed.explore).toBe(withExplore ? explore : undefined);
    expect(game.shard).toBe(installed);
    expect(installed.load).not.toBe(legacyLoad);
    expect(installed.ground).not.toBe(manifest.ground);
    expect(installed.ground.terrain?.heightAt(0, 0)).toBe(0);
    expect(descriptorDetails.length).toBeGreaterThan(0);
    for (const detail of descriptorDetails) expect(detail).toContain(new URL(manifest.shardfile).pathname);
  } finally { installShards(previous); setActiveChunk(active.slug); }
});

// GO7, opus-tplseat: Shard select → the Template shard boots a grid page whose home is `_template`. The page admits that product
// here, then the grid admits the same cell through the installed manifest's descriptor (`gridShardfileProduct`) and hands the home
// claim off at the cell's regional charge (session.ts claims it, T7). This admission lost the descriptor ("not a shardfile shard")
// and claimed the home at the one-shard page's cost ("Home residency differs"): the template card never reached its cell.
test('a grid page\'s data home keeps its descriptor and leaves its home claim to the grid', async () => {
  const { source, wires } = fixture(false, 0, 1, 'template');
  const manifest = { ...sourceManifest(source), slug: '_template', shardfile: `${base}shard.json` };
  const previous = shards(), active = game.shard, residency = new PageResidency();
  try {
    installShards([manifest]);
    setPageMode('grid');
    const installed = await installManifestShardfile(manifest, options(wires), {
      instance: 'template-2', residency, recipes: new Map(), items: new Map(), catalogue: [],
      voices: () => new Map(), icon: () => { throw new Error('No fixture item'); },
    });
    expect(installed.shardfile, 'the installed manifest names its product').toBe(manifest.shardfile);
    expect(findShard('_template')?.shardfile, 'what the grid reads for the template cell').toBe(manifest.shardfile);
    expect(residency.allocator.has('sim:template-2'), 'the home is the grid\'s to claim, at its regional charge').toBe(false);
  } finally { setPageMode('shard'); residency.dispose(); installShards(previous); setActiveChunk(active.slug); }
});

test.each(['manifest', 'external'] as const)('%s admission finishes during kit imports but publishes only after them', async kind => {
  const { source, wires } = fixture(false, 0, 1, 'template');
  const manifest = { ...sourceManifest(source), shardfile: `${base}shard.json` };
  let release = (): void => { throw new Error('Uninitialized kit import'); };
  const imports = prepareBootImports(new Promise<void>(resolve => { release = resolve; }));
  let admitted = (): void => { throw new Error('Uninitialized admission'); };
  const admission = new Promise<void>(resolve => { admitted = resolve; });
  const opts = { ...options(wires), progress: (row: Parameters<NonNullable<ProductOptions['progress']>>[0]) => {
    if (row.phase === 'complete') admitted();
  } };
  const bindings = { instance: 'template-solo', recipes: new Map(), items: new Map(), catalogue: [],
    voices: () => new Map(), icon: () => { throw new Error('No fixture item'); } };
  const previous = shards(), active = game.shard;
  try {
    const installing = kind === 'manifest'
      ? installManifestShardfile(manifest, opts, bindings, imports.ready)
      : installShardfileProduct(source, opts, bindings, imports.ready);
    await admission;
    expect(game.shard).toBe(active);
    expect(shards()).toBe(previous);
    release();
    const installed = await installing;
    expect(game.shard).toBe(installed);
    expect(installed.slug).toBe(manifest.slug);
  } finally { release(); installShards(previous); setActiveChunk(active.slug); }
});

test('a rejected kit barrier leaves admitted data unpublished and retains the original failure', async () => {
  const { source, wires } = fixture(false, 0, 1, 'template');
  const manifest = { ...sourceManifest(source), shardfile: `${base}shard.json` };
  const kit = new Error('kit import failed'), imports = prepareBootImports(Promise.reject(kit));
  const previous = shards(), active = game.shard;
  await expect(installManifestShardfile(manifest, options(wires), {
    instance: 'template-solo', recipes: new Map(), items: new Map(), catalogue: [],
    voices: () => new Map(), icon: () => { throw new Error('No fixture item'); },
  }, imports.ready)).rejects.toBe(kit);
  expect(game.shard).toBe(active);
  expect(shards()).toBe(previous);
});

test.each([true, false])('a real admission refusal drains before cleanup and retains kit-first errors=%s', async fails => {
  const { source, wires } = fixture(false, 0, 1, 'template');
  const manifest = { ...sourceManifest(source), shardfile: `${base}shard.json` };
  let release = (): void => { throw new Error('Uninitialized import'); };
  let failImport = (_error: Error): void => { throw new Error('Uninitialized import'); };
  const imports = prepareBootImports(new Promise<void>((resolve, reject) => { release = resolve; failImport = reject; }));
  let refused = (): void => { throw new Error('Uninitialized refusal'); };
  const refusal = new Promise<void>(resolve => { refused = resolve; });
  const kit = new Error('kit import failed'), admission = new Error('descriptor read failed'), events: string[] = [];
  const previous = shards(), active = game.shard;
  const completed = (async () => {
    try {
      return await installManifestShardfile(manifest, { ...options(wires), fetch: () => Promise.reject(admission) }, {
        instance: 'template-solo', recipes: new Map(), items: new Map(), catalogue: [],
        voices: () => new Map(), icon: () => { throw new Error('No fixture item'); },
      }, imports.ready);
    } catch (failure) { refused(); return await imports.refuse(failure); }
    finally { events.push('residency', 'memory'); }
  })();
  const observed = expect(completed).rejects.toBe(fails ? kit : admission);
  await refusal;
  expect(events).toEqual([]);
  expect(game.shard).toBe(active);
  expect(shards()).toBe(previous);
  if (fails) failImport(kit); else release();
  await observed;
  expect(events).toEqual(['residency', 'memory']);
});

test('v2 sections reconstruct host values and refuse the old monolithic transport', async () => {
  const { source, wires } = fixture(true), opts = options(wires);
  const read = await readProductDescriptor(opts);
  expect(read).toEqual(parseShardfile(source));
  provideHybridDeclaration(read);
  expect(runtimeProduct(parseShardfile(source)).source).toBe(read);
  const file = read.files[0]; if (file === undefined) throw new Error('Missing blob');
  expect(outputBlobUrl(read, file.hash, base)).toBe(`${base}blobs/bin/${file.hash}.bin`);
  expect(await new ClientAssets(read, new Map(), opts).read(file.hash)).toEqual(new Uint8Array([1, 2, 3]));
  expect(() => outputBlobUrl(read, '0'.repeat(64), base)).toThrow('Undeclared');
  const v1 = new Map([['shard.json', encodeCanonicalJson(source)], [file.hash, new Uint8Array([1, 2, 3])]]);
  await expect(readProductDescriptor(options(v1))).rejects.toThrow('format-2');
  expect(() => outputBlobUrl(source, file.hash, base)).toThrow('format-2');
});

test('the complete blob bank is declared before the first section read, except for historical lineage', async () => {
  const { index, wires } = fixture(true);
  const expected = new Map(index.sections.map(file => [file.path, file.bytes]));
  for (const file of index.files) expected.set(file.path, file.compressed);
  for (const lineage of [false, true]) {
    const declared = new Map<string, number>(); let reads = 0;
    await resolveOutputDescriptor(index, {
      offline: false, lineage, hash,
      declare: (path, bytes) => { declared.set(path, bytes); },
      read: (path) => {
        expect(declared).toEqual(lineage ? new Map(index.sections.map(file => [file.path, file.bytes])) : expected);
        reads++;
        const bytes = wires.get(path);
        if (bytes === undefined) throw new Error('Missing section');
        return Promise.resolve(bytes);
      },
    });
    expect(reads).toBe(index.sections.length);
  }
});

test('historical transport never loads current host grammar or grants a model proof', async () => {
  const { index, wires, source } = fixture();
  const grammar = vi.spyOn(await import('@wildshard/format/outputIndex'), 'parseOutputDescriptorIndex');
  // An old visit may name host, asset and cost declarations this build removed.
  const historical = { ...index, admission: { obsolete: true }, runtime: { obsolete: true }, files: [{ obsolete: true }] };
  const read = vi.fn(sectionReader(wires));
  try {
    const previous = await resolveOutputDescriptor(historical, { lineage: true, offline: false, hash, read });
    expect(parseStateLineage(previous)).toEqual({ identity: { slug: source.identity.slug, revision: source.identity.revision }, state: source.state });
    expect(grammar).not.toHaveBeenCalled();
    expect(read.mock.calls.map(([path]) => path)).toEqual(index.sections.map(row => row.path));
    expect(isBuildValidatedOutput(previous)).toBe(false);
  } finally { grammar.mockRestore(); }
});

test.each(['version', 'duplicate', 'escape', 'state', 'hash', 'cap'] as const)('historical %s refusal precedes section reads', async kind => {
  const { index, wires } = fixture(), first = index.sections[0];
  if (first === undefined) throw new Error('Missing section');
  const input = kind === 'version' ? { ...index, formatVersion: 3 }
    : kind === 'duplicate' ? { ...index, sections: [...index.sections, first] }
    : kind === 'escape' ? { ...index, sections: [{ ...first, path: '../escape.json' }, ...index.sections.slice(1)] }
    : kind === 'state' ? { ...index, sections: index.sections.filter(row => row.name !== 'state/state') }
    : kind === 'hash' ? { ...index, sections: [{ ...first, hash: 'bad' }, ...index.sections.slice(1)] }
    : { ...index, sections: [{ ...first, bytes: 2_000_001 }, ...index.sections.slice(1)] };
  const read = vi.fn(sectionReader(wires));
  await expect(resolveOutputDescriptor(input, { lineage: true, offline: false, hash, read })).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
});

test('historical reads retain cache completeness, immutable hashes and strict state semantics', async () => {
  const { index, wires } = fixture(), state = index.sections.find(row => row.name === 'state/state');
  if (state === undefined) throw new Error('Missing state');
  const bank = new Map(index.sections.map(row => [row.hash, wires.get(row.path)])), read = vi.fn(sectionReader(wires));
  const cached = vi.fn((ref: string) => Promise.resolve(ref === state.hash ? null : bank.get(ref) ?? null));
  await expect(resolveOutputDescriptor(index, { lineage: true, offline: true, hash, read, cached })).rejects.toThrow('incomplete section cache');
  expect(cached).toHaveBeenCalledTimes(index.sections.length);
  expect(read).not.toHaveBeenCalled();
  const corrupt = new Map(wires); corrupt.set(state.path, new Uint8Array(state.bytes));
  await expect(resolveOutputDescriptor(index, { lineage: true, offline: false, hash, read: sectionReader(corrupt) })).rejects.toThrow('hash or size mismatch');
  const bad = encodeCanonicalJson({ state: { version: 0 } }), sections = index.sections.map(row => row === state ? { ...row, hash: hashImmutableBytes(bad), bytes: bad.length } : row);
  wires.set(state.path, bad);
  const previous = await resolveOutputDescriptor({ ...index, sections }, { lineage: true, offline: false, hash, read: sectionReader(wires) });
  expect(() => parseStateLineage(previous)).toThrow();
});

test('historical inventory rejects authored getters without invoking them', async () => {
  const { index, wires } = fixture(); let reads = 0;
  Object.defineProperty(index, 'admission', { enumerable: true, get: () => { reads++; return {}; } });
  const read = vi.fn(sectionReader(wires));
  await expect(resolveOutputDescriptor(index, { lineage: true, offline: false, hash, read })).rejects.toThrow('bounded plain JSON');
  expect(reads).toBe(0); expect(read).not.toHaveBeenCalled();
});

test('admission preserves v2 addressing across parser copies and offline section reassembly', async () => {
  const { source, wires, index } = fixture(), store = cacheStore(), opts = options(wires, store.cache);
  const read = await readProductDescriptor(opts), admitted = await admitProduct(read, opts);
  expect(admitted.source).toEqual(source);
  expect(outputDescriptor(admitted.source)?.index).toEqual(index);
  expect(store.product()?.source).toEqual(index);
  const offline = { ...opts, offline: true, fetch: () => Promise.reject(new Error('Offline network')) };
  expect((await admitProduct(null, offline)).source).toEqual(source);
  expect(await readProductDescriptor(offline)).toEqual(source);
  const section = index.sections[0]; if (section === undefined) throw new Error('Missing section');
  store.bytes.delete(section.hash);
  await expect(readProductDescriptor(offline)).rejects.toThrow('incomplete section cache');
});

test('a product stored whole asks for persistent storage once (iPhone downloads I10)', async () => {
  const { wires } = fixture(), store = cacheStore(), opts = options(wires, store.cache);
  const persist = vi.spyOn(saves, 'persist').mockResolvedValue(true);
  try {
    await admitProduct(await readProductDescriptor(opts), opts);
    expect(store.product()).not.toBeNull(); expect(persist).toHaveBeenCalledTimes(1);
    persist.mockClear();
    await admitProduct(await readProductDescriptor(options(wires)), options(wires));
    expect(persist).not.toHaveBeenCalled();
  } finally { persist.mockRestore(); }
});

function packedSectionFixture() {
  const f = fixture(), parts = f.index.sections.map(section => {
    const bytes = f.wires.get(section.path); if (bytes === undefined) throw new Error('Missing section bytes');
    return { hash: section.hash, bytes };
  });
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.bytes.length, 0));
  const entries: { hash: string; offset: number; bytes: number }[] = []; let offset = 0;
  for (const part of parts) { bytes.set(part.bytes, offset); entries.push({ hash: part.hash, offset, bytes: part.bytes.length }); offset += part.bytes.length; }
  const digest = hashImmutableBytes(bytes), path = `blobs/pack/${digest}.pack`;
  const index = parseOutputIndex({ ...f.index, packs: [{ path, hash: digest, bytes: bytes.length, entries }] });
  f.wires.set(path, bytes); f.wires.set('shard.json', encodeCanonicalJson(index));
  return { ...f, index, path, bytes };
}

test('online packed descriptors pass a pending disk recovery after one hint turn', async () => {
  const f = packedSectionFixture(), store = cacheStore(), reads: string[] = [];
  let release = (): void => { throw new Error('Missing cache gate'); };
  const pending = new Promise<Uint8Array | null>(resolve => { release = () => { resolve(null); }; });
  const plain = options(f.wires, { ...store.cache, asset: () => pending });
  try {
    const source = await readProductDescriptor({ ...plain, cacheHintTurn: () => Promise.resolve(),
      fetch: url => { reads.push(url.slice(base.length)); return plain.fetch(url); } });
    expect(source).toEqual(parseShardfile(f.source));
    expect(reads).toEqual(['shard.json', f.path]);
  } finally { release(); }
});

test('ready descriptor cache bytes cancel the hint turn without reading a pack', async () => {
  const f = packedSectionFixture(), store = cacheStore(), reads: string[] = []; let cancelled = 0;
  const plain = options(f.wires, { ...store.cache, asset: (_base, digest) => {
    const section = f.index.sections.find(row => row.hash === digest);
    return Promise.resolve(section === undefined ? null : f.wires.get(section.path) ?? null);
  } });
  await expect(readProductDescriptor({ ...plain, cacheHintTurn: signal => new Promise<void>(resolve => {
    signal.addEventListener('abort', () => { cancelled++; resolve(); }, { once: true });
  }), fetch: url => { reads.push(url.slice(base.length)); return plain.fetch(url); } })).resolves.toEqual(parseShardfile(f.source));
  expect(reads).toEqual(['shard.json']); expect(cancelled).toBe(f.index.sections.length);
});

test.each(['offline', 'unpacked'] as const)('descriptor %s reads keep the original durable cache barrier', async mode => {
  const f = packedSectionFixture(); let finish = (): void => { throw new Error('Missing cache gate'); }, completed = false;
  const gate = new Promise<void>(resolve => { finish = resolve; }), turn = vi.fn(() => Promise.resolve()), read = vi.fn(() => Promise.reject(new Error('Unexpected transport')));
  const pending = resolveOutputDescriptor(mode === 'unpacked' ? { ...f.index, packs: [] } : f.index, {
    offline: mode === 'offline', hash, read, pack: read, cacheHintTurn: turn,
    cached: async (_digest, path) => { await gate; return f.wires.get(path) ?? null; },
  }).then(value => { completed = true; return value; });
  await Promise.resolve(); await Promise.resolve();
  expect(completed).toBe(false); expect(turn).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  finish(); await expect(pending).resolves.toMatchObject({ identity: f.source.identity });
});

test('a slow descriptor cache never excuses corrupt fallback pack bytes', async () => {
  const f = packedSectionFixture(), store = cacheStore(), corrupt = Uint8Array.from(f.bytes); corrupt[0] = 255;
  f.wires.set(f.path, corrupt);
  const plain = options(f.wires, { ...store.cache, asset: () => new Promise<Uint8Array | null>(() => { /* Cache stays pending while the pack refuses. */ }) });
  const reads: string[] = [];
  await expect(readProductDescriptor({ ...plain, fetch: url => { reads.push(url.slice(base.length)); return plain.fetch(url); },
    cacheHintTurn: () => Promise.resolve() })).rejects.toThrow('pack hash or size mismatch');
  expect(reads).toEqual(['shard.json', f.path]);
});

test('packed sections and files come from one read of each pack (iPhone downloads I5)', async () => {
  const { wires, index } = fixture(true), packs: NonNullable<OutputIndex['packs']> = [];
  for (const members of [[...index.sections, ...index.schemas].map(entry => ({ path: entry.path, hash: entry.hash })), index.files.map(file => ({ path: file.path, hash: file.hash }))]) {
    const parts = members.map(member => { const part = wires.get(member.path); if (part === undefined) throw new Error('Missing fixture member'); return { hash: member.hash, part }; });
    const bytes = new Uint8Array(parts.reduce((total, row) => total + row.part.length, 0)), entries: { hash: string; offset: number; bytes: number }[] = [];
    let offset = 0;
    for (const row of parts) { bytes.set(row.part, offset); entries.push({ hash: row.hash, offset, bytes: row.part.length }); offset += row.part.length; }
    const packHash = hashImmutableBytes(bytes), path = `blobs/pack/${packHash}.pack`;
    wires.set(path, bytes); packs.push({ path, hash: packHash, bytes: bytes.length, entries });
  }
  wires.set('shard.json', encodeCanonicalJson(parseOutputIndex({ ...index, packs })));
  const reads: string[] = [], plain = options(wires), opts: ProductOptions = { ...plain, fetch: url => { reads.push(url.slice(base.length)); return plain.fetch(url); } };
  const admitted = await admitProduct(await readProductDescriptor(opts), opts), file = index.files[0];
  if (file === undefined) throw new Error('Missing fixture blob');
  expect(admitted.assets.get(file.hash)).toEqual(wires.get(file.path));
  expect(reads.filter(path => path.startsWith('blobs/pack/')).sort()).toEqual(packs.map(pack => pack.path).sort());
  expect(reads.filter(path => path.startsWith('sections/') || path.startsWith('blobs/bin/'))).toEqual([]);
});

async function demandPackFixture(corruptMember = false) {
  const {wires,index,source:original}=fixture(true),first=index.files[0];
  if(first===undefined)throw new Error('Missing first demand member');
  const secondBytes=new Uint8Array([4,5,6]),secondHash=hashImmutableBytes(secondBytes);
  const second={...first,hash:secondHash,path:`blobs/bin/${secondHash}.bin`};
  index.files.push(second);wires.set(second.path,secondBytes);
  const wire=new Uint8Array([corruptMember?9:1,2,3,4,5,6]),packHash=hashImmutableBytes(wire),path=`blobs/pack/${packHash}.pack`;
  const packed=parseOutputIndex({...index,admission:{...index.admission,library:[...original.library,secondHash],
    budgets:{...original.budgets,library:{resident:6,compressed:6}}},packs:[{path,hash:packHash,bytes:6,entries:[
    {hash:first.hash,offset:0,bytes:3},{hash:secondHash,offset:3,bytes:3}]}]});
  wires.set(path,wire);wires.set('shard.json',encodeCanonicalJson(packed));
  const source=await readProductDescriptor(options(wires));
  return {source,wires,first,second,path,wire};
}

test('concurrent native demand reads share one verified pack and retain no settled member backing',async()=>{
  const f=await demandPackFixture(),plain=options(f.wires),reads:string[]=[];
  const assets=new ClientAssets(f.source,new Map(),{...plain,fetch:url=>{reads.push(url.slice(base.length));return plain.fetch(url);}});
  const [first,second]=await Promise.all([assets.read(f.first.hash),assets.read(f.second.hash)]);
  expect(reads).toEqual([f.path]);expect(first).toEqual(new Uint8Array([1,2,3]));expect(second).toEqual(new Uint8Array([4,5,6]));
  expect(first.buffer).not.toBe(second.buffer);first[0]=99;
  expect(assets.retained.size).toBe(0);
  expect(await assets.read(f.first.hash)).toEqual(new Uint8Array([1,2,3]));
  expect(reads).toEqual([f.path]); // QF17.B1: the immutable product owns its verified whole pack.
});

test('native demand packs refuse corruption for every borrower and release the failed read for repair',async()=>{
  const f=await demandPackFixture(),plain=options(f.wires);let corrupt=true,reads=0;
  const assets=new ClientAssets(f.source,new Map(),{...plain,fetch:url=>{
    reads++;if(corrupt){const damaged=f.wire.slice();damaged[0]=99;return Promise.resolve(new Response(damaged));}
    return plain.fetch(url);
  }});
  const results=await Promise.allSettled([assets.read(f.first.hash),assets.read(f.second.hash)]);
  expect(results.map(result=>result.status)).toEqual(['rejected','rejected']);expect(reads).toBe(1);
  for(const result of results)if(result.status==='rejected')expect(String(result.reason)).toContain('Shardfile pack hash or size mismatch');
  corrupt=false;expect(await Promise.all([assets.read(f.first.hash),assets.read(f.second.hash)])).toEqual([new Uint8Array([1,2,3]),new Uint8Array([4,5,6])]);expect(reads).toBe(2);
});

test('native offline demand never fetches a pack or hides a missing member behind another cached member',async()=>{
  const f=await demandPackFixture(),fetch=vi.fn(()=>Promise.reject(new Error('No offline network')));
  const assets=new ClientAssets(f.source,new Map(),{...options(f.wires),offline:true,fetch,cache:{
    ...cacheStore().cache,verifiedAsset:ref=>Promise.resolve(ref===f.first.hash?new Uint8Array([1,2,3]):null),
  }});
  expect(await assets.read(f.first.hash)).toEqual(new Uint8Array([1,2,3]));
  await expect(assets.read(f.second.hash)).rejects.toThrow('Missing cached resident tile');expect(fetch).not.toHaveBeenCalled();
});

test('a valid native pack hash never substitutes for its demanded member hash',async()=>{
  const f=await demandPackFixture(true),assets=new ClientAssets(f.source,new Map(),options(f.wires));
  const [first,second]=await Promise.allSettled([assets.read(f.first.hash),assets.read(f.second.hash)]);
  expect(first?.status).toBe('rejected');if(first?.status==='rejected')expect(String(first.reason)).toContain('Resident tile hash or size mismatch');
  expect(second).toEqual({status:'fulfilled',value:new Uint8Array([4,5,6])});
});

test('a private build-verified admission does not reread its matching historical sections', async () => {
  const old = fixture(), store = cacheStore(), initial = options(old.wires, store.cache);
  const restore = installIndexReceipt(old.index);
  try {
    await admitProduct(old.index, initial);
    const asset = vi.spyOn(store.cache, 'asset');
    const present = vi.fn(() => Promise.resolve(true));
    await admitProduct(old.index, { ...initial, cache: { ...store.cache, verifiedPresent: present } });
    expect(asset).toHaveBeenCalledTimes(old.index.sections.length);
    expect(present).toHaveBeenCalled(); // Durable publication is still checked.
    asset.mockRestore();
  } finally { restore(); }
});

test('an evicted section of an older visit refetches online and replaces the offline record', async () => {
  const old = fixture(), current = fixture(false, 4), store = cacheStore();
  const oldOptions = options(old.wires, store.cache);
  await admitProduct(await readProductDescriptor(oldOptions), oldOptions);
  const section = old.index.sections.find(value => value.name === 'world/spawn');
  if (section === undefined) throw new Error('Missing spawn section');
  store.bytes.delete(section.hash);
  const offline = { ...oldOptions, offline: true, fetch: () => Promise.reject(new Error('Offline network')) };
  await expect(readProductDescriptor(offline)).rejects.toThrow('needs a connection');
  await expect(admitProduct(null, offline)).rejects.toThrow('needs a connection');
  expect(store.product()?.source).toEqual(old.index); // No partial publication.

  const online = options(current.wires, store.cache), fetch = online.fetch, requests: string[] = [];
  online.fetch = url => { requests.push(url); return fetch(url); };
  const admitted = await admitProduct(await readProductDescriptor(online), online);
  expect(requests).toContain(`${base}shard.json`);
  expect(requests).toContain(`${base}${section.path}`);
  expect(admitted.source).toEqual(current.source);
  expect(store.product()?.source).toEqual(current.index);
  expect(await readProductDescriptor(offline)).toEqual(current.source);
  expect((await admitProduct(null, offline)).source).toEqual(current.source);
});

test('an offline descriptor resolves every original section without a network read', async () => {
  const {source, wires} = fixture(), store = cacheStore(), opts = options(wires, store.cache);
  await admitProduct(await readProductDescriptor(opts), opts);
  const fetch = vi.fn(() => Promise.reject(new Error('Offline network')));
  expect(await readProductDescriptor({...opts, offline: true, fetch})).toEqual(source);
  expect(fetch).not.toHaveBeenCalled();
});

test('a complete older visit still enforces saved-state compatibility', async () => {
  const visited = fixture(false, 0, 2), older = fixture(), store = cacheStore();
  const savedOptions = options(visited.wires, store.cache);
  await admitProduct(await readProductDescriptor(savedOptions), savedOptions);
  const downgrade = options(older.wires, store.cache);
  await expect(admitProduct(await readProductDescriptor(downgrade), downgrade)).rejects.toThrow('revisions cannot move backwards');
  expect(store.product()?.source).toEqual(visited.index);
});

// G531 retired the manifest's `entries.public`: a phone that visited before it holds sections this build's strict schemas
// refuse. The visit is compared by identity and state only, so the shard still loads and the record is replaced.
test('an older visit this build no longer parses is compared by its state lineage only', async () => {
  const stale = (revision: number): { visited: CachedProduct; bytes: Map<string, Uint8Array> } => {
    const old = fixture(false, 0, revision), section = old.index.sections.find(value => value.name === 'world/spawn');
    const wire = section === undefined ? undefined : old.wires.get(section.path);
    if (section === undefined || wire === undefined) throw new Error('Missing spawn section');
    const payload: unknown = JSON.parse(new TextDecoder().decode(wire));
    if (typeof payload !== 'object' || payload === null) throw new Error('Spawn section is not an object');
    const bytes = encodeCanonicalJson({ ...payload, public: 'legacy' }), ref = hashImmutableBytes(bytes);
    const sections = old.index.sections.map(value => value === section ? { ...value, hash: ref, bytes: bytes.length } : value);
    return { visited: { source: { ...old.index, sections }, firstParty: true },
      bytes: new Map([...old.index.sections.flatMap(value => { const b = old.wires.get(value.path); return b === undefined ? [] : [[value.hash, b] as const]; }), [ref, bytes]]) };
  };
  const seed = (store: ReturnType<typeof cacheStore>, revision: number): void => {
    const { visited, bytes } = stale(revision);
    for (const [ref, wire] of bytes) store.bytes.set(ref, wire);
    void store.cache.putProduct(base, visited);
  };
  const current = fixture(false, 4, 2), store = cacheStore(), online = options(current.wires, store.cache);
  seed(store, 1);
  await expect(readProductDescriptor({ ...online, offline: true })).rejects.toThrow('undeclared field');
  expect((await admitProduct(await readProductDescriptor(online), online)).source).toEqual(current.source);
  expect(store.product()?.source).toEqual(current.index);
  const downgrade = cacheStore(), older = options(fixture().wires, downgrade.cache);
  seed(downgrade, 3);
  await expect(admitProduct(await readProductDescriptor(older), older)).rejects.toThrow('revisions cannot move backwards');
});

test('index, section integrity and path/version refusals happen before any host or blob read', async () => {
  const { wires, index } = fixture(); let fetched = 0;
  const opts = options(wires), fetch = opts.fetch;
  opts.fetch = url => { fetched++; return fetch(url); };
  await expect(readProductDescriptor({ ...opts, descriptorHash: '0'.repeat(64) })).rejects.toThrow('descriptor hash');
  expect(fetched).toBe(1);
  await expect(readProductDescriptor({ ...opts, descriptorHash: await hash(encodeCanonicalJson(index)) })).resolves.toBeDefined();
  wires.set('shard.json', encodeCanonicalJson({ ...index, formatVersion: 3 }));
  await expect(readProductDescriptor(opts)).rejects.toThrow();
  const first = index.sections[0]; if (first === undefined) throw new Error('Missing section');
  wires.set('shard.json', encodeCanonicalJson({ ...index, sections: [{ ...first, path: '../escape.json' }, ...index.sections.slice(1)] }));
  await expect(readProductDescriptor(opts)).rejects.toThrow();
  wires.set('shard.json', encodeCanonicalJson(index));
  wires.set(first.path, new Uint8Array(first.bytes).fill(32));
  await expect(readProductDescriptor(opts)).rejects.toThrow('section hash or size');
  wires.set(first.path, new Uint8Array(first.bytes + 1));
  await expect(readProductDescriptor(opts)).rejects.toThrow('wire size');
});

test('every section request starts before a slow first response completes', async () => {
  const { index, wires } = fixture(), started: string[] = [];
  const gate: { release?: () => void; started?: () => void } = {};
  const wait = new Promise<void>(resolve => { gate.release = resolve; });
  const firstStarted = new Promise<void>(resolve => { gate.started = resolve; });
  const pending = resolveOutputDescriptor(index, { offline: false, hash, read: async path => {
    started.push(path); gate.started?.(); await wait;
    const bytes = wires.get(path); if (bytes === undefined) throw new Error('Missing section');
    return bytes;
  } });
  try { await firstStarted; expect(started).toHaveLength(index.sections.length); }
  finally { gate.release?.(); }
  await expect(pending).resolves.toBeDefined();
});

test.each(['network', 'cache', 'quota', 'packed-cache'] as const)('verified %s sections avoid page hashing and duplicate writes', async mode => {
  const f = mode === 'packed-cache' ? packedSectionFixture() : fixture(), store = cacheStore(), pageHash = vi.fn(hash), fetch = vi.fn(options(f.wires).fetch);
  const checked = vi.fn(async (url: string, expected: string, maximum: number) => {
    const wire = f.wires.get(url.slice(base.length));
    if (wire === undefined) throw new Error('Missing verified section');
    expect(wire.length).toBe(maximum); expect(hashImmutableBytes(wire)).toBe(expected);
    await Promise.resolve();
    if (mode !== 'quota') store.bytes.set(expected, new Uint8Array(wire));
    return { bytes: new Uint8Array(wire), cached: false, stored: mode !== 'quota' };
  });
  if (mode === 'cache' || mode === 'packed-cache') for (const section of f.index.sections) {
    const wire = f.wires.get(section.path); if (wire === undefined) throw new Error('Missing cache section');
    store.bytes.set(section.hash, wire);
  }
  const raw = vi.fn(store.cache.asset), put = vi.fn(store.cache.putAsset);
  const opts: ProductOptions = { ...options(f.wires), hash: pageHash, fetch, transport: checked,
    cache: { ...store.cache, asset: raw, putAsset: put,
      verifiedAsset: address => Promise.resolve(store.bytes.get(address) ?? null) } };
  const source = await readProductDescriptor(opts);
  expect(source).toEqual(f.source);
  const sectionHashes = new Set(f.index.sections.map(section => section.hash));
  expect(pageHash.mock.calls.filter(([wire]) => sectionHashes.has(hashImmutableBytes(wire)))).toHaveLength(0);
  expect(fetch.mock.calls.map(([url]) => url.slice(base.length))).toEqual(['shard.json']);
  expect(checked).toHaveBeenCalledTimes(mode === 'cache' || mode === 'packed-cache' ? 0 : f.index.sections.length);
  expect(raw).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
  expect(outputDescriptor(source)?.cached).toBe(mode !== 'quota');
  await admitProduct(source, opts);
  expect(store.product() === null).toBe(mode === 'quota');
});

test('verified section transport retains size refusals, failure and ordinary hash fallback', async () => {
  const f = fixture(), opts = options(f.wires);
  await expect(readProductDescriptor({ ...opts, transport: () => Promise.resolve({ bytes: new Uint8Array(), cached: false, stored: true }) }))
    .rejects.toThrow('section hash or size mismatch');
  await expect(readProductDescriptor({ ...opts, transport: () => Promise.reject(new Error('Worker hash mismatch')) }))
    .rejects.toThrow('Worker hash mismatch');
  const first = f.index.sections[0]; if (first === undefined) throw new Error('Missing section');
  f.wires.set(first.path, new Uint8Array(first.bytes));
  await expect(readProductDescriptor({ ...opts, transport: () => Promise.resolve(null) })).rejects.toThrow('section hash or size mismatch');
});

test('verified packed cache still refuses a wrong-sized section', async () => {
  const f = packedSectionFixture(), store = cacheStore();
  await expect(readProductDescriptor({ ...options(f.wires), cache: { ...store.cache,
    verifiedAsset: () => Promise.resolve(new Uint8Array()),
  } })).rejects.toThrow('section hash or size mismatch');
});

test('a verified-cache miss retains whole-pack transport and member verification', async () => {
  const f = packedSectionFixture(), store = cacheStore(), plain = options(f.wires), fetch = vi.fn(plain.fetch);
  const transport = vi.fn(() => Promise.reject(new Error('Packed cache miss must not fetch one member')));
  const pageHash = vi.fn(hash);
  const result = await readProductDescriptor({ ...plain, fetch, hash: pageHash, transport,
    cache: { ...store.cache, verifiedAsset: () => Promise.resolve(null) } });
  expect(result).toEqual(f.source);
  expect(fetch.mock.calls.map(([url]) => url.slice(base.length))).toEqual(['shard.json', f.path]);
  expect(transport).not.toHaveBeenCalled();
  const sectionHashes = new Set(f.index.sections.map(section => section.hash));
  expect(pageHash.mock.calls.filter(([wire]) => sectionHashes.has(hashImmutableBytes(wire)))).toHaveLength(f.index.sections.length);
});

test('cold sections build before disk writes while offline publication waits for durability', async () => {
  const f = fixture(), store = cacheStore();
  let release = (): void => { throw new Error('Missing cache write gate'); };
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const cache: ProductCache = { ...store.cache, putAssetBackground: async (productBase, address, bytes) => {
    const copy = Uint8Array.from(bytes); await blocked; return await store.cache.putAsset(productBase, address, copy) !== false;
  } };
  const opts = options(f.wires, cache);
  try {
    const source = await readProductDescriptor(opts);
    expect(source).toEqual(f.source);
    expect(outputDescriptor(source)?.cached).toBe(false);
    expect(store.product()).toBeNull(); expect(store.bytes.size).toBe(0);
    const admitted = admitProduct(source, opts);
    await new Promise<void>(resolve => { setTimeout(resolve, 0); });
    expect(store.product()).toBeNull();
    release(); await admitted;
    expect(outputDescriptor(source)?.cached).toBe(true);
    expect(store.product()?.source).toEqual(f.index);
    expect(await readProductDescriptor({ ...opts, offline: true })).toEqual(f.source);
  } finally { release(); }
});

test('a refused background section write cannot advertise a complete offline product', async () => {
  const f = fixture(), store = cacheStore(), opts = options(f.wires, { ...store.cache, putAssetBackground: () => Promise.resolve(false) });
  const source = await readProductDescriptor(opts);
  expect(source).toEqual(f.source);
  expect(await outputDescriptor(source)?.cacheStored).toBe(false);
  expect(outputDescriptor(source)?.cached).toBe(false);
  await admitProduct(source, opts);
  expect(store.product()).toBeNull();
  await expect(readProductDescriptor({ ...opts, offline: true })).rejects.toThrow('not been visited offline');
});

test('custom sections and their schema inventory refuse before reads or cache adoption', async () => {
  const {index}=fixture();let reads=0,pauses=0;
  const measured={path:'schemas/custom/probe.schema.json',hash:'0'.repeat(64),bytes:2};
  const reader={offline:false,hash,pause:()=>{pauses++;return Promise.resolve();},read:()=>{reads++;return Promise.reject(new Error('Unexpected read'));}};
  for(const input of [
    {...index,sections:[...index.sections,{name:'custom/probe',path:'sections/custom/probe.json',schema:measured.path,hash:measured.hash,bytes:2}]},
    {...index,schemas:[measured]},
  ]) {
    await expect(resolveOutputDescriptor(input,reader)).rejects.toThrow();
    await expect(resolveOutputDescriptor(input,{...reader,firstParty:true})).rejects.toThrow();
    await expect(resolveOutputDescriptor(input,{...reader,offline:true})).rejects.toThrow();
  }
  expect(reads).toBe(0);expect(pauses).toBe(0);
});

test('concurrent platform reads paint before their consumers resume', async () => {
  const {index,wires}=fixture();let blocked=true,completed=0,pauses=0;
  const release:(()=>void)[]=[];
  const pause=():Promise<void>=>{pauses++;return blocked?new Promise(resolve=>{release.push(resolve);}):Promise.resolve();};
  const read=()=>resolveOutputDescriptor(index,{offline:false,firstParty:true,hash,pause,read:file=>{
    const bytes=wires.get(file);if(bytes===undefined)throw new Error('Missing section');return Promise.resolve(bytes);
  }});
  const products=[read(),read()].map(async product=>{const result=await product;completed++;return result;});
  try {
    await new Promise<void>(resolve=>{setTimeout(resolve,0);});
    expect(pauses).toBeGreaterThan(0);expect(completed).toBe(0);
  } finally {blocked=false;for(const done of release)done();await Promise.all(products);}
  expect(completed).toBe(2);
});

test('descriptor envelope detection refuses getters before reading format or starting reads', async () => {
  let calls = 0;
  const input = Object.defineProperty({}, 'format', { enumerable: true, get() { calls++; return 'wildshard.shardfile'; } });
  await expect(resolveOutputDescriptor(input, { offline: false, hash, read: () => { calls++; throw new Error('Unexpected read'); } })).rejects.toThrow('bounded plain JSON');
  expect(calls).toBe(0);
});

test('descriptor index admission retains every inventory refusal before any section read', async () => {
  const { index } = fixture(); let reads = 0;
  const reader = { offline: false, hash, read: () => { reads++; throw new Error('Unexpected read'); } };
  const first = index.sections[0]; if (first === undefined) throw new Error('Missing section');
  for (const input of [
    { ...index, formatVersion: 3 },
    { ...index, sections: [...index.sections, first] },
    { ...index, sections: [{ ...first, path: '../escape.json' }] },
    { ...index, schemas: [{ path: 'schemas/orphan.json', hash: first.hash, bytes: 2 }] },
  ]) {
    expect(() => parseOutputIndex(input)).toThrow();
    await expect(resolveOutputDescriptor(input, reader)).rejects.toThrow();
  }
  expect(reads).toBe(0);
  const legacy = { legacy: [1, 'text', null, false] };
  expect(await resolveOutputDescriptor(legacy, reader)).toBe(legacy);
});

test('an off-page transport supplies verified stored blobs without a page read or second write', async () => {
  const { wires, index } = fixture(true), store = cacheStore(), file = index.files[0];
  if (file === undefined) throw new Error('Missing blob');
  const writes: string[] = [], pageReads: string[] = [];
  const cache: ProductCache = { ...store.cache, putAsset: (productBase, ref, wire) => { writes.push(ref); return store.cache.putAsset(productBase, ref, wire); } };
  const page = options(wires, cache);
  const opts: ProductOptions = { ...page, fetch: url => { pageReads.push(url); return page.fetch(url); },
    transport: (url, address, bytes) => {
      const wire = wires.get(url.slice(base.length));
      if (wire === undefined || wire.length !== bytes) throw new Error('Unexpected transport read');
      store.bytes.set(address, Uint8Array.from(wire)); // the worker stored it
      return Promise.resolve({ bytes: Uint8Array.from(wire), cached: false, stored: true });
    } };
  const admitted = await admitProduct(await readProductDescriptor(opts), opts);
  expect(admitted.assets.get(file.hash)).toEqual(new Uint8Array([1, 2, 3]));
  expect(pageReads.some(url => url.endsWith(file.path))).toBe(false);
  expect(writes).not.toContain(file.hash);
  // No live worker: the page reads, hashes and writes it as before.
  const fallback: ProductOptions = { ...opts, transport: () => Promise.resolve(null) }, cold = cacheStore();
  const again = await admitProduct(await readProductDescriptor(fallback), { ...fallback, cache: cold.cache });
  expect(again.assets.get(file.hash)).toEqual(new Uint8Array([1, 2, 3]));
  expect(cold.bytes.get(file.hash)).toEqual(new Uint8Array([1, 2, 3]));
  expect(pageReads.some(url => url.endsWith(file.path))).toBe(true);
});


test('exact receipted library costs reserve all bytes without reading unused bodies', async () => {
  const row = fixture(true), restore = installIndexReceipt(row.index), store = cacheStore(), opts = options(row.wires, store.cache);
  const scope = new Scope('receipt-costs'), allocator = new ResidencyAllocator();
  try {
    const source = await readProductDescriptor(opts), read = vi.fn(() => Promise.reject(new Error('Cost-only body read')));
    expect(isBuildValidatedOutput(source)).toBe(true);
    // A host may project rows, but only exact original file objects inherit its build proof.
    await leaseClientLibrary({ ...source }, new Map(), { allocator, scope, owner: 'home', read, validatedSource: source });
    expect(read).not.toHaveBeenCalled(); expect(allocator.cost().input.libraries).toBe(3);
    const ref = source.files[0]?.hash; if (ref === undefined) throw new Error('Missing fixture library');
    const assets = new ClientAssets(source, new Map(), opts);
    await expect(assets.read(ref)).resolves.toEqual(new Uint8Array([1, 2, 3]));
  } finally { scope.dispose(); restore(); }
  expect(allocator.entries()).toHaveLength(0);
});

test('a replaced cost row cannot borrow an original receipt to skip its byte reader', async () => {
  const row = fixture(true), restore = installIndexReceipt(row.index), store = cacheStore();
  const scope = new Scope('receipt-cost-refusal'), allocator = new ResidencyAllocator();
  try {
    const source = await readProductDescriptor(options(row.wires, store.cache));
    const projected = { ...source, files: source.files.map(file => ({ ...file, decoded: file.decoded + 1 })) };
    const read = vi.fn(() => Promise.reject(new Error('Unproven cost row')));
    await expect(leaseClientLibrary(projected, new Map(), { allocator, scope, owner: 'home', read, validatedSource: source })).rejects.toThrow('Unproven cost row');
    expect(read).toHaveBeenCalled(); expect(allocator.entries()).toHaveLength(0);
  } finally { scope.dispose(); restore(); }
});


test('declared late library round-trips into phone admission and native after-control warming', async () => {
  const row = fixture(true, 0, 1, 'loader-fixture', false, true), restore = installIndexReceipt(row.index), store = cacheStore();
  const scope = new Scope('late-native'), opts = options(row.wires, store.cache), original = opts.fetch, reads: string[] = [];
  opts.tier = 'phone'; opts.fetch = url => { reads.push(url); return original(url); };
  try {
    const product = await loadShardProduct('loader-fixture', opts, scope);
    expect(product.shardfile.late).toStrictEqual(row.source.late);
    const admitted = await admitProduct(row.index, opts);
    expect(admitted.assets.size).toBe(0); expect(reads.some(url => url.includes('/blobs/'))).toBe(false);
    expect(store.product()).toBeNull();
    await product.file('late.bin'); // actual demand can precede the optional warm queue
    await completeManifestCache(sourceManifest(product.shardfile), scope, product);
    expect(reads.filter(url => url.includes('/blobs/'))).toHaveLength(1);
    expect(store.product()?.source).toStrictEqual(row.index);
  } finally { scope.dispose(); restore(); }
});

test('an unreceipted late hint never skips byte validation or admits an undeclared root', async () => {
  const row = fixture(true, 0, 1, 'loader-fixture', false, true), opts = options(row.wires), reads: string[] = [], original = opts.fetch;
  opts.tier = 'phone'; opts.fetch = url => { reads.push(url); return original(url); };
  const admitted = await admitProduct(row.index, opts);
  expect(admitted.assets.size).toBe(1); expect(reads.filter(url => url.includes('/blobs/'))).toHaveLength(1);
  expect(() => parseOutputIndex({...row.index,admission:{...row.index.admission,late:[{hash:'f'.repeat(64)}]}})).toThrow('declared library root');
});


test('late scheduling hints do not create synchronous transport ownership', () => {
  const row = fixture(true,0,1,'loader-fixture',false,true), file = row.source.files[0];
  if (file === undefined) throw new Error('Missing scheduled fixture file');
  expect(runtimeOnlyProductFiles(row.source)).toEqual([file.hash]);
  row.source.look.grade.lut = file.hash;
  expect(runtimeOnlyProductFiles(row.source)).toEqual([]);
});


test('receipted KTX2 device costs preserve the exact claim without fetching a body for costing', async () => {
  const bytes = Uint8Array.from(readFileSync('test/fixtures/shard-assets/pixel.ktx2'));
  for (const support of [{astc:false,bc7:false},{astc:true,bc7:false},{astc:false,bc7:true}]) {
    const row = fixture(true,0,1,'loader-fixture',false,false,bytes), restore = installIndexReceipt(row.index), scope = new Scope('device-costs'), allocator = new ResidencyAllocator();
    try {
      const source = await readProductDescriptor(options(row.wires)), read = vi.fn(() => Promise.reject(new Error('Cost-only KTX2 transfer')));
      await leaseClientLibrary({...source},new Map(),{validatedSource:source,scope,allocator,owner:'home',textures:support,read});
      expect(read).not.toHaveBeenCalled();
      expect(allocator.cost().input.libraries).toBe(parseKtx2(bytes,support).gpu);
      expect(ktx2DeviceGpu(ktx2DeviceCosts(bytes),support)).toBe(parseKtx2(bytes,support).gpu);
    } finally {scope.dispose();restore();}
  }
});

test('old receipted KTX2 products still parse the body when device metadata is absent', async () => {
  const bytes = Uint8Array.from(readFileSync('test/fixtures/shard-assets/pixel.ktx2')), row = fixture(true,0,1,'loader-fixture',false,false,bytes);
  delete row.index.ktx2Costs;row.wires.set('shard.json',encodeCanonicalJson(row.index));
  const restore = installIndexReceipt(row.index), scope = new Scope('old-device-costs'), allocator = new ResidencyAllocator();
  try {
    const source = await readProductDescriptor(options(row.wires)), read = vi.fn(() => Promise.resolve(bytes));
    await leaseClientLibrary(source,new Map(),{validatedSource:source,scope,allocator,owner:'home',read});
    expect(read).toHaveBeenCalledTimes(1);expect(allocator.cost().input.libraries).toBe(parseKtx2(bytes).gpu);
  } finally {scope.dispose();restore();}
});


test('device footprints preserve padded tiny mips even above RGBA size', () => {
  expect(ktx2DeviceGpu({rgba:4,astc:16,bc7:16},{astc:true,bc7:false})).toBe(16);
  expect(ktx2DeviceGpu({rgba:4,astc:4,bc7:16},{astc:true,bc7:true})).toBe(16);
  expect(ktx2DeviceGpu({rgba:4,astc:16,bc7:16})).toBe(4);
});


test('late KTX2 cost projection uses exact receipt facts without admitting its body', async () => {
  const bytes = Uint8Array.from(readFileSync('test/fixtures/shard-assets/pixel.ktx2'));
  const row = fixture(true,0,1,'loader-fixture',false,true,bytes), restore = installIndexReceipt(row.index);
  try {
    const source = await readProductDescriptor(options(row.wires));
    for (const support of [{astc:true,bc7:false},{astc:false,bc7:true}]) {
      const projected = {...source};
      const actual = await deviceLibraryCostPaced(projected,new Map(),support,undefined,source);
      const parsed = await deviceLibraryCostPaced(projected,new Map([[hashImmutableBytes(bytes),bytes]]),support,undefined);
      expect(actual).toEqual(parsed);
      await expect(deviceLibraryCostPaced({...source,files:source.files.map(file=>({...file}))},new Map(),support,undefined,source))
        .rejects.toThrow('Missing admitted texture cost bytes');
      await expect(deviceLibraryCostPaced(projected,new Map(),support,undefined,{...source}))
        .rejects.toThrow('Missing admitted texture cost bytes');
    }
  } finally {restore();}
});

async function rangeDemandFixture() {
  const f=await demandPackFixture(),index=parseOutputIndex(JSON.parse(new TextDecoder().decode(f.wires.get('shard.json'))));
  const wire=new Uint8Array([1,2,3,4,5,6,7,8,9]),thirdBytes=wire.slice(6),thirdHash=hashImmutableBytes(thirdBytes);
  const third={...f.second,hash:thirdHash,path:`blobs/bin/${thirdHash}.bin`},packHash=hashImmutableBytes(wire),path=`blobs/pack/${packHash}.pack`;
  const packed=parseOutputIndex({...index,files:[...index.files,third],admission:{...index.admission,library:[...f.source.library,thirdHash],
    budgets:{...f.source.budgets,library:{resident:9,compressed:9}}},packs:[{path,hash:packHash,bytes:9,entries:[
      {hash:f.first.hash,offset:0,bytes:3},{hash:f.second.hash,offset:3,bytes:3},{hash:thirdHash,offset:6,bytes:3}]}]});
  f.wires.set(third.path,thirdBytes);f.wires.set(path,wire);f.wires.set('shard.json',encodeCanonicalJson(packed));
  return {...f,third,wire,path,source:await readProductDescriptor(options(f.wires))};
}

test('adjacent native demands share one whole pack and release detached member backing',async()=>{
  const f=await rangeDemandFixture(),plain=options(f.wires),ranges:number[][]=[],reads:string[]=[];
  const assets=new ClientAssets(f.source,new Map(),{...plain,fetch:url=>{reads.push(url.slice(base.length));return plain.fetch(url);},fetchRange:(url,start,end)=>{
    expect(url).toBe(base+f.path);ranges.push([start,end]);return Promise.resolve(new Response(f.wire.slice(start,end+1),{status:206,headers:{'content-range':`bytes ${start}-${end}/9`}}));
  }});
  const values=await Promise.all([assets.read(f.first.hash),assets.read(f.second.hash)]);
  expect(values).toEqual([new Uint8Array([1,2,3]),new Uint8Array([4,5,6])]);expect(ranges).toEqual([]);expect(reads).toEqual([f.path]);
  expect(values[0]?.buffer).not.toBe(values[1]?.buffer);expect(assets.retained.size).toBe(0);
  expect(await assets.read(f.first.hash)).toEqual(new Uint8Array([1,2,3]));expect(reads).toEqual([f.path]);expect(ranges).toEqual([]);
  expect(await assets.read(f.third.hash)).toEqual(new Uint8Array([7,8,9]));expect(reads).toEqual([f.path]);
});

test('disjoint demands verify the whole pack but admit only their requested members',async()=>{
  const f=await rangeDemandFixture(),plain=options(f.wires),ranges=vi.fn(()=>Promise.reject(new Error('Unexpected range'))),reads:string[]=[];
  const verify=vi.fn(plain.hash);
  const assets=new ClientAssets(f.source,new Map(),{...plain,hash:verify,fetch:url=>{reads.push(url.slice(base.length));return plain.fetch(url);},fetchRange:ranges});
  expect(await Promise.all([assets.read(f.first.hash),assets.read(f.third.hash)])).toEqual([new Uint8Array([1,2,3]),new Uint8Array([7,8,9])]);
  expect(reads).toEqual([f.path]);expect(ranges).not.toHaveBeenCalled();expect(assets.retained.size).toBe(0);
  expect(verify.mock.calls.map(([bytes])=>Array.from(bytes))).toEqual([Array.from(f.wire),[1,2,3],[7,8,9]]);
});

test('whole pack responses retain status, size, envelope hash and independent member guards',async()=>{
  for(const mode of ['partial','short','hash','member'] as const){
    const f=mode==='member'?await demandPackFixture(true):await rangeDemandFixture();
    const range=vi.fn(()=>Promise.reject(new Error('Unexpected range'))),reads:string[]=[];
    const assets=new ClientAssets(f.source,new Map(),{...options(f.wires),fetch:url=>{
      reads.push(url.slice(base.length));const wire=f.wire.slice(0,mode==='short'?f.wire.length-1:f.wire.length);
      if(mode==='hash')wire[0]=99;
      return Promise.resolve(new Response(wire,{status:mode==='partial'?206:200,headers:{'content-range':`bytes 0-${wire.length-1}/${f.wire.length}`}}));
    },fetchRange:range});
    const values=await Promise.allSettled([assets.read(f.first.hash),assets.read(f.second.hash)]);
    expect(values[0]?.status).toBe('rejected');expect(values[1]?.status).toBe(mode==='member'?'fulfilled':'rejected');expect(assets.retained.size).toBe(0);
    expect(reads).toEqual([f.path]);expect(range).not.toHaveBeenCalled();
  }
});

test('offline partial native demand never invokes the range capability',async()=>{
  const f=await rangeDemandFixture(),fetchRange=vi.fn(()=>Promise.reject(new Error('No offline range'))),fetch=vi.fn(()=>Promise.reject(new Error('No offline fetch')));
  const assets=new ClientAssets(f.source,new Map(),{...options(f.wires),offline:true,fetchRange,fetch,cache:{
    ...cacheStore().cache,verifiedAsset:ref=>Promise.resolve(ref===f.first.hash?new Uint8Array([1,2,3]):null),
  }});
  expect(await assets.read(f.first.hash)).toEqual(new Uint8Array([1,2,3]));
  await expect(assets.read(f.second.hash)).rejects.toThrow('Missing cached resident tile');
  expect(fetchRange).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();expect(assets.retained.size).toBe(0);
});

test('a partial response refuses without per-file fallback and a repaired whole wave retries',async()=>{
  const f=await rangeDemandFixture(),range=vi.fn(()=>Promise.reject(new Error('Unexpected range')));let supported=false,reads=0;
  const assets=new ClientAssets(f.source,new Map(),{...options(f.wires),fetch:url=>{
    expect(url).toBe(base+f.path);reads++;
    return Promise.resolve(new Response(supported?f.wire:f.wire.slice(0,6),{status:supported?200:206,headers:{'content-range':'bytes 0-5/9'}}));
  },fetchRange:range});
  const refused=await Promise.allSettled([assets.read(f.first.hash),assets.read(f.second.hash)]);
  for(const value of refused){expect(value.status).toBe('rejected');if(value.status==='rejected')expect(String(value.reason)).toContain('Resident pack requires a whole response');}
  expect(reads).toBe(1);expect(range).not.toHaveBeenCalled();supported=true;
  expect(await Promise.all([assets.read(f.first.hash),assets.read(f.second.hash)])).toEqual([new Uint8Array([1,2,3]),new Uint8Array([4,5,6])]);
  expect(reads).toBe(2);expect(assets.retained.size).toBe(0);
});


test('low-priority read-ahead and actual demand share one exact verified body', async () => {
  const row = fixture(true), opts = options(row.wires), source = await readProductDescriptor(opts);
  const file = source.files[0], bytes = row.wires.get(`blobs/bin/${file?.hash ?? ''}.bin`);
  if (file === undefined || bytes === undefined) throw new Error('Native body fixture missing');
  let finish = (_value: Response): void => undefined;
  const body = new Promise<Response>(resolve => { finish = resolve; });
  const backgroundFetch = vi.fn(() => body), fetch = vi.fn(() => Promise.reject(new Error('Ordinary retry'))), verify = vi.fn(hash);
  const assets = new ClientAssets(source, new Map(), { ...opts, hash: verify, fetch, backgroundFetch });
  const warm = assets.read(file.hash, 'low'), demand = assets.read(file.hash);
  finish(new Response(Uint8Array.from(bytes)));
  expect(await warm).toEqual(bytes); expect(await demand).toBe(await warm);
  expect(backgroundFetch).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  expect(verify).toHaveBeenCalledOnce(); expect(assets.retained.size).toBe(0);
  await expect(assets.read(file.hash)).rejects.toThrow('Ordinary retry');
  expect(fetch).toHaveBeenCalledOnce();
});


test('low-priority adjacent demands share one whole response and independent member hashes', async () => {
  const f = await rangeDemandFixture(), plain = options(f.wires);
  const fetch = vi.fn(() => Promise.reject(new Error('Unexpected foreground body')));
  const fetchRange = vi.fn(() => Promise.reject(new Error('Unexpected range')));
  const backgroundFetch=vi.fn((url:string)=>{expect(url).toBe(new URL(f.path,base).href);return Promise.resolve(new Response(f.wire));});
  const verify=vi.fn(plain.hash);
  const assets = new ClientAssets(f.source, new Map(), { ...plain, hash:verify, fetch, backgroundFetch, fetchRange });
  expect(await Promise.all([assets.read(f.first.hash, 'low'), assets.read(f.second.hash, 'low')])).toEqual([
    new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6]),
  ]);
  expect(backgroundFetch).toHaveBeenCalledExactlyOnceWith(new URL(f.path,base).href);
  expect(fetchRange).not.toHaveBeenCalled();
  expect(verify.mock.calls.map(([bytes])=>Array.from(bytes))).toEqual([Array.from(f.wire),[1,2,3],[4,5,6]]);
  expect(fetch).not.toHaveBeenCalled(); expect(assets.retained.size).toBe(0);
});

test('a build-addressed descriptor uses its exact version and healthy progress outlives three seconds', async () => {
  const f=fixture(),opts=options(f.wires),release=installIndexReceipt(f.index,new URL('shard.json',base).pathname);
  const wire=f.wires.get('shard.json');if(wire===undefined)throw new Error('Missing descriptor wire');
  let body:ReadableStreamDefaultController<Uint8Array>|undefined;
  const requests:string[]=[],refresh=vi.fn<(run:()=>Promise<void>)=>void>();
  const fetcher=opts.fetch;
  opts.fetch=(url,signal)=>{
    requests.push(url);const address=new URL(url);
    if(address.pathname.endsWith('/shard.json')){
      expect(address.search).toBe(`?v=${hashImmutableBytes(wire).slice(0,8)}`);expect(signal).toBeDefined();
      return Promise.resolve(new Response(new ReadableStream<Uint8Array>({start(controller){body=controller;}})));
    }
    return fetcher(url,signal);
  };
  opts.revalidateAfterControl=refresh;vi.useFakeTimers();
  try{
    const pending=readProductDescriptor(opts);await vi.advanceTimersByTimeAsync(4000);
    if(body===undefined)throw new Error('Descriptor request not started');
    body.enqueue(wire.slice(0,Math.floor(wire.length/2)));await vi.advanceTimersByTimeAsync(4000);
    body.enqueue(wire.slice(Math.floor(wire.length/2)));body.close();
    expect(await pending).toStrictEqual(f.source);expect(requests.filter(url=>new URL(url).pathname.endsWith('/shard.json'))).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
  }finally{release();vi.useRealTimers();}
});

test.each([false, true])('versioned transfer waits for actual headers/body and retains native failure (body=%s)', async body => {
  const f = fixture(), store = cacheStore(), opts = options(f.wires, store.cache);
  await admitProduct(await readProductDescriptor(opts), opts);
  const release = installIndexReceipt(f.index, new URL('shard.json', base).pathname);
  const refresh = vi.fn<(run: () => Promise<void>) => void>();
  let fail = (_error: Error): void => { throw new Error('Transfer not started'); };
  let settled = false;
  const error = new TypeError('Native descriptor transfer failed');
  const held: ProductOptions = { ...opts, revalidateAfterControl: refresh, fetch: (_url, signal) => {
    expect(signal?.aborted).toBe(false);
    if (body) return Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(Uint8Array.of(123)); fail = reason => { controller.error(reason); };
    } })));
    return new Promise((_resolve, reject) => { fail = reject; });
  } };
  vi.useFakeTimers();
  try {
    const rejected = expect(readProductDescriptor(held).finally(() => { settled = true; })).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(180_000); expect(settled).toBe(false); expect(vi.getTimerCount()).toBe(0);
    fail(error); await rejected; expect(refresh).not.toHaveBeenCalled();
  } finally { release(); vi.useRealTimers(); }
});

test('build-addressed descriptor bytes and caller digests retain exact refusal before section reads',async()=>{
  const f=fixture(),opts=options(f.wires),release=installIndexReceipt(f.index,new URL('shard.json',base).pathname),calls:string[]=[];
  const read=opts.fetch;opts.fetch=(url,signal)=>{calls.push(url);const address=new URL(url);address.search='';return read(address.href,signal);};
  try{
    await expect(readProductDescriptor({...opts,descriptorHash:'f'.repeat(64)})).rejects.toThrow('descriptor hash mismatch');expect(calls).toEqual([]);
    const changed=fixture(false,10).wires.get('shard.json');if(changed===undefined)throw new Error('Missing changed index');
    f.wires.set('shard.json',changed);
    await expect(readProductDescriptor(opts)).rejects.toThrow('descriptor hash mismatch');
    expect(calls).toHaveLength(1);expect(new URL(calls[0]??'').pathname).toBe(new URL('shard.json',base).pathname);
  }finally{release();}
});

test('offline build-addressed products retain complete-index and visited-origin verification',async()=>{
  const f=fixture(),store=cacheStore(),opts=options(f.wires,store.cache);
  await admitProduct(await readProductDescriptor(opts),opts);
  const release=installIndexReceipt(f.index,new URL('shard.json',base).pathname),fetcher=vi.fn<ProductOptions['fetch']>();
  try{
    expect(await readProductDescriptor({...opts,offline:true,fetch:fetcher})).toStrictEqual(f.source);
    await store.cache.putProduct(base,{source:fixture(false,10).index,firstParty:true});
    await expect(readProductDescriptor({...opts,offline:true,fetch:fetcher})).rejects.toThrow('descriptor hash mismatch');
    await store.cache.putProduct(base,{source:f.index,firstParty:false});
    await expect(readProductDescriptor({...opts,offline:true,fetch:fetcher})).rejects.toThrow('not been visited offline');
    expect(fetcher).not.toHaveBeenCalled();
  }finally{release();}
});


test('live parsing retains main-thread receipts and the original hash refusal', async () => {
  const f = packedSectionFixture();
  const parse = vi.fn((bytes: Uint8Array): Promise<unknown> => Promise.resolve(JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(structuredClone(bytes)))));
  const source = await readProductDescriptor({ ...options(f.wires), parseJson: parse });
  expect(source).toEqual(f.source); expect(parse).toHaveBeenCalledTimes(f.index.sections.length + 1);
  const bad = fixture(), section = bad.index.sections[0];
  if (section === undefined) throw new Error('No section');
  bad.wires.set(section.path, new Uint8Array(section.bytes).fill(32));
  parse.mockClear();
  await expect(readProductDescriptor({ ...options(bad.wires), parseJson: parse })).rejects.toThrow('section hash or size mismatch');
  expect(parse.mock.calls.some(([bytes]) => bytes.length === section.bytes && bytes.every(byte => byte === 32))).toBe(false);
});

test('build-owned client sections assemble exact hosts without hashing or downloading schemas',async()=>{
  const f=fixture(),path='sections/ui/strings.json',schemaPath='schemas/custom/forbidden.schema.json';
  const value={enabled:'true'},wire=encodeCanonicalJson(value);
  const measured=(name:string,bytes:Uint8Array)=>({path:name,bytes:bytes.length,hash:hashImmutableBytes(bytes)});
  const index=parseOutputIndex({...f.index,sections:[...f.index.sections,{name:'ui/strings',schema:'wildshard:ui/strings@1',...measured(path,wire)}],schemas:[]});
  f.wires.set(path,wire);
  const reads:string[]=[],digest=vi.fn<(bytes:Uint8Array)=>Promise<string>>(()=>{throw new Error('No client digest');});
  let active=0,maximum=0;
  const source=await resolveOutputDescriptor(index,{offline:false,firstParty:true,hash:digest,read:()=>{throw new Error('No checked-reader fallback');},
    parseJson:async bytes=>{active++;maximum=Math.max(maximum,active);try{await Promise.resolve();const parsed:unknown=JSON.parse(new TextDecoder().decode(bytes));return parsed;}finally{active--; }},
    built:{indexHash:'compiled-index-key',read:(name,bytes)=>{reads.push(name);const body=f.wires.get(name);if(body===undefined||body.length!==bytes)throw new Error('Missing emitted bytes');return Promise.resolve(body);}}});
  expect(source).toStrictEqual(f.source);expect(digest).not.toHaveBeenCalled();expect(reads).toEqual(index.sections.map(row=>row.path));expect(reads).not.toContain(schemaPath);
  expect(maximum).toBe(1);
  if(!isBuildValidatedOutput(source))throw new Error('Missing build authority');
  expect(outputDescriptor(source)?.sections.get('ui/strings')).toStrictEqual(value);expect(outputDescriptor(source)?.indexHash).toBe('compiled-index-key');
});

test('a supplied build reader cannot bypass external descriptor validation',async()=>{
  const f=fixture(),first=f.index.sections[0];if(first===undefined)throw new Error('Missing section');
  const corrupt=new Uint8Array(f.wires.get(first.path)??[]);corrupt[0]=0;
  const built=vi.fn<(path:string,bytes:number)=>Promise<Uint8Array>>(()=>{throw new Error('External input has no build authority');});
  await expect(resolveOutputDescriptor(f.index,{offline:false,firstParty:false,hash:bytes=>Promise.resolve(hash(bytes)),built:{read:built,indexHash:'not-authority'},read:path=>Promise.resolve(path===first.path?corrupt:f.wires.get(path)??new Uint8Array())})).rejects.toThrow('section hash or size mismatch');
  expect(built).not.toHaveBeenCalled();
});

test('native first-party loading has no visited fallback, digest or client admission phases',async()=>{
  const f=fixture(true),ordinary=options(f.wires),store=cacheStore(),phases:string[]=[],requests:string[]=[];
  const digest=vi.fn<(bytes:Uint8Array)=>Promise<string>>(()=>{throw new Error('No first-party digest');});
  const visited=vi.spyOn(store.cache,'product').mockRejectedValue(new Error('No visited fallback'));
  const native:ProductOptions={...ordinary,cache:store.cache,hash:digest,progress:row=>{phases.push(row.phase);},
    firstPartyRead:(url,expected,read)=>{
      const path=new URL(url).pathname.slice(new URL(base).pathname.length),bytes=f.wires.get(path);requests.push(path);
      if(bytes===undefined||(expected!==undefined&&expected!==bytes.length))throw new Error('Missing build file');
      read?.(bytes.length);return Promise.resolve(bytes);
    }};
  const source=await readProductDescriptor(native),loaded=await admitProduct(source,native);
  expect(loaded.source).toStrictEqual(f.source);expect([...loaded.assets.values()]).toStrictEqual([new Uint8Array([1,2,3])]);
  expect(digest).not.toHaveBeenCalled();expect(visited).not.toHaveBeenCalled();expect(phases.every(phase=>phase==='assets')).toBe(true);
  expect(requests.filter(path=>path==='shard.json')).toHaveLength(1);expect(store.product()).toBeNull();
});

// GC9 (GRID-CROSSING; Pine's product read 8.5 s on a loopback page): a grid neighbour releases its runtime-only wires straight
// after admission, so a first-party read leaves them unread and only warms them, low priority and unhashed, for the entry's reads.
test('first-party admission leaves deferred files unread, warms them, and still releases them',async()=>{
  const f=fixture(true),ordinary=options(f.wires),requests:string[]=[],warmed:string[]=[];
  const files=f.source.files.map(file=>file.hash);expect(files.length).toBeGreaterThan(0);
  const native:ProductOptions={...ordinary,deferred:()=>Promise.resolve(files),
    backgroundFetch:url=>{warmed.push(new URL(url).pathname.slice(new URL(base).pathname.length));return Promise.resolve(new Response(new Uint8Array([1,2,3])));},
    firstPartyRead:(url,expected,read)=>{
      const path=new URL(url).pathname.slice(new URL(base).pathname.length),bytes=f.wires.get(path);requests.push(path);
      if(bytes===undefined||(expected!==undefined&&expected!==bytes.length))throw new Error('Missing build file');
      read?.(bytes.length);return Promise.resolve(bytes);
    }};
  const source=await readProductDescriptor(native),loaded=await admitProduct(source,native);
  expect([...loaded.assets.keys()].filter(ref=>files.includes(ref))).toEqual([]);expect(loaded.unread).toEqual(files);
  const blobs=files.map(ref=>new URL(outputBlobUrl(loaded.source,ref,base)).pathname.slice(new URL(base).pathname.length));
  expect(requests.filter(path=>blobs.includes(path))).toEqual([]);
  await vi.waitFor(()=>{expect(warmed.sort()).toEqual([...blobs].sort());});
  expect(await loaded.releaseTransport?.(files,'cache-or-fetch')).toEqual(files);
});

test('built product residency is the emitted value without another source walk',async()=>{
  const f=fixture(),expected=productResidentBytes(f.source);
  const previous=Object.getOwnPropertyDescriptor(globalThis,'__SHARDFILE_VERDICTS__');
  const postCost={passes:1,instructions:7,inputs:{colour:true,depth:false,normal:false}};
  Object.defineProperty(globalThis,'__SHARDFILE_VERDICTS__',{configurable:true,value:[{sourceHash:f.index.build.sourceHash,residentBytes:expected,postCost}]});
  try{
    const source=await resolveOutputDescriptor(f.index,{firstParty:true,offline:false,hash:()=>{throw new Error('No client hash');},read:()=>{throw new Error('No checked fallback');},
      built:{indexHash:'compiled',read:path=>{const bytes=f.wires.get(path);if(bytes===undefined)throw new Error('Missing section');return Promise.resolve(bytes);}}});
    if(!isBuildValidatedOutput(source))throw new Error('Missing built source');
    expect(productResidentBytes(source)).toBe(expected);
    expect(productPostCost(source,()=>{throw new Error('No entry-time graph validation');})).toStrictEqual(postCost);
    const steps=productResidentBytesSteps(source,1);expect(steps.next()).toEqual({done:true,value:expected});
  }finally{if(previous===undefined)Reflect.deleteProperty(globalThis,'__SHARDFILE_VERDICTS__');else Object.defineProperty(globalThis,'__SHARDFILE_VERDICTS__',previous);}
});

// QA-FEEDBACK-2026-11-12 (v0.1.14 staging proof): Brasscap rev 3's receipt stamps 2,930,740 resident bytes over 4,670,827 bytes of wire (its
// repack kept an older receipt's cost fields). As a grid neighbour, the transport release shrank the product claim by every
// released file's wire, past zero: "RangeError: Invalid residency shrink", and the cell stayed closed.
test('a built product stamped below its own wire still releases all of its transport',async()=>{
  const f=fixture(true),wire=f.source.files.reduce((sum,file)=>sum+file.compressed,0),stale=1;
  expect(wire).toBeGreaterThan(stale);
  const previous=Object.getOwnPropertyDescriptor(globalThis,'__SHARDFILE_VERDICTS__');
  const postCost={passes:1,instructions:7,inputs:{colour:true,depth:false,normal:false}};
  Object.defineProperty(globalThis,'__SHARDFILE_VERDICTS__',{configurable:true,value:[{sourceHash:f.index.build.sourceHash,residentBytes:stale,postCost}]});
  const allocator=new ResidencyAllocator(),leases=new ProductLeases<string>(allocator,'grid');
  try{
    const source=await resolveOutputDescriptor(f.index,{firstParty:true,offline:false,hash:()=>{throw new Error('No client hash');},read:()=>{throw new Error('No checked fallback');},
      built:{indexHash:'compiled',read:path=>{const bytes=f.wires.get(path);if(bytes===undefined)throw new Error('Missing section');return Promise.resolve(bytes);}}});
    if(!isBuildValidatedOutput(source))throw new Error('Missing built source');
    const lease=await leases.acquire('blender-template',async(reserve,releaseBytes)=>{
      await reserve(source);
      const admitted:AdmittedProduct={source,assets:new Map(),cached:false,releaseTransport:refs=>Promise.resolve([...refs])};
      accountTransportRelease(admitted,releaseBytes);
      await admitted.releaseTransport?.(source.files.map(file=>file.hash),'cache-or-fetch');
      return 'admitted';
    });
    expect(lease.value).toBe('admitted');
    expect(allocator.entries().find(row=>row.id==='product:grid:blender-template')?.bytes).toBe(0);
    expect(productResidentBytes(source)).toBe(wire);expect(productResidentBytesSteps(source,1).next()).toEqual({done:true,value:wire});
    lease.release();
  }finally{leases.dispose();if(previous===undefined)Reflect.deleteProperty(globalThis,'__SHARDFILE_VERDICTS__');else Object.defineProperty(globalThis,'__SHARDFILE_VERDICTS__',previous);}
});

test('the browser cannot fall back to Node admission when its native build reader is missing',async()=>{
  const f=fixture(),native=options(f.wires);
  vi.stubEnv('SSR',false);
  try{
    await expect(readProductDescriptor(native)).rejects.toThrow('build-owned reader');
    expect(()=>admitProduct(f.index,native)).toThrow('build-owned reader');
    expect(()=>productResidentBytes(f.source)).toThrow('build-owned residency');
    expect(()=>productResidentBytesSteps(f.source).next()).toThrow('build-owned residency');
    expect(()=>productPostCost(f.source,()=>undefined)).toThrow('build-owned post cost');
    await expect(resolveOutputDescriptor(f.index,{firstParty:true,offline:false,read:()=>Promise.resolve(new Uint8Array()),hash:native.hash})).rejects.toThrow('build-owned reader');
  }finally{vi.unstubAllEnvs();}
});
