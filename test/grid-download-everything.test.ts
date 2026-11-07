import {afterEach, expect, test, vi} from 'vitest';
import {emptyShardfile} from '../src/shared/host/author';
import {hashImmutableBytes} from '../src/shared/host/immutable';
import {parseOutputIndex} from '@wildshard/format/outputIndex';
import {installTitleManifests, titleManifests, type TitleManifest} from '../src/client/game/shard/titleList';
import {Scope} from '../src/shared/engine/app/scope';
import {saves} from '../src/shared/engine/saves/runtime';

afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();});

test('Download everything reads every product past Save-Data in a fresh run, and reports its bytes (G727, I9)', async () => {
  const {startGridPrefetch, gridPrefetchStatus, downloadEverything, remainingDownloadBytes} = await import('../src/client/game/grid/prefetch');
  const bodies = [new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])], hashes = bodies.map(body => hashImmutableBytes(body));
  const indexOf = (slug: string, file: number) => {
    const source = emptyShardfile({slug, name: slug, author: 'Test', revision: 1, seed: 1});
    return parseOutputIndex({format: 'wildshard.shardfile', formatVersion: 2, sdk: '0.2', version: source.version,
      identity: source.identity, requires: source.requires, build: {sourceHash: '0'.repeat(64), validator: 'test'},
      admission: {budgets: source.budgets, serverBudget: source.serverBudget, authorCaps: source.authorCaps, critical: source.critical, library: source.library},
      sections: [], schemas: [], runtime: null, files: [{hash: hashes[file] ?? '', kind: 'bin', path: `blobs/bin/${hashes[file] ?? ''}.bin`,
        compressed: bodies[file]?.length ?? 0, decoded: bodies[file]?.length ?? 0, gpu: 0, triangles: 0, draws: 0, dependencies: [], critical: false}]});
  };
  const indexes = new Map([['home', indexOf('download-home', 0)], ['far', indexOf('download-far', 1)]]);
  // no build index hashes (as in dev): the phone path keeps each checked index without rebuilding its whole product
  vi.stubEnv('DEV', true);
  const title = (slug: '_template' | 'blender-template', path: string): TitleManifest => ({slug, name: slug, biome: 'test', status: 'hidden',
    card: {thumb: '', portrait: '', landscape: ''}, shardfile: `http://localhost/${path}/index.json`});
  let previous: readonly TitleManifest[] = [];
  try {previous = titleManifests();} catch { /* This isolated test need not install runnable worlds. */ }
  installTitleManifests([title('_template', 'home'), title('blender-template', 'far')]);
  const disk = new Map<string, Response>(), reads: string[] = [];
  const urlOf = (input: RequestInfo | URL): string => input instanceof Request ? input.url : String(input);
  const cache: Cache = {
    add: () => Promise.reject(new Error('Unexpected unverified cache add')), addAll: () => Promise.reject(new Error('Unexpected unverified cache addAll')),
    matchAll: () => Promise.reject(new Error('Unexpected bulk cache read')),
    match: (input: RequestInfo | URL) => Promise.resolve(disk.get(urlOf(input))?.clone()),
    put: (input: RequestInfo | URL, response: Response): Promise<void> => {disk.set(urlOf(input), response.clone()); return Promise.resolve();},
    delete: (input: RequestInfo | URL) => Promise.resolve(disk.delete(urlOf(input))),
    keys: () => Promise.resolve([...disk.keys()].map(url => new Request(url))),
  };
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('location', {href: 'http://localhost/', origin: 'http://localhost'});
  // Save-Data on: an ordinary prefetch would stop; the player's explicit download does not
  vi.stubGlobal('navigator', {onLine: true, connection: {saveData: true}, storage: {persist: () => Promise.resolve(true), estimate: () => Promise.resolve({usage: 0, quota: 1024 ** 3})}});
  vi.stubGlobal('caches', {open: () => Promise.resolve(cache), delete: () => Promise.resolve(true)});
  vi.stubGlobal('Worker', undefined);
  vi.spyOn(saves, 'persist').mockResolvedValue(true);
  vi.stubGlobal('fetch', ((input: RequestInfo | URL) => {
    const url = urlOf(input); reads.push(url);
    for (const [path, index] of indexes) if (url === `http://localhost/${path}/index.json`) return Promise.resolve(Response.json(index));
    const file = hashes.findIndex(hash => url.endsWith(`${hash}.bin`));
    return Promise.resolve(new Response(bodies[file] ?? new Uint8Array()));
  }) satisfies typeof fetch);
  const owner = new Scope('download-everything');
  try {
    expect(await remainingDownloadBytes()).toBe(5);
    // the background run (Save-Data on) stops before reading; the player's download then starts a fresh one
    startGridPrefetch(['_template', 'blender-template'], ['_template']);
    await vi.waitFor(() => {expect(gridPrefetchStatus()?.phase).not.toBe('running');});
    expect(gridPrefetchStatus()?.reason).toBe('save-data'); // the background prefetch respects Save-Data
    const progress: [number, number][] = [];
    expect(await downloadEverything(owner, (done, total) => {progress.push([done, total]);})).toBe('done');
    expect(reads).toContain(`http://localhost/far/blobs/bin/${hashes[1] ?? ''}.bin`);
    expect(progress.at(-1)).toEqual([5, 5]);
    expect(await remainingDownloadBytes()).toBe(0);
  } finally { owner.dispose(); installTitleManifests(previous); }
});
