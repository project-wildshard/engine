import {afterAll, afterEach, beforeAll, expect, test, vi} from 'vitest';
import {emptyShardfile} from '../src/shared/host/author';
import {hashImmutableBytes} from '../src/shared/host/immutable';
import {parseOutputIndex} from '@wildshard/format/outputIndex';
import {installTitleManifests, titleManifests, type TitleManifest} from '../src/client/game/shard/titleList';
import {startGridPrefetch, startTitlePrefetch, gridPrefetchStatus} from '../src/client/game/grid/prefetch';
import {startSpawnDownload, adoptCompletedSpawnDownload} from '../src/client/game/boot/spawnDownload';
import {installEntryDownloadTap, startEntryDownload} from '../src/client/game/shardfile/entryTransport';
import {jsonSlot} from '../src/client/engine/saves/slots';
import {LEVEL_DOWNLOAD_SLOT, runtimePacksOn} from '../src/client/engine/boot/loadingPacks';

// These title transports read loose files (DL16 made Runtime packs the shipped default; the packs book has its own
// tests): pin the harness slot to Shardfile before the page's first, frozen read
const download = jsonSlot(LEVEL_DOWNLOAD_SLOT, 'device'), savedDownload = download.read();
beforeAll(() => { download.write('shardfile'); expect(runtimePacksOn()).toBe(false); });
afterAll(() => { download.write(savedDownload); });

const initialStorage = globalThis.localStorage;
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.stubGlobal('localStorage', initialStorage); });

// iPhone downloads I5: the grid prefetch stores a pack's members from one read of the pack, never their own paths.
test.each(['play', 'title', 'title-stop', 'grid-title', 'title-adopt'] as const)('%s uses its exact transport and preserves title cancellation ownership', async mode => {
  const first = new Uint8Array([1, 2]), second = new Uint8Array([3]);
  const hashes = [hashImmutableBytes(first), hashImmutableBytes(second)];
  const packBytes = new Uint8Array([...first, ...second]), packHash = hashImmutableBytes(packBytes), packPath = `blobs/pack/${packHash}.pack`;
  const source = emptyShardfile({slug: 'prefetch-packs', name: 'Packs', author: 'Test', revision: 1, seed: 1});
  const index = parseOutputIndex({format: 'wildshard.shardfile', formatVersion: 2, sdk: '0.2', version: source.version,
    identity: source.identity, requires: source.requires, build: {sourceHash: '0'.repeat(64), validator: 'test'},
    admission: {budgets: source.budgets, serverBudget: source.serverBudget, authorCaps: source.authorCaps, critical: source.critical, library: source.library},
    sections: [], schemas: [], runtime: null, files: [first, second].map((bytes, i) => ({hash: hashes[i] ?? '', kind: 'bin', path: `blobs/bin/${hashes[i] ?? ''}.bin`,
      compressed: bytes.length, decoded: bytes.length, gpu: 0, triangles: 0, draws: 0, dependencies: [], critical: false})),
    packs: [{path: packPath, hash: packHash, bytes: 3, entries: [{hash: hashes[0] ?? '', offset: 0, bytes: 2}, {hash: hashes[1] ?? '', offset: 2, bytes: 1}]}],
  });
  vi.stubEnv('DEV', false);
  vi.stubGlobal('__SHARDFILE_VERDICTS__', [{path: '/alpha/index.json', indexHash: hashImmutableBytes(new TextEncoder().encode(JSON.stringify(index)))}]);
  const title: TitleManifest = {slug: '_template', name: '_template', biome: 'test', status: 'hidden',
    card: {thumb: '', portrait: '', landscape: ''}, shardfile: 'http://localhost/alpha/index.json'};
  let previous: readonly TitleManifest[] = [];
  try {previous = titleManifests();} catch { /* This isolated test need not install runnable worlds. */ }
  installTitleManifests([title]);
  const reads: string[] = [], disk = new Map<string, Response>();
  const spawn = JSON.stringify({version: 1, shard: '_template', tier: 'phone', flow: mode === 'grid-title' ? 'grid' : 'client', totalBytes: 3,
    files: [first, second].map((bytes, i) => ({url: `/alpha/blobs/bin/${hashes[i] ?? ''}.bin`, hash: hashes[i], bytes: bytes.length}))});
  const address = {url: `/assets/spawn/template-${mode}-1234567890abcdef.json`, bytes: spawn.length, totalBytes: 3, files: 2};
  vi.stubGlobal('document', {baseURI: 'http://localhost/', getElementById: () => ({textContent: JSON.stringify({spawnManifests: {
    cacheName: 'ws-assets-v1', client: {_template: {phone: address, desktop: address}},
    grid: {'100': {_template: {phone: address, desktop: address}}}}})})});
  const urlOf = (input: RequestInfo | URL): string => input instanceof Request ? input.url : String(input);
  const cache: Cache = {
    add: () => Promise.reject(new Error('Unexpected unverified cache add')),
    addAll: () => Promise.reject(new Error('Unexpected unverified cache addAll')),
    matchAll: () => Promise.resolve([...disk.values()].map(response => response.clone())),
    match: (input: RequestInfo | URL) => Promise.resolve(disk.get(urlOf(input))?.clone()),
    put: (input: RequestInfo | URL, response: Response): Promise<void> => {disk.set(urlOf(input), response.clone()); return Promise.resolve();},
    delete: (input: RequestInfo | URL) => Promise.resolve(disk.delete(urlOf(input))),
    keys: () => Promise.resolve([...disk.keys()].map(url => new Request(url))),
  };
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('location', {href: 'http://localhost/', origin: 'http://localhost'});
  vi.stubGlobal('navigator', {onLine: true, connection: {saveData: mode !== 'play'}, storage: {persist: () => Promise.resolve(true), estimate: () => Promise.resolve({usage: 0, quota: 1024 ** 3})}});
  vi.stubGlobal('caches', {open: () => Promise.resolve(cache), delete: () => Promise.resolve(true)});
  vi.stubGlobal('Worker', undefined);
  let aborted = false;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlOf(input); reads.push(url);
    if (mode === 'title-stop' && url.endsWith('.bin')) return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal === undefined || signal === null) { reject(new Error('Missing title abort signal')); return; }
      signal.addEventListener('abort', () => {aborted = true; reject(new DOMException('Title left', 'AbortError'));}, {once: true});
    });
    return Promise.resolve(new URL(url).pathname.endsWith('/index.json') ? Response.json(index) : url.endsWith('.pack') ? new Response(packBytes)
      : url.endsWith(address.url) ? new Response(spawn) : url.endsWith(`${hashes[0] ?? ''}.bin`) ? new Response(first)
      : url.endsWith(`${hashes[1] ?? ''}.bin`) ? new Response(second) : new Response(null, {status: 404}));
  });
  try {
    const titleRun = mode === 'play' ? null : startTitlePrefetch('_template', mode === 'grid-title' ? 'grid' : 'client', '100');
    if (mode === 'play') startGridPrefetch(['_template']);
    else expect(titleRun).not.toBeNull();
    if (mode === 'title-adopt') {
      const foreground = startSpawnDownload('_template', 'client', 'phone');
      if (foreground === null) throw new Error('Missing foreground adoption');
      expect(adoptCompletedSpawnDownload('_template', 'client', 'phone')).toBeNull();
      titleRun?.stop(); await foreground.ready;
      expect(foreground.snapshot().complete).toBe(true); expect(aborted).toBe(false);
      // A late title callback cannot start or replace the active world's job.
      expect(startTitlePrefetch('_template')).toBeNull();
      const readsBefore = reads.length;
      expect(adoptCompletedSpawnDownload('_template', 'client', 'phone')).toBe(foreground);
      expect(adoptCompletedSpawnDownload('_template', 'grid', 'phone')).toBeNull();
      expect(adoptCompletedSpawnDownload('absent', 'client', 'phone')).toBeNull();
      address.totalBytes++;
      expect(adoptCompletedSpawnDownload('_template', 'client', 'phone')).toBeNull();
      address.totalBytes--;
      expect(reads).toHaveLength(readsBefore);
    }
    if (mode === 'title-stop') {
      await vi.waitFor(() => {expect(reads).toContain(`http://localhost/alpha/blobs/bin/${hashes[0] ?? ''}.bin`);});
      titleRun?.stop();
      expect(aborted).toBe(true);
      expect(reads).toHaveLength(3);
      expect([...disk.keys()].filter(url => hashes.some(hash => url.endsWith(`/${hash}`)))).toEqual([]);
      return;
    }
    await vi.waitFor(() => {expect((titleRun?.snapshot() ?? gridPrefetchStatus())?.phase).toBe('done');});
    expect(reads).toEqual(mode === 'play' ? [`http://localhost/alpha/index.json?v=${hashImmutableBytes(new TextEncoder().encode(JSON.stringify(index))).slice(0,8)}`, `http://localhost/alpha/${packPath}`]
      : [`http://localhost${address.url}`, ...hashes.map(hash => `http://localhost/alpha/blobs/bin/${hash}.bin`)]);
    expect(titleRun?.snapshot() ?? gridPrefetchStatus()).toMatchObject({knownFiles: 2, knownBytes: 3, storedFiles: 2, storedBytes: 3});
    titleRun?.stop();
  } finally { installTitleManifests(previous); }
});

test('title tap ownership is synchronous, disposable and cannot block navigation', () => {
  vi.stubGlobal('document', {getElementById: () => null});
  const first = vi.fn(() => true), second = vi.fn(() => true);
  const stopFirst = installEntryDownloadTap(first);
  try {
    startEntryDownload('example');
    expect(first).toHaveBeenCalledExactlyOnceWith('example', 'client');
    const stopSecond = installEntryDownloadTap(second);
    try {
      stopFirst(); startEntryDownload('example', 'grid');
      expect(second).toHaveBeenCalledExactlyOnceWith('example', 'grid');
    } finally {stopSecond();}
    startEntryDownload('example'); expect(second).toHaveBeenCalledTimes(1);
    const stopBroken = installEntryDownloadTap(() => {throw new Error('Optional title painter retired');});
    try {expect(() => startEntryDownload('example')).not.toThrow();} finally {stopBroken();}
  } finally {stopFirst();}
});
