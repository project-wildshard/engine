import { publicBytes } from '../../../shared/engine/boot/tables';
import { bootLateReads } from './filePolicy';
import { pageScope } from '../../../shared/engine/app/resources';
import { saveStorage } from '../saves/slots';
import { prepareBootAudio } from './audioInventory';
/**
 * The other shards, downloaded in the background (E158; the user: "skip the download phase when swapping shards and only
 * do the loading phase"). Once this shard is playable, every file another shard's boot reads — for THIS device's tier —
 * is fetched into the service worker's caches, so the first switch to a shard never visited boots from Cache Storage: its
 * loading bar has nothing to download, and it works offline. A revisit already cost ~0 bytes (bench.budget.json "warm
 * transfer"); this makes the FIRST visit a revisit.
 *
 * The list is the boot's own, not a copy of it (`shardBootRequests`): the shard's boot pack parts for this tier, then every
 * file its `bootFiles` declares that the pack does not carry — the files the loading bar counts, which are exactly the
 * files a boot reads (plan.done() throws unless DOWNLOAD is at 100 %), with the network's `?v=` (versionedUrl) applied.
 * test/shard-prefetch.test.ts proves the equality against main.ts's own composition (pack + bootFetches + extraFetches +
 * physics), per shard and per tier.
 *
 * The fetching happens in the worker (src/client/engine/pwa/sw.js `PREFETCH`): the page posts one URL at a time and the worker checks
 * its cache (a hit costs nothing — so a later session resumes where this one stopped), fetches at low priority and stores
 * the response. The page thread only posts messages, so the game's frames do not pay for it.
 *
 * Polite: starts a few seconds after playable and only when idle; at most CONCURRENCY files in flight; nothing new while
 * the tab is hidden; on Wi-Fi and cellular alike (E158), off on the OS's data saver (Save-Data) or without a controlling
 * worker (dev, `?sw=0`). The current shard goes first:
 * whatever its own boot fetched before the worker controlled the page
 * (a first visit on a slow link, the ≤ 2.5 s cap in src/client/engine/boot/sw.ts) is stored now instead of on the next launch.
 *
 * E157 B (the user: "images on the first visit, KTX2 from the next launch"): after every shard's boot files, the same
 * lanes fetch each shard's KTX2 set (`ktx2Set`: the KTX2 stand-ins its KTX2 boot reads + the Basis transcoder), this
 * shard's first. When the worker has answered every file of a set with 'hit' or 'stored', its marker (`ktx2MarkerKey`,
 * the set's hash) is written; src/client/engine/boot/gpuFiles.ts reads it at the next page load and Auto boots that shard with KTX2.
 * A failed file removes the marker. It does not override G188's first-visit over-cap phone policy or explicit
 * tier choices or a harness pin (gpuFiles.ts). Skipped when a test or capture pins the textures to images (G386).
 *
 * `window.__ws_prefetch` (the bench / tests): `{ state, done }` — `done` resolves with the final report.
 */
import { bootCatalog, type BootLevel } from './catalog';
import { bootFiles } from './extras';
import { bootParts, packFor } from './pack';
import { gpuUrl, versionedUrl } from './bytes';
import { isRegisteredGpuFile, registerGpuFiles, setAutoKtx2Check, texMode, texModeWhy, texturePin, type TexMode } from './gpuFiles';
import { BASIS_PATH } from '../core/ktx2';
import { ktx2ProbeResult } from '../render/ktx2Probe';
import { TIER } from '../core/tier';
import { lutUrl } from '../world/lut';
import { horizonStrips } from '../world/HorizonMatte';

const savedStorage = saveStorage('device');

/** files in flight at once: the worker's fetches share the pipe with anything the game still asks for */
const CONCURRENCY = 2;
/** after playable: the title's first frames, the menu's first taps and the shader warm-up go first */
const START_DELAY_MS = 4000;

/** Every URL `def`'s boot requests on this tier, in the order the boot asks for them, as the network sees them. */
export function shardBootRequests(def: BootLevel, tex: TexMode = texMode()): string[] {
  const files = bootFiles(def, tex);
  const whole = packFor(def), pack = whole ? bootParts(whole, files) : null;
  const packed = new Set(pack ? pack.files.map(([p]) => p) : []);
  const declared = Object.values(files).flat().filter((p) => !packed.has(p));
  return [...new Set([...(pack ? pack.parts.map((part) => part.url) : []), ...declared])].map(versionedUrl);
}

/**
 * The files a shard reads at boot WITHOUT declaring them to the loading bar — fetched by the world as it comes up (the
 * shard's colour LUT, its painted horizon, Driftwood's Blender island + the captain, Pine Hollow's rifle / knife / birds /
 * NPCs / trophy-wall chalk, Nalati's camp people). Not in `bootFiles` (plan.done() would wait on them), so the bench found them: the first switch still
 * downloaded ~1–4 MB of them. Each name comes from the module that loads it; a file the build does not ship is left out.
 */
export function lateReads(def: BootLevel, tex: TexMode = texMode()): string[] {
  const out: string[] = [...bootLateReads(def.boot?.lateReads, TIER, tex)];
  const lut = lutUrl(def.slug);
  if (lut !== null) out.push(lut);
  const strips = horizonStrips(def);
  if (strips) { const s = TIER === 'phone' && strips.phone ? strips.phone : strips; out.push(gpuUrl(s.day, tex), gpuUrl(s.night, tex)); }
  const declared = new Set(Object.values(bootFiles(def, tex)).flat());
  // a level's declared late reads may name the LUT and the strips too (first occurrence kept: the declared order)
  return [...new Set(out)].filter((p) => p in publicBytes() && !declared.has(p)).map(versionedUrl);
}

/** What the background download fetches for `def`: its boot's requests, then what the world reads as it comes up. */
export function shardPrefetchList(def: BootLevel, tex: TexMode = texMode()): string[] {
  return [...new Set([...shardBootRequests(def, tex), ...lateReads(def, tex)])];
}

/**
 * E157 B: a shard's KTX2 set for this tier — every KTX2 stand-in its KTX2 boot and world read (the files an images boot
 * does not), plus the Basis transcoder they need. Empty when the tier has no stand-ins (both tiers are baked since E173).
 */
export function ktx2Set(def: BootLevel): string[] {
  // Pack parts replace stand-in URLs on the wire; the marker must still name every logical stand-in.
  const own = [...Object.values(bootFiles(def, 'ktx2')).flat(), ...lateReads(def, 'ktx2')]
    .filter(isRegisteredGpuFile).map(versionedUrl);
  return own.length === 0 ? [] : [...new Set([...own, `${BASIS_PATH}basis_transcoder.js`, `${BASIS_PATH}basis_transcoder.wasm`])];
}
/** the set's identity: FNV-1a over its sorted names — they are content-addressed, so the same hash means the same bytes */
export function setHash(files: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const ch of [...files].sort((a, b) => a.localeCompare(b)).join('\n')) h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  return `${files.length}-${h.toString(16).padStart(8, '0')}`;
}
/** the marker the background download writes once the worker holds every file of the set (localStorage: read synchronously at boot) */
export const ktx2MarkerKey = (slug: string): string => `ktx2set:${slug}.${TIER}`;
function markKtx2(def: BootLevel, complete: boolean, hash: string): void {
  try {
    if (complete) savedStorage.setItem(ktx2MarkerKey(def.slug), hash);
    else savedStorage.removeItem(ktx2MarkerKey(def.slug));
  } catch { /* private mode: Auto stays on images */ }
}
// DL17: Auto boots a shard's KTX2 set from the first visit (no images-then-KTX2 swap); the marker still records the cached set
setAutoKtx2Check((slug) => { const def = bootCatalog().find(slug); return def !== undefined && ktx2Set(def).length > 0; });

export interface PrefetchEnv {
  /** a service worker controls the page (its caches are where the files go) */
  controlled: boolean;
  /** the OS's data saver (Android Data Saver, Chromium's Save-Data; iOS Low Data Mode does not reach the page) */
  saveData?: boolean;
}

/**
 * Why the background download must not run here, or null when it may. Wi-Fi and cellular alike (the user's pick, E158):
 * only the OS data saver or absence of a service worker prevents it — never the connection type.
 */
export function prefetchVeto(env: PrefetchEnv): string | null {
  if (!env.controlled) return 'no service worker';
  if (env.saveData === true) return 'Save-Data';
  return null;
}

/** navigator.connection (Chromium / Android): not in every browser, not in the DOM lib */
function connection(): Pick<PrefetchEnv, 'saveData'> {
  const c: unknown = Reflect.get(navigator, 'connection');
  if (typeof c !== 'object' || c === null) return {};
  const saveData: unknown = Reflect.get(c, 'saveData');
  return typeof saveData === 'boolean' ? { saveData } : {};
}

export interface ShardTally { files: number; hit: number; stored: number; failed: number; bytes: number }
export interface PrefetchState {
  status: 'waiting' | 'running' | 'done' | 'skipped' | 'failed';
  reason?: string;
  startedAt: number;
  endedAt: number;
  shards: Record<string, ShardTally>;
  /** E157 B: each shard's KTX2 set (after every shard's boot files); `complete` once the worker holds all of it */
  ktx2: Record<string, ShardTally & { complete: boolean }>;
  /** the textures this page loads with, and why (src/client/engine/boot/gpuFiles.ts) */
  tex: { mode: TexMode; why: string };
}
export interface PrefetchHandle {
  state: PrefetchState;
  done: Promise<PrefetchState>;
  /** E172 (Debug ▸ Clear downloads): ask for no new file; resolves once the files in flight have answered (the run ends 'skipped') */
  stop: () => Promise<void>;
}

declare global { interface Window { __ws_prefetch?: PrefetchHandle } }

interface Reply { status: 'hit' | 'stored' | 'failed'; bytes: number }

/** One file through the controlling worker; null when nothing answers (an older worker without PREFETCH, or none). */
function viaWorker(url: string, signal: AbortSignal): Promise<Reply | null> {
  const ctl = navigator.serviceWorker.controller;
  if (!ctl || signal.aborted || ctl.state === 'redundant') return Promise.resolve(null);
  return new Promise<Reply | null>((resolve) => {
    const owner = pageScope.child('prefetch-reply'), ch = new MessageChannel();
    const finish = (reply: Reply | null): void => { resolve(reply); owner.dispose(); };
    owner.onDispose(() => { ch.port1.close(); ch.port2.close(); resolve(null); });
    owner.listen(signal, 'abort', () => { finish(null); }, {once: true});
    owner.listen(ctl, 'statechange', () => { if (ctl.state === 'redundant') finish(null); });
    owner.listen(ctl, 'error', () => { finish(null); });
    ch.port1.onmessageerror = () => { finish(null); };
    ch.port1.onmessage = (e: MessageEvent<unknown>) => {
      const data = e.data;
      if (typeof data !== 'object' || data === null) { finish(null); return; }
      const status: unknown = Reflect.get(data, 'status'), bytes: unknown = Reflect.get(data, 'bytes');
      finish(Reflect.get(data, 'type') === 'PREFETCHED' && (status === 'hit' || status === 'stored' || status === 'failed')
        ? { status, bytes: typeof bytes === 'number' ? bytes : 0 } : null);
    };
    try { ctl.postMessage({ type: 'PREFETCH', url }, [ch.port2]); }
    catch { finish(null); }
  });
}

// the shell's timers / listeners (E155: several shards live in the page; this download is the page's, not a shard's)
const sleep = (ms: number): Promise<void> => new Promise((resolve) => { pageScope.timeout(ms, resolve); });
/** the next idle slot (Safari has no requestIdleCallback: a short timeout stands in) */
const idle = (): Promise<void> => new Promise((resolve) => {
  if ('requestIdleCallback' in window) window.requestIdleCallback(() => { resolve(); }, { timeout: 2000 });
  else pageScope.timeout(50, resolve);
});
/** resolves while the tab is visible — at once, or on the next visibilitychange that shows it */
const visible = (): Promise<void> => new Promise((resolve) => {
  if (!document.hidden) { resolve(); return; }
  let off = (): void => undefined;
  const on = (): void => { if (!document.hidden) { off(); resolve(); } };
  off = pageScope.listen(document, 'visibilitychange', on);
});

/**
 * Start the background download: `active` (the shard on screen) first, then every other shard in title order. Call once
 * the shard is playable. Returns the handle it also puts on `window.__ws_prefetch`.
 */
export function startShardPrefetch(active: BootLevel): PrefetchHandle {
  const state: PrefetchState = { status: 'waiting', startedAt: 0, endedAt: 0, shards: {}, ktx2: {}, tex: texModeWhy() };
  const veto = prefetchVeto({ controlled: 'serviceWorker' in navigator && navigator.serviceWorker.controller !== null, ...connection() });
  const finish = (status: PrefetchState['status'], reason?: string): PrefetchState => {
    state.status = status;
    if (reason !== undefined) state.reason = reason;
    state.endedAt = Math.round(performance.now());
    return state;
  };
  const stopped = { on: false }; // E172: handle.stop() — Debug ▸ Clear downloads
  const controller = new AbortController();
  let finishStop = (): void => { /* Assigned before starting the background task. */ };
  const ended = new Promise<void>(resolve => { finishStop = resolve; });
  const halted = (): boolean => stopped.on;
  const run = async (): Promise<PrefetchState> => {
    if (veto !== null) return finish('skipped', veto);
    await Promise.race([sleep(START_DELAY_MS), ended]);
    if (halted()) return finish('skipped', 'stopped (Clear downloads)');
    // A phone keeps only one shard in play. Cache this shard (including its KTX2 set for the next launch),
    // but do not download the other worlds while the iOS WebContent process is under memory pressure.
    const order = TIER === 'phone' ? [active] : [active, ...bootCatalog().playable.filter((c) => c !== active)];
    await Promise.all(order.filter((def) => def !== active).map((def) => prepareBootAudio(def.boot)));
    await Promise.all(order.map(async (def) => { if (def.ktx2 !== undefined) registerGpuFiles((await def.ktx2()).GPU_FILES); }));
    const jobs: { slug: string; url: string; set: 'boot' | 'ktx2' }[] = [];
    // 1. (E158) every shard's boot files, in the textures its NEXT boot loads with: the harness pin, or Auto's — KTX2 for a
    //    shard with a set (DL17). The page's own shard first: what its boot fetched before the worker controlled it.
    const picked = texturePin();
    // a GPU the capability probe already turned to images (render/ktx2Probe.ts) loads images next time too: no KTX2 sets
    const vetoed = (ktx2ProbeResult()?.veto ?? null) !== null;
    const modeFor = (def: BootLevel): TexMode => (vetoed ? 'img' : picked !== 'auto' ? picked : ktx2Set(def).length > 0 ? 'ktx2' : 'img');
    for (const def of order) {
      const urls = shardPrefetchList(def, def === active ? texMode() : modeFor(def));
      state.shards[def.slug] = { files: urls.length, hit: 0, stored: 0, failed: 0, bytes: 0 };
      for (const url of urls) jobs.push({ slug: def.slug, url, set: 'boot' });
    }
    // 2. (E157 B) then each shard's KTX2 set — this shard's first: Auto boots it with KTX2 from the next launch on. Files
    //    already cached are hits (nothing fetched), so every session re-confirms the set and re-writes its marker.
    const hashes = new Map<string, string>();
    if (picked !== 'img' && !vetoed) for (const def of order) {
      const urls = ktx2Set(def);
      if (urls.length === 0) continue;
      hashes.set(def.slug, setHash(urls));
      state.ktx2[def.slug] = { files: urls.length, hit: 0, stored: 0, failed: 0, bytes: 0, complete: false };
      for (const url of urls) jobs.push({ slug: def.slug, url, set: 'ktx2' });
    }
    state.status = 'running';
    state.startedAt = Math.round(performance.now());
    const worker = { gone: false }; // an older worker (no PREFETCH) or none: stop asking
    if (halted()) return finish('skipped', 'stopped (Clear downloads)');
    const lane = async (): Promise<void> => {
      for (let job = jobs.shift(); job !== undefined && !worker.gone && !halted(); job = jobs.shift()) {
        await Promise.race([visible(), ended]);
        await Promise.race([idle(), ended]);
        const r = await viaWorker(job.url, controller.signal);
        const t = job.set === 'boot' ? state.shards[job.slug] : state.ktx2[job.slug];
        if (r === null) { worker.gone = true; return; }
        if (t) { t[r.status]++; t.bytes += r.bytes; }
        const k = job.set === 'ktx2' ? state.ktx2[job.slug] : undefined;
        if (k?.hit !== undefined && k.hit + k.stored + k.failed === k.files) { // the set's last reply: mark it (or unmark a set that lost a file)
          k.complete = k.failed === 0;
          const def = bootCatalog().find(job.slug), hash = hashes.get(job.slug);
          if (def && hash !== undefined) markKtx2(def, k.complete, hash);
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, lane));
    if (halted()) return finish('skipped', 'stopped (Clear downloads)');
    return worker.gone ? finish('failed', 'the service worker did not answer') : finish('done');
  };
  const done = run().catch((e: unknown) => finish('failed', e instanceof Error ? e.message : String(e)));
  const handle: PrefetchHandle = { state, done, stop: async () => { stopped.on = true; controller.abort(); finishStop(); await done; } };
  window.__ws_prefetch = handle;
  return handle;
}
