import { workerScope } from '../app/workerScope.js';
/* MF1: one URL cache, one build shell, and one previous generation of code.
 * No fetched-body reconstruction, checksums, receipts, packs, retries or work timers. */
const BUILD = '__BUILD_ID__';
const DOCUMENT = '__DOCUMENT__';
const ASSETS = '__ASSET_CACHE__';
const BOOKS = 'ws-builds-v1';
const SHELL_PREFIX = 'ws-shell-v3-';
const SHELL = `${SHELL_PREFIX}${BUILD}`;
const FILES = JSON.parse('__FILES__');
const SHELL_FILES = JSON.parse('__SHELL_FILES__');
const NAMED = new Set(FILES);
const MATCH = { ignoreVary: true };
const abs = path => new URL(path, self.registration.scope).href;
const bookKey = build => abs(`/__ws_build__/${encodeURIComponent(build)}`);
const CONTENT = /-[a-f0-9]{8,64}\.[a-z0-9]+$|\/[a-f0-9]{64}\.[a-z0-9]+$/;
const HASH = /\/([a-f0-9]{64})\.[a-z0-9]+$/;
/** @param {URL} url */
const immutable = url => NAMED.has(url.pathname) || url.pathname.startsWith('/b/') || CONTENT.test(url.pathname)
  || /^[a-f0-9]{8,64}$/.test(url.searchParams.get('v') ?? '');
const isHtml = response => /\btext\/html\b/i.test(response.headers.get('content-type') ?? '');

// Keep the current worker's hot handles. WebKit can take a second to reopen
// a cache during navigation; a rejected open must remain retryable.
const stores = new Map();
function store(name) {
  const existing = stores.get(name);
  if (existing !== undefined) return existing;
  const pending = (async () => {
    await Promise.resolve(); // Publish this promise before a synchronous storage refusal.
    try { return await caches.open(name); }
    catch (error) { if (stores.get(name) === pending) stores.delete(name); throw error; }
  })();
  stores.set(name, pending);
  return pending;
}

async function precache(cache, urls, contentNamed = false) {
  await Promise.all(urls.map(async path => {
    const key = abs(path);
    const held = await cache.match(key, MATCH);
    if (held !== undefined && !isHtml(held)) return;
    if (held !== undefined) await cache.delete(key);
    const response = await fetch(new Request(key, { cache: contentNamed ? 'force-cache' : 'reload' }));
    if (!response.ok || isHtml(response)) throw new Error(`Precache failed: ${path} (${response.status})`);
    await cache.put(key, response);
  }));
}

// Import old immutable entries once; mutable public URLs deliberately load cold.
async function importPrevious(assets, books) {
  if ((await books.keys()).length > 0) return;
  const code = [];
  for (const name of await caches.keys()) {
    if (name !== 'ws-immutable' && !name.startsWith('ws-static-')) continue;
    const old = await caches.open(name);
    for (const request of await old.keys()) {
      const url = new URL(request.url);
      if (name !== 'ws-immutable' && !immutable(url)) continue;
      const response = await old.match(request, MATCH);
      if (response === undefined || isHtml(response)) continue;
      await assets.put(request, response);
      if (name === 'ws-immutable') code.push(request.url);
    }
  }
  if (code.length > 0) await books.put(bookKey('previous'), Response.json({ files: code }));
}

workerScope.listen(self, 'install', event => {
  // Native cache routes avoid waking the worker for already installed title code.
  // Both engines get the controlling worker's exact baked document.
  const pattern = pathname => ({ protocol: self.location.protocol.slice(0, -1), hostname: self.location.hostname,
    port: self.location.port, pathname, search: '' });
  const routes = typeof event.addRoutes === 'function' ? event.addRoutes([
    ...['script', 'style'].map(requestDestination => ({ condition: { urlPattern: pattern('/b/*'), requestDestination, requestMethod: 'GET' }, source: { cacheName: ASSETS } })),
    { condition: { urlPattern: pattern('/assets/title/*'), requestDestination: 'image', requestMethod: 'GET' }, source: { cacheName: ASSETS } },
    { condition: { urlPattern: pattern('/fonts/*'), requestDestination: 'font', requestMethod: 'GET' }, source: { cacheName: SHELL } },
  ]) : undefined;
  event.waitUntil((async () => {
    await routes;
    const [assets, shell, books] = await Promise.all([store(ASSETS), store(SHELL), caches.open(BOOKS)]);
    await importPrevious(assets, books);
    const namedShell = SHELL_FILES.filter(path => immutable(new URL(abs(path))));
    await Promise.all([precache(shell, SHELL_FILES.filter(path => !namedShell.includes(path))),
      precache(assets, namedShell, true)]);
  })());
});

// DL1: the build's hashed code is precached only when a page reports control (PRECACHE), so a cold visit's level
// download has the link to itself. Chunks that page already loaded come from the HTTP cache (force-cache).
// Only a completely precached build is a generation; a failed precache never evicts working code and is asked again.
// It yields to a page that is loading (G872, sp-o2's quick-return gate): a navigation, or a fetch from a page that has
// not reported control yet, pauses it and aborts its in-flight fetches (re-queued); the next PRECACHE (that page's
// control, or an explicit adoption) resumes it. A few fetches at a time, so a pause frees the link at once.
// A pause never strands it (sp-x2): it also resumes once every loading client that paused it is gone, and at the
// latest PAUSE_LIMIT_MS after the pause. A waiting update has no fetch events of its own: a loading page tells it
// with a PAUSE message (src/client/engine/boot/sw.ts), and that page's control resumes it with PRECACHE.
// Only a document loads. A worker never reports control, and the server worker lives as long as its page, so its reads
// would hold the precache to the limit on every visit (DL1): a worker's fetch neither pauses it nor counts as a loader.
const PRECACHE_LANES = 6, PAUSE_LIMIT_MS = 60_000;
let precaching, paused = false, resume = () => undefined, pauses = 0;
const inflight = new Set(), controlled = new Set(), loading = new Set(), workers = new Map();
function isWorker(id) {
  if (typeof self.clients?.get !== 'function') return Promise.resolve(false);
  let known = workers.get(id);
  if (known === undefined) { known = self.clients.get(id).then(client => client?.type === 'worker', () => false); workers.set(id, known); }
  return known;
}
async function pauseForClient(id) {
  if (typeof id === 'string' && id !== '' && await isWorker(id)) return;
  pausePrecache(id);
}
function pausePrecache(client) {
  if (typeof client === 'string' && client !== '') loading.add(client);
  if (precaching === undefined || paused) return;
  paused = true;
  for (const lane of inflight) lane.abort();
  const pause = ++pauses; // a limit only ends the pause that set it
  workerScope.timeout(PAUSE_LIMIT_MS, () => { if (paused && pauses === pause) resumePrecache(); });
}
function resumePrecache() {
  paused = false;
  loading.clear();
  const waiting = resume;
  resume = () => undefined;
  waiting();
}
/** While paused, a controlled page's read checks whether the loading clients still exist; none left resumes. */
async function resumeIfLoadersGone() {
  if (!paused || typeof self.clients?.get !== 'function') return;
  for (const id of Array.from(loading)) if (await self.clients.get(id) === undefined) loading.delete(id);
  if (paused && loading.size === 0) resumePrecache();
}
/** Resolves at once, or on the resume that ends the current pause. */
function whilePaused() {
  if (!paused) return Promise.resolve();
  return new Promise(resolve => { const previous = resume; resume = () => { previous(); resolve(); }; });
}
async function precacheQueue(cache, urls) {
  const pending = [...urls];
  const lane = async () => {
    for (;;) {
      await whilePaused();
      const path = pending.shift();
      if (path === undefined) return;
      const key = abs(path), control = new AbortController();
      inflight.add(control);
      try {
        const held = await cache.match(key, MATCH);
        if (held !== undefined && !isHtml(held)) continue;
        if (held !== undefined) await cache.delete(key);
        // DL25: a part's member is kept under its manifest's `?v=`, and no HTTP cache saw it. These names are hashed: same file.
        const kept = await cache.match(key, { ...MATCH, ignoreSearch: true });
        if (kept !== undefined && !isHtml(kept)) { await cache.put(key, kept); continue; }
        const response = await fetch(new Request(key, { cache: 'force-cache', signal: control.signal }));
        if (!response.ok || isHtml(response)) throw new Error(`Precache failed: ${path} (${response.status})`);
        await cache.put(key, response);
      } catch (error) {
        if (!control.signal.aborted) throw error;
        pending.unshift(path); // paused mid-fetch: fetch it again after the resume
      } finally { inflight.delete(control); }
    }
  };
  await Promise.all(Array.from({ length: PRECACHE_LANES }, lane));
}
function precacheGeneration() {
  precaching ??= (async () => {
    try {
      const [assets, books] = await Promise.all([store(ASSETS), caches.open(BOOKS)]);
      await precacheQueue(assets, FILES);
      await books.put(bookKey(BUILD), Response.json({ files: FILES.map(abs) }));
    } catch (error) { precaching = undefined; throw error; }
  })();
  return precaching;
}

workerScope.listen(self, 'activate', event => {
  event.waitUntil((async () => {
    const books = await caches.open(BOOKS), current = bookKey(BUILD);
    const keys = await books.keys(), previous = keys.findLast(key => key.url !== current)?.url;
    const kept = new Set(FILES.map(abs));
    if (previous !== undefined) {
      const record = await books.match(previous);
      if (record !== undefined) for (const file of (await record.json()).files) kept.add(file);
    }
    const assets = await store(ASSETS);
    for (const key of keys) {
      if (key.url === current || key.url === previous) continue;
      const record = await books.match(key);
      if (record !== undefined) for (const file of (await record.json()).files) if (!kept.has(file)) await assets.delete(file);
      await books.delete(key);
    }
    for (const name of await caches.keys()) {
      if (name === SHELL) continue;
      if (name.startsWith('ws-shell-') || name.startsWith('ws-static-') || name === 'ws-immutable') await caches.delete(name);
    }
  })());
});

async function cached(request, name) {
  let cache;
  // A visible retry must reach the origin, including past the legacy URL cache.
  const reload = request.cache === 'reload' || request.cache === 'no-store';
  try {
    cache = await store(name);
    const response = reload ? undefined : await cache.match(request, MATCH);
    if (response !== undefined && !isHtml(response)) return response;
    // DL25: a hashed name read bare, where a part's member was kept under its manifest's `?v=`: the same file
    if (!reload && CONTENT.test(new URL(request.url).pathname)) {
      const kept = await cache.match(request, { ...MATCH, ignoreSearch: true });
      if (kept !== undefined && !isHtml(kept)) return kept;
    }
    if (response !== undefined) await cache.delete(request);
    if (!reload && name !== ASSETS) {
      const shared = await (await store(ASSETS)).match(request, MATCH);
      if (shared !== undefined && !isHtml(shared)) return shared;
      if (shared !== undefined) await (await store(ASSETS)).delete(request);
    }
    // Wave 2 removes the old page cache. Until then retain its already named bodies.
    const hash = HASH.exec(new URL(request.url).pathname)?.[1];
    if (!reload && hash !== undefined && (await caches.keys()).includes('ws-content-v0')) {
      const old = await (await caches.open('ws-content-v0')).match(abs(`/__ws_content__/v0/${hash}`), MATCH);
      if (old !== undefined && !isHtml(old)) {
        await cache.put(request, old.clone()).catch(() => undefined);
        return old;
      }
    }
  } catch { stores.delete(name); stores.delete(ASSETS); /* Storage denial keeps online fetch working. */ }
  const response = await fetch(request);
  // Native no-body statuses pass through untouched. A range never replaces a full body.
  if (cache !== undefined && response.status === 200 && !isHtml(response)) await cache.put(request, response.clone()).catch(() => undefined);
  return response;
}

workerScope.listen(self, 'fetch', event => {
  const request = event.request, url = new URL(request.url);
  // A loading page (a navigation, or a client that has not reported control) gets the link: the precache waits.
  if (request.mode === 'navigate') pausePrecache(event.resultingClientId);
  else if (!controlled.has(event.clientId)) event.waitUntil(pauseForClient(event.clientId));
  else if (paused) event.waitUntil(resumeIfLoadersGone());
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.searchParams.get('sw') === '0') return;
  if (url.pathname === '/version.json' || url.pathname === '/sw.js' || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(new Response(DOCUMENT, { headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' } }));
    return;
  }
  if (immutable(url)) {
    event.respondWith(cached(request, ASSETS));
    return;
  }
  if (/^\/(?:assets|basis|fonts)\//.test(url.pathname) || url.pathname === '/manifest.webmanifest') {
    event.respondWith(cached(request, SHELL));
  }
});

workerScope.listen(self, 'message', event => {
  const type = event.data?.type;
  if (type === 'SKIP_WAITING') { event.waitUntil(self.skipWaiting()); return; }
  if (type === 'PAUSE') { pausePrecache(event.source?.id); return; }
  if (type === 'PRECACHE') {
    // Adoption waits on this reply: a build is offered as the next document's worker only once its code is held.
    // A page asks once it reaches control, so it no longer counts as loading, and the precache resumes.
    const port = event.ports?.[0], client = event.source?.id;
    if (typeof client === 'string') controlled.add(client);
    resumePrecache();
    event.waitUntil((async () => {
      let ok = true;
      try { await precacheGeneration(); } catch { ok = false; }
      port?.postMessage({ type, ok, build: BUILD });
    })());
    return;
  }
  if (type !== 'BUILD' && type !== 'VERSION') return;
  const value = { type, build: BUILD };
  const port = event.ports?.[0];
  if (port !== undefined) port.postMessage(value);
  else event.source?.postMessage(value);
});
