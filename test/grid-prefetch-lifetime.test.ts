import {afterEach, expect, test, vi} from 'vitest';
import {emptyShardfile} from '../src/shared/host/author';
import {hashImmutableBytes} from '../src/shared/host/immutable';
import {parseOutputIndex} from '@wildshard/format/outputIndex';
import {installTitleManifests, titleManifests, type TitleManifest} from '../src/client/game/shard/titleList';
import {startGridPrefetch, gridPrefetchStatus} from '../src/client/game/grid/prefetch';

afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();});

test('completed prefetch releases dedupe hashes after their last live reader', async () => {
  const first = new Uint8Array([1]), second = new Uint8Array([2]);
  const hashes = [hashImmutableBytes(first), hashImmutableBytes(second)];
  const source = emptyShardfile({slug: 'prefetch-history', name: 'History', author: 'Test', revision: 1, seed: 1});
  const index = parseOutputIndex({format: 'wildshard.shardfile', formatVersion: 2, sdk: '0.2', version: source.version,
    identity: source.identity, requires: source.requires, build: {sourceHash: '0'.repeat(64), validator: 'test'},
    admission: {budgets: source.budgets, serverBudget: source.serverBudget, authorCaps: source.authorCaps, critical: source.critical, library: source.library},
    sections: [], schemas: [], runtime: null, files: hashes.map(hash => ({hash, kind: 'bin', path: `blobs/bin/${hash}.bin`,
      compressed: 1, decoded: 1, gpu: 0, triangles: 0, draws: 0, dependencies: [], critical: false})),
  });
  vi.stubEnv('DEV', false);
  vi.stubGlobal('__SHARDFILE_VERDICTS__', ['alpha', 'beta'].map(path => ({ path: `/${path}/index.json`, indexHash: hashImmutableBytes(new TextEncoder().encode(JSON.stringify(index))) })));
  const title = (slug: '_template' | 'blender-template', path: string): TitleManifest => ({slug, name: slug, biome: 'test', status: 'hidden',
    card: {thumb: '', portrait: '', landscape: ''}, shardfile: `http://localhost/${path}/index.json`});
  let previous: readonly TitleManifest[] = [];
  try {previous = titleManifests();} catch { /* This isolated test need not install runnable worlds. */ }
  installTitleManifests([title('_template', 'alpha'), title('blender-template', 'beta')]);
  let release: (() => void) | undefined;
  const pending = new Promise<void>(resolve => {release = resolve;});
  const reads: string[] = [], disk = new Map<string, Response>(), writes: string[] = [];
  const urlOf = (input: RequestInfo | URL): string => input instanceof Request ? input.url : String(input);
  const cache: Cache = {
    add: () => Promise.reject(new Error('Unexpected unverified cache add')),
    addAll: () => Promise.reject(new Error('Unexpected unverified cache addAll')),
    matchAll: () => Promise.reject(new Error('Unexpected bulk cache read')),
    match: (input: RequestInfo | URL) => Promise.resolve(disk.get(urlOf(input))?.clone()),
    put: (input: RequestInfo | URL, response: Response): Promise<void> => {const url = urlOf(input); writes.push(url); disk.set(url, response.clone()); return Promise.resolve();},
    delete: (input: RequestInfo | URL) => Promise.resolve(disk.delete(urlOf(input))),
    keys: () => Promise.resolve([...disk.keys()].map(url => new Request(url))),
  };
  const storage = {open: () => Promise.resolve(cache), delete: () => Promise.resolve(true)};
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('location', {href: 'http://localhost/', origin: 'http://localhost'});
  vi.stubGlobal('navigator', {onLine: true, storage: {
    persist: () => Promise.resolve(true), estimate: () => Promise.resolve({usage: 0, quota: 1024 ** 3}),
  }});
  vi.stubGlobal('caches', storage);
  vi.stubGlobal('Worker', undefined);
  const fetcher: typeof fetch = async input => {
    const url = urlOf(input); reads.push(url);
    if (new URL(url).pathname.endsWith('/index.json')) return Response.json(index);
    if (url.endsWith(`/${hashes[1]}.bin`)) await pending;
    return new Response(url.endsWith(`/${hashes[0]}.bin`) ? first : second);
  };
  vi.stubGlobal('fetch', fetcher);
  const has = vi.spyOn(Set.prototype, 'has'), clear = vi.spyOn(Set.prototype, 'clear');
  try {
    startGridPrefetch(['_template', 'blender-template']);
    await vi.waitFor(() => {expect(reads).toContain(`http://localhost/alpha/blobs/bin/${hashes[1]}.bin`);});
    expect(gridPrefetchStatus()).toMatchObject({phase: 'running', shardfiles: 2, knownFiles: 2});
    startGridPrefetch(['_template', 'blender-template']);
    if (release === undefined) throw new Error('Missing pending-file release');
    release();
    await vi.waitFor(() => {expect(gridPrefetchStatus()?.phase).toBe('done');});
    expect(reads).toEqual([
      `http://localhost/alpha/index.json?v=${hashImmutableBytes(new TextEncoder().encode(JSON.stringify(index))).slice(0,8)}`, `http://localhost/alpha/blobs/bin/${hashes[0]}.bin`,
      `http://localhost/alpha/blobs/bin/${hashes[1]}.bin`, `http://localhost/beta/index.json?v=${hashImmutableBytes(new TextEncoder().encode(JSON.stringify(index))).slice(0,8)}`,
    ]);
    // The second product's successful hash lookup identifies the actual live
    // cross-product dedupe Set, without replacing any module or private API.
    const hit = has.mock.calls.findIndex((args, i) => args[0] === hashes[0] && has.mock.results[i]?.value === true);
    expect(hit).toBeGreaterThanOrEqual(0);
    const history: unknown = has.mock.contexts[hit];
    if (!(history instanceof Set)) throw new Error('Missing live dedupe history');
    expect(clear.mock.contexts).toContain(history);
    expect(history.size).toBe(0);
    expect(writes.filter(url => hashes.some(hash => url.endsWith(`/${hash}.bin`)))).toHaveLength(2);
    const done = gridPrefetchStatus();
    expect(done).toMatchObject({shardfiles: 2, shardfilesRead: 2, knownFiles: 2, knownBytes: 2, storedFiles: 2, storedBytes: 2, inFlightBytes: 0});
    expect(window.__ws_gridPrefetch?.()).toEqual(done);
    startGridPrefetch(['blender-template']);
    expect(gridPrefetchStatus()).toEqual(done);
    expect(reads).toHaveLength(4);
  } finally {
    release?.();
    installTitleManifests(previous);
  }
});
