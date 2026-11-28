import {expect, test, vi} from 'vitest';
import {downloadSpawnManifest, optionalCodePaths, pageLoadedCode, type SpawnDownloadSnapshot} from '../src/client/game/boot/spawnDownload';
import {readSpawnManifest} from '../src/shared/game/shardfile/spawnManifest';

const files = [{url: `/shardfiles/example/blobs/bin/${'a'.repeat(64)}.bin`, bytes: 4, hash: 'a'.repeat(64)},
  {url: '/assets/code-12345678.js', bytes: 3, hash: 'b'.repeat(64)}];
const manifest = {version: 1, shard: 'example', tier: 'phone', flow: 'client', files, totalBytes: 7};
const text = JSON.stringify(manifest), address = {url: '/assets/spawn/example-1234567890abcdef.json', bytes: text.length, totalBytes: 7, files: 2};
const base = 'https://example.test/';

test('cold progress is exactly the one list, with a fixed denominator and no unrelated credit', async () => {
  const reads: string[] = [], snapshots: SpawnDownloadSnapshot[] = [];
  const download = downloadSpawnManifest(address, {cached: () => Promise.resolve(undefined), fetch: url => {
    reads.push(new URL(url).pathname);
    return Promise.resolve(new Response(url.endsWith('.json') ? text : new Uint8Array(url.endsWith('.js') ? 3 : 4)));
  }}, base);
  download.subscribe(row => {snapshots.push(row);}); await download.ready;
  expect(reads).toEqual([address.url, ...files.map(row => row.url)]);
  expect(download.snapshot()).toEqual({progressKnown: true, totalBytes: 7, completedBytes: 7, cachedBytes: 0, filesTotal: 2, filesDone: 2, complete: true, error: null, streamedBytes: 7});
  expect(snapshots.every(row => row.totalBytes === 7 && row.completedBytes <= 7)).toBe(true);
  expect(snapshots.map(row => row.completedBytes)).toEqual(snapshots.map(row => row.completedBytes).sort((a, b) => a - b));
});

test('a warm list completes from native presence without fetching or reading any cached file body', async () => {
  const unread: (() => void)[] = [];
  const download = downloadSpawnManifest(address, {cached: url => Promise.resolve(url.endsWith('.json') ? new Response(text)
    : (() => {const response = new Response(new Uint8Array(4)), body = response.body;
      if (body === null) throw new Error('Missing cache body');
      const reader = vi.spyOn(body, 'getReader'); unread.push(() => {expect(reader).not.toHaveBeenCalled();}); return response;})()),
    fetch: () => Promise.reject(new Error('Warm files must not be fetched'))}, base);
  await download.ready;
  for (const check of unread) check();
  expect(download.snapshot()).toMatchObject({complete: true, completedBytes: 7, cachedBytes: 7, filesDone: 2});
});

test('one native metadata census completes a warm list without per-file cache calls', async () => {
  const cached = vi.fn((url: string) => {
    if (!url.endsWith('.json')) throw new Error('Unexpected individual file census');
    return Promise.resolve(new Response(text));
  });
  const present = vi.fn((urls: readonly string[]) => Promise.resolve(new Set(urls))), fetch = vi.fn(() => Promise.reject(new Error('Unexpected warm network')));
  const download = downloadSpawnManifest(address, {cached, present, fetch}, base); await download.ready;
  expect(present).toHaveBeenCalledExactlyOnceWith(files.map(row => new URL(row.url, base).href));
  expect(cached).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled();
  expect(download.snapshot()).toMatchObject({complete: true, cachedBytes: 7, filesDone: 2});
});

test('a cache too big for the native census is read file by file: the player is not refused a held level', async () => {
  const tooLarge = () => Promise.reject(new DOMException('Operation too large', 'UnknownError'));
  const cached = vi.fn(() => Promise.resolve(new Response(text))), present = vi.fn(tooLarge), fetch = vi.fn(() => Promise.reject(new Error('Unexpected warm network')));
  const download = downloadSpawnManifest(address, {cached, present, fetch}, base); await download.ready;
  expect(present).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled();
  expect(download.snapshot()).toMatchObject({complete: true, cachedBytes: 7, filesDone: 2});
});

test('a pending cache census keeps its fixed total but publishes no invented zero percentage', async () => {
  let release: (urls: ReadonlySet<string>) => void = () => undefined;
  const present = new Promise<ReadonlySet<string>>(resolve => {release = resolve;});
  const snapshots: SpawnDownloadSnapshot[] = [];
  const download = downloadSpawnManifest(address, {
    cached: url => Promise.resolve(url.endsWith('.json') ? new Response(text) : undefined),
    present: () => present,
    fetch: () => Promise.reject(new Error('Warm bodies must not be fetched')),
  }, base);
  download.subscribe(row => {snapshots.push(row);});
  expect(download.snapshot()).toMatchObject({totalBytes: 7, progressKnown: false, complete: false});
  release(new Set(files.map(file => new URL(file.url, base).href)));
  await download.ready;
  expect(snapshots.filter(row => row.progressKnown)).toEqual([
    {progressKnown: true, totalBytes: 7, completedBytes: 7, cachedBytes: 7, filesTotal: 2, filesDone: 2, complete: true, error: null, streamedBytes: 7},
  ]);
});

test('a warm check counts each file as its own lookup lands, behind the slowest', async () => {
  let release: (hit: Response) => void = () => undefined;
  const slowest = new Promise<Response>(resolve => {release = resolve;});
  const download = downloadSpawnManifest(address, {
    cached: url => url.endsWith('.json') ? Promise.resolve(new Response(text))
      : url.endsWith('.js') ? slowest : new Promise(resolve => {setTimeout(() => {resolve(new Response(new Uint8Array(4)));}, 150);}),
    fetch: () => Promise.reject(new Error('Warm bodies must not be fetched')),
  }, base);
  await vi.waitFor(() => {expect(download.snapshot()).toMatchObject({progressKnown: true, completedBytes: 4, cachedBytes: 4, filesDone: 1, complete: false});});
  release(new Response(new Uint8Array(3)));
  await download.ready;
  expect(download.snapshot()).toMatchObject({completedBytes: 7, cachedBytes: 7, filesDone: 2, complete: true});
});

test.each([2, 5])('a short/oversized body (%s) never completes or exceeds the manifest total', async count => {
  const download = downloadSpawnManifest({...address, files: 1, totalBytes: 4, bytes: JSON.stringify({...manifest, files: [files[0]], totalBytes: 4}).length}, {
    cached: () => Promise.resolve(undefined), fetch: url => Promise.resolve(new Response(url.endsWith('.json') ? JSON.stringify({...manifest, files: [files[0]], totalBytes: 4}) : new Uint8Array(count))),
  }, base);
  await expect(download.ready).rejects.toThrow('size differs');
  expect(download.snapshot().complete).toBe(false); expect(download.snapshot().completedBytes).toBeLessThanOrEqual(4);
});

test('bad totals/duplicate URLs refuse, and an error cached response is a miss', async () => {
  expect(() => readSpawnManifest({...manifest, totalBytes: 8})).toThrow('total differs');
  expect(() => readSpawnManifest({...manifest, files: [files[0], files[0]], totalBytes: 8})).toThrow('spawn file');
  const reads: string[] = [];
  const download = downloadSpawnManifest(address, {cached: url => Promise.resolve(url.endsWith('.json') ? new Response(text) : new Response(null, {status: 404})), fetch: url => {
    reads.push(url); return Promise.resolve(new Response(url.endsWith('.json') ? text : new Uint8Array(url.endsWith('.js') ? 3 : 4)));
  }}, base);
  await download.ready; expect(reads).toEqual(files.map(row => new URL(row.url, base).href));
  expect(download.snapshot()).toMatchObject({complete: true, cachedBytes: 0});
});

test('an uncontrolled first install fills the same cache before the next warm presence census', async () => {
  const stored = new Map<string, Uint8Array>(); let reads = 0;
  const ports = {
    cached: (url: string) => {const bytes = stored.get(url); return Promise.resolve(bytes === undefined ? undefined : new Response(new Uint8Array(bytes)));},
    fetch: (url: string) => {reads++; return Promise.resolve(new Response(url.endsWith('.json') ? text : new Uint8Array(url.endsWith('.js') ? 3 : 4)));},
    store: async (url: string, response: Response) => {stored.set(url, new Uint8Array(await response.arrayBuffer()));},
  };
  const cold = downloadSpawnManifest(address, ports, base); await cold.ready;
  expect(reads).toBe(3); expect(stored.size).toBe(3);
  expect(cold.snapshot()).toMatchObject({complete: true, cachedBytes: 0, completedBytes: 7});
  const warm = downloadSpawnManifest(address, ports, base); await warm.ready;
  expect(reads).toBe(3); expect(warm.snapshot()).toMatchObject({complete: true, cachedBytes: 7, completedBytes: 7});
});

test('a dropped spawn body retries once without duplicate progress or publishing its partial clone', async () => {
  const snapshots: SpawnDownloadSnapshot[] = [], stored = new Map<string, {bytes: Uint8Array; type: string | null}>();
  const requests: {url: string; cache: RequestCache | undefined}[] = [];
  let attempts = 0;
  const download = downloadSpawnManifest(address, {cached: () => Promise.resolve(undefined),
    fetch: (url, _signal, init) => {
      requests.push({url, cache: init?.cache});
      if (url.endsWith('.json')) return Promise.resolve(new Response(text, {headers: {'content-type': 'application/json'}}));
      if (url.endsWith('.js')) return Promise.resolve(new Response(new Uint8Array([7, 8, 9]), {headers: {'content-type': 'application/javascript'}}));
      if (++attempts === 1) {
        let pulls = 0;
        return Promise.resolve(new Response(new ReadableStream<Uint8Array>({pull(controller) {
          if (++pulls === 1) controller.enqueue(new Uint8Array([1, 2]));
          else controller.error(new TypeError('Synthetic connection dropped'));
        }}, {highWaterMark: 0})));
      }
      return Promise.resolve(new Response(new Uint8Array([1, 2, 3, 4]), {headers: {'content-type': 'application/octet-stream'}}));
    }, store: async (url, response) => {stored.set(url, {bytes: new Uint8Array(await response.arrayBuffer()), type: response.headers.get('content-type')});},
  }, base);
  download.subscribe(row => {snapshots.push(row);}); await download.ready;
  expect(attempts).toBe(2);
  expect(requests.filter(row => row.url.endsWith('.bin')).map(row => row.cache)).toEqual([undefined, 'reload']);
  expect(snapshots.every((row, index) => row.totalBytes === 7 && row.completedBytes <= 7 && row.completedBytes >= (snapshots[index - 1]?.completedBytes ?? 0))).toBe(true);
  expect(download.snapshot()).toMatchObject({complete: true, completedBytes: 7, filesDone: 2});
  expect(stored.get(new URL(files[0]?.url ?? '', base).href)?.bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
  expect(stored.get(new URL(files[1]?.url ?? '', base).href)?.type).toBe('application/javascript');
  expect(stored.size).toBe(3);
});

test('a cached HTML content response is a miss without reading or crediting its body', async () => {
  const html = new Response('<html>missing</html>', {headers: {'content-type': 'text/html'}});
  if (html.body === null) throw new Error('Missing HTML fixture body');
  const read = vi.spyOn(html.body, 'getReader');
  const download = downloadSpawnManifest(address, {
    cached: url => Promise.resolve(url.endsWith('.json') ? new Response(text) : html),
    fetch: url => Promise.resolve(new Response(new Uint8Array(url.endsWith('.js') ? 3 : 4))),
  }, base);
  await download.ready;
  expect(read).not.toHaveBeenCalled();
  expect(download.snapshot()).toMatchObject({complete: true, cachedBytes: 0, completedBytes: 7});
});

test('encoded text sizes never replace decoded body bounds or cache progress', async () => {
  const encoded = {...manifest, files: files.map(file => ({...file, wireBytes: 1})), wireBytes: 2};
  const encodedText = JSON.stringify(encoded), selected = {...address, bytes: encodedText.length, wireBytes: 2};
  const ports = {cached: () => Promise.resolve(undefined), fetch: (url: string) => Promise.resolve(new Response(url.endsWith('.json') ? encodedText : new Uint8Array(url.endsWith('.js') ? 3 : 4)))};
  const cold = downloadSpawnManifest(selected, ports, base); await cold.ready;
  expect(cold.snapshot()).toMatchObject({totalBytes: 7, completedBytes: 7, cachedBytes: 0, complete: true,
    wire: {totalBytes: 2, completedBytes: 2, cachedBytes: 0}});
  const warm = downloadSpawnManifest(selected, {...ports, cached: (url: string) => Promise.resolve(url.endsWith('.json') ? new Response(encodedText) : new Response(new Uint8Array(1)))}, base);
  await warm.ready;
  expect(warm.snapshot()).toMatchObject({completedBytes: 7, cachedBytes: 7, wire: {totalBytes: 2, completedBytes: 2, cachedBytes: 2}});
  const short = downloadSpawnManifest(selected, {...ports, fetch: (url: string) => Promise.resolve(new Response(url.endsWith('.json') ? encodedText : new Uint8Array(1)))}, base);
  await expect(short.ready).rejects.toThrow('size differs');
  expect(short.snapshot().complete).toBe(false);
  expect(() => readSpawnManifest({...encoded, wireBytes: 3})).toThrow('wire total differs');
  expect(() => readSpawnManifest({...encoded, files})).toThrow('wire total differs');
});

test('LD2: the warm check is one named span with its file count, failed when the check fails', async () => {
  const spans: {operation: string; detail: unknown; result?: string}[] = [];
  Reflect.set(globalThis, '__bootTiming', {version: 1, begin: (operation: string, detail: unknown) => spans.push({operation, detail}) - 1,
    end: (id: number, result: string) => { const span = spans[id]; if (span !== undefined) span.result = result; },
    mark: () => undefined, progress: () => undefined});
  try {
    const warm = downloadSpawnManifest(address, {cached: () => Promise.resolve(new Response(text)), fetch: () => Promise.reject(new Error('Unexpected warm network'))}, base);
    await warm.ready;
    const broken = downloadSpawnManifest(address, {cached: url => url.endsWith('.json') ? Promise.resolve(new Response(text)) : Promise.reject(new Error('native cache refused')),
      fetch: () => Promise.reject(new Error('Unexpected network'))}, base);
    await expect(broken.ready).rejects.toThrow('native cache refused');
    expect(spans.filter(row => row.operation === 'download:cache-check')).toEqual([
      {operation: 'download:cache-check', detail: {files: 2}, result: 'complete'},
      {operation: 'download:cache-check', detail: {files: 2}, result: 'failed'}]);
  } finally { Reflect.deleteProperty(globalThis, '__bootTiming'); }
});

test('LD2: a cancel ends the warm check span at once, even while a native cache call never returns', async () => {
  const spans: {operation: string; result?: string}[] = [];
  Reflect.set(globalThis, '__bootTiming', {version: 1, begin: (operation: string) => spans.push({operation}) - 1,
    end: (id: number, result: string) => { const span = spans[id]; if (span !== undefined) span.result = result; },
    mark: () => undefined, progress: () => undefined});
  try {
    let listed = (): void => undefined; const reached = new Promise<void>(resolve => { listed = resolve; });
    const download = downloadSpawnManifest(address, {cached: url => { if (url.endsWith('.json')) return Promise.resolve(new Response(text)); listed(); return new Promise<undefined>(() => undefined); },
      fetch: () => Promise.reject(new Error('Unexpected network'))}, base);
    void download.ready.catch(() => undefined);
    await reached; download.cancel(); await Promise.resolve(); await Promise.resolve();
    expect(spans.filter(row => row.operation === 'download:cache-check')).toEqual([{operation: 'download:cache-check', result: 'cancelled'}]);
  } finally { Reflect.deleteProperty(globalThis, '__bootTiming'); }
});

// QA-FEEDBACK-2026-11-23-b row 23 (J501): staging Driftwood's boot stuck at `finish` on "Spawn file size differs:
// /shardfiles/brasscap-mesa/discovery.json". A neighbour's bad file is skipped (and reported); this zone's own bad file still refuses.
test('a neighbour\'s file that differs never blocks the zone\'s boot; the zone\'s own still refuses', async () => {
  const neighbour = {url: '/shardfiles/brasscap-mesa/discovery.json', bytes: 5, hash: 'c'.repeat(64)};
  const own = {...manifest, files: [...files, neighbour], totalBytes: 12}, ownText = JSON.stringify(own);
  const selected = {...address, bytes: ownText.length, totalBytes: 12, files: 3};
  const body = (url: string): Uint8Array<ArrayBuffer> => new Uint8Array(url.includes('brasscap') ? 9 : url.endsWith('.js') ? 3 : 4);
  const ports = {cached: () => Promise.resolve(undefined), fetch: (url: string) => Promise.resolve(new Response(url.endsWith('.json') && !url.includes('brasscap') ? ownText : body(url)))};
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    const download = downloadSpawnManifest(selected, ports, base, base, 'example');
    await download.ready;
    expect(download.snapshot()).toMatchObject({filesDone: 3, complete: true, error: null});
    expect(warn.mock.calls.some(([line]) => String(line).includes('skipped brasscap-mesa\'s /shardfiles/brasscap-mesa/discovery.json for example'))).toBe(true);
    const ownBad = {...manifest, files: [{...files[0], url: '/shardfiles/example/discovery.json'}, files[1]]}, ownBadText = JSON.stringify(ownBad);
    const refused = downloadSpawnManifest({...address, bytes: ownBadText.length}, {cached: () => Promise.resolve(undefined),
      fetch: (url: string) => Promise.resolve(new Response(url.includes('spawn/') ? ownBadText : new Uint8Array(url.endsWith('.js') ? 3 : 9)))}, base, base, 'example');
    await expect(refused.ready).rejects.toThrow('size differs');
  } finally { warn.mockRestore(); }
});

// QA 11-23-b row 20 (staging, 2026-11-23 16:50 UTC: every fresh boot stopped at "Download paused · the connection dropped"). Driftwood's
// manifest lists Brasscap's discovery at the bytes the build baked; the rooms had moved Brasscap to an upload (NB2), so the read went
// to the upload's folder, met other bytes (or a 404 page) and failed the size check. A neighbour's file stays the build's own copy.
test('a manifest reads a placed neighbour\'s loose file from the build, and only its own slug\'s from the upload', async () => {
  const {installPlacedContent} = await import('../src/client/game/grid/placedContent');
  const {clearPlacedSpawns} = await import('../src/client/game/boot/placedSpawn');
  const hash = 'c0'.repeat(32), loose = `https://packs.example/loose/${hash}/`;
  installPlacedContent({spawn: {slug: 'neighbour', entry: {phone: {url: `/loose/${hash}/m.json`, bytes: 1, totalBytes: 1, files: 1}} as never,
    whole: {}, base: 'https://packs.example/', loose, programs: false}, verdict: null});
  const discovery = {url: '/shardfiles/neighbour/discovery.json?v=b649bfae', bytes: 5, hash: 'd'.repeat(64)};
  const run = async (shard: string): Promise<string[]> => {
    const listed = {version: 1, shard, tier: 'phone', flow: 'grid', files: [discovery], totalBytes: 5}, body = JSON.stringify(listed);
    const reads: string[] = [];
    const download = downloadSpawnManifest({url: `/assets/spawn/${shard}-grid-phone-1234567890abcdef.json`, bytes: body.length, totalBytes: 5, files: 1}, {
      cached: () => Promise.resolve(undefined),
      fetch: url => { reads.push(url); return Promise.resolve(new Response(url.includes('/assets/spawn/') ? body : new Uint8Array(5))); }}, base);
    await download.ready;
    expect(download.snapshot().complete).toBe(true);
    return reads.filter(url => url.includes('discovery'));
  };
  try {
    expect(await run('example'), 'a neighbour: the build\'s own copy').toEqual([`${base}shardfiles/neighbour/discovery.json?v=b649bfae`]);
    expect(await run('neighbour'), 'its own slug: the upload').toEqual([`${loose}shardfiles/neighbour/discovery.json?v=b649bfae`]);
  } finally { clearPlacedSpawns(); }
});

// SF29: on a page no worker controls, the module loader already read the page's code over HTTP; a fetch of the same file
// misses that cache entry in WebKit, so the download fetching it again sent Pine's code twice (2.2 MB).
test('an uncontrolled page never fetches again a code file its module loader read, and still completes', async () => {
  const reads: string[] = [], stored: string[] = [];
  const download = downloadSpawnManifest(address, {cached: () => Promise.resolve(undefined),
    fetch: url => {reads.push(new URL(url).pathname); return Promise.resolve(new Response(url.endsWith('.json') ? text : new Uint8Array(url.endsWith('.js') ? 3 : 4)));},
    store: async url => {stored.push(new URL(url).pathname);},
    loaded: url => new URL(url).pathname === '/assets/code-12345678.js'}, base);
  await download.ready;
  expect(reads).toEqual([address.url, files[0]?.url]);
  expect(stored).not.toContain('/assets/code-12345678.js');
  expect(download.snapshot()).toMatchObject({complete: true, completedBytes: 7, cachedBytes: 3, filesDone: 2, error: null});
});

test('the page holds a code file only when its loader read it, not a fetch, and never a content file', () => {
  const page = 'https://example.test/', code = `${page}builds/shared/late-session-Ab12.js`;
  expect(pageLoadedCode(code, [{name: code, initiatorType: 'script'}])).toBe(true);
  expect(pageLoadedCode(`${page}builds/shared/style-Cr0i.css`, [{name: `${page}builds/shared/style-Cr0i.css`, initiatorType: 'link'}])).toBe(true);
  expect(pageLoadedCode(code, [{name: code, initiatorType: 'fetch'}])).toBe(false);
  expect(pageLoadedCode(code, [{name: 'https://other.test/builds/shared/late-session-Ab12.js', initiatorType: 'script'}])).toBe(false);
  expect(pageLoadedCode(`${page}shardfiles/z/blobs/image/a.png`, [{name: `${page}shardfiles/z/blobs/image/a.png`, initiatorType: 'img'}])).toBe(false);
});

// SF29: optional code is the loader's to import on demand; a download that fetched it first sent Nalati's two startup chunks
// twice on WebKit (the loader missed the fetch's cache entry at control).
test('an uncontrolled page leaves the bank\'s optional code to its loader', () => {
  const page = typeof location === 'undefined' ? 'https://example.test/' : new URL('/', location.href).href, chunk = '/builds/shared/control-0-0-9hc-startup-CRSl.js';
  const bank = JSON.stringify({common: [], optional: {files: [[chunk, 25_660], ['/builds/shared/other-Ab.js', 10]], groups: {}}});
  const optional = optionalCodePaths(bank);
  expect([...optional]).toEqual([chunk, '/builds/shared/other-Ab.js']);
  expect(pageLoadedCode(`${page}${chunk.slice(1)}`, [], optional)).toBe(true);
  expect(pageLoadedCode(`${page}builds/shared/late-session-Ab12.js`, [], optional)).toBe(false);
  expect(optionalCodePaths(undefined).size).toBe(0);
  expect(optionalCodePaths('not json').size).toBe(0);
  expect(optionalCodePaths(JSON.stringify({optional: {files: 'x'}})).size).toBe(0);
});
