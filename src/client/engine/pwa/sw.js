import { workerScope } from '../app/workerScope.js';
import { diagnosticNow } from '../../../shared/engine/core/clock';
/* MF1: one URL cache, one build shell, and one previous generation of code.
 * No fetched-body reconstruction, checksums, receipts, packs, retries or work timers. */
const BUILD = '__BUILD_ID__';
const DOCUMENT = '__DOCUMENT__';
// PZ12 (J274): the page origin's COOP and COEP for the baked document (empty on a channel that is not isolated)
const DOCUMENT_HEADERS = (baked => baked.startsWith('{') ? JSON.parse(baked) : {})('__DOCUMENT_HEADERS__');
const ISOLATED = Object.keys(DOCUMENT_HEADERS).length > 0;
/** PZ12: a dedicated worker in an isolated page starts only if its own script carries COEP. A worker chunk whose name did
 *  not change across the switch is held here (or in the HTTP cache) with the headers it was first fetched with, so on an
 *  isolated channel every worker script this worker answers wears the document's headers. */
async function isolatedWorkerScript(pending) {
  const response = await pending;
  if (response.type === 'opaque' || response.type === 'opaqueredirect') return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(DOCUMENT_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
const answer = (event, request, pending) => { event.respondWith(ISOLATED && request.destination === 'worker' ? isolatedWorkerScript(pending) : pending); };
const ASSETS = '__ASSET_CACHE__';
const BOOKS = 'ws-builds-v1';
const SHELL_PREFIX = 'ws-shell-v3-';
const SHELL = `${SHELL_PREFIX}${BUILD}`;
/** OFFLINE OF5 (J298): a world build (its document stamped with `__WS_WORLD__`; play, staging) never runs the in-page solo
 *  server, so it never precaches the solo server's code or its server book. Read at run time: a deploy stamps the document. */
const WORLD = /\bglobalThis\.__WS_WORLD__=/u.test(DOCUMENT);
const SOLO_ONLY = /\/standalone\/(?:serverWorker|serverRuntime)-[^/]+\.js$|\/assets\/spawn\/server-[^/]+\.json$/u;
const FILES = JSON.parse('__FILES__');
/** What this build precaches and records as its generation: its files, less the solo server's on a world build. */
const PRECACHE_FILES = FILES.filter(path => !WORLD || !SOLO_ONLY.test(path));
const SHELL_FILES = JSON.parse('__SHELL_FILES__');
const NAMED = new Set(FILES);
const MATCH = { ignoreVary: true };
const abs = path => new URL(path, self.registration.scope).href;
const bookKey = build => abs(`/__ws_build__/${encodeURIComponent(build)}`);
const CONTENT = /-[a-f0-9]{8,64}\.[a-z0-9]+$|\/[a-f0-9]{64}\.[a-z0-9]+$/;
const HASH = /\/([a-f0-9]{64})\.[a-z0-9]+$/;
/** OF5: a spawn manifest's code list (`code/<sha16>.json`) is named by its own bytes too, so it is kept across builds: an
 *  update's first offline launch still reads the route's code list. */
const OWN_NAMED = /^\/assets\/spawn\/code\/[a-f0-9]{16}\.json$/;
/** @param {URL} url */
const immutable = url => NAMED.has(url.pathname) || url.pathname.startsWith('/b/') || CONTENT.test(url.pathname) || OWN_NAMED.test(url.pathname)
  || /^[a-f0-9]{8,64}$/.test(url.searchParams.get('v') ?? '');
const isHtml = response => /\btext\/html\b/i.test(response.headers.get('content-type') ?? '');
/* PAGE-SIZE PZ10 (J276): content on the content base (`https://packs.wildshard.io/content/<set>/`, baked from the boot
 * bank by serviceWorker.ts; '' when content is on the page) lives in one cross-build cache, keyed by exact URL: every key
 * there is content-named, so a copy is good for every build that names it, and no activate touches it. Only a CORS 200 is
 * kept: an opaque body cannot be checked and is padded against quota, and a range never stands for the whole file. */
/** @type {{ base: string, files: string[] }} one parsed value: the bundler would fold a literal base into its origin */
const { base: CONTENT_BASE, files: CONTENT_FILES } = JSON.parse('__CONTENT__');
/** OF5: the server book on the content base is solo-only too (a URL there, its path under the base's folder). */
const CONTENT_PRECACHE = CONTENT_FILES.filter(href => !WORLD || !SOLO_ONLY.test(new URL(href).pathname));
const CONTENT_CACHE = 'ws-content-v1';
const CONTENT_URL = CONTENT_BASE === '' ? undefined : new URL(CONTENT_BASE);
/** A base on the page's own origin (contentBase.ts allows one) owns its folder only; the rest of the origin is the page's. */
const SAME_ORIGIN_BASE = CONTENT_URL?.origin === self.location.origin;
/** A part on the page origin is content-named too (`<hash16>.pack.br`): kept across builds, not in the build's shell. */
const PAGE_PART = /^\/assets\/spawn\/(?:[^/]+\/)*[a-f0-9]{16}\.pack\.br$/;
/** The content origin's mutable files (the signed channel objects, the cache clear) always go to the network.
 * @param {URL} url */
const isContentRead = url => CONTENT_URL !== undefined && url.origin === CONTENT_URL.origin && (SAME_ORIGIN_BASE
  ? CONTENT_URL.pathname !== '/' && url.pathname.startsWith(CONTENT_URL.pathname)
  : url.pathname !== '/clear-cache.json' && !url.pathname.startsWith('/releases/'));
/** A readable 200: CORS from the CDN (`basic` only from a base on the page's own origin), never opaque, never a range.
 * @param {Response} response */
const keepContent = response => (response.type === 'cors' || SAME_ORIGIN_BASE && response.type === 'basic') && response.status === 200 && !isHtml(response);
/** The same request as a plain CORS GET with no credentials, as the page's own content reads are (no preflight: at most a
 * single Range); its headers, redirect mode, cache mode and signal are kept.
 * @param {Request | string} input @param {RequestInit} init */
const corsRequest = (input, init = {}) => new Request(input, { ...init, mode: 'cors', credentials: 'omit' });

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
const inflight = new Set(), controlled = new Set(), loading = new Set(), nonLoadingClients = new Map();
/** @param {URL} url */
const isDoctorDocument = url => url.origin === self.location.origin
  && (url.pathname === '/doctor' || url.pathname === '/doctor/' || url.pathname === '/doctor/index.html'
    || (url.pathname === '/' || url.pathname === '/index.html') && url.searchParams.has('doctor'));
// OF6: only a page we can see loads. A client `clients.get` doesn't list (a dedicated worker some browsers don't) is not one.
function isNonLoadingClient(id) {
  if (typeof self.clients?.get !== 'function') return Promise.resolve(false);
  let known = nonLoadingClients.get(id);
  if (known === undefined) {
    known = self.clients.get(id).then(client => {
      // unseen now may be a page a browser lists late: not kept, so its next read asks again
      if (client === undefined) { nonLoadingClients.delete(id); return true; }
      return client.type === 'worker' || client.type === 'sharedworker' || client.type === 'window' && isDoctorDocument(new URL(client.url));
    }, () => false);
    nonLoadingClients.set(id, known);
  }
  return known;
}
// OF6: a read with no client id (a worker's own script) is no loading page; a navigation pauses through its own branch. Before,
// such reads paused the precache and aborted its fetches on every read, so a page's workers held it paused while they read.
async function pauseForClient(id) {
  if (typeof id !== 'string' || id === '' || await isNonLoadingClient(id)) return;
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
async function precacheQueue(cache, urls, content = false) {
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
        if (content) {
          const response = await fetch(corsRequest(key, { cache: 'force-cache', signal: control.signal }));
          if (!keepContent(response)) throw new Error(`Precache failed: ${path} (${response.type} ${response.status})`);
          await cache.put(key, response);
          continue;
        }
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
      await precacheQueue(assets, PRECACHE_FILES);
      // PZ10: this build's books on the content base; a build is a generation (and adoptable) only once they are held
      if (CONTENT_PRECACHE.length > 0) await precacheQueue(await store(CONTENT_CACHE), CONTENT_PRECACHE, true);
      await books.put(bookKey(BUILD), Response.json({ files: PRECACHE_FILES.map(abs) }));
    } catch (error) { precaching = undefined; throw error; }
  })();
  return precaching;
}

/** OFFLINE OF7 (PZ15): the build's network-first reads (`/programs/`, `/shardfiles/`) are kept in its shell, which activate
 *  deletes. Copy them into this build's shell first, so the first offline launch after an update still has them; a copy this
 *  shell holds wins, and the newest older shell wins over older ones. Online they are still read from the network first.
 *  Chosen over content-naming those files (OF7's other fix): this changes no URL, no cook and no reader. */
/** OF5: the deck's draft cards (`/drafts/`, named by their source art, not their bytes) are read the same way. */
const NETWORK_FIRST = /^\/(?:programs|shardfiles|drafts)\//;
async function carryNetworkFirst() {
  const shell = await store(SHELL);
  for (const name of (await caches.keys()).reverse()) {
    if (name === SHELL || !name.startsWith(SHELL_PREFIX)) continue;
    const old = await caches.open(name);
    // in parallel within one shell (its keys are distinct): activate holds the first launch after an update
    await Promise.all((await old.keys()).map(async request => {
      if (!NETWORK_FIRST.test(new URL(request.url).pathname) || await shell.match(request, MATCH) !== undefined) return;
      const response = await old.match(request, MATCH);
      if (response !== undefined && !isHtml(response)) await shell.put(request, response);
    }));
  }
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
    await carryNetworkFirst().catch(() => undefined);
    for (const name of await caches.keys()) {
      if (name === SHELL) continue;
      if (name.startsWith('ws-shell-') || name.startsWith('ws-static-') || name === 'ws-immutable') await caches.delete(name);
    }
  })());
});

// LS1: local client messages only; never await diagnostics before delivery.
const bootOrigin = performance.timeOrigin, bootPending = new Map();
function bootPublish(event, rows) {
  const id = (event?.resultingClientId === '' ? undefined : event?.resultingClientId) ?? event?.clientId;
  if (!id || controlled.has(id)) return;
  const records = rows.map(row => ({...row,origin:bootOrigin,client:id}));
  try { event.waitUntil(self.clients.get(id).then(client => {
    if (client && (client.type === 'window' || /serverWorker|\.worker|DecodeWorker/.test(client.url))) {
      client.postMessage({__engineBootTiming:1,serviceWorker:true,records}, []);
    } else {
      if (!bootPending.has(id) && bootPending.size >= 32) bootPending.delete(bootPending.keys().next().value);
      const held=bootPending.get(id) ?? [];
      for (const record of records) {if (held.length < 256) held.push(record);
      else held[255]={...record,operation:'sw:buffer-overflow',result:'unknown'};}
      bootPending.set(id,held);
    }
    return undefined;
  }).catch(() => { /* Diagnostics cannot refuse a response. */ })); } catch { /* Event retirement does not affect delivery. */ }
}
async function cached(request, name, event) {
  const received=diagnosticNow();
  const records=[{operation:'sw:handler-received',url:request.url,start:received,end:received,result:'observed'}];
  const timed = async (operation, work) => {
    const start=diagnosticNow(); let result='complete';
    try { return await work(); } catch(error) {result='failed';throw error;}
    finally {records.push({operation,url:request.url,start,end:diagnosticNow(),result});}
  };
  const delivery = response => {records.push({operation:'sw:response-delivery-decision',url:request.url,start:diagnosticNow(),end:diagnosticNow(),result:'observed'});bootPublish(event,records);return response;};
  let cache;
  // A visible retry must reach the origin, including past the legacy URL cache.
  const reload = request.cache === 'reload' || request.cache === 'no-store';
  try {
    cache = await timed('sw:cache-open', () => store(name));
    const response = reload ? undefined : await timed('sw:cache-match', () => cache.match(request, MATCH));
    records.push({operation:response !== undefined && !isHtml(response) ? 'sw:cache-hit' : 'sw:cache-miss',url:request.url,start:diagnosticNow(),end:diagnosticNow(),result:'observed'});
    if (response !== undefined && !isHtml(response)) return delivery(response);
    // DL25: a hashed name read bare, where a part's member was kept under its manifest's `?v=`: the same file
    if (!reload && CONTENT.test(new URL(request.url).pathname)) {
      const kept = await timed('sw:cache-match-ignore-search', () => cache.match(request, { ...MATCH, ignoreSearch: true }));
      if (kept !== undefined && !isHtml(kept)) return delivery(kept);
    }
    if (response !== undefined) await timed('sw:discard-html', () => cache.delete(request));
    if (!reload && name !== ASSETS) {
      const assets = await timed('sw:shared-cache-open', () => store(ASSETS));
      const shared = await timed('sw:shared-cache-match', () => assets.match(request, MATCH));
      if (shared !== undefined && !isHtml(shared)) return delivery(shared);
      if (shared !== undefined) await timed('sw:discard-shared-html', () => assets.delete(request));
    }
    // Wave 2 removes the old page cache. Until then retain its already named bodies.
    const hash = HASH.exec(new URL(request.url).pathname)?.[1];
    if (!reload && hash !== undefined && (await timed('sw:legacy-cache-list', () => caches.keys())).includes('ws-content-v0')) {
      const legacy = await timed('sw:legacy-cache-open', () => caches.open('ws-content-v0'));
      const old = await timed('sw:legacy-cache-match', () => legacy.match(abs(`/__ws_content__/v0/${hash}`), MATCH));
      if (old !== undefined && !isHtml(old)) {
        await timed('sw:legacy-copy-publication', () => cache.put(request, old.clone())).catch(() => undefined);
        return delivery(old);
      }
    }
  } catch { stores.delete(name); stores.delete(ASSETS); /* Storage denial keeps online fetch working. */ }
  const response = await timed('sw:network-fetch-to-headers', () => fetch(request)).catch((/** @type {unknown} */ error) => {bootPublish(event,records);throw error;});
  // Native no-body statuses pass through untouched. A range never replaces a full body.
  if (cache !== undefined && response.status === 200 && !isHtml(response)) await timed('sw:body-and-cache-publication', () => cache.put(request, response.clone())).catch(() => undefined);
  return delivery(response);
}

/** QA 11-12 row 36: a build's own unhashed reads (`/programs/<slug>.json`, the recorded shader programs, and `/shardfiles/**`: a
 *  neighbour's tiles, collision, props and look) carry no hash, so they are not `immutable`. Network first, so a deploy's copy is
 *  always read online; each 200 is kept in this build's shell, which answers when the network can't (offline, a dropped link).
 *  The page gets the response at once; the copy is written behind it.
 *  @param {Request} request @param {string} name @param {{ waitUntil: (work: Promise<unknown>) => void }} event */
async function networkFirst(request, name, event) {
  try {
    const response = await fetch(request);
    if (response.status === 200 && !isHtml(response)) {
      const copy = response.clone();
      event.waitUntil(store(name).then(cache => cache.put(request, copy)).catch(() => undefined));
    }
    return response;
  } catch (error) {
    const held = await store(name).then(cache => cache.match(request, MATCH)).catch(() => undefined);
    if (held !== undefined && !isHtml(held)) return held;
    throw error;
  }
}

/** PZ10: a read on the content base's origin, cache-first by exact URL. A miss is fetched as asked and kept only as a CORS
 *  200. A no-cors read (an image, a CSS background) is asked again in CORS mode, so it can be kept; if the CDN will not answer
 *  that, it still loads, as itself, unkept. Any other mode (cors, same-origin, an only-if-cached probe) goes as it came.
 * @param {Request} request */
async function contentRead(request) {
  const reload = request.cache === 'reload' || request.cache === 'no-store';
  let cache;
  try {
    cache = await store(CONTENT_CACHE);
    const held = reload ? undefined : await cache.match(request.url, MATCH);
    if (held !== undefined && !isHtml(held)) return held;
  } catch { stores.delete(CONTENT_CACHE); /* Storage denial keeps online fetch working. */ }
  let response;
  if (request.mode !== 'no-cors') response = await fetch(request);
  else {
    try { response = await fetch(corsRequest(request)); }
    catch { return fetch(request); }
  }
  if (cache !== undefined && keepContent(response)) await cache.put(request.url, response.clone()).catch(() => undefined);
  return response;
}

workerScope.listen(self, 'fetch', event => {
  const request = event.request, url = new URL(request.url);
  // A diagnostic document must reach its own host route, not the cached game
  // shell. It owns no game loader and must not pause the game's precache.
  const doctor = request.mode === 'navigate' && isDoctorDocument(url);
  if (doctor) return;
  // A loading page (a navigation, or a client that has not reported control) gets the link: the precache waits.
  if (request.mode === 'navigate') pausePrecache(event.resultingClientId);
  else if (!controlled.has(event.clientId)) event.waitUntil(pauseForClient(event.clientId));
  else if (paused) event.waitUntil(resumeIfLoadersGone());
  if (request.method !== 'GET' || url.searchParams.get('sw') === '0') return;
  if (isContentRead(url)) { event.respondWith(contentRead(request)); return; }
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/version.json' || url.pathname === '/sw.js' || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    const received=diagnosticNow();
    event.respondWith(new Response(DOCUMENT, { headers: { ...DOCUMENT_HEADERS, 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' } }));
    bootPublish(event,[{operation:'sw:navigation-handler-and-delivery',url:request.url,start:received,end:diagnosticNow(),result:'complete'}]);
    return;
  }
  if (PAGE_PART.test(url.pathname)) {
    event.respondWith(cached(request, CONTENT_CACHE, event));
    return;
  }
  if (immutable(url)) {
    answer(event, request, cached(request, ASSETS, event));
    return;
  }
  if (/^\/(?:assets|basis|fonts)\//.test(url.pathname) || url.pathname === '/manifest.webmanifest') {
    answer(event, request, cached(request, SHELL, event));
  } else if (NETWORK_FIRST.test(url.pathname)) answer(event, request, networkFirst(request, SHELL, event));
});

workerScope.listen(self, 'message', event => {
  const type = event.data?.type;
  if (type === 'BOOT_TIMING') {const id=event.source?.id, rows=bootPending.get(id) ?? [];bootPending.delete(id);event.source?.postMessage({__engineBootTiming:1,serviceWorker:true,attempt:event.data.attempt,records:rows}, []);return;}
  if (type === 'SKIP_WAITING') { event.waitUntil(self.skipWaiting()); return; }
  if (type === 'PAUSE') { pausePrecache(event.source?.id); return; }
  if (type === 'PRECACHE') {
    // Adoption waits on this reply: a build is offered as the next document's worker only once its code is held.
    // A page asks once it reaches control, so it no longer counts as loading, and the precache resumes.
    const port = event.ports?.[0], client = event.source?.id;
    // OF5a: a title asks too (`update`), so a build update seen only on the title holds its code before the first offline
    // launch. Only on a device that holds another build's generation: a first visit's title still reads nothing (S2, DL1),
    // and a title that is turned down neither counts as a page past loading nor resumes another page's pause.
    const update = event.data?.update === true;
    const settle = () => { if (typeof client === 'string') controlled.add(client); resumePrecache(); };
    if (!update) settle();
    event.waitUntil((async () => {
      let ok = true;
      try {
        if (update && (await (await caches.open(BOOKS)).keys()).every(key => key.url === bookKey(BUILD))) ok = false;
        else { if (update) settle(); await precacheGeneration(); }
      } catch { ok = false; }
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
