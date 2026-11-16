import { installCatalogueFixture } from './fixtures/bootSetup';
import { afterEach, expect, test, vi } from 'vitest';
import { emptyShardfile } from '@wildshard/engine/host/author';
import { encodeCanonicalJson, hashImmutableBytes } from '@wildshard/engine/host/immutable';
import { Scope } from '@wildshard/engine/app/scope';
import { postStackCost } from '@wildshard/format/postStack';
import * as product from '../src/client/game/shardfile/folder';
import * as runtime from '../src/client/game/shardfile/runtimeFolder';
import { gridShardfileFolder,prioritizeGridFolder } from '../src/client/game/grid/folders';
import { prepareHomeMetadata } from '../src/client/game/grid/homeMetadata';
import { ResidencyAllocator } from '../src/shared/game/grid/allocator';
import { prepareApproachFolderInputs } from '../src/client/game/grid/approachFolderInputs';
import { ApproachInputsDeferredError } from '../src/client/game/grid/folderInputs';

await installCatalogueFixture();

const scopes: Scope[] = [];
afterEach(() => { for (const scope of scopes.splice(0)) scope.dispose(); });

test('initial metadata prefetch lends the same admitted source and claim to real entry', async () => {
  const f = fixture();
  await prepareHomeMetadata(f.owner.scope, () => gridShardfileFolder('driftwood-isle', f.owner, 'metadata'));
  const real = await gridShardfileFolder('driftwood-isle', f.owner, 'metadata');
  if (real === null) throw new Error('Missing real entry metadata');
  expect(f.admit).toHaveBeenCalledOnce(); expect(f.read).not.toHaveBeenCalled(); expect(f.hash).not.toHaveBeenCalled();
  real.release(); expect(f.owner.allocator.has('product:grid:driftwood-isle')).toBe(true);
  f.owner.scope.dispose(); expect(f.owner.allocator.has('product:grid:driftwood-isle')).toBe(false);
});

function fixture(offline = false, playing?: number) {
  const source = emptyShardfile({ slug: 'driftwood-isle', name: 'Metadata lease', author: 'Test', revision: 1, seed: 1 });
  const binary = Uint8Array.of(1, 2, 3), ref = hashImmutableBytes(binary);
  const json = new TextEncoder().encode(encodeCanonicalJson({ version: 1, kind: 'post', nodes: {}, stages: { post: { colour: [1, 1, 1] } } }));
  const graph = hashImmutableBytes(json);
  for (const [hash, bytes, kind] of [[ref, binary, 'binary'], [graph, json, 'json']] as const) {
    source.files.push({ hash, kind, compressed: bytes.length, decoded: bytes.length, gpu: 0, triangles: 0, draws: 0, dependencies: [], critical: false });
  }
  source.look.grade.lut = ref;
  source.look.post = [{ file: graph }]; source.library.push(ref, graph);
  const wire = new Map([[ref, binary], [graph, json]]);
  const release = vi.fn((refs: Iterable<string>) => { const released = [...refs]; for (const hash of released) wire.delete(hash); return Promise.resolve(released); });
  const admitted: product.AdmittedFolder = { source, assets: wire, cached: true, releasePreparedTransport: release };
  const read = vi.fn<(base: string, hash: string) => Promise<Uint8Array | null>>((_base, hash) => Promise.resolve(hash === ref ? Uint8Array.from(binary) : Uint8Array.from(json)));
  const hash = vi.fn((bytes: Uint8Array) => Promise.resolve(hashImmutableBytes(bytes)));
  const fetch = vi.fn(() => Promise.resolve(Response.json({})));
  const options: product.FolderOptions = { base: 'https://metadata.test/', offline, firstParty: true, fetch, hash,
    cache: { asset: read, product: () => Promise.resolve(null), putFolder: () => Promise.resolve(), putAsset: () => Promise.resolve(true) } };
  vi.spyOn(runtime, 'browserShardfileOptions').mockReturnValue(options);
  // the real admission awaits its reserve (the residency walk runs in steps, f149370022) before it continues
  const admit = vi.spyOn(product, 'admitFolder').mockImplementation(async (_input, opts) => { await opts.reserve?.(source); return admitted; });
  const scope = new Scope('metadata product'); scopes.push(scope);
  const allocator = new ResidencyAllocator(playing === undefined ? {} : { playing });
  return { source, wire, ref, graph, json, read, hash, fetch, admit, release,options, owner: { scope, allocator } };
}

test('native URL reads retain actual-world priority over speculative product reads',async()=>{
  const f=fixture(),native=vi.fn(()=>Promise.resolve(Uint8Array.of(1)));
  f.options.firstPartyRead=native;
  vi.spyOn(product,'readFolderDescriptor').mockImplementation(async(options,url)=>{
    if(url===undefined||options.firstPartyRead===undefined)throw new Error('Missing native root reader');
    await options.firstPartyRead(url.href,undefined);return f.source;
  });
  const release=prioritizeGridFolder('active-world',f.owner);
  const pending=gridShardfileFolder('driftwood-isle',f.owner,'metadata');
  await Promise.resolve();await Promise.resolve();
  expect(native).not.toHaveBeenCalled();
  release();const result=await pending;
  expect(native).toHaveBeenCalledOnce();result?.release();
});

test('released metadata reuses its JSON and product claim without reading or hashing binary inputs', async () => {
  const f = fixture(), first = await gridShardfileFolder('driftwood-isle', f.owner);
  if (first === null) throw new Error('Missing test product');
  await first.releaseInputs(); first.release();
  expect(f.wire.has(f.ref)).toBe(false);
  const metadata = await gridShardfileFolder('driftwood-isle', f.owner, 'metadata');
  if (metadata === null) throw new Error('Missing metadata product');
  expect(f.read).not.toHaveBeenCalled(); expect(f.hash).not.toHaveBeenCalled(); expect(f.admit).toHaveBeenCalledOnce();
  expect(metadata.admitted.assets.get(f.graph)).toBe(f.json);
  expect(postStackCost(metadata.admitted.source, ref => metadata.admitted.assets.get(ref)).errors).toEqual([]);
  expect(f.owner.allocator.has('product:grid:driftwood-isle')).toBe(true);
  expect(f.owner.allocator.entries().some(row => row.id.startsWith('product-input:'))).toBe(false);
  metadata.release(); f.owner.scope.dispose();
  expect(f.owner.allocator.has('product:grid:driftwood-isle')).toBe(false);
});

test('cold metadata drops unused binary mirrors without first borrowing or rereading them', async () => {
  const f = fixture(), metadata = await gridShardfileFolder('driftwood-isle', f.owner, 'metadata');
  if (metadata === null) throw new Error('Missing metadata product');
  expect(f.wire.has(f.ref)).toBe(false); expect(f.wire.get(f.graph)).toBe(f.json);
  expect(f.read).not.toHaveBeenCalled(); expect(f.hash).not.toHaveBeenCalled();
  const world = await gridShardfileFolder('driftwood-isle', f.owner);
  if (world === null) throw new Error('Missing construction product');
  expect(world.admitted.assets.get(f.ref)).toEqual(Uint8Array.of(1, 2, 3));
  expect(f.read).toHaveBeenCalledOnce(); expect(f.hash).toHaveBeenCalledOnce();
  expect(f.owner.allocator.entries().some(row => row.id.startsWith('product-input:'))).toBe(true);
  await world.releaseInputs(); world.release(); metadata.release();
  expect(f.owner.allocator.entries().some(row => row.id.startsWith('product-input:'))).toBe(false);
});

test('metadata during a live preparation cannot clear its binary inputs', async () => {
  const f = fixture(), world = await gridShardfileFolder('driftwood-isle', f.owner);
  if (world === null) throw new Error('Missing construction product');
  const metadata = await gridShardfileFolder('driftwood-isle', f.owner, 'metadata');
  if (metadata === null) throw new Error('Missing metadata product');
  metadata.release();
  expect(world.admitted.assets.get(f.ref)).toEqual(Uint8Array.of(1, 2, 3)); expect(f.release).not.toHaveBeenCalled();
  await world.releaseInputs(); world.release();
});

test('cold offline metadata retains bytes when durable release authority refuses them', async () => {
  const f = fixture(true); f.release.mockResolvedValueOnce([]);
  const metadata = await gridShardfileFolder('driftwood-isle', f.owner, 'metadata');
  if (metadata === null) throw new Error('Missing metadata product');
  expect(f.wire.has(f.ref)).toBe(true);
  const world = await gridShardfileFolder('driftwood-isle', f.owner);
  if (world === null) throw new Error('Missing construction product');
  expect(world.admitted.assets.get(f.ref)).toEqual(Uint8Array.of(1, 2, 3));
  expect(f.read).not.toHaveBeenCalled(); expect(f.hash).not.toHaveBeenCalled();
  await world.releaseInputs(); world.release(); metadata.release();
});

test('page disposal while cold metadata releases inputs rejects publication and releases its product claim', async () => {
  const f = fixture();
  let finish: (() => void) | undefined, started: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const releasing = new Promise<void>(resolve => { started = resolve; });
  f.release.mockImplementationOnce(async refs => {
    started?.(); await gate;
    const released = [...refs]; for (const ref of released) f.wire.delete(ref); return released;
  });
  const pending = gridShardfileFolder('driftwood-isle', f.owner, 'metadata');
  if (pending === null) throw new Error('Missing metadata product');
  const refused = expect(pending).rejects.toThrow('disposed during metadata');
  await releasing; f.owner.scope.dispose();
  if (finish === undefined) throw new Error('Missing release gate'); finish();
  await refused;
  expect(f.read).not.toHaveBeenCalled(); expect(f.hash).not.toHaveBeenCalled();
  expect(f.owner.allocator.has('product:grid:driftwood-isle')).toBe(false);
});

test.each(['corrupt', 'offline-missing'] as const)('metadata cannot admit a later world with %s inputs', async mode => {
  const f = fixture(mode === 'offline-missing'), metadata = await gridShardfileFolder('driftwood-isle', f.owner, 'metadata');
  if (metadata === null) throw new Error('Missing metadata product');
  expect(f.read).not.toHaveBeenCalled();
  f.read.mockResolvedValue(mode === 'corrupt' ? Uint8Array.of(3, 2, 1) : null);
  await expect(gridShardfileFolder('driftwood-isle', f.owner)).rejects.toThrow(mode === 'corrupt' ? 'hash or size mismatch' : 'Missing cached resident tile');
  expect(f.wire.has(f.ref)).toBe(false);
  expect(f.owner.allocator.entries().some(row => row.id.startsWith('product-input:'))).toBe(false);
  expect(f.fetch).toHaveBeenCalledOnce(); metadata.release();
});


test('approach IO never evicts a retained world, while actual input admission still may', async () => {
  const probe = fixture(), before = await gridShardfileFolder('driftwood-isle', probe.owner, 'metadata');
  if (before === null) throw new Error('Missing probe metadata');
  const cap = probe.owner.allocator.cost().playing + 4;
  before.release(); probe.owner.scope.dispose();
  const f = fixture(false, cap), metadata = await gridShardfileFolder('driftwood-isle', f.owner, 'metadata');
  if (metadata === null) throw new Error('Missing metadata');
  const evict = vi.fn(), kept = f.owner.allocator.reserve({ id: 'retained-world', owner: 'kept', category: 'sim', bytes: 3, distance: 1, needed: false, evictSync: () => { evict(); } });
  if (kept === null) throw new Error('Retained world did not fit');
  const controller = new AbortController();
  // The old normal-acquire path reads and aborts here instead of deferring, so
  // its regression fails promptly rather than leaving a forever-held approach.
  f.read.mockImplementation((_base, hash) => { controller.abort(); return Promise.resolve(hash === f.ref ? Uint8Array.of(1, 2, 3) : Uint8Array.from(f.json)); });
  await expect(prepareApproachFolderInputs('driftwood-isle', f.owner, controller.signal)).resolves.toBeUndefined();
  expect(evict).not.toHaveBeenCalled(); expect(f.owner.allocator.has('retained-world')).toBe(true);
  expect(f.read).not.toHaveBeenCalled(); expect(f.owner.allocator.entries().some(row => row.id.startsWith('product-input:'))).toBe(false);
  const actual = await gridShardfileFolder('driftwood-isle', f.owner);
  if (actual === null) throw new Error('Missing actual product');
  expect(evict).toHaveBeenCalledOnce(); expect(f.owner.allocator.has('retained-world')).toBe(false);
  expect(actual.admitted.assets.get(f.ref)).toEqual(Uint8Array.of(1, 2, 3));
  await actual.releaseInputs(); actual.release(); metadata.release(); kept.release();
});

test('an approach with no existing metadata admission starts no product IO', async () => {
  const f = fixture();
  await prepareApproachFolderInputs('driftwood-isle', f.owner, new AbortController().signal);
  expect(f.admit).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
  expect(f.owner.allocator.entries()).toEqual([]);
});


test('a demanded map subset restores only its selected file, not the unrelated world wire', async () => {
  const f = fixture(), unused = Uint8Array.of(7, 8, 9), hash = hashImmutableBytes(unused);
  f.source.files.push({ hash, kind: 'binary', compressed: 3, decoded: 3, gpu: 0, triangles: 0, draws: 0, dependencies: [], critical: false });
  f.source.library.push(hash); f.wire.set(hash, unused);
  const metadata = await gridShardfileFolder('driftwood-isle', f.owner, 'metadata');
  if (metadata === null) throw new Error('Missing metadata');
  const selected = await gridShardfileFolder('driftwood-isle', f.owner, { files: [f.ref] });
  if (selected === null) throw new Error('Missing selected input');
  expect(selected.admitted.assets.get(f.ref)).toEqual(Uint8Array.of(1, 2, 3)); expect(selected.admitted.assets.has(hash)).toBe(false);
  expect(f.read).toHaveBeenCalledExactlyOnceWith('https://metadata.test/', f.ref);
  await selected.releaseInputs(); selected.release(); metadata.release();
});

test('a file subset cannot refill a wire absent from the originally admitted tier', async () => {
  const f = fixture(), unselected = hashImmutableBytes(Uint8Array.of(4, 5, 6));
  f.source.files.push({ hash: unselected, kind: 'binary', compressed: 3, decoded: 3, gpu: 0, triangles: 0, draws: 0, dependencies: [], critical: false });
  const metadata = await gridShardfileFolder('driftwood-isle', f.owner, 'metadata');
  if (metadata === null) throw new Error('Missing metadata');
  await expect(gridShardfileFolder('driftwood-isle', f.owner, { files: [unselected] })).rejects.toThrow('Unselected product input');
  expect(f.read).not.toHaveBeenCalled(); metadata.release();
});

async function metadataPressure() {
  const probe = fixture(), metadata = await gridShardfileFolder('driftwood-isle', probe.owner, 'metadata');
  if (metadata === null) throw new Error('Missing probe metadata');
  const cap = probe.owner.allocator.cost().playing + 4;
  metadata.release(); probe.owner.scope.dispose();
  const f = fixture(false, cap), evict = vi.fn();
  // The sizing probe shares the module spy; count only this owner's admissions.
  f.admit.mockClear();
  const kept = f.owner.allocator.reserve({ id: 'kept', category: 'sim', owner: 'kept', bytes: 3, distance: 1, needed: false, evictSync: () => { evict(); } });
  if (kept === null) throw new Error('Kept world did not fit');
  return { ...f, evict, kept };
}

test('fresh optional metadata defers before eviction or publication, required metadata still admits', async () => {
  const f = await metadataPressure();
  await expect(gridShardfileFolder('driftwood-isle', f.owner, 'optional-metadata')).rejects.toBeInstanceOf(ApproachInputsDeferredError);
  expect(f.evict).not.toHaveBeenCalled(); expect(f.owner.allocator.has('kept')).toBe(true);
  expect(f.owner.allocator.has('product:grid:driftwood-isle')).toBe(false); expect(f.read).not.toHaveBeenCalled();
  const required = await gridShardfileFolder('driftwood-isle', f.owner, 'metadata');
  if (required === null) throw new Error('Required metadata was poisoned');
  expect(f.evict).toHaveBeenCalledOnce(); required.release(); f.kept.release();
});

test('required metadata promotes a joined optional loader before its source reservation', async () => {
  const f = await metadataPressure();
  let started = (): void => undefined, finish = (_response: Response): void => undefined;
  const reading = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<Response>(resolve => { finish = resolve; });
  f.fetch.mockImplementationOnce(() => { started(); return gate; });
  const optional = gridShardfileFolder('driftwood-isle', f.owner, 'optional-metadata');
  await reading;
  const actual = gridShardfileFolder('driftwood-isle', f.owner, 'metadata');
  finish(Response.json({}));
  const [a, b] = await Promise.all([optional, actual]);
  if (a === null || b === null) throw new Error('Missing promoted metadata');
  expect(f.admit).toHaveBeenCalledOnce(); expect(f.evict).toHaveBeenCalledOnce();
  a.release(); b.release(); f.kept.release();
});

test('required metadata retries when a joined optional reserve already declined', async () => {
  const f = await metadataPressure();
  let declined = (): void => undefined, finish = (): void => undefined;
  const rejected = new Promise<void>(resolve => { declined = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  f.admit.mockImplementationOnce(async (_input, options) => {
    try { await options.reserve?.(f.source); }
    catch (error) { declined(); await gate; throw error; }
    throw new Error('Optional reservation unexpectedly fit');
  });
  const optional = gridShardfileFolder('driftwood-isle', f.owner, 'optional-metadata');
  const refused = expect(optional).rejects.toBeInstanceOf(ApproachInputsDeferredError);
  await rejected;
  const actual = gridShardfileFolder('driftwood-isle', f.owner, 'metadata');
  finish(); await refused;
  const required = await actual;
  if (required === null) throw new Error('Missing retried metadata');
  expect(f.admit).toHaveBeenCalledTimes(2); expect(f.evict).toHaveBeenCalledOnce();
  required.release(); f.kept.release();
});
