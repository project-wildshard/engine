import { afterEach, expect, test, vi } from 'vitest';
import { setDev } from '@wildshard/engine/core/devMode';
import { memoryAttribution } from '@wildshard/engine/core/memoryAttribution';
import { parseShardfile } from '@wildshard/format/shardSchema';
import { SHARDFILE_VERSION } from '@wildshard/format/version';
import { ClientAssets } from './clientAssets';
import { parseOutputIndex } from '@wildshard/format/outputIndex';
import { isBuildValidatedOutput, resolveOutputDescriptor } from '../../../shared/game/shardfile/outputDescriptor';
import { realGc } from '@wildshard/engine/test/realGc';

const observed: ArrayBufferLike[] = [];
afterEach(() => {
  setDev(false);
  for (const buffer of observed.splice(0)) memoryAttribution.release(buffer, 'ram');
});
function fixture() {
  const edge = { heights: Array.from({ length: 257 }, () => 0), colours: Array.from({ length: 257 }, () => [0.5, 0.5, 0.5]), roadHeight: 0 };
  const source = parseShardfile({ version: SHARDFILE_VERSION,
    identity: { slug: 'transport-memory', name: 'Transport', author: 'Test', revision: 1, seed: 1 }, accent: 'sand',
    requires: { sdk: SHARDFILE_VERSION, capabilities: [], commons: [], commonsWire: {}, commonsCosts: {} },
    budgets: { library: { resident: 0, compressed: 0 }, sim: { resident: 0, compressed: 0 }, overlap: 0 },
    entryways: ['north', 'east', 'south', 'west'].map((side, i) => ({ edge: side, at: [[0, 0, 250], [250, 0, 0], [0, 0, -250], [-250, 0, 0]][i], width: 8 })),
    look: { families: [], grade: { exposure: 0, saturation: 1, contrast: 1, lut: null }, clock: 'engine', dayOverride: null, keys: [] },
    sim: { fixedHz: 60, scriptTickDivisor: 2, commandVersion: 0, snapshotVersion: 0, scripts: [] },
    state: { version: 1, sharedOwner: 'host', playerKey: 'actorId', shared: [], player: [] }, authorCaps: { players: 32, speed: 15 },
    serverBudget: { tickMicros: 1000, memory: 1_000_000, entities: 100, commandsPerTick: 32 },
    edge: { north: edge, south: edge, east: edge, west: edge }, files: [], tiles: [], library: [], critical: [], far: null });
  const bytes = new Uint8Array([1, 2, 3]), ref = 'a'.repeat(64);
  observed.push(bytes.buffer);
  source.files.push({ hash: ref, kind: 'binary', compressed: bytes.length, decoded: 3, gpu: 0, triangles: 0, draws: 0, dependencies: [], critical: false });
  const fetch = vi.fn(() => Promise.reject(new Error('Unexpected transport fetch')));
  const options = { base: 'https://example.invalid/product/', offline: true, firstParty: true, fetch,
    hash: vi.fn(() => Promise.resolve(ref)) };
  const rows = () => memoryAttribution.snapshot().allocations.filter(row => row.owner === 'product:transport-memory');
  return { source, bytes, ref, options, fetch, rows };
}

test('native first-party demand uses the canonical URL and no page cache or hash', async () => {
  const f = fixture(), requests: { url: string; bytes: number | undefined; hash: string | undefined; priority: 'low' | undefined }[] = [];
  const index = parseOutputIndex({ format: 'wildshard.shardfile', formatVersion: 2, sdk: '0.2', version: f.source.version,
    identity: f.source.identity, requires: f.source.requires, build: { sourceHash: '0'.repeat(64), validator: 'test' },
    admission: { budgets: f.source.budgets, serverBudget: f.source.serverBudget, authorCaps: f.source.authorCaps, critical: [], library: [] },
    sections: [], schemas: [], runtime: null, files: [{ hash: f.ref, kind: 'bin', path: `blobs/bin/${f.ref}.bin`, compressed: 3,
      decoded: 3, gpu: 0, triangles: 0, draws: 0, dependencies: [], critical: false }],
  });
  const read = (): Promise<Uint8Array> => Promise.reject(new Error('No section in this emitted index'));
  const source = await resolveOutputDescriptor(index, { offline: false, firstParty: true, read, hash: f.options.hash,
    built: { indexHash: 'b'.repeat(64), read } });
  if (!isBuildValidatedOutput(source)) throw new Error('Missing build-owned output fixture');
  const assets = new ClientAssets(source, new Map(), { ...f.options, firstPartyRead: (url, bytes, _read, hash, priority) => {
    requests.push({ url, bytes, hash, priority }); return Promise.resolve(f.bytes);
  } });
  expect(await assets.read(f.ref, 'low')).toBe(f.bytes);
  expect(requests).toEqual([{ url: new URL(`blobs/bin/${f.ref}.bin`, f.options.base).href, bytes: f.bytes.length, hash: f.ref, priority: 'low' }]);
  expect(f.options.hash).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
  expect(assets.retained.size).toBe(0);
  await assets.read(f.ref); expect(requests).toHaveLength(2);
});

test('Developer transport labels share original backing identity and survive map release while another owner holds it', async () => {
  setDev(true);
  const f = fixture(), wire = new Map([[f.ref, f.bytes]]);
  const first = new ClientAssets(f.source, wire, f.options), second = new ClientAssets(f.source, wire, f.options);
  const row = f.rows();
  expect(row).toHaveLength(1);
  expect(row[0]).toMatchObject({ asset: f.ref, kind: 'array-buffer', bytes: 3, precision: 'exact' });
  expect(await first.read(f.ref)).toBe(f.bytes);
  expect(await second.read(f.ref)).toBe(f.bytes);
  first.releaseTransport([f.ref]); second.releaseTransport([f.ref]);
  expect(first.retained.size).toBe(0); expect(second.retained.size).toBe(0);
  expect(wire.get(f.ref)).toBe(f.bytes);
  expect(f.rows()).toEqual(row);
  structuredClone(f.bytes, { transfer: [f.bytes.buffer] });
  expect(f.rows()[0]?.bytes).toBe(0);
  expect(f.fetch).not.toHaveBeenCalled();
});

test('verified rereads are labelled without introducing a transport memo or another read', async () => {
  setDev(true);
  const f = fixture(), verifiedAsset = vi.fn(() => Promise.resolve(f.bytes));
  const assets = new ClientAssets(f.source, new Map(), { ...f.options, cache: {
    product: () => Promise.resolve(null), putProduct: () => Promise.resolve(),
    asset: () => Promise.reject(new Error('Unexpected unverified read')),
    putAsset: () => Promise.resolve(true), verifiedAsset,
  } });
  expect(await assets.read(f.ref)).toBe(f.bytes);
  expect(await assets.read(f.ref)).toBe(f.bytes);
  expect(verifiedAsset).toHaveBeenCalledTimes(2);
  expect(assets.retained.size).toBe(0);
  expect(f.rows()).toHaveLength(1);
  expect(f.fetch).not.toHaveBeenCalled();
});

test('ordinary reads add no diagnostic rows and invalid verified bytes still refuse before observation', async () => {
  const f = fixture(), assets = new ClientAssets(f.source, new Map([[f.ref, f.bytes]]), f.options);
  expect(await assets.read(f.ref)).toBe(f.bytes);
  expect(f.rows()).toHaveLength(0);
  setDev(true);
  const invalid = new ClientAssets(f.source, new Map(), { ...f.options, cache: {
    product: () => Promise.resolve(null), putProduct: () => Promise.resolve(),
    asset: () => Promise.resolve(null), putAsset: () => Promise.resolve(true),
    verifiedAsset: () => Promise.resolve(new Uint8Array([1])),
  } });
  await expect(invalid.read(f.ref)).rejects.toThrow('hash or size mismatch');
  expect(f.rows()).toHaveLength(0);
});

test('concurrent released reads borrow one verified backing only until the wave settles', async () => {
  const f = fixture();
  let complete = (_bytes: Uint8Array): void => undefined;
  const wave = new Promise<Uint8Array>(resolve => { complete = resolve; });
  const verifiedAsset = vi.fn(() => wave);
  const assets = new ClientAssets(f.source, new Map(), { ...f.options, cache: {
    product: () => Promise.resolve(null), putProduct: () => Promise.resolve(),
    asset: () => Promise.reject(new Error('Unexpected unverified read')),
    putAsset: () => Promise.resolve(true), verifiedAsset,
  } });
  const first = assets.read(f.ref), second = assets.read(f.ref);
  expect(verifiedAsset).toHaveBeenCalledTimes(1);
  complete(f.bytes);
  expect(await first).toBe(f.bytes); expect(await second).toBe(f.bytes);
  expect(assets.retained.size).toBe(0);
  expect(await assets.read(f.ref)).toBe(f.bytes);
  expect(verifiedAsset).toHaveBeenCalledTimes(2);
  expect(f.options.hash).not.toHaveBeenCalled();
});

test('a refused concurrent wave keeps its exact guard and a later read retries', async () => {
  const f = fixture(), verifiedAsset = vi.fn(() => Promise.resolve(new Uint8Array([1])));
  const assets = new ClientAssets(f.source, new Map(), { ...f.options, cache: {
    product: () => Promise.resolve(null), putProduct: () => Promise.resolve(),
    asset: () => Promise.resolve(null), putAsset: () => Promise.resolve(true), verifiedAsset,
  } });
  const refused = await Promise.allSettled([assets.read(f.ref), assets.read(f.ref)]);
  expect(verifiedAsset).toHaveBeenCalledTimes(1);
  for (const result of refused) {
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.reason).toEqual(new Error('Resident tile hash or size mismatch'));
  }
  verifiedAsset.mockImplementation(() => Promise.resolve(f.bytes));
  expect(await assets.read(f.ref)).toBe(f.bytes);
  expect(verifiedAsset).toHaveBeenCalledTimes(2);
  await expect(assets.read('b'.repeat(64))).rejects.toThrow('Undeclared resident asset');
  expect(verifiedAsset).toHaveBeenCalledTimes(2);
});

test('distinct declared reads stay parallel and do not share byte owners', async () => {
  const f = fixture(), other = 'b'.repeat(64), row = f.source.files[0];
  if (row === undefined) throw new Error('Missing fixture file');
  f.source.files.push({ ...row, hash: other });
  const completed = new Map<string, (bytes: Uint8Array) => void>();
  const verifiedAsset = vi.fn((hash: string) => new Promise<Uint8Array>(resolve => { completed.set(hash, resolve); }));
  const assets = new ClientAssets(f.source, new Map(), { ...f.options, cache: {
    product: () => Promise.resolve(null), putProduct: () => Promise.resolve(),
    asset: () => Promise.resolve(null), putAsset: () => Promise.resolve(true), verifiedAsset,
  } });
  const first = assets.read(f.ref), second = assets.read(other), bytes = new Uint8Array([4, 5, 6]);
  expect([...completed.keys()]).toEqual([f.ref, other]);
  completed.get(other)?.(bytes); expect(await second).toBe(bytes);
  completed.get(f.ref)?.(f.bytes); expect(await first).toBe(f.bytes);
  expect(assets.retained.size).toBe(0);
});

const flightGc = 'completed read waves release their backing with the asset reader alive';
test(flightGc, async () => {
  await realGc('src/client/game/shardfile/clientAssets.test.ts', flightGc, async collect => {
    const f = fixture(), row = f.source.files[0];
    if (row === undefined) throw new Error('Missing fixture file');
    row.compressed = 1024 * 1024;
    const assets = new ClientAssets(f.source, new Map(), { ...f.options, cache: {
      product: () => Promise.resolve(null), putProduct: () => Promise.resolve(),
      asset: () => Promise.resolve(null), putAsset: () => Promise.resolve(true),
      verifiedAsset: () => Promise.resolve(new Uint8Array(1024 * 1024)),
    } });
    const backing = await (async () => {
      const [first, second] = await Promise.all([assets.read(f.ref), assets.read(f.ref)]);
      if (first === undefined || second === undefined) throw new Error('Missing fixture read');
      expect(first).toBe(second);
      return new WeakRef(first.buffer);
    })();
    await collect(backing);
    expect(assets.retained.size).toBe(0);
    expect((await assets.read(f.ref)).byteLength).toBe(1024 * 1024);
  });
});
