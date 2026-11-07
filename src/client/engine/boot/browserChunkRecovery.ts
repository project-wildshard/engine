import { pageScope } from '../../../shared/engine/app/resources';
import { saveStorage } from '../saves/slots';
import { countReload } from '../core/reloadGuard';
import { beginLoadingWait, finishLoadingWait } from '../../../shared/engine/boot/loadingWaits';
import { markReload } from './lastEnd';
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
async function latestVersion(allowed: () => boolean): Promise<string | null> {
  if (!allowed()) return null;
  const owner = pageScope.child('chunk-version'), controller = new AbortController();
  const url = new URL('/version.json', location.href);
  const wait = beginLoadingWait('Checking updated application', { kind: 'file', resource: url.href });
  owner.onDispose(() => { controller.abort(); });
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
const recoveryPorts = (allowed: () => boolean): ChunkRecoveryPorts => ({allowed, base: location.href, runningBuild: __BUILD_ID__,
  version: () => latestVersion(allowed), claimed: bootSelfReloadClaimed, claim: claimBootSelfReload,
  prepare: async build => {
    const wait = beginLoadingWait('Activating updated application', {kind: 'worker', resource: '/sw.js'});
    try { return await (await import('./sw')).refreshWorkerForChunkRecovery(build, allowed); }
    finally { finishLoadingWait(wait); }
  },
  reload: () => { countReload(); markReload('stale deployment code'); location.reload(); },
});
/** Only a confirmed newer deployment can replace a rejected boot/lazy module or stylesheet. */
export function recoverChunkFailure(error: unknown): Promise<boolean> {
  if (typeof window === 'undefined' || typeof __BUILD_ID__ !== 'string') return Promise.resolve(false);
  recover ??= createChunkRecovery(recoveryPorts(recoveryAllowed));
  return recover(error);
}
/** J54 (E5-REPLICATION §4.4): a server refused this build at `hello`. A refused tab has no world left to protect, so this
 * runs even with one on screen. The newer worker owns the next document first, or the reload lands on this build again. */
export function reloadRefusedBuild(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof __BUILD_ID__ !== 'string') return Promise.resolve(false);
  return reloadIntoNewerBuild(recoveryPorts(() => !documentLeaving));
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
