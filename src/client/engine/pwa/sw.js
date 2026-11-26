import { FORCE_CACHE_MARKER, forceCacheState, setForceCacheState, wipeDownloadedCaches } from './forceCache';
import { workerScope } from '../app/workerScope.js';
import { diagnosticNow } from '../../../shared/engine/core/clock';
import { cacheChannel, cacheName, ownsCache, PRODUCTION_MARK } from './cacheNames';
/* MF1: one URL cache, one build shell, and one previous generation of code.
 * No fetched-body reconstruction, checksums, receipts, packs, retries or work timers. */
const BUILD = '__BUILD_ID__';
const DOCUMENT = '__DOCUMENT__';
// PZ12 (J274): the page origin's COOP and COEP for the baked document; DW12: COOP on every channel, COEP only isolated
const DOCUMENT_HEADERS = (baked => baked.startsWith('{') ? JSON.parse(baked) : {})('__DOCUMENT_HEADERS__');
const ISOLATED = 'cross-origin-embedder-policy' in DOCUMENT_HEADERS;
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
/** OFFLINE OF5 (J298): a world build (its document stamped with `__WS_WORLD__`; play, staging) never runs the in-page solo
 *  server, so it never precaches the solo server's code or its server book. Read at run time: a deploy stamps the document. */
const WORLD = /\bglobalThis\.__WS_WORLD__=/u.test(DOCUMENT);
/** OFFLINE OF12: every cache this worker opens carries its channel (cacheNames.ts), read from the same stamp, so preview and
 *  staging on one origin keep disjoint caches. Production's names are the ones it always had. */
const CHANNEL = cacheChannel((() => {
  const stamp = /\bglobalThis\.__WS_WORLD__=(\{[^;]+\});/u.exec(DOCUMENT)?.[1];
  try { return stamp === undefined ? undefined : JSON.parse(stamp); } catch { return {}; }
})(), /\bglobalThis\.__WS_EXPLORE__=true;/u.test(DOCUMENT));
const ASSETS = cacheName('__ASSET_CACHE__', CHANNEL);
const BOOKS = cacheName('ws-builds-v1', CHANNEL);
const SHELL_FAMILY = cacheName('ws-shell-', CHANNEL);
const SHELL_PREFIX = cacheName('ws-shell-v3-', CHANNEL);
const SHELL = `${SHELL_PREFIX}${BUILD}`;
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
 * bank by serviceWorker.ts; '' when content is on the page) lives in one cross-build cache. NB11 removes the set folder
 * only from content-named or per-file-versioned keys; mutable files retain their release URL. No activate touches it. Only a CORS 200 is
 * kept: an opaque body cannot be checked and is padded against quota, and a range never stands for the whole file. */
/** @type {{ base: string, files: string[], versions?: Record<string, string> }} one parsed value: the bundler would fold a literal base into its origin */
const { base: CONTENT_BASE, files: CONTENT_FILES, versions: CONTENT_VERSIONS = {} } = JSON.parse('__CONTENT__');
/** OF5: the server book on the content base is solo-only too (a URL there, its path under the base's folder). */
const CONTENT_PRECACHE = CONTENT_FILES.filter(href => !WORLD || !SOLO_ONLY.test(new URL(href).pathname));
const CONTENT_CACHE = cacheName('ws-content-v1', CHANNEL);
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

/** NB11: a release's set folder changes when any content changes. Only a
 * content-named file or a build-declared content hash can leave that folder.
 * Mutable metadata keeps its exact release URL; channel stores remain separate. */
function contentKey(href) {
  if (CONTENT_URL === undefined) return href;
  const address = new URL(href);
  if (address.origin !== CONTENT_URL.origin || !address.pathname.startsWith(CONTENT_URL.pathname)) return href;
  const path = address.pathname.slice(CONTENT_URL.pathname.length - 1);
  const version = CONTENT_VERSIONS[path];
  if (!CONTENT.test(path) && !PAGE_PART.test(path) && !OWN_NAMED.test(path)
    && !/^[a-f0-9]{8,64}$/.test(address.searchParams.get('v') ?? '') && version === undefined) return href;
  const key = new URL(`/__ws_content__/v1${path}`, CONTENT_URL.origin);
  key.search = address.search;
  if (!key.searchParams.has('v') && version !== undefined) key.searchParams.set('v', version);
  return key.href;
}

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

let nuclearUpdate = false;
workerScope.listen(self, 'install', event => {
  if (self.registration?.active !== null && self.registration?.active !== undefined) event.waitUntil(self.skipWaiting());
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
    // J383: escape a legacy registration before any shell/generation download can strand the install.
    if (self.registration?.active !== null && self.registration?.active !== undefined && await forceCacheState() !== 'complete') {
      nuclearUpdate = true;
      // A full legacy cache must not prevent the very migration that frees it.
      await setForceCacheState('pending').catch(() => undefined);
      return;
    }
    // OF12: production marks the origin, so another channel's worker here keeps production's caches
    if (CHANNEL === 'production') await caches.open(PRODUCTION_MARK);
    const [assets, shell, books] = await Promise.all([store(ASSETS), store(SHELL), caches.open(BOOKS)]);
    await importPrevious(assets, books);
    const namedShell = SHELL_FILES.filter(path => immutable(new URL(abs(path))));
    await Promise.all([precache(shell, SHELL_FILES.filter(path => !namedShell.includes(path))),
      precache(assets, namedShell, true)]);
    // STALESHELL (QA 11-15 row 32, Jake: "the cache PWA one has to swap out new code"): an update (a worker already runs
    // this origin) takes over by itself, so the next boot is the new build and nobody waits on a reload that never
    // activates it. When the running build is whole on this device (its generation is held, so it boots offline), the new
    // one first downloads its own whole generation here, in the background while the player plays; a download cut short
    // (bad Wi-Fi) fails the install, the running build stays whole and nothing of the new one boots, and the browser's next
    // update check resumes from what the shared cache already holds. A running build that is not whole has nothing to keep:
    // it can't boot offline, and its document names code a newer deploy took off the server (Jake's phone sat on v0.1.19's
    // title through every reload), so the new worker takes over after its shell. A first visit stays shell-only (DL1).
    const running = self.registration?.active;
    if (running === null || running === undefined) return;
    const runningBuild = await buildOfWorker(running);
    if (runningBuild !== undefined && await (await caches.open(BOOKS)).match(bookKey(runningBuild)) !== undefined) await precacheGeneration();
    // The update requested skipWaiting synchronously, but installation still waits for a whole modern generation.
  })());
});

/** The build a worker serves (its `BUILD` reply, which every worker since the MF1 rewrite answers), or undefined after 3 s. */
function buildOfWorker(worker) {
  return new Promise(resolve => {
    workerScope.timeout(3000, () => { resolve(undefined); }); // the first answer wins
    const done = build => { resolve(build); };
    try {
      const channel = new MessageChannel();
      channel.port1.onmessage = event => { done(typeof event.data?.build === 'string' && event.data.build !== '' ? event.data.build : undefined); };
      worker.postMessage({ type: 'BUILD' }, [channel.port2]);
    } catch { done(undefined); }
  });
}

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
/** QA 11-23 row 8 (Jake, 11-23: an update boot is "frozen"): a navigation pauses an update installing or waiting behind this
 *  worker too. Its generation download sees none of the page's fetches, and until the page's own code tells it (boot/sw.ts
 *  PAUSE) its lanes held the link while the document itself (network-first once a newer build is live) waited on it. That
 *  page's control resumes it (PRECACHE), as it does the page's own PAUSE. */
function pauseUpdate(client) {
  for (const worker of [self.registration?.installing, self.registration?.waiting]) {
    if (worker === null || worker === undefined || worker === self.serviceWorker) continue;
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- ServiceWorker.postMessage has no targetOrigin parameter.
    try { worker.postMessage({ type: 'PAUSE', client }); } catch { /* a retired worker has nothing to pause */ }
  }
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
      const address = abs(path), key = content ? contentKey(address) : address, control = new AbortController();
      inflight.add(control);
      try {
        const held = await cache.match(key, MATCH);
        if (held !== undefined && !isHtml(held)) continue;
        if (held !== undefined) await cache.delete(key);
        if (content) {
          const response = await fetch(corsRequest(address, { cache: 'force-cache', signal: control.signal }));
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
    if (nuclearUpdate || await forceCacheState() === 'pending') {
      stores.clear();
      await wipeDownloadedCaches().catch(() => false);
      await self.clients.claim();
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Functional events may wait for activate; never await these navigations here.
      for (const client of clients) if (typeof client.navigate === 'function') void client.navigate(client.url).catch(() => undefined);
      return;
    }
    if (await forceCacheState() === null) await setForceCacheState('complete').catch(() => undefined);
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
    // OF12: only this channel's older shells (and production's legacy caches) go. Another channel's worker on this origin
    // also drops every cache under production's names (its own from before OF12, and the legacy ws-content-v0) on each
    // activate, unless production runs here too; nothing on this channel writes them again, so in effect it happens once.
    const productionHere = CHANNEL !== 'production' && await caches.has(PRODUCTION_MARK);
    for (const name of await caches.keys()) {
      if (name === SHELL || name === PRODUCTION_MARK || name === FORCE_CACHE_MARKER) continue;
      const legacy = CHANNEL === 'production' && (name.startsWith('ws-static-') || name === 'ws-immutable');
      if (name.startsWith(SHELL_FAMILY) || legacy) await caches.delete(name);
      else if (CHANNEL !== 'production' && !productionHere && ownsCache(name, 'production')) await caches.delete(name);
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
  const key = contentKey(request.url);
  let cache;
  try {
    cache = await store(CONTENT_CACHE);
    const held = reload ? undefined : await cache.match(key, MATCH) ?? (key === request.url ? undefined : await cache.match(request.url, MATCH));
    if (held !== undefined && !isHtml(held)) return held;
  } catch { stores.delete(CONTENT_CACHE); /* Storage denial keeps online fetch working. */ }
  let response;
  try {
    if (request.mode !== 'no-cors') response = await fetch(request);
    else {
      try { response = await fetch(corsRequest(request)); }
      catch { return await fetch(request); }
    }
  } catch (error) {
    const copy = key === request.url || request.signal.aborted ? undefined : await pageCopy(request.url, key);
    if (copy !== undefined) return copy;
    throw error;
  }
  if (cache !== undefined && keepContent(response)) await cache.put(key, response.clone()).catch(() => undefined);
  return response;
}

/** OFFLINE OF21: a content read the network can't answer (offline) is answered by this origin's copy of the same named file,
 *  when the asset cache holds one. The precache keeps the boot tables, and the spawn download keeps a level's members, under
 *  their page URLs (J138), so a reopen offline after a short online visit holds every byte its entry reads, though the content
 *  cache never saw them. Only a content-named or versioned file (its key differs from its URL), looked up by the key's own name
 *  and `?v=`: the same name is the same bytes. Only when the network fails (offline, or a CDN that can't answer): online reads are
 *  unchanged, and the hit is not promoted into the content cache.
 *  @param {string} href @param {string} key */
async function pageCopy(href, key) {
  if (CONTENT_URL === undefined) return undefined;
  const address = new URL(href), keyed = new URL(key);
  const path = address.pathname.slice(CONTENT_URL.pathname.length - 1);
  try {
    const assets = await store(ASSETS);
    // the key's own identity only (the content-named path, or its `?v=`): a bare page copy of a versioned name may be another build's
    const held = await assets.match(new URL(`${path}${keyed.search}`, self.location.origin).href, MATCH);
    if (held !== undefined && held.status === 200 && !isHtml(held)) return held;
  } catch { /* storage denial: the read fails as it would have */ }
  return undefined;
}

/** DW12: the game's routes (src/scripts/app-build/isolation.mjs DOCUMENT_ROUTE). Off them, a channel that is not isolated answers
 *  without COOP, so a warm return's stop between boots (/robots.txt) stays COOP-less and WebKit swaps processes back to the game. */
const DOCUMENT_ROUTE = /^\/(?:index\.html)?$|^\/slug\/[\w-]+\/?$/u;
const OPENER = 'cross-origin-opener-policy';
/** DW12: the leave page between two game documents (src/scripts/app-build/isolation.mjs LEAVE_PAGE, the same bytes): no
 *  opener policy, so the next game document starts in a new WebContent. Held here, so it answers offline too. */
const LEAVE_PATH = '/leave';
const LEAVE_PAGE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="color-scheme" content="dark"><meta name="robots" content="noindex"><style>html,body{margin:0;background:#050810}i{position:fixed;left:0;top:50%;width:30%;height:2px;background:#7fd8ff;animation:s 1s linear infinite}@keyframes s{from{transform:translateX(-100%)}to{transform:translateX(340%)}}</style><script>(()=>{let to="/",gone=0;try{const u=new URL(new URLSearchParams(location.search).get("to")||"/",location.origin);if(u.origin===location.origin&&u.pathname!=="/leave")to=u.pathname+u.search+u.hash}catch{}const go=()=>{if(!gone){gone=1;location.replace(to)}};requestAnimationFrame(()=>requestAnimationFrame(go));setTimeout(go,150)})()</script></head><body><i></i></body></html>';
/** The document baked into this worker: its build's own page, whatever URL asked (the page reads its route from the URL).
 *  @param {string} pathname */
const bakedDocument = pathname => {
  const headers = { ...DOCUMENT_HEADERS, 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' };
  if (!ISOLATED && !DOCUMENT_ROUTE.test(pathname)) delete headers[OPENER];
  return new Response(DOCUMENT, { headers });
};
/** STALESHELL: how long a navigation waits on the network before a worker whose code is not all held answers with its own
 *  document anyway (offline, or a link that never answers). */
const NAVIGATION_WAIT_MS = 6000;
let generationHeld = false;
/** QA-FEEDBACK 11-19 row 50 (Jake's home-screen app sat on v0.1.50 for 15 min after 0.1.52 went live, "can't refresh"): the
 *  build the server has live, as the page last read it from /version.json (`LIVE`), or null before any read. A newer one
 *  means this worker's document is no longer the live shell. */
let liveBuild = null;
const newerLive = () => liveBuild !== null && liveBuild !== BUILD && !BUILD.startsWith(`${liveBuild}-`);
/** Whether this build's whole generation is held (its book is written only once every file is). Only a yes is remembered. */
async function holdsGeneration() {
  if (generationHeld) return true;
  try { generationHeld = await (await store(BOOKS)).match(bookKey(BUILD)) !== undefined; } catch { return false; }
  return generationHeld;
}
/** STALESHELL (QA 11-15 row 32: Jake's phone sat on v0.1.19's title for good, "8 of 8 files", then "still waiting"): this
 *  worker answers a navigation with its own document only when it holds that document's whole generation, so the page boots
 *  complete from the cache, offline too. A worker that holds less (it never reached control on this build) can't promise the
 *  code its document names, and a newer deploy has removed it from the server: the network's page answers, and the baked
 *  document only when the network can't (offline, or no answer in NAVIGATION_WAIT_MS). The request's own URL is kept either
 *  way: a `/slug/<x>` stays itself.
 *  @param {Request} request */
async function navigation(request) {
  // row 50: once a newer build is live the network's page answers, so a reload (or the next launch while this worker lives)
  // boots the new shell instead of this worker's old one; offline, or no answer in NAVIGATION_WAIT_MS, still boots this one
  const pathname = new URL(request.url).pathname;
  if (await holdsGeneration() && !newerLive()) return bakedDocument(pathname);
  const waited = new Promise(resolve => { workerScope.timeout(NAVIGATION_WAIT_MS, () => { resolve(undefined); }); });
  const online = fetch(request).then(response => response.type === 'opaqueredirect' || response.ok && isHtml(response) ? response : undefined,
    () => undefined);
  return await Promise.race([online, waited]) ?? bakedDocument(pathname);
}

/* Fix preview PV4 (J276): a page that bakes a zone table (`#ws-zone-table`, read from the document like the world stamp) reads
 * every zone from the cooked bucket (`cooked.wildshard.io`, or the origin the table names). Those reads go to the network first and
 * a CORS 200 is kept in one cross-build cache, so an offline reload answers the index, manifests, parts and loose files the online
 * visit read. A key under one shard version and cook names the same bytes, but the network still wins while there is one. */
const COOKED_URL = (() => {
  const text = /<script type="application\/json" id="ws-zone-table">([^<]*)<\/script>/u.exec(DOCUMENT)?.[1];
  if (text === undefined) return undefined;
  try { const table = JSON.parse(text); return new URL(typeof table?.origin === 'string' ? table.origin : 'https://cooked.wildshard.io/'); } catch { return undefined; }
})();
const COOKED_CACHE = cacheName('ws-cooked-v1', CHANNEL);
/** @param {URL} url */
const isCookedRead = url => COOKED_URL !== undefined && url.origin === COOKED_URL.origin && url.pathname.startsWith('/shards/');
/** @param {Request} request */
async function cookedRead(request) {
  let response;
  try { response = await fetch(request.mode === 'no-cors' ? corsRequest(request) : request); }
  catch (error) {
    const held = await store(COOKED_CACHE).then(cache => cache.match(request.url, MATCH)).catch(() => undefined);
    if (held !== undefined) return held;
    throw error;
  }
  if (response.type === 'cors' && response.status === 200 && !isHtml(response)) {
    await store(COOKED_CACHE).then(cache => cache.put(request.url, response.clone())).catch(() => { stores.delete(COOKED_CACHE); });
  }
  return response;
}
workerScope.listen(self, 'fetch', event => {
  const request = event.request, url = new URL(request.url);
  // A diagnostic document must reach its own host route, not the cached game
  // shell. It owns no game loader and must not pause the game's precache.
  const doctor = request.mode === 'navigate' && isDoctorDocument(url);
  // A warm MMO tab still takes the host's Explore redirect.
  const explore = WORLD && request.mode === 'navigate' && /^\/slug\/[\w-]+\/?$/u.test(url.pathname) && url.searchParams.has('explore');
  if (doctor || explore) return;
  // DW12: the leave page loads nothing and lives a moment, so it never pauses the precache
  if (request.mode === 'navigate' && url.origin === self.location.origin && url.pathname === LEAVE_PATH) {
    event.respondWith(new Response(LEAVE_PAGE, { headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' } }));
    return;
  }
  // A loading page (a navigation, or a client that has not reported control) gets the link: the precache waits.
  if (request.mode === 'navigate') { pausePrecache(event.resultingClientId); pauseUpdate(event.resultingClientId); }
  else if (!controlled.has(event.clientId)) event.waitUntil(pauseForClient(event.clientId));
  else if (paused) event.waitUntil(resumeIfLoadersGone());
  if (request.method !== 'GET' || url.searchParams.get('sw') === '0') return;
  if (isCookedRead(url)) { event.respondWith(cookedRead(request)); return; }
  if (isContentRead(url)) { event.respondWith(contentRead(request)); return; }
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/version.json' || url.pathname === '/sw.js' || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    const received=diagnosticNow();
    event.respondWith(navigation(request).then(response => {
      bootPublish(event,[{operation:'sw:navigation-handler-and-delivery',url:request.url,start:received,end:diagnosticNow(),result:'complete'}]);
      return response;
    }));
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
  // row 50: the page read /version.json; its build is what the network's page now is (src/client/engine/boot/sw.ts)
  if (type === 'LIVE') { const build = event.data?.build; if (typeof build === 'string' && build !== '') liveBuild = build; return; }
  if (type === 'PAUSE') { const client = event.data?.client; pausePrecache(typeof client === 'string' && client !== '' ? client : event.source?.id); return; }
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
