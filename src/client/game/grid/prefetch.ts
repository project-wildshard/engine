/**
 * G554 (Jake, 2026-10-21): *"the download bar doesn't pre download and pre fetch everything we know that infinite wildshard
 * needs"*. Infinite Wildshard knows its whole set before play: every cell's product (its index, sections, schemas and every
 * blob, commons included, which carry the far tiers, impostors, near rows, ring tiles, edges and minimap). This reads all of
 * it into the content cache on disk, during the grid's loading (nearest cells first) and from the main menu in the
 * background, so nothing the grid can know in advance is fetched later during play.
 *
 * Disk, never memory: nothing is admitted, decoded or claimed in the residency allocator (G534 limits unchanged). It reads
 * only the format-2 index of each product and stores each file under its verified hash with a `keep` write, which never
 * evicts anything (the current shard's bytes stay); the PrefetchQuota guard (navigator.storage) stops the run when the
 * origin's free quota runs out, and a full content cache stops it too, keeping what fit. A file already stored costs one
 * index lookup, so a later launch resumes where this one stopped. Off on Save-Data and offline; a product whose index is
 * from a newer deployment stops the run (the page's own load handles that reload, never this). One run per page: a second
 * start (the grid after the menu) only moves its cells to the front of the queue. Its fetches are not boot waits.
 * `window.__ws_gridPrefetch()` (captures, the bench) returns the counts. The phone tier (iPhone downloads I9, G737) reads
 * only the home cell and its ring, and of those only the files its tier admits; the rest waits for Settings' download
 * everything (G727).
 */
import { PrefetchQuota, PrefetchBytes } from '@wildshard/engine/boot/prefetchQuota';
import { saves } from '@wildshard/engine/saves/runtime';
import type { OutputDownloadIndex } from '@wildshard/format/outputDownload';
import { findTitleManifest, titleManifests } from '../shard/titleList';
import type { Scope } from '@wildshard/engine/app/scope';
import type { OfflineDownloadEnd } from '@wildshard/engine/ui/offlineDownload';
import { hasCachedAsset, cacheAsset } from '../shardfile/assetCache';
import { builtIndexHash, builtIndexHashes } from '@wildshard/format/builtIndexes';
import { readPrefetchIndex } from './prefetchIndex';
import type { GridAssembly } from '../../../shared/game/grid/assembly';
import {TIER, MOBILE_DEVICE, type Tier} from '@wildshard/engine/core/tier';
import { prefetchRing } from './titleOrder';
import {prefetchSpawnDownload, adoptCompletedSpawnDownload, paintSpawnDownload, setSpawnPacks} from '../boot/spawnDownload';
import { runtimePacksOn } from '@wildshard/engine/boot/loadingPacks';
import {installEntryDownloadTap} from '../shardfile/entryTransport';
import {setting, savedSetting, settingFromUrl} from '@wildshard/engine/ui/Settings';
import {gridMode, DEVSERVER} from './menu';
import {holdLeaving} from '@wildshard/engine/boot/lastEnd';

/** Files in flight at once: the page's own reads keep most of the pipe. */
const CONCURRENCY = 2;
/** Payloads, not process memory: worker/store snapshots also consume memory. */
const IN_FLIGHT_BYTES = 32 * 1024 * 1024;
/** Origin quota left free for saves, the app shell and the browser's own caches. */
const HEADROOM = 64 * 1024 * 1024;

/** Read-only progress of the page's one run (the loading screen's download line reads it through an injected port). */
export interface GridPrefetchStatus {
  /** `quota`: the origin's free quota or the content cache ran out (what fit is kept); `stopped`: offline, Save-Data, no
   * storage, a newer deployment; `error`: the run itself failed (one product's failure only skips that product) */
  readonly phase: 'running' | 'done' | 'quota' | 'stopped' | 'error';
  readonly reason: string | null;
  readonly products: number; readonly productsRead: number;
  /** distinct files (by hash) and their wire bytes known from the product indexes read so far */
  readonly knownFiles: number; readonly knownBytes: number;
  /** of those, already on disk before this run looked, and stored by this run */
  readonly presentFiles: number; readonly presentBytes: number; readonly storedFiles: number; readonly storedBytes: number;
  readonly inFlightBytes: number; readonly peakInFlightBytes: number; readonly limitInFlightBytes: number;
}
interface Row { readonly path: string; readonly hash: string; readonly bytes: number }
interface PrefetchCache {
  holds: (hash: string, bytes: number) => Promise<boolean>;
  keepAsset: (hash: string, bytes: Uint8Array) => Promise<boolean>;
}

/** The verified disk cache owns persistence. A title read borrows its
 * abort signal so the tap can release bandwidth before travel/adoption. */
export async function readGridPrefetch(url: string, maximum: number, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > IN_FLIGHT_BYTES) throw new Error('Invalid prefetch body size');
  const response = await fetcher(url, { cache: 'no-store', ...(signal === undefined ? {} : {signal}) });
  if (!response.ok) throw new Error(`Prefetch read failed: ${url}`);
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maximum) throw new Error('Prefetched file exceeds its declared size');
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
function saveData(): boolean {
  const connection: unknown = Reflect.get(navigator, 'connection');
  return typeof connection === 'object' && connection !== null && Reflect.get(connection, 'saveData') === true;
}

/** The grid's distinct slugs, nearest cell to `at` first (the home cell, then its neighbours, then the rest); the phone
 * tier keeps only the home cell and its ring (I9). */
export function gridPrefetchOrder(assembly: Pick<GridAssembly, 'cells'>, at: Readonly<{ x: number; z: number }>, tier: Tier = 'desktop'): string[] {
  const near = [...assembly.cells].sort((a, b) => Math.hypot(a.origin.x - at.x, a.origin.z - at.z) - Math.hypot(b.origin.x - at.x, b.origin.z - at.z));
  const home = near[0];
  return [...new Set((home === undefined ? near : prefetchRing(near, home.cell, tier)).map(cell => cell.slug))];
}

class GridPrefetch {
  private readonly memory = new PrefetchBytes(IN_FLIGHT_BYTES);
  private readonly transfer = new AbortController();
  private readonly queue: string[] = [];
  private readonly known = new Set<string>();
  private readonly hashes = new Set<string>();
  /** I9: the phone tier's home cell and ring (every caller's ring so far); the run reads only these on the phone */
  private readonly ring = new Set<string>();
  private tier: Tier = 'desktop';
  /** G727 / I9: Settings' "Download everything" asked for it: every product, past Save-Data and the phone ring */
  explicit = false;
  /** PL13: the title's home/last products are requested on any network.
   * This does not widen the phone ring or the device's admitted file tier. */
  title = false;
  private status: Omit<{ -readonly [K in keyof GridPrefetchStatus]: GridPrefetchStatus[K] }, 'inFlightBytes' | 'peakInFlightBytes' | 'limitInFlightBytes'> = { phase: 'running', reason: null,
    products: 0, productsRead: 0, knownFiles: 0, knownBytes: 0, presentFiles: 0, presentBytes: 0, storedFiles: 0, storedBytes: 0 };
  /** Queue these slugs ahead of the rest (already read ones are skipped); start the run if it is not running. */
  prioritize(slugs: readonly string[], ring: readonly string[]): void {
    for (const id of ring) this.ring.add(id);
    const fresh = slugs.filter(id => !this.known.has(id) || this.queue.includes(id));
    for (const id of fresh) { const at = this.queue.indexOf(id); if (at !== -1) this.queue.splice(at, 1); this.known.add(id); }
    this.queue.unshift(...fresh); this.status.products = this.known.size;
  }
  snapshot(): GridPrefetchStatus { return { ...this.status, inFlightBytes: this.memory.usedBytes,
    peakInFlightBytes: this.memory.peakBytes, limitInFlightBytes: this.memory.limit }; }
  stop(reason: string, phase: 'quota' | 'stopped' | 'error' = 'stopped'): void {
    if (this.status.reason === null) { this.status.reason = reason; this.status.phase = phase; if (this.title) this.transfer.abort(); }
  }
  async run(): Promise<void> {
    try {
      if (!this.explicit && !this.title && saveData()) { this.stop('save-data'); return; }
      // the tier loads here, off the title's static graph (the render tiers stay cold until a world needs them)
      this.tier = (await import('@wildshard/engine/core/tier')).TIER;
      // I10 / D133: the page's one persistence request (the save store's, once a page, its answer kept for the Debug storage
      // line); a direct navigator.storage.persist() here was the entry's second request
      const quota = await PrefetchQuota.open({ persist: () => saves.persist(), estimate: () => navigator.storage.estimate() }, HEADROOM);
      if (quota === null) { this.stop('no storage estimate'); return; }
      for (let next = this.queue.shift(); next !== undefined && this.status.reason === null; next = this.queue.shift()) {
        if (!navigator.onLine) { this.stop('offline'); return; }
        if (this.tier === 'phone' && !this.explicit && !this.ring.has(next)) continue;
        try { await this.product(next, quota); }
        catch (error: unknown) {
          if (this.status.reason === null) {
            if (this.title) this.stop(error instanceof Error ? error.message : String(error), 'error');
            console.warn(`[grid prefetch] ${next} skipped`, error);
          }
        } // an ordinary grid run still skips only the failed product
        this.status.productsRead++;
      }
      if (this.status.reason === null) this.status.phase = 'done';
    } finally {
      // Only product() reads the hash history. This page's one run is over;
      // later prioritization/status reads retain scalar counts, not file hashes.
      this.hashes.clear();
    }
  }
  private async product(id: string, quota: PrefetchQuota): Promise<void> {
    const manifest = findTitleManifest(id), descriptor = manifest?.shardfile ?? manifest?.gridShardfile;
    if (descriptor === undefined) return;
    const url = new URL(descriptor, location.href), base = new URL('.', url).href;
    const indexHash = import.meta.env.DEV ? null : builtIndexHash(url.pathname);
    if (indexHash !== null) url.searchParams.set('v', indexHash.slice(0, 8));
    if (typeof caches === 'undefined') { this.stop('no content cache'); return; }
    const indexes = import.meta.env.DEV ? null : builtIndexHashes();
    const index = await readPrefetchIndex({url:url.href,indexHashes:indexes===null?null:[...indexes],phone:this.tier==='phone'});
    if(index===null){this.stop('a newer deployment');return;}
    const listed: Row[] = [...index.sections, ...index.schemas, ...index.files.map(file => ({ path: file.path, hash: file.hash, bytes: file.compressed }))];
    const urls = new Map(listed.map(row => [row.hash, new URL(row.path, base).href]));
    const address = (hash: string): string => { const path = urls.get(hash); if (path === undefined) throw new Error('Undeclared prefetch file'); return path; };
    const holds: PrefetchCache['holds'] = hash => hasCachedAsset(caches, address(hash));
    const keepAsset: PrefetchCache['keepAsset'] = (hash, body) => cacheAsset(caches, address(hash), body);
    // a commons blob or a shared section is listed by several products: count and store it once
    const rows = listed.filter(row => { if (this.hashes.has(row.hash)) return false; this.hashes.add(row.hash); return true; });
    this.status.knownFiles += rows.length; this.status.knownBytes += rows.reduce((sum, row) => sum + row.bytes, 0);
    // I5: members of a pack come from one read of the pack; only the rest are read one by one
    const packOf = new Map<string, NonNullable<typeof index.packs>[number]>();
    for (const pack of index.packs ?? []) for (const entry of pack.entries) if (!packOf.has(entry.hash)) packOf.set(entry.hash, pack);
    const byPack = new Map<string, Row[]>(), loose: Row[] = [];
    for (const row of rows) {
      const pack = packOf.get(row.hash);
      if (pack === undefined) { loose.push(row); continue; }
      const list = byPack.get(pack.hash) ?? []; list.push(row); byPack.set(pack.hash, list);
    }
    for (const pack of index.packs ?? []) {
      const members = byPack.get(pack.hash);
      if (members !== undefined && this.status.reason === null) await this.pack(pack, members, base, { holds, keepAsset }, quota);
    }
    rows.splice(0, rows.length, ...loose);
    let next = 0;
    const lane = async (): Promise<void> => {
      for (let row = rows[next++]; row !== undefined && this.status.reason === null; row = rows[next++]) await this.file(row, base, { holds, keepAsset }, quota);
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, lane));
  }
  /** I5: a pack's members not yet on disk, from one verified read of the pack, each kept under its own hash. */
  private async pack(pack: NonNullable<OutputDownloadIndex['packs']>[number], members: readonly Row[], base: string,
    cache: PrefetchCache, quota: PrefetchQuota): Promise<void> {
    const missing: Row[] = [];
    for (const row of members) {
      if (await cache.holds(row.hash, row.bytes)) { this.status.presentFiles++; this.status.presentBytes += row.bytes; }
      else missing.push(row);
    }
    if (missing.length === 0) return;
    const reservation = await quota.reserve(missing.reduce((total, row) => total + row.bytes, 0));
    if (reservation === null) { this.stop('storage quota', 'quota'); return; }
    let stored = 0, release: (() => void) | undefined;
    try {
      release = await this.memory.reserve(pack.bytes);
      if (this.status.reason !== null) return;
      const bytes = await readGridPrefetch(new URL(pack.path, base).href, pack.bytes, fetch, this.title ? this.transfer.signal : undefined);
      if (bytes.length !== pack.bytes) throw new Error('Prefetched pack differs from its index');
      if (this.status.reason !== null) return;
      const at = new Map(pack.entries.map(entry => [entry.hash, entry] as const));
      for (const row of missing) {
        if (this.status.reason !== null) return;
        const entry = at.get(row.hash);
        if (entry === undefined || entry.bytes !== row.bytes) throw new Error('Prefetched pack member differs from its index');
        if (!await cache.keepAsset(row.hash, bytes.slice(entry.offset, entry.offset + entry.bytes))) { this.stop('content cache full', 'quota'); return; }
        stored += row.bytes; this.status.storedFiles++; this.status.storedBytes += row.bytes;
      }
    } finally { release?.(); reservation.finish(stored); }
  }
  /** Build-owned files use their canonical URL and exact length, never a digest. */
  private async file(row: Row, base: string, cache: PrefetchCache, quota: PrefetchQuota): Promise<void> {
    if (await cache.holds(row.hash, row.bytes)) { this.status.presentFiles++; this.status.presentBytes += row.bytes; return; }
    const reservation = await quota.reserve(row.bytes);
    if (reservation === null) { this.stop('storage quota', 'quota'); return; }
    let stored = 0, release: (() => void) | undefined, bytes: Uint8Array | undefined;
    try {
      release = await this.memory.reserve(row.bytes);
      if (this.status.reason !== null) return;
      const url = new URL(row.path, base).href;
      bytes = await readGridPrefetch(url, row.bytes, fetch, this.title ? this.transfer.signal : undefined);
      if (bytes.length !== row.bytes) throw new Error('Prefetched file differs from its index');
      if (this.status.reason !== null) return;
      if (await cache.keepAsset(row.hash, bytes)) stored = bytes.length; else this.stop('content cache full', 'quota');
    } finally {
      bytes = undefined; release?.(); reservation.finish(stored);
      // Worker-only replies return above; credit their durable write too.
      if (stored > 0) { this.status.storedFiles++; this.status.storedBytes += stored; }
    }
  }
}

declare global { interface Window { __ws_gridPrefetch?: () => GridPrefetchStatus | null } }
/** Each document owns one run; retaining this module never retains a retired window. */
const pageRuns = new WeakMap<Window, GridPrefetch>();
/** Start (or re-prioritize) the page's one whole-set prefetch; it runs on its own and never throws into the caller. */
export function startGridPrefetch(slugs: readonly string[], ring: readonly string[] = slugs, explicit = false): void {
  if (typeof caches === 'undefined' || !('storage' in navigator)) return;
  const running = pageRuns.get(window);
  if (running !== undefined) { if (explicit) running.explicit = true; running.prioritize(slugs, ring); return; }
  const run = new GridPrefetch(); pageRuns.set(window, run); run.explicit = explicit; run.prioritize(slugs, ring);
  launchPrefetch(run);
}
function launchPrefetch(run: GridPrefetch): void {
  window.__ws_gridPrefetch = gridPrefetchStatus; // captures and the bench read the counts
  void (async (): Promise<void> => {
    try { await run.run(); }
    catch (error: unknown) { run.stop(error instanceof Error ? error.message : String(error), 'error'); console.warn('[grid prefetch] stopped', error); }
  })();
}
/** G897: only the last selected shard's spawn files, not whole products or
 * neighbouring worlds. Foreground adoption retains the same cache operation. */
export function startTitlePrefetch(target: string, flow: 'client' | 'grid' = 'client', gridKey = '000'): {snapshot: () => GridPrefetchStatus; stop: () => void} | null {
  if (typeof caches === 'undefined') return null;
  const futureTier = (): 'auto' | Tier => settingFromUrl('tier') ? setting('tier') : savedSetting('tier');
  const preferred = futureTier(), tier = preferred === 'auto' ? TIER : preferred;
  setSpawnPacks(runtimePacksOn()); // DL16: the title's read-ahead follows Debug ▸ Loading & memory ▸ Level download
  const held = prefetchSpawnDownload(target, tier, flow, gridKey); if (held === null) return null;
  // The title has no session saver. Reuse the existing navigation handoff so
  // its non-abortable Cache API reads finish before location.replace.
  holdLeaving(held.drain);
  const stopTap = installEntryDownloadTap((slug, selectedFlow) => {
    const picked = futureTier(), selectedTier = picked === 'auto' ? TIER : picked;
    // Auto desktop still needs its actual GPU pick. Never paint a guessed tier.
    if (picked === 'auto' && !MOBILE_DEVICE) return false;
    const card = document.querySelector<HTMLElement>('.ws-load'); if (card === null) return false;
    const mode = gridMode(DEVSERVER), selected = adoptCompletedSpawnDownload(slug, selectedFlow, selectedTier,
      `${Number(mode.developer)}${Number(mode.devserver)}${Number(mode.nineDragon)}`);
    if (selected === null) return false;
    paintSpawnDownload(selected, card)(); return true;
  });
  return {stop: () => {stopTap(); held.stop();}, snapshot: () => {
    const row = held.download.snapshot();
    return {phase: row.error !== null ? 'error' : row.complete ? 'done' : 'running', reason: row.error,
      products: 1, productsRead: row.complete ? 1 : 0, knownFiles: row.filesTotal, knownBytes: row.totalBytes,
      presentFiles: row.complete && row.cachedBytes === row.totalBytes ? row.filesDone : 0, presentBytes: row.cachedBytes,
      storedFiles: row.filesDone, storedBytes: row.completedBytes - row.cachedBytes,
      inFlightBytes: row.totalBytes - row.completedBytes, peakInFlightBytes: 0, limitInFlightBytes: 0};
  }};
}
/** The run's counts (null before any start): for the loading screen's download line and captures. */
export function gridPrefetchStatus(): GridPrefetchStatus | null { return pageRuns.get(window)?.snapshot() ?? null; }

/** Every product the title list knows (G727's "everything"). */
function everyProduct(): string[] {
  return titleManifests().filter(row => (row.shardfile ?? row.gridShardfile) !== undefined).map(row => row.slug);
}
/** G727 / I9: the wire bytes "Download everything" still has to fetch: each product's files of this device's tier (I1's
 *  filter, as the prefetch reads them), counted once across products, less what the content cache already holds. The
 *  code bundle is not counted (a few MB beside the products; the worker warms it alongside). Null without a cache. */
export async function remainingDownloadBytes(owner?: Scope): Promise<number | null> {
  const live = (): void => { if (owner?.disposed === true || owner?.disposing === true) throw new DOMException('Offline estimate left view', 'AbortError'); };
  live();
  if (typeof caches === 'undefined') return null;
  const tier = (await import('@wildshard/engine/core/tier')).TIER;
  const indexes = import.meta.env.DEV ? null : builtIndexHashes(), seen = new Set<string>();
  let bytes = 0;
  for (const slug of everyProduct()) {
    live();
    const manifest = findTitleManifest(slug), descriptor = manifest?.shardfile ?? manifest?.gridShardfile;
    if (descriptor === undefined) continue;
    const url = new URL(descriptor, location.href), indexHash = import.meta.env.DEV ? null : builtIndexHash(url.pathname);
    if (indexHash !== null) url.searchParams.set('v', indexHash.slice(0, 8));
    const index = await readPrefetchIndex({ url: url.href, indexHashes: indexes === null ? null : [...indexes], phone: tier === 'phone' }, owner);
    live();
    if (index === null) return null;
    for (const row of [...index.sections, ...index.schemas, ...index.files.map(file => ({ path: file.path, hash: file.hash, bytes: file.compressed }))]) {
      if (seen.has(row.hash)) continue;
      seen.add(row.hash);
      live();
      const held = await hasCachedAsset(caches, new URL(row.path, new URL('.', url)).href); live();
      if (!held) bytes += row.bytes;
    }
  }
  return bytes;
}
/** G727 / I9: download everything for offline play: every product of the title list (all of this tier's files, past
 *  the phone ring and Save-Data: the player asked) through the page's one prefetch, a finished run replaced by a new
 *  one; the worker warms the whole code bundle beside it. `progress` gets the stored and present bytes of the known set. */
export async function downloadEverything(owner: Scope, progress: (done: number, total: number) => void): Promise<OfflineDownloadEnd> {
  if (typeof caches === 'undefined' || !('storage' in navigator)) return 'stopped';
  const slugs = everyProduct(), running = pageRuns.get(window);
  if (running?.snapshot().phase !== 'running') pageRuns.delete(window); // a finished run makes way for a new one
  startGridPrefetch(slugs, slugs, true);
  navigator.serviceWorker?.controller?.postMessage({ type: 'WARM_ALL_CODE' });
  for (;;) {
    const status = gridPrefetchStatus();
    if (status === null) return 'stopped';
    progress(status.presentBytes + status.storedBytes, status.knownBytes);
    if (status.phase !== 'running') return status.phase;
    await new Promise<void>((resolve) => { owner.timeout(500, resolve); });
    if (owner.disposed) return 'stopped';
  }
}
