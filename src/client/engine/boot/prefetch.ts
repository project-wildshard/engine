/**
 * Every file the boot will read, requested up front (project/archive/2026-09-22-load-perf.md: "fetch everything up front in
 * parallel, then build as each arrives"). The steps still ask for their files in their own order — through
 * fetchImage, three's FileLoader / ImageBitmapLoader, the baked-terrain reader — and the first GET of a
 * prefetched path is handed the prefetched response (in flight, downloaded, or started on the spot when it
 * was still queued) instead of a new request. A step's CPU work so overlaps the downloads of the steps after
 * it, where each step used to start its fetches only once the previous one had finished building.
 *
 * The queue runs in manifest order (sky → baked → terrain → trees → cabins → props, the order the steps need
 * them) with `CONCURRENCY` downloads at a time: enough to keep the pipe full at 4G latency, few enough that
 * the first step's files are not starved by the last step's — all ~90 at once finished everything together
 * at the end of the download and left every step's build for after it.
 *
 * Installed after the byte counter (src/client/engine/boot/bytes.ts): the prefetch goes through the counted fetch, so the
 * DOWNLOAD track moves as the bytes really arrive. Installed after the service worker controls the page, so
 * every response still lands in its cache (the second launch stays all-cache).
 */
import type { BootSpec } from '../../../shared/engine/level/spec';
import type { ChunkFiles } from './bytes';
import type { Scope } from '../../../shared/engine/app/scope';
import { pageScope } from '../../../shared/engine/app/resources';

let documentEnded = false, observesDocumentEnd = false;
function ended(): boolean { return documentEnded || pageScope.disposed || pageScope.disposing; }
function endError(): DOMException { return new DOMException('Boot prefetch document ended', 'AbortError'); }
/** A cancelled native read can settle while WebKit is tearing down its
 * origin. Never let that settlement start the next queued request. */
function observeDocumentEnd(): void {
  if (observesDocumentEnd) return;
  observesDocumentEnd = true;
  // WebKit rejects in-flight fetches before pagehide, while the old origin
  // still runs promise callbacks. beforeunload precedes that cancellation.
  pageScope.listen(window, 'beforeunload', () => { documentEnded = true; });
  pageScope.listen(window, 'pagehide', event => {
    if (!(event instanceof PageTransitionEvent) || !event.persisted) documentEnded = true;
  });
  // A retained document can return from the back/forward cache. Its old
  // optional queue has ended; future demands use ordinary verified fetches.
  pageScope.listen(window, 'pageshow', () => { documentEnded = false; });
}

/** I2: the host's first controllable frame precedes speculative I/O. Recheck after the paint/task boundary;
 * a pause rearms the same observer, and retirement cancels the queued scope work. */
export function afterControl(scope: Scope, onFrame: (run: () => void) => void, ready: () => boolean, run: () => void): void {
  let started = false;
  onFrame(() => {
    if (started || scope.disposed || scope.disposing || !ready()) return;
    started = true;
    scope.raf(() => { scope.timeout(0, () => {
      if (scope.disposed || scope.disposing) return;
      if (!ready()) { started = false; return; }
      run();
    }); });
  });
}

const controlled = new WeakSet<Scope>(), awaitingControl = new WeakMap<Scope, Set<() => void>>();
/** I2: a level's host reached its first controllable frame (session/finish.ts, beside its `ws:control-ready` event);
 *  everything `whenControl` queued for that level runs now. */
export function reachControl(level: Scope): void {
  if (controlled.has(level)) return;
  controlled.add(level);
  const queued = awaitingControl.get(level); awaitingControl.delete(level);
  for (const run of queued ?? []) run();
}
/** I2: run once `level` has reached control, at once when it already has (a cell assembled in play); `owner`'s
 *  retirement cancels it. */
export function whenControl(level: Scope, owner: Scope, run: () => void): void {
  if (level.disposed || level.disposing || owner.disposed || owner.disposing) return;
  if (controlled.has(level)) { run(); return; }
  let queued = awaitingControl.get(level);
  if (queued === undefined) { queued = new Set(); awaitingControl.set(level, queued); }
  const once = (): void => { if (!owner.disposed && !owner.disposing) run(); };
  queued.add(once);
  owner.onDispose(() => { awaitingControl.get(level)?.delete(once); });
}

const CONCURRENCY = 6;
/**
 * The art + audio queue (prefetchAfter): ~150 files, most of them 3–30 KB one-shots, after the pack has the pipe to itself.
 * At 6 in flight a 4G round trip (~170 ms) per small file left the pipe idle between them; the world's files are in by
 * then, so nothing downstream is starved by more at once.
 */
const EXTRA_CONCURRENCY = 16;

/**
 * The declared files this level's boot really reads, in step order: its own `boot.sources` (each level that declares
 * them lists only what it reads), else the boot manifest's (src/client/engine/boot/manifest.ts) — prefetching the whole
 * engine-fixed manifest once downloaded a small level's boot plus 14 MB of another's.
 */
export function bootFetches(def: { boot?: Pick<BootSpec, 'sources'> | undefined }, files: ChunkFiles): string[] {
  if (def.boot?.sources !== undefined) return [...files.sky, ...files.baked, ...files.terrain, ...files.trees, ...files.cabins, ...files.props];
  return [...files.sky, ...files.baked, ...files.terrain, ...files.trees, ...files.cabins, ...files.props]; // not files.physics: Rapier fetches its own WASM at boot start (streamed compile), outside the uncompressed pack
}
const pathOf = (url: string): string => { try { return new URL(url, location.href).pathname; } catch { return url; } };

/** path → settles when the queue has downloaded it (src/client/engine/boot/extras.ts waits on these instead of jumping the queue) */
const landed = new Map<string, { done: Promise<void>; settle: () => void }>();
const landing = (p: string): { done: Promise<void>; settle: () => void } => {
  let e = landed.get(p);
  if (!e) { let settle: () => void = () => undefined; const done = new Promise<void>((resolve) => { settle = resolve; }); e = { done, settle }; landed.set(p, e); }
  return e;
};
/**
 * Resolves once the queue has downloaded `url` (or failed to): the next GET of it is then answered from memory. A path
 * that was never queued resolves at once. Waiting here keeps the queue's order and concurrency — a plain early fetch()
 * would start the file on the spot, ahead of the files the world's steps need first.
 */
export function whenPrefetched(url: string): Promise<void> {
  if (ended()) return Promise.reject(endError());
  return (landed.get(pathOf(url))?.done ?? Promise.resolve()).then(() => { if (ended()) throw endError(); return undefined; });
}

/**
 * Queue `paths` once `after` has settled (the boot pack streamed): the art and the audio wait for the shard's own files
 * instead of splitting the pipe with them. `whenPrefetched` already knows them, so nobody jumps the queue meanwhile.
 */
export function prefetchAfter(paths: readonly string[], after: Promise<unknown>): void {
  observeDocumentEnd();
  if (ended()) return;
  for (const p of paths) landing(p);
  void (async () => {
    try { await after; } catch { /* a failed pack frees the pipe all the same */ }
    if (ended()) { for (const p of paths) landing(p).settle(); return; }
    prefetch(paths, EXTRA_CONCURRENCY);
  })();
}

/** Queue `paths` now; the first plain GET of each is served the prefetched response. Returns how many were queued. */
export function prefetch(paths: readonly string[], concurrency: number = CONCURRENCY): number {
  observeDocumentEnd();
  if (ended()) return 0;
  const fetchNow = window.fetch.bind(window);
  const queue = [...new Set(paths)];
  const queued = new Set(queue);
  for (const p of queue) landing(p);
  const started = new Map<string, Promise<Response>>();
  let active = 0, closed = false;
  const start = (p: string): Promise<Response> => {
    queued.delete(p);
    active++;
    // read to the end here: the download finishing (not its headers) is what frees the slot for the next file
    const res = fetchNow(p)
      .then(async (r) => (r.ok ? new Response(await r.blob(), { status: r.status, statusText: r.statusText, headers: r.headers }) : r))
      .finally(() => { active--; landing(p).settle(); if (!closed && !ended()) pump(); });
    res.catch(() => undefined); // a failed prefetch is re-asked for (and its error surfaced) by the step that needs it
    started.set(p, res);
    return res;
  };
  function pump(): void {
    if (closed || ended()) return;
    for (let free = concurrency - active; free > 0;) {
      const p = queue.shift();
      if (p === undefined) return;
      if (queued.has(p)) { void start(p); free--; }
    }
  }
  const redirect: typeof fetch = (input, init) => {
    const req = input instanceof Request ? input : null;
    const method = (init?.method ?? req?.method ?? 'GET').toUpperCase();
    const p = pathOf(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (method !== 'GET') return fetchNow(input, init);
    if (ended()) return Promise.reject(endError());
    const hit = started.get(p) ?? (queued.has(p) ? start(p) : undefined); // asked for before its turn: now
    if (hit === undefined) return fetchNow(input, init);
    started.delete(p); // a body is read once: a second ask for the same file makes its own request
    return hit.then(r => { if (closed || ended()) throw endError(); return r.ok ? r : fetchNow(input, init); }, () => {
      if (closed || ended()) throw endError();
      return fetchNow(input, init);
    });
  };
  const onHide = (): void => { if (ended()) stop(); };
  function stop(): void {
    if (closed) return;
    closed = true; queue.length = 0; queued.clear(); started.clear();
    for (const path of paths) landing(path).settle();
    // Keep the empty redirect as the ending document's fetch fence: a late
    // cache hint or failed borrowed read must not resurrect a native request.
    // pageshow reopens ordinary demand if this document returns from BFCache.
    pageScope.unlisten(window, 'beforeunload', onHide);
    pageScope.unlisten(window, 'pagehide', onHide);
  }
  pageScope.listen(window, 'beforeunload', onHide);
  pageScope.listen(window, 'pagehide', onHide); pageScope.onDispose(stop);
  pump();
  if (!closed) window.fetch = redirect;
  return queued.size + started.size;
}
