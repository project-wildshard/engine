import { afterEach, expect, test, vi } from 'vitest';
import { emptyShardfile } from '../src/shared/host/author';
import { hashImmutableBytes } from '../src/shared/host/immutable';
import { parseOutputIndex } from '@wildshard/format/outputIndex';
import { installTitleManifests, titleManifests, type TitleManifest } from '../src/client/game/shard/titleList';
import { startGridPrefetch, gridPrefetchStatus } from '../src/client/game/grid/prefetch';
import { ASSET_CACHE_NAME } from '../src/client/engine/pwa/cacheNames';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
test('prefetch publishes canonical URL bytes and durable progress in the worker store', async () => {
  const body = new Uint8Array([7, 8, 9]), hash = hashImmutableBytes(body);
  const source = emptyShardfile({ slug: 'native-progress', name: 'Native progress', author: 'Test', revision: 1, seed: 1 });
  const index = parseOutputIndex({ format: 'wildshard.shardfile', formatVersion: 2, sdk: '0.2', version: source.version,
    identity: source.identity, requires: source.requires, build: { sourceHash: '0'.repeat(64), validator: 'test' },
    admission: { budgets: source.budgets, serverBudget: source.serverBudget, authorCaps: source.authorCaps, critical: source.critical, library: source.library },
    sections: [], schemas: [], runtime: null, files: [{ hash, kind: 'bin', path: `blobs/bin/${hash}.bin`,
      compressed: 3, decoded: 3, gpu: 0, triangles: 0, draws: 0, dependencies: [], critical: false }],
  });
  const disk = new Map<string, Response>(), stores: string[] = [];
  const urlOf = (input: RequestInfo | URL): string => typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const cache: Cache = {
    add: () => Promise.reject(new Error('No unbounded add')), addAll: () => Promise.reject(new Error('No unbounded addAll')),
    matchAll: () => Promise.reject(new Error('No body inventory')),
    match: input => Promise.resolve(disk.get(urlOf(input))?.clone()),
    put: (input, response) => { disk.set(urlOf(input), response.clone()); return Promise.resolve(); },
    delete: input => Promise.resolve(disk.delete(urlOf(input))), keys: () => Promise.resolve([...disk.keys()].map(key => new Request(key))),
  };
  const storage = { open: (name: string) => { stores.push(name); return Promise.resolve(cache); } };
  let previous: readonly TitleManifest[] = [];
  try { previous = titleManifests(); } catch { /* Isolated metadata fixture. */ }
  vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('location', { href: 'http://localhost/', origin: 'http://localhost' });
  vi.stubGlobal('navigator', { onLine: true, storage: { persist: () => Promise.resolve(true), estimate: () => Promise.resolve({ usage: 0, quota: 1024 ** 3 }) } });
  vi.stubGlobal('caches', storage); vi.stubGlobal('Worker', vi.fn(() => { throw new Error('No cache worker'); }));
  vi.stubEnv('DEV', false);
  vi.stubGlobal('__SHARDFILE_VERDICTS__', [{ path: '/product/index.json', indexHash: hashImmutableBytes(new TextEncoder().encode(JSON.stringify(index))) }]);
  installTitleManifests([{ slug: '_template', name: 'Test', biome: 'test', status: 'hidden', card: { thumb: '', portrait: '', landscape: '' },
    shardfile: 'http://localhost/product/index.json' }]);
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => Promise.resolve(new URL(urlOf(input)).pathname.endsWith('/index.json') ? Response.json(index) : new Response(body)));
  try {
    startGridPrefetch(['_template']); await vi.waitFor(() => { expect(gridPrefetchStatus()?.phase).toBe('done'); });
    expect(gridPrefetchStatus()).toMatchObject({ knownFiles: 1, knownBytes: 3, storedFiles: 1, storedBytes: 3, inFlightBytes: 0 });
    const held = disk.get(`http://localhost/product/blobs/bin/${hash}.bin`);
    if (held === undefined) throw new Error('Missing canonical stored response');
    expect(new Uint8Array(await held.arrayBuffer())).toEqual(body);
    expect(new Set(stores)).toEqual(new Set([ASSET_CACHE_NAME]));
  } finally { installTitleManifests(previous); }
});
