import {expect, test, vi} from 'vitest';
import {downloadSpawnManifest, type SpawnDownloadSnapshot} from '../src/client/game/boot/spawnDownload';
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
    await reached; download.cancel();
    expect(spans.filter(row => row.operation === 'download:cache-check')).toEqual([{operation: 'download:cache-check', result: 'cancelled'}]);
  } finally { Reflect.deleteProperty(globalThis, '__bootTiming'); }
});
