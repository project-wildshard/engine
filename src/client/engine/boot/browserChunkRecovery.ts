import { pageScope } from '../../../shared/engine/app/resources';
import { saveStorage } from '../saves/slots';
import { countReload } from '../core/reloadGuard';
import { beginLoadingWait, finishLoadingWait } from '../../../shared/engine/boot/loadingWaits';
import { markReload, type ReloadReason } from './lastEnd';
import { leaveAfterPaint } from './leaveAfterPaint';
import { createChunkRecovery, reloadIntoNewerBuild, type ChunkRecoveryPorts } from './chunkRecovery';

declare const __BUILD_ID__: string;
function bootSelfReloadClaimed(): boolean {
  try { return saveStorage('session').getItem('boot.selfReload') !== null; } catch { return true; }
}
function claimBootSelfReload(): boolean {
  try {
    if (bootSelfReloadClaimed()) return false;
    saveStorage('session').setItem('boot.selfReload', '1'); return true;
  } catch { return false; }
}
let worldRunning = false;
let documentLeaving = false;
const recoveryAllowed = (): boolean => !worldRunning && !documentLeaving;
let recover: ((error: unknown) => Promise<boolean>) | undefined;
/** How long a failed chunk's newer-build check waits for `/version.json`. */
const VERSION_MS = 5000;
async function latestVersion(allowed: () => boolean, limitMs?: number): Promise<string | null> {
  if (!allowed()) return null;
  const owner = pageScope.child('chunk-version'), controller = new AbortController();
  const url = new URL('/version.json', location.href);
  const wait = beginLoadingWait('Checking updated application', { kind: 'file', resource: url.href });
  owner.onDispose(() => { controller.abort(); });
  if (limitMs !== undefined) owner.timeout(limitMs, () => { controller.abort(); });
  owner.listen(window, 'beforeunload', () => { controller.abort(); });
  owner.listen(window, 'pagehide', () => { controller.abort(); });
  try {
    const response = await fetch(url, {cache: 'no-store', signal: controller.signal});
    if (!response.ok || response.url !== '' && new URL(response.url).origin !== url.origin) return null;
    const value: unknown = await response.json();
    return typeof value === 'object' && value !== null && 'build' in value && typeof value.build === 'string'
      && /^[\w.-]+$/u.test(value.build) ? value.build : null;
  } catch { return null; }
  finally { finishLoadingWait(wait); owner.dispose(); }
}
const recoveryPorts = (allowed: () => boolean, reason: ReloadReason = 'reload', limitMs?: number): ChunkRecoveryPorts => ({allowed, base: location.href, runningBuild: __BUILD_ID__,
  version: () => latestVersion(allowed, limitMs), claimed: bootSelfReloadClaimed, claim: claimBootSelfReload,
  prepare: async build => {
    const wait = beginLoadingWait('Activating updated application', {kind: 'worker', resource: '/sw.js'});
    try { return await (await import('./sw')).refreshWorkerForChunkRecovery(build, allowed); }
    finally { finishLoadingWait(wait); }
  },
  reload: () => { countReload(); markReload('stale deployment code', reason); location.reload(); },
});
/** Only a confirmed newer deployment can replace a rejected boot/lazy module or stylesheet. */
export function recoverChunkFailure(error: unknown): Promise<boolean> {
  if (typeof window === 'undefined' || typeof __BUILD_ID__ !== 'string') return Promise.resolve(false);
  // QA 11-12 row 35: the engine's own reload into the newer build resumes the world it was loading, never a title nobody asked for
  // QA 11-12 row 36: a link that never answers is no newer build; the failed read surfaces instead of waiting on it
  recover ??= createChunkRecovery(recoveryPorts(recoveryAllowed, 'background', VERSION_MS));
  return recover(error);
}
/** The old worker can't be shown to step aside, so the page leaves it: the next document comes from the network. */
async function dropWorker(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return true;
  await (await navigator.serviceWorker.getRegistration())?.unregister();
  return true;
}
/** J54 (E5-REPLICATION §4.4): a server refused this build at `hello`. A refused tab has no world left to protect, so this
 * runs even with one on screen. The newer worker owns the next document first, or the reload lands on this build again.
 * `keepPlace`: the player's place is on a server, so the page comes back to this URL and not to the title (J174). */
export function reloadRefusedBuild(keepPlace = false): Promise<boolean> {
  if (typeof window === 'undefined' || typeof __BUILD_ID__ !== 'string') return Promise.resolve(false);
  const ports = recoveryPorts(() => !documentLeaving, keepPlace ? 'background' : 'reload');
  // A server won't take this build, so staying is no option: a slower reload beats a player left outside the world.
  return reloadIntoNewerBuild(keepPlace ? { ...ports, prepare: async build => await ports.prepare(build) || dropWorker() } : ports);
}
/** A server took this build, so the reload that got here worked, and the next deploy may have one of its own. A build no server takes never reaches this, so nothing loops. */
export function settleRefusedBuild(): void {
  try { saveStorage('session').removeItem('boot.selfReload'); } catch { /* a page with no session storage reloads once, and stops */ }
}

/** A player's tap on a stale tab: the next document comes from the network, whatever worker holds this one, and the tab may reload itself once more. */
export async function reloadPastWorker(): Promise<void> {
  settleRefusedBuild();
  await leavePastWorker('new build panel');
}
/** Drop this tab's worker, then reload: the next document comes from the network. `cover`: the RELOADING cover going up,
 * which the reload waits for too, then leaves one painted frame later (leaveAfterPaint). */
async function leavePastWorker(why: string, cover: Promise<void> = Promise.resolve()): Promise<void> {
  // RL5: dropping the worker gets 3 s (reloadCover.ts RELOAD_FALLBACK_MS); a hung unregister never keeps the tap from reloading,
  // and a failed one still waits for the cover
  try { await Promise.race([Promise.all([dropWorker().catch(() => undefined), cover]), new Promise<void>(resolve => { pageScope.timeout(3000, resolve); })]); } catch { /* The reload goes anyway. */ }
  leaveAfterPaint(() => { countReload(); markReload(why, 'background'); location.reload(); });
}

/** RL8: this build's own file is gone from the server. When /version.json names another build, this tab's build is out
 * of date: the full-page RELOADING cover goes up (reloadCover.ts listens for `ws:reloading`) and the page reloads past
 * its worker into the live build. Once per build and tab, so a broken deploy can't loop; false leaves the ordinary RETRY. */
export async function reloadIfStaleBuild(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof __BUILD_ID__ !== 'string') return false;
  const live = await latestVersion(() => !documentLeaving);
  if (live === null || live === __BUILD_ID__) return false;
  // its own claim (settleRefusedBuild clears boot.selfReload on an online hello), holding this build: never twice for it
  try {
    const store = saveStorage('session');
    if (store.getItem('boot.staleBuild') === __BUILD_ID__) return false;
    store.setItem('boot.staleBuild', __BUILD_ID__);
  } catch { return false; }
  const cover = showReloadingSoon('This build is out of date · getting the new one');
  void leavePastWorker('stale build: its files are gone from the server', cover);
  return true;
}

/** The RELOADING cover, in this turn when its module is loaded (it answers `ws:reloading` with preventDefault). In an
 * unbundled dev page this can run before any module that imports the cover has; then the cover's module is loaded now
 * and shown, and the reload waits for it (inside the worker drop's 3 s). Resolves once the cover is up. A bundled stale build already holds the cover (its own files are
 * gone, so it could not load a chunk now); its import failing leaves only the reload. */
function showReloadingSoon(line: string): Promise<void> {
  if (!document.dispatchEvent(new CustomEvent('ws:reloading', { detail: line, cancelable: true }))) return Promise.resolve();
  return import('../ui/reloadCover').then(cover => { if (!cover.reloadingShown()) cover.showReloading(null, line); return undefined; }, () => undefined);
}

let installed = false;
/** Arm lazy-import/CSS failures after the initial entry promise has settled.
 * The ordinary error pipeline still receives the original failure. */
export function installChunkRecovery(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  pageScope.listen(window, 'beforeunload', () => { documentLeaving = true; });
  pageScope.listen(window, 'pagehide', () => { documentLeaving = true; });
  pageScope.listen(window, 'pageshow', () => { documentLeaving = false; });
  pageScope.listen(document, 'ws:ready', () => {
    if (!document.documentElement.classList.contains('title-first')) worldRunning = true;
  });
  pageScope.listen(document, 'ws:control-ready', () => { worldRunning = true; });
  pageScope.listen(window, 'unhandledrejection', event => { void recoverChunkFailure(event.reason); });
  pageScope.listen(window, 'vite:preloadError', event => { void recoverChunkFailure(Reflect.get(event, 'payload')); });
}
