// oxlint-disable-next-line import/no-nodejs-modules -- The fixture executes source, never a copied cache implementation.
import { runInNewContext } from 'node:vm';
// oxlint-disable-next-line import/no-nodejs-modules -- Check the shipped route patterns with the native URLPattern implementation.
import { URLPattern, type URLPatternInit } from 'node:url';
import { expect, test, vi } from 'vitest';
// Execute the actual bundled worker, including its explicit clock import.
import { rolldown } from 'rolldown';
import { ASSET_CACHE_NAME } from '../src/client/engine/pwa/cacheNames';

const workerBuild = await rolldown({input:'src/client/engine/pwa/sw.js',platform:'browser',transform:{target:'es2022'}});
const workerOutput = await workerBuild.generate({format:'iife'});
await workerBuild.close();
const workerChunk = workerOutput.output.find(file => file.type === 'chunk');
if (workerChunk === undefined) throw new Error('Missing worker bundle');
const bundled: string = workerChunk.code;

const origin = 'https://worker.test';
const url = (path: string): string => new URL(path, origin).href;
const shared = '/assets/shared-ssssssss.js';
const shell = ['/manifest.webmanifest'];
const document = '<!doctype html><html><body>worker shell π</body></html>';
interface NativeRoute {
  condition: {urlPattern: URLPatternInit; requestMethod: string; requestMode?: string; requestDestination?: string};
  source: string | {cacheName: string};
}
interface WorkerEvent {
  request?: Request;
  addRoutes?: (rules: NativeRoute[]) => Promise<void>;
  data?: { type: string };
  ports?: { postMessage: (value: unknown) => void }[];
  source?: { postMessage: (value: unknown) => void; id?: string };
  clientId?: string;
  waitUntil: (work: Promise<unknown>) => void;
  respondWith: (work: Response | Promise<Response>) => void;
}
class StoredCache {
  readonly entries = new Map<string, Response>();
  private key(input: Request | string): string { return typeof input === 'string' ? input : input.url; }
  match(input: Request | string, options?: { ignoreSearch?: boolean }): Promise<Response | undefined> {
    const key = this.key(input), found = options?.ignoreSearch === true ? [...this.entries.keys()].find(entry => entry.split('?')[0] === key.split('?')[0]) : key;
    return Promise.resolve(found === undefined ? undefined : this.entries.get(found)?.clone());
  }
  async put(input: Request | string, response: Response): Promise<void> {
    this.entries.set(this.key(input), new Response(await response.arrayBuffer(), { status: response.status, headers: response.headers }));
  }
  keys(): Promise<Request[]> { return Promise.resolve([...this.entries.keys()].map(key => new Request(key))); }
  delete(input: Request | string): Promise<boolean> { return Promise.resolve(this.entries.delete(this.key(input))); }
}
function fixture(read?: (request: Request) => Promise<Response>, nativeRoutes = false) {
  const books = new Map<string, StoredCache>();
  const open = (name: string): Promise<StoredCache> => {
    let cache = books.get(name);
    if (cache === undefined) { cache = new StoredCache(); books.set(name, cache); }
    return Promise.resolve(cache);
  };
  const caches = { open, keys: () => Promise.resolve([...books.keys()]), delete: (name: string) => Promise.resolve(books.delete(name)) };
  const fetch = vi.fn((input: Request | string) => read?.(typeof input === 'string' ? new Request(input) : input)
    ?? Promise.resolve(new Response(`body:${typeof input === 'string' ? input : input.url}`)));
  const load = (build: string, files: string[], shellFiles = shell, content: { base?: string; files?: string[] } = {}) => {
    const listeners = new Map<string, ((event: WorkerEvent) => void)[]>();
    const claim = vi.fn(() => Promise.resolve()), skipWaiting = vi.fn(() => Promise.resolve());
    const routes = vi.fn<(rules: NativeRoute[]) => Promise<void>>(() => Promise.resolve());
    const live = new Set<string>(), workers = new Set<string>();
    const get = (id: string): Promise<{ id: string; type?: string } | undefined> => Promise.resolve(workers.has(id) ? { id, type: 'worker' } : live.has(id) ? { id } : undefined);
    const self = { location: new URL(origin), registration: { scope: `${origin}/` }, clients: { claim, get }, skipWaiting,
      addEventListener: (kind: string, listener: (event: WorkerEvent) => void) => { listeners.set(kind, [...listeners.get(kind) ?? [], listener]); } };
    const source = bundled.replaceAll('__BUILD_ID__', build)
      .replaceAll('__ASSET_CACHE__', ASSET_CACHE_NAME).replace(/['"]__DOCUMENT__['"]/u, () => JSON.stringify(document)).replace(/['"]__FILES__['"]/u, () => JSON.stringify(JSON.stringify(files)))
      .replace(/['"]__SHELL_FILES__['"]/u, () => JSON.stringify(JSON.stringify(shellFiles)))
      .replace(/['"]__CONTENT__['"]/u, () => JSON.stringify(JSON.stringify({ base: content.base ?? '', files: content.files ?? [] })));
    // Deliberately no crypto, scheduler or accounting ports; timers only for the precache's bounded pause.
    runInNewContext(source, { self, caches, fetch, URL, Request, Response, Set, JSON, encodeURIComponent, AbortController, setTimeout, clearTimeout, performance });
    const dispatch = async (kind: string, payload: Pick<WorkerEvent, 'request' | 'data' | 'ports' | 'source' | 'clientId'> = {}): Promise<Response | undefined> => {
      const work: Promise<unknown>[] = []; let response: Response | undefined;
      for (const listener of listeners.get(kind) ?? []) listener({ ...payload, ...(nativeRoutes && kind === 'install' ? {addRoutes: routes} : {}),
        waitUntil: promise => { work.push(promise); }, respondWith: promise => { work.push(Promise.resolve(promise).then(value => { response = value; return value; })); } });
      await Promise.all(work); return response;
    };
    return { dispatch, claim, skipWaiting, routes, live, workers };
  };
  return { caches, open, books, fetch, load };
}

const precached = { data: { type: 'PRECACHE' } };
test('install precaches only the shell; control precaches hashed files before publishing a generation', async () => {
  const f = fixture(), worker = f.load('A', ['/assets/a-aaaaaaaa.js', shared]);
  await worker.dispatch('install'); await worker.dispatch('activate');
  // DL1: nothing of the build's code shares a cold visit's level download.
  expect(f.fetch).toHaveBeenCalledTimes(1); expect(worker.claim).not.toHaveBeenCalled();
  const assets = await f.open(ASSET_CACHE_NAME), current = await f.open('ws-shell-v3-A');
  expect(await assets.match(url(shared))).toBeUndefined();
  expect(await (await f.open('ws-builds-v1')).keys()).toHaveLength(0);
  await worker.dispatch('message', precached); await worker.dispatch('message', precached);
  expect(f.fetch).toHaveBeenCalledTimes(3); expect(await (await f.open('ws-builds-v1')).keys()).toHaveLength(1);
  expect(await (await assets.match(url(shared)))?.text()).toBe(`body:${url(shared)}`);
  expect(await current.match(url('/index.html'))).toBeUndefined();
  f.fetch.mockRejectedValue(new Error('offline'));
  expect(await (await worker.dispatch('fetch', { request: new Request(url(shared)) }))?.text()).toBe(`body:${url(shared)}`);
  expect(await (await worker.dispatch('fetch', { request: new Request(url('/')) }))?.text()).toBe(document);
  expect(f.fetch).toHaveBeenCalledTimes(3);
});

test('the post-control precache yields to a loading page and resumes at that page\'s control', async () => {
  let holding = true;
  const f = fixture(request => new Promise((resolve, reject) => {
    request.signal.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')); });
    const answer = (): void => { resolve(new Response(`body:${request.url}`)); };
    if (!holding) answer();
  }));
  const files = Array.from({ length: 8 }, (_, at) => `/assets/f${at}-0000000${at}.js`);
  const worker = f.load('A', files, []); await worker.dispatch('install'); await worker.dispatch('activate');
  const source = (id: string) => ({ id, postMessage: () => undefined });
  const first = worker.dispatch('message', { ...precached, source: source('page-1') });
  await vi.waitFor(() => { expect(f.fetch).toHaveBeenCalledTimes(6); }); // a few lanes, not every file at once
  // A new document loads (its client has not reported control): the precache steps aside and frees the link.
  await worker.dispatch('fetch', { request: new Request(url('/')), clientId: 'page-2' });
  holding = false; await new Promise(resolve => { setTimeout(resolve, 0); });
  expect(f.fetch).toHaveBeenCalledTimes(6);
  // The first page's own reads never pause it; page 2 reaching control resumes it to one complete generation.
  await worker.dispatch('fetch', { request: new Request(url('/')), clientId: 'page-1' });
  await worker.dispatch('message', { ...precached, source: source('page-2') }); await first;
  expect(f.fetch).toHaveBeenCalledTimes(14); // 6 aborted and re-queued, then all 8
  const assets = await f.open(ASSET_CACHE_NAME);
  for (const path of files) expect(await assets.match(url(path))).toBeDefined();
  expect(await (await f.open('ws-builds-v1')).keys()).toHaveLength(1);
});

/** A precache whose fetches hang until `release()` (or abort), for the pause tests. */
function heldPrecache() {
  let holding = true;
  const f = fixture(request => new Promise((resolve, reject) => {
    request.signal.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')); });
    if (!holding) resolve(new Response(`body:${request.url}`));
  }));
  const files = Array.from({ length: 8 }, (_, at) => `/assets/f${at}-0000000${at}.js`);
  return { f, files, release: () => { holding = false; }, source: (id: string) => ({ id, postMessage: () => undefined }) };
}

test('a pause never strands the precache: a gone loader or the time limit resumes it', async () => {
  // The loading page closes before its control: a controlled page's next read finds it gone and resumes.
  const gone = heldPrecache(), worker = gone.f.load('A', gone.files, []);
  await worker.dispatch('install'); await worker.dispatch('activate');
  const first = worker.dispatch('message', { ...precached, source: gone.source('page-1') });
  await vi.waitFor(() => { expect(gone.f.fetch).toHaveBeenCalledTimes(6); });
  worker.live.add('page-2');
  await worker.dispatch('fetch', { request: new Request(url('/')), clientId: 'page-2' });
  gone.release(); worker.live.delete('page-2');
  await worker.dispatch('fetch', { request: new Request(url('/')), clientId: 'page-1' }); await first;
  expect(gone.f.fetch).toHaveBeenCalledTimes(14);
  // The loading page lives on but never reports control: the pause ends at its limit.
  vi.useFakeTimers();
  try {
    const stuck = heldPrecache(), late = stuck.f.load('A', stuck.files, []);
    await late.dispatch('install'); await late.dispatch('activate');
    const pending = late.dispatch('message', { ...precached, source: stuck.source('page-1') });
    await vi.advanceTimersByTimeAsync(0); expect(stuck.f.fetch).toHaveBeenCalledTimes(6);
    late.live.add('page-2'); await late.dispatch('fetch', { request: new Request(url('/')), clientId: 'page-2' });
    stuck.release(); await vi.advanceTimersByTimeAsync(59_999); expect(stuck.f.fetch).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(1); await pending;
    expect(stuck.f.fetch).toHaveBeenCalledTimes(14);
  } finally { vi.useRealTimers(); }
});

test('a worker\'s reads neither pause the precache nor stand as a loader', async () => {
  const held = heldPrecache(), worker = held.f.load('A', held.files, []);
  await worker.dispatch('install'); await worker.dispatch('activate');
  void worker.dispatch('message', { ...precached, source: held.source('page-1') });
  await vi.waitFor(() => { expect(held.f.fetch).toHaveBeenCalledTimes(6); });
  // The page at control starts its server: the worker lives on, and never reports control. Nothing it reads stops the precache.
  worker.workers.add('server');
  // Row 36: the worker's /shardfiles/ read now goes network first through this worker; the held network keeps it in flight.
  void worker.dispatch('fetch', { request: new Request(url('/shardfiles/nine/server/a.bin')), clientId: 'server' });
  expect(held.f.fetch.mock.calls.filter(([request]) => typeof request !== 'string' && request.signal.aborted)).toEqual([]);
  // A loading document does pause it, and a worker read in that pause doesn't keep it paused once the document has gone.
  const again = heldPrecache(), second = again.f.load('A', again.files, []);
  await second.dispatch('install'); await second.dispatch('activate');
  const run = second.dispatch('message', { ...precached, source: again.source('page-1') });
  await vi.waitFor(() => { expect(again.f.fetch).toHaveBeenCalledTimes(6); });
  second.workers.add('server'); second.live.add('page-2');
  await second.dispatch('fetch', { request: new Request(url('/')), clientId: 'page-2' });
  void second.dispatch('fetch', { request: new Request(url('/shardfiles/nine/server/a.bin')), clientId: 'server' });
  again.release(); second.live.delete('page-2');
  await second.dispatch('fetch', { request: new Request(url('/')), clientId: 'page-1' }); await run;
  expect(again.f.fetch).toHaveBeenCalledTimes(15);
});

test('the precache takes a part\'s member from under its `?v=`, and downloads nothing', async () => {
  const file = '/b/abc/basis_transcoder-aaaaaaaa.wasm', f = fixture(), worker = f.load('A', [file], []);
  await worker.dispatch('install'); await worker.dispatch('activate');
  const assets = await f.open(ASSET_CACHE_NAME);
  await assets.put(url(`${file}?v=6cf17dc8`), new Response('held'));
  await worker.dispatch('message', precached);
  expect(f.fetch).not.toHaveBeenCalled();
  expect(await (await assets.match(url(file)))?.text()).toBe('held');
});

test('a hashed name read bare is answered from a member kept under its `?v=`; a plain name is not', async () => {
  const f = fixture(), worker = f.load('A', [], []);
  await worker.dispatch('install'); await worker.dispatch('activate');
  const assets = await f.open(ASSET_CACHE_NAME), plain = await f.open('ws-shell-v3-A');
  await assets.put(url('/assets/boot-tables-4daeb084.json?v=4daeb084'), new Response('kept'));
  await plain.put(url('/assets/title/plain.json?v=1'), new Response('kept'));
  const held = await worker.dispatch('fetch', { request: new Request(url('/assets/boot-tables-4daeb084.json')) });
  expect(await held?.text()).toBe('kept');
  expect(f.fetch).not.toHaveBeenCalled();
  await worker.dispatch('fetch', { request: new Request(url('/assets/title/plain.json')) });
  expect(f.fetch).toHaveBeenCalledTimes(1);
});

test('a waiting update steps its precache aside on a loading page\'s PAUSE', async () => {
  const held = heldPrecache(), waiting = held.f.load('B', held.files, []);
  await waiting.dispatch('install');
  const background = waiting.dispatch('message', { ...precached, source: held.source('page-1') });
  await vi.waitFor(() => { expect(held.f.fetch).toHaveBeenCalledTimes(6); });
  // The controlling worker sees the navigation; the waiting one hears it from the loading page (src/client/engine/boot/sw.ts).
  await waiting.dispatch('message', { data: { type: 'PAUSE' }, source: held.source('page-2') });
  held.release(); await new Promise(resolve => { setTimeout(resolve, 0); });
  expect(held.f.fetch).toHaveBeenCalledTimes(6);
  await waiting.dispatch('message', { ...precached, source: held.source('page-2') }); await background;
  expect(held.f.fetch).toHaveBeenCalledTimes(14);
});

test('native title routes use exact same-origin bare GETs and the existing cache owners', async () => {
  const f = fixture(undefined, true), worker = f.load('A', [shared]);
  await worker.dispatch('install'); await worker.dispatch('activate');
  const pattern = (pathname: string): object => ({protocol: 'https', hostname: 'worker.test', port: '', pathname, search: ''});
  expect(worker.routes).toHaveBeenCalledExactlyOnceWith([
    ...['script', 'style'].map(requestDestination => ({condition: {urlPattern: pattern('/b/*'), requestDestination, requestMethod: 'GET'}, source: {cacheName: ASSET_CACHE_NAME}})),
    {condition: {urlPattern: pattern('/assets/title/*'), requestDestination: 'image', requestMethod: 'GET'}, source: {cacheName: ASSET_CACHE_NAME}},
    {condition: {urlPattern: pattern('/fonts/*'), requestDestination: 'font', requestMethod: 'GET'}, source: {cacheName: 'ws-shell-v3-A'}},
  ]);
  expect(worker.claim).not.toHaveBeenCalled(); expect(worker.skipWaiting).not.toHaveBeenCalled();
});

test('native URL patterns leave queries, foreign origins and ordinary retry fetches with the handler', async () => {
  const worker = fixture(undefined, true).load('A', [shared]); await worker.dispatch('install');
  const routes = worker.routes.mock.calls[0]?.[0];
  if (routes === undefined) throw new Error('Missing installed native routes');
  for (const path of ['/', '/index.html']) expect(routes.some(route => new URLPattern(route.condition.urlPattern).test(url(path)))).toBe(false);
  for (const route of routes) {
    const pattern = new URLPattern(route.condition.urlPattern);
    const path = route.condition.urlPattern.pathname?.replace('*', 'file-01234567.js');
    if (path === undefined) throw new Error('Missing native route path');
    expect(pattern.test(url(path))).toBe(true);
    expect(pattern.test(url(`${path}?sw=0`))).toBe(false);
    expect(pattern.test(url(`${path}?v=01234567`))).toBe(false);
    expect(pattern.test(new URL(path, 'https://foreign.test').href)).toBe(false);
    expect(pattern.test(new URL(path, 'http://worker.test').href)).toBe(false);
    expect(pattern.test(new URL(path, 'https://worker.test:444').href)).toBe(false);
    // Only immutable content destinations bypass the worker; documents never do.
    expect(route.condition.requestDestination).toBeDefined();
  }
});

test('refused native routes cannot publish an installed generation', async () => {
  const f = fixture(undefined, true), worker = f.load('A', [shared]), refusal = new TypeError('Native route refused');
  worker.routes.mockRejectedValueOnce(refusal);
  await expect(worker.dispatch('install')).rejects.toBe(refusal);
  expect(f.books.size).toBe(0); expect(f.fetch).not.toHaveBeenCalled();
});

test('navigation fallback serves the exact document without storage or network', async () => {
  const f = fixture(), open = vi.spyOn(f.caches, 'open').mockRejectedValue(new DOMException('denied', 'SecurityError'));
  const worker = f.load('A', []);
  for (const path of ['/', '/index.html', '/?chunk=fixture']) {
    const response = await worker.dispatch('fetch', {request: new Request(url(path))});
    expect(response?.status).toBe(200); expect(response?.headers.get('content-type')).toBe('text/html;charset=utf-8');
    expect(response?.headers.get('cache-control')).toBe('no-store'); expect(await response?.text()).toBe(document);
  }
  expect(open).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
});

test('a worker reuses its installed cache handles across navigation and content reads', async () => {
  const f = fixture(), open = vi.spyOn(f.caches, 'open');
  const file = '/assets/file-0123456789abcdef.bin', worker = f.load('A', [file]);
  await worker.dispatch('install'); await worker.dispatch('activate');
  const before = open.mock.calls.length;
  for (let visit = 0; visit < 3; visit++) {
    await worker.dispatch('fetch', {request: new Request(url('/'))});
    await worker.dispatch('fetch', {request: new Request(url(file))});
  }
  expect(open.mock.calls).toHaveLength(before);
  expect(open.mock.calls.filter(([name]) => name === ASSET_CACHE_NAME)).toHaveLength(1);
  expect(open.mock.calls.filter(([name]) => name === 'ws-shell-v3-A')).toHaveLength(1);
});

test('a rejected native cache open never poisons the next ordinary read', async () => {
  const f = fixture(), open = vi.spyOn(f.caches, 'open').mockRejectedValueOnce(new DOMException('denied', 'SecurityError'));
  const request = new Request(url('/assets/file-0123456789abcdef.bin')), worker = f.load('A', []);
  for (let visit = 0; visit < 3; visit++) {
    expect(await (await worker.dispatch('fetch', {request}))?.text()).toBe(`body:${request.url}`);
  }
  expect(open).toHaveBeenCalledTimes(2); expect(f.fetch).toHaveBeenCalledTimes(2);
});

test('named shell artwork is installed into the same asset cache its fetch route reads', async () => {
  const image = '/assets/title/hero-0123456789abcdef.jpg', f = fixture();
  const worker = f.load('A', [], ['/index.html', image]);
  await worker.dispatch('install'); await worker.dispatch('activate');
  expect(await (await f.open(ASSET_CACHE_NAME)).match(url(image))).toBeDefined();
  expect(await (await f.open('ws-shell-v3-A')).match(url(image))).toBeUndefined();
  f.fetch.mockRejectedValue(new Error('offline'));
  expect(await (await worker.dispatch('fetch', {request: new Request(url(image))}))?.text()).toBe(`body:${url(image)}`);
  expect(f.fetch).toHaveBeenCalledTimes(2);
});

test('same-build content and versioned metadata read from the one asset cache without network', async () => {
  const f = fixture(), worker = f.load('A', []);
  for (const path of [`/shardfiles/fixture/blobs/glb/${'a'.repeat(64)}.glb`, '/assets/entry-fixture-0123456789abcdef.json', '/shardfiles/fixture/shard.json?v=abcdef12']) {
    const before = f.fetch.mock.calls.length, request = new Request(url(path));
    const first = await worker.dispatch('fetch', { request });
    const second = await worker.dispatch('fetch', { request });
    expect(await first?.text()).toBe(`body:${request.url}`); expect(await second?.text()).toBe(`body:${request.url}`);
    expect(f.fetch.mock.calls.length).toBe(before + 1);
    expect(await (await f.open(ASSET_CACHE_NAME)).match(request)).toBeDefined();
    expect(second?.headers.has('server-timing')).toBe(false);
  }
});

test('retention keeps current plus previous code, shared chunks and immutable content', async () => {
  const f = fixture(), a = '/assets/a-aaaaaaaa.js', b = '/assets/b-bbbbbbbb.js', c = '/assets/c-cccccccc.js';
  const content = `/assets/models/${'d'.repeat(64)}.glb`;
  const first = f.load('A', [a, shared]); await first.dispatch('install'); await first.dispatch('activate'); await first.dispatch('message', precached);
  await first.dispatch('fetch', { request: new Request(url(content)) });
  const second = f.load('B', [b, shared]); await second.dispatch('install'); await second.dispatch('activate'); await second.dispatch('message', precached);
  const assets = await f.open(ASSET_CACHE_NAME); expect(await assets.match(url(a))).toBeDefined();
  const third = f.load('C', [c, shared]); await third.dispatch('install'); await third.dispatch('activate'); await third.dispatch('message', precached);
  expect(await assets.match(url(a))).toBeUndefined(); expect(await assets.match(url(b))).toBeDefined();
  expect(await assets.match(url(c))).toBeDefined(); expect(await assets.match(url(shared))).toBeDefined();
  expect(await assets.match(url(content))).toBeDefined();
  expect((await (await f.open('ws-builds-v1')).keys())).toHaveLength(2);
  expect(await f.caches.keys()).not.toContain('ws-shell-v3-A');
  expect(await f.caches.keys()).not.toContain('ws-shell-v3-B');
});

test('an incomplete precache never publishes a generation or prunes working code, and is asked again', async () => {
  let fail = false;
  const f = fixture(request => Promise.resolve(new Response('code', { status: fail && request.url.endsWith('/assets/b-bbbbbbbb.js') ? 503 : 200 })));
  const a = f.load('A', ['/assets/a-aaaaaaaa.js']); await a.dispatch('install'); await a.dispatch('activate'); await a.dispatch('message', precached); fail = true;
  const b = f.load('B', ['/assets/b-bbbbbbbb.js']); await b.dispatch('install'); await b.dispatch('activate');
  const replies: unknown[] = [], port = { postMessage: (value: unknown) => { replies.push(value); } };
  await b.dispatch('message', { ...precached, ports: [port] });
  expect(replies).toEqual([{ type: 'PRECACHE', ok: false, build: 'B' }]); // adoption refuses an update it cannot hold
  expect(await (await f.open(ASSET_CACHE_NAME)).match(url('/assets/a-aaaaaaaa.js'))).toBeDefined();
  expect((await (await f.open('ws-builds-v1')).keys())).toHaveLength(1);
  fail = false; replies.length = 0; await b.dispatch('message', { ...precached, ports: [port] });
  expect(replies).toEqual([{ type: 'PRECACHE', ok: true, build: 'B' }]);
  expect((await (await f.open('ws-builds-v1')).keys())).toHaveLength(2);
});

test('install repairs an older HTML precache hit without trusting its content-named key', async () => {
  const f = fixture(), file = '/assets/a-aaaaaaaa.js', assets = await f.open(ASSET_CACHE_NAME);
  await assets.put(url(file), new Response('<html>missing</html>', {headers: {'content-type': 'text/html'}}));
  const worker = f.load('A', [file]); await worker.dispatch('install'); await worker.dispatch('activate'); await worker.dispatch('message', precached);
  expect(await (await assets.match(url(file)))?.text()).toBe(`body:${url(file)}`);
  expect(f.fetch.mock.calls.filter(([input]) => (typeof input === 'string' ? input : input.url) === url(file))).toHaveLength(1);
  expect((await (await f.open('ws-builds-v1')).keys())).toHaveLength(1);
});

test('rewrite migration skips HTML masquerading as old code or immutable content', async () => {
  const f = fixture(), code = '/assets/old-oooooooo.js', content = `/assets/models/${'a'.repeat(64)}.glb`;
  const html = (): Response => new Response('<html>missing</html>', {headers: {'content-type': 'text/html;charset=utf-8'}});
  await (await f.open('ws-immutable')).put(url(code), html());
  await (await f.open('ws-static-old')).put(url(content), html());
  const worker = f.load('A', []); await worker.dispatch('install'); await worker.dispatch('activate'); await worker.dispatch('message', precached);
  const assets = await f.open(ASSET_CACHE_NAME);
  expect(await assets.match(url(code))).toBeUndefined(); expect(await assets.match(url(content))).toBeUndefined();
  expect((await (await f.open('ws-builds-v1')).keys())).toHaveLength(1);
  expect(await f.caches.keys()).not.toContain('ws-immutable'); expect(await f.caches.keys()).not.toContain('ws-static-old');
});

test('the one-time rewrite preserves named legacy bodies and one old code generation', async () => {
  const f = fixture(), oldCode = '/assets/old-oooooooo.js', named = `/assets/models/${'e'.repeat(64)}.glb`;
  await (await f.open('ws-immutable')).put(url(oldCode), new Response('old code'));
  await (await f.open('ws-static-old')).put(url(named), new Response('named model'));
  await (await f.open('ws-static-old')).put(url('/assets/baked/mutable.bin'), new Response('mutable old'));
  const a = f.load('A', ['/assets/a-aaaaaaaa.js']); await a.dispatch('install'); await a.dispatch('activate'); await a.dispatch('message', precached);
  const assets = await f.open(ASSET_CACHE_NAME);
  expect(await (await assets.match(url(oldCode)))?.text()).toBe('old code');
  expect(await (await assets.match(url(named)))?.text()).toBe('named model');
  expect(await assets.match(url('/assets/baked/mutable.bin'))).toBeUndefined();
  expect(await f.caches.keys()).not.toContain('ws-static-old'); expect(await f.caches.keys()).not.toContain('ws-immutable');
  const b = f.load('B', ['/assets/b-bbbbbbbb.js']); await b.dispatch('install'); await b.dispatch('activate');
  expect(await assets.match(url(oldCode))).toBeUndefined(); expect(await assets.match(url(named))).toBeDefined();
});

test.each([200, 204, 205, 304])('a native bodyless %i passes through without reconstruction', async status => {
  const original = new Response(null, { status }), f = fixture(() => Promise.resolve(original)), worker = f.load('A', []);
  expect(await worker.dispatch('fetch', { request: new Request(url(`/assets/${'f'.repeat(64)}.bin`)) })).toBe(original);
});

test('version, API, cross-origin, non-GET and explicit opt-out bypass the worker', async () => {
  const f = fixture(), worker = f.load('A', []);
  for (const request of [new Request(url('/version.json')), new Request(url('/api/state')), new Request('https://other.test/a.js'),
    new Request(url('/assets/a-aaaaaaaa.js?sw=0')), new Request(url('/api/write'), { method: 'POST' })]) {
    expect(await worker.dispatch('fetch', { request })).toBeUndefined();
  }
  expect(f.fetch).not.toHaveBeenCalled(); expect(await f.caches.keys()).toEqual([]);
});

test('quota denial serves online bytes; partial bodies never replace a full cache entry', async () => {
  const f = fixture(), assets = await f.open(ASSET_CACHE_NAME), worker = f.load('A', []);
  vi.spyOn(assets, 'put').mockRejectedValue(new DOMException('full', 'QuotaExceededError'));
  const request = new Request(url(`/assets/${'a'.repeat(64)}.bin`));
  expect(await (await worker.dispatch('fetch', { request }))?.text()).toBe(`body:${request.url}`);
  const partial = fixture(() => Promise.resolve(new Response('part', { status: 206 }))), ranged = partial.load('A', []);
  await ranged.dispatch('fetch', { request }); expect(await (await partial.open(ASSET_CACHE_NAME)).match(request)).toBeUndefined();
});

test('a build folder is immutable whatever its names, so a stale tab keeps its code under a newer worker', async () => {
  const f = fixture(), worker = f.load('B', []); await worker.dispatch('install'); await worker.dispatch('activate');
  const request = new Request(url('/b/a3e7ef2-mw3ukc3m/standalone/shell.js'));
  f.fetch.mockClear(); f.fetch.mockResolvedValue(new Response('old code'));
  await worker.dispatch('fetch', {request});
  f.fetch.mockRejectedValue(new Error('offline'));
  const response = await worker.dispatch('fetch', {request});
  expect(await response?.text()).toBe('old code');
  expect(await (await f.open(ASSET_CACHE_NAME)).match(request)).toBeDefined();
});

test('an inert legacy hash body serves offline and migrates once to its exact immutable URL', async () => {
  const f = fixture(), hash = '0'.repeat(64), bytes = Uint8Array.of(0, 1, 127, 128, 254, 255);
  const legacy = await f.open('ws-content-v0'), oldKey = url(`/__ws_content__/v0/${hash}`);
  await legacy.put(oldKey, new Response(bytes)); const oldWrites = vi.spyOn(legacy, 'put');
  const worker = f.load('A', []); await worker.dispatch('install'); await worker.dispatch('activate');
  const publications = vi.spyOn(await f.open(ASSET_CACHE_NAME), 'put');
  const request = new Request(url(`/shardfiles/fixture/blobs/bin/${hash}.bin`));
  f.fetch.mockClear(); f.fetch.mockRejectedValue(new Error('offline'));
  for (let read = 0; read < 2; read++) {
    const response = await worker.dispatch('fetch', {request});
    if (response === undefined) throw new Error('Missing cached immutable response');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  }
  const migrated = await (await f.open(ASSET_CACHE_NAME)).match(request);
  if (migrated === undefined) throw new Error('Missing exact URL migration');
  expect(new Uint8Array(await migrated.arrayBuffer())).toEqual(bytes);
  expect(publications).toHaveBeenCalledTimes(1);
  expect(oldWrites).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
  expect(await legacy.match(oldKey)).toBeDefined();
});

test('quota denial cannot destroy inert cached-visit bodies or either old product namespace', async () => {
  const f = fixture(), hash = '1'.repeat(64), bytes = Uint8Array.of(7, 8, 9);
  const legacy = await f.open('ws-content-v0'), oldKey = url(`/__ws_content__/v0/${hash}`);
  await legacy.put(oldKey, new Response(bytes));
  for (const name of ['ws-shardfile-products-v0', 'ws-shardfile-products-v2']) {
    await (await f.open(name)).put(url('/shardfiles/fixture/__visited_shardfile__'), Response.json({source: {identity: {slug: 'fixture'}}, firstParty: true}));
  }
  const worker = f.load('A', []); await worker.dispatch('install'); await worker.dispatch('activate');
  const assets = await f.open(ASSET_CACHE_NAME); vi.spyOn(assets, 'put').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
  f.fetch.mockClear(); f.fetch.mockRejectedValue(new Error('offline'));
  const request = new Request(url(`/shardfiles/fixture/blobs/bin/${hash}.bin`));
  const response = await worker.dispatch('fetch', {request});
  if (response === undefined) throw new Error('Missing legacy body after quota refusal');
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  expect(await assets.match(request)).toBeUndefined(); expect(await legacy.match(oldKey)).toBeDefined();
  for (const name of ['ws-shardfile-products-v0', 'ws-shardfile-products-v2']) {
    expect(await (await f.open(name)).match(url('/shardfiles/fixture/__visited_shardfile__'))).toBeDefined();
  }
  expect(f.fetch).not.toHaveBeenCalled();
});

test('BUILD/VERSION are identity-only and SKIP_WAITING preserves the adoption protocol', async () => {
  const f = fixture(), worker = f.load('A', []), replies: unknown[] = [];
  for (const type of ['BUILD', 'VERSION']) await worker.dispatch('message', { data: { type }, ports: [{ postMessage: value => { replies.push(value); } }] });
  expect(replies).toEqual([{ type: 'BUILD', build: 'A' }, { type: 'VERSION', build: 'A' }]);
  await worker.dispatch('message', { data: { type: 'SKIP_WAITING' } }); expect(worker.skipWaiting).toHaveBeenCalledOnce();
  await worker.dispatch('message', { data: { type: 'WARM_CODE' } }); expect(f.fetch).not.toHaveBeenCalled();
  expect(await f.caches.keys()).toEqual([]);
});

test('an HTML missing-file answer is returned online but never stored as content', async () => {
  const f = fixture(() => Promise.resolve(new Response('<!doctype html><html>missing</html>', { headers: { 'content-type': 'text/html;charset=utf-8' } })));
  const worker = f.load('A', []), request = new Request(url(`/assets/${'a'.repeat(64)}.bin`));
  expect(await (await worker.dispatch('fetch', { request }))?.text()).toContain('<!doctype html>');
  expect(await (await f.open(ASSET_CACHE_NAME)).match(request)).toBeUndefined();
  await worker.dispatch('fetch', { request }); expect(f.fetch).toHaveBeenCalledTimes(2);
});

test('a poisoned cached HTML body is discarded before reading the actual file', async () => {
  const f = fixture(), worker = f.load('A', []), request = new Request(url('/assets/data-aaaaaaaa.json'));
  const assets = await f.open(ASSET_CACHE_NAME);
  await assets.put(request, new Response('<html>old missing page</html>', { headers: { 'content-type': 'text/html' } }));
  expect(await (await worker.dispatch('fetch', { request }))?.text()).toBe(`body:${request.url}`);
  expect(await (await assets.match(request))?.text()).toBe(`body:${request.url}`);
  expect(f.fetch).toHaveBeenCalledOnce();
});

test('explicit retry bypasses current and legacy content copies without changing its key', async () => {
  const f = fixture(), worker = f.load('A', []), path = `/shardfiles/fixture/blobs/bin/${'a'.repeat(64)}.bin`;
  const request = new Request(url(path), { cache: 'reload' });
  const assets = await f.open(ASSET_CACHE_NAME);
  await assets.put(request, new Response('old current'));
  await (await f.open('ws-content-v0')).put(url(`/__ws_content__/v0/${'a'.repeat(64)}`), new Response('old legacy'));
  expect(await (await worker.dispatch('fetch', { request }))?.text()).toBe(`body:${request.url}`);
  expect(f.fetch).toHaveBeenCalledOnce(); expect(f.fetch.mock.calls[0]?.[0]).toBe(request);
  expect(await (await assets.match(request))?.text()).toBe(`body:${request.url}`);
});

test('precache never publishes HTML in place of its required code', async () => {
  const f = fixture(() => Promise.resolve(new Response('<html>missing</html>', { headers: { 'content-type': 'text/html' } })));
  const worker = f.load('A', ['/assets/a-aaaaaaaa.js'], []);
  await worker.dispatch('install');
  const replies: unknown[] = [];
  await worker.dispatch('message', { ...precached, ports: [{ postMessage: (value: unknown) => { replies.push(value); } }] });
  expect(replies).toEqual([{ type: 'PRECACHE', ok: false, build: 'A' }]);
  expect((await (await f.open('ws-builds-v1')).keys())).toHaveLength(0);
  expect((await (await f.open(ASSET_CACHE_NAME)).keys())).toHaveLength(0);
});

// PAGE-SIZE PZ10 (J276): the content base's origin is kept in one cross-build cache, ws-content-v1, keyed by exact CDN URL.
const CONTENT_CACHE = 'ws-content-v1';
const cdn = 'https://packs.test', base = `${cdn}/content/0123456789abcdef/`;
const cdnPart = `${base}assets/spawn/parts/0123456789abcdef.pack.br`;
/** A network answer of the given response type (a constructed Response is always 'default'). */
const typed = (body: string | null, type: ResponseType, status = 200, headers: Record<string, string> = {}): Response => {
  const response = new Response(body, { status: status === 0 ? 200 : status, headers });
  Object.defineProperty(response, 'type', { value: type });
  if (status === 0) Object.defineProperty(response, 'status', { value: 0 });
  return response;
};

test('PZ10: a content-base read is cache-first from ws-content-v1, fetched in CORS mode with no credentials', async () => {
  const f = fixture(request => Promise.resolve(typed(`cdn:${request.url}`, 'cors'))), worker = f.load('A', [], [], { base });
  await worker.dispatch('install'); await worker.dispatch('activate');
  f.fetch.mockClear();
  // a no-cors read (an image) is asked again in CORS mode with no credentials, keeping the rest of the request
  const request = new Request(cdnPart, { mode: 'no-cors', redirect: 'manual' });
  expect(await (await worker.dispatch('fetch', { request }))?.text()).toBe(`cdn:${cdnPart}`);
  const sent = f.fetch.mock.calls[0]?.[0];
  if (!(sent instanceof Request)) throw new Error('Missing CORS request');
  expect(sent.url).toBe(cdnPart); expect(sent.mode).toBe('cors'); expect(sent.credentials).toBe('omit'); expect(sent.redirect).toBe('manual');
  expect(await (await (await f.open(CONTENT_CACHE)).match(cdnPart))?.text()).toBe(`cdn:${cdnPart}`);
  expect(await (await f.open(ASSET_CACHE_NAME)).match(cdnPart)).toBeUndefined();
  f.fetch.mockRejectedValue(new Error('offline'));
  expect(await (await worker.dispatch('fetch', { request: new Request(cdnPart, { mode: 'no-cors' }) }))?.text()).toBe(`cdn:${cdnPart}`);
  expect(f.fetch).toHaveBeenCalledOnce();
});

test('PZ10: the content cache stores only a cors 200, never an opaque answer or a 206', async () => {
  for (const answer of [() => typed(null, 'opaque', 0), () => typed('part', 'cors', 206), () => typed('basic', 'basic'),
    () => typed('<html>missing</html>', 'cors', 200, { 'content-type': 'text/html' })]) {
    const f = fixture(() => Promise.resolve(answer())), worker = f.load('A', [], [], { base });
    const response = await worker.dispatch('fetch', { request: new Request(cdnPart) });
    expect(response).toBeDefined();
    expect(await (await f.open(CONTENT_CACHE)).keys()).toEqual([]);
  }
  // A no-cors read the CDN will not answer with CORS still loads (opaque), and is never kept.
  const f = fixture(request => request.mode === 'cors' ? Promise.reject(new TypeError('CORS refused')) : Promise.resolve(typed(null, 'opaque', 0)));
  const worker = f.load('A', [], [], { base }), image = `${base}assets/title/hero-0123456789abcdef.jpg`;
  expect((await worker.dispatch('fetch', { request: new Request(image, { mode: 'no-cors' }) }))?.type).toBe('opaque');
  expect(await (await f.open(CONTENT_CACHE)).keys()).toEqual([]);
});

test('PZ10: no activate deletes ws-content-v1', async () => {
  const f = fixture(request => Promise.resolve(typed(`cdn:${request.url}`, 'cors')));
  const first = f.load('A', ['/b/A/a-aaaaaaaa.js'], [], { base });
  await first.dispatch('install'); await first.dispatch('activate'); await first.dispatch('message', precached);
  await first.dispatch('fetch', { request: new Request(cdnPart) });
  for (const build of ['B', 'C', 'D']) {
    const next = f.load(build, [`/b/${build}/a-aaaaaaaa.js`], [], { base });
    await next.dispatch('install'); await next.dispatch('message', precached); await next.dispatch('activate');
  }
  expect(await f.caches.keys()).toContain(CONTENT_CACHE);
  expect(await (await f.open(CONTENT_CACHE)).match(cdnPart)).toBeDefined();
});

test('PZ10: the books precache at their CDN URLs, in CORS mode, and adoption waits for them', async () => {
  const books = [`${base}assets/spawn/packs-A.json`, `${base}assets/spawn/server-A.json`];
  let refuse = true;
  const f = fixture(request => Promise.resolve(request.url.startsWith(cdn) ? (refuse ? typed(null, 'opaque', 0) : typed(`cdn:${request.url}`, 'cors')) : new Response(`body:${request.url}`)));
  const worker = f.load('A', ['/b/A/a-aaaaaaaa.js'], [], { base, files: books });
  await worker.dispatch('install'); await worker.dispatch('activate');
  expect(f.fetch).not.toHaveBeenCalled(); // DL1: nothing before control
  const replies: unknown[] = [], port = { postMessage: (value: unknown) => { replies.push(value); } };
  await worker.dispatch('message', { ...precached, ports: [port] });
  expect(replies).toEqual([{ type: 'PRECACHE', ok: false, build: 'A' }]);
  expect(await (await f.open('ws-builds-v1')).keys()).toHaveLength(0);
  refuse = false;
  await worker.dispatch('message', { ...precached, ports: [port] });
  expect(replies.at(-1)).toEqual({ type: 'PRECACHE', ok: true, build: 'A' });
  const content = await f.open(CONTENT_CACHE);
  for (const book of books) expect(await (await content.match(book))?.text()).toBe(`cdn:${book}`);
  for (const [input] of f.fetch.mock.calls) if (input instanceof Request && input.url.startsWith(cdn)) { expect(input.mode).toBe('cors'); expect(input.credentials).toBe('omit'); }
  // the build's own record names its page code only, so no activate ever reaches into the content cache
  const record = await (await f.open('ws-builds-v1')).match(url('/__ws_build__/A'));
  expect(await record?.json()).toEqual({ files: [url('/b/A/a-aaaaaaaa.js')] });
});

test('PZ10: the content origin\'s mutable files go to the network untouched', async () => {
  const f = fixture(), worker = f.load('A', [], [], { base });
  for (const path of ['/clear-cache.json', '/releases/preview.json', '/content/0123456789abcdef/assets/x.json?sw=0']) {
    expect(await worker.dispatch('fetch', { request: new Request(`${cdn}${path}`) })).toBeUndefined();
  }
  expect(await worker.dispatch('fetch', { request: new Request(cdnPart, { method: 'HEAD' }) })).toBeUndefined();
  expect(f.fetch).not.toHaveBeenCalled();
});

test('PZ10: with no content base the worker behaves as today: another origin is never touched', async () => {
  const f = fixture(), worker = f.load('A', ['/b/A/a-aaaaaaaa.js']);
  await worker.dispatch('install'); await worker.dispatch('activate'); await worker.dispatch('message', precached);
  expect(f.fetch.mock.calls.map(([input]) => input instanceof Request ? input.url : input)).toEqual([url('/manifest.webmanifest'), url('/b/A/a-aaaaaaaa.js')]);
  f.fetch.mockClear();
  for (const request of [new Request(cdnPart), new Request(`${cdn}/assets/spawn/packs-A.json`)]) expect(await worker.dispatch('fetch', { request })).toBeUndefined();
  expect(f.fetch).not.toHaveBeenCalled();
  expect(await f.caches.keys()).not.toContain(CONTENT_CACHE);
});

test('PZ10: a part on the page origin is content too, so it survives an update', async () => {
  const f = fixture(), part = url('/assets/spawn/parts/fedcba9876543210.pack.br');
  const first = f.load('A', [], []); await first.dispatch('install'); await first.dispatch('activate');
  expect(await (await first.dispatch('fetch', { request: new Request(part) }))?.text()).toBe(`body:${part}`);
  expect(await (await f.open(CONTENT_CACHE)).match(part)).toBeDefined();
  expect(await (await f.open('ws-shell-v3-A')).match(part)).toBeUndefined();
  const next = f.load('B', [], []); await next.dispatch('install'); await next.dispatch('activate');
  expect(await f.caches.keys()).not.toContain('ws-shell-v3-A');
  f.fetch.mockClear(); f.fetch.mockRejectedValue(new Error('offline'));
  expect(await (await next.dispatch('fetch', { request: new Request(part) }))?.text()).toBe(`body:${part}`);
  expect(f.fetch).not.toHaveBeenCalled();
});

test('PZ10: a CORS or same-origin-mode read on the CDN goes exactly as it came', async () => {
  const f = fixture(request => Promise.resolve(typed(`cdn:${request.url}`, 'cors'))), worker = f.load('A', [], [], { base });
  const asked = [new Request(`${base}assets/spawn/a.json`, { headers: { range: 'bytes=0-9', 'if-range': '"tag"' } }), new Request(`${base}assets/spawn/b.json`, { mode: 'same-origin' })];
  for (const request of asked) await worker.dispatch('fetch', { request });
  expect(f.fetch.mock.calls.map(([input]) => input)).toEqual(asked);
});

test('PZ10: a content base on the page\'s own origin owns its folder only, and keeps its same-origin answers', async () => {
  const local = url('/content/0123456789abcdef/'), book = `${local}assets/spawn/packs-A.json`;
  const f = fixture(request => Promise.resolve(typed(`body:${request.url}`, 'basic'))), worker = f.load('A', [], [], { base: local, files: [book] });
  await worker.dispatch('install'); await worker.dispatch('activate');
  const replies: unknown[] = [];
  await worker.dispatch('message', { ...precached, ports: [{ postMessage: (value: unknown) => { replies.push(value); } }] });
  expect(replies).toEqual([{ type: 'PRECACHE', ok: true, build: 'A' }]);
  expect(await (await worker.dispatch('fetch', { request: new Request(url('/')) }))?.text()).toBe(document);
  for (const path of ['/version.json', '/api/telemetry']) expect(await worker.dispatch('fetch', { request: new Request(url(path)) })).toBeUndefined();
  f.fetch.mockClear(); f.fetch.mockRejectedValue(new Error('offline'));
  expect(await (await worker.dispatch('fetch', { request: new Request(book) }))?.text()).toBe(`body:${book}`);
});

test('QA 11-12 row 36: /programs/ and /shardfiles/ go network first, are kept per build, and answer from the cache offline', async () => {
  let offline = false;
  const f = fixture(request => offline ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve(new Response(`net:${request.url}`)));
  const worker = f.load('A', [], []);
  await worker.dispatch('install'); await worker.dispatch('activate');
  const files = ['/programs/driftwood-isle.json', '/shardfiles/far-reach/sections/world/tiles.json'];
  for (const path of files) expect(await (await worker.dispatch('fetch', { request: new Request(url(path)) }))?.text()).toBe(`net:${url(path)}`);
  const shellCache = await f.open('ws-shell-v3-A');
  for (const path of files) expect(await (await shellCache.match(url(path)))?.text(), 'kept in this build\'s shell').toBe(`net:${url(path)}`);
  // Online, a deploy's new copy is read first, never the kept one.
  await shellCache.put(url(files[0] ?? ''), new Response('old'));
  expect(await (await worker.dispatch('fetch', { request: new Request(url(files[0] ?? '')) }))?.text()).toBe(`net:${url(files[0] ?? '')}`);
  offline = true;
  for (const path of files) expect(await (await worker.dispatch('fetch', { request: new Request(url(path)) }))?.text(), 'offline: the kept copy').toBe(`net:${url(path)}`);
  // A file this device never read still fails at once offline, as the network does.
  await expect(worker.dispatch('fetch', { request: new Request(url('/programs/nalati-grasslands.json')) })).rejects.toThrow('Failed to fetch');
});
