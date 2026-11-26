import { engineString } from '../../../shared/engine/strings';
import { Scope } from '../../../shared/engine/app/scope';
import type { SaveStorage } from '../../../shared/engine/saves/store';
import { saveStorage } from '../saves/slots';
import { markReload } from './lastEnd';
import { FORCE_UPDATE_RELOAD } from './dropNotice';
import { forceCacheState, setForceCacheState, wipeDownloadedCaches } from '../pwa/forceCache';
import { OLD_TAB_RELOAD_KEY, paintOldTabCard } from './oldTab';

/** Compare declared versions, never hashes or a possibly stale git-describe label. */
export function olderClient(current: string, minimum: unknown): boolean {
  if (typeof minimum !== 'string') return false;
  const parse = (value: string): number[] | null => /^\d{1,6}\.\d{1,6}\.\d{1,6}$/u.test(value) ? value.split('.').map(Number) : null;
  const ours = parse(current), floor = parse(minimum);
  if (ours === null || floor === null) return false;
  for (let i = 0; i < 3; i++) { const a = ours[i] ?? 0, b = floor[i] ?? 0; if (a !== b) return a < b; }
  return false;
}
const RETRIED = OLD_TAB_RELOAD_KEY;
/** PV11: a retired client's forced update shows the one old-tab card ("Wildshard was updated"), with its one event. */
function updating(): void {
  if (document.getElementById('ws-old-tab') !== null) return;
  paintOldTabCard('old-tab-updated', engineString('s_old_tab_updated'));
  void reportUpdating();
}
async function reportUpdating(): Promise<void> {
  try {
    const errors = await import('../telemetry/browserErrors');
    errors.captureBrowserError(new Error('old tab: a retired client is forced to update (PV11)'), errors.engineScreenTags('old-tab-updated', 'old-tab', 'boot', { kind: 'client' }));
  } catch { /* a report never holds the update */ }
}
/** One page's recovery lifetime. Construction installs no listeners or services. */
export class ClientUpdater {
  private resetting: Promise<void> | null = null;
  private readonly retryStore: Pick<SaveStorage, 'getItem' | 'setItem'> | null | undefined;
  constructor(retryStore?: Pick<SaveStorage, 'getItem' | 'setItem'> | null) { this.retryStore = retryStore; }
  /** Unregister and wipe concurrently; a stuck worker job must not prevent native cache deletion or navigation. */
  force(): Promise<void> {
  if (this.resetting !== null) return this.resetting;
  updating();
  try { markReload(FORCE_UPDATE_RELOAD); } catch { /* An unavailable diagnostic store cannot block recovery. */ }
  this.resetting = (async () => {
    const owner = new Scope('boot.force-update');
    const visible = new Promise<void>(resolve => { owner.timeout(400, resolve); });
    const deadline = new Promise<void>(resolve => { owner.timeout(4000, resolve); });
    const clear = (async () => {
    const unregister = 'serviceWorker' in navigator ? navigator.serviceWorker.getRegistrations().then(registrations => Promise.all(registrations.map(registration => registration.unregister()))) : Promise.resolve([]);
    await Promise.all([unregister, wipeDownloadedCaches()]);
    // WebKit's Clear-Site-Data support varies; native deletion above is authoritative.
    await fetch('/clear-cache.json', { cache: 'no-store', signal: AbortSignal.timeout(2000) }).catch(() => undefined);
    })();
    try { await Promise.race([Promise.all([clear, visible]), deadline]); }
    catch { document.documentElement.dataset['forceUpdateIncomplete'] = 'true'; await visible; }
    finally { owner.dispose(); location.reload(); } // exit: marked (markReload(FORCE_UPDATE_RELOAD) at the reset's start)
  })();
  return this.resetting;
}
/** Finish a blocked worker wipe before app entry. Healthy boot checks run in parallel and repeat on foreground. */
  async install(current: string, scope: Scope): Promise<boolean> {
  if (await forceCacheState() === 'pending') {
    let retry = false;
    try {
      const store = this.retryStore === undefined ? saveStorage('session') : this.retryStore;
      retry = store?.getItem(RETRIED) === null; store?.setItem(RETRIED, '1');
    } catch { /* No durable retry budget: prefer the new page over a reload loop. */ }
    if (retry) { await this.force(); return false; }
    // A permanently refused derivative cache must not prevent entry after one real cleanup attempt.
    await setForceCacheState('complete').catch(() => undefined);
    document.documentElement.dataset['forceUpdateIncomplete'] = 'true';
  }
  let reading = false;
  let queued = false;
  const check = async (): Promise<void> => {
    if (this.resetting !== null) return;
    if (reading) { queued = true; return; }
    reading = true;
    try {
      const response = await fetch('/version.json', { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000) });
      if (!response.ok) return;
      const value: unknown = await response.json();
      if (typeof value === 'object' && value !== null && 'minClient' in value && olderClient(current, value.minClient)) await this.force();
    } catch { /* Offline does not prove that the installed client is retired. */ } finally {
      reading = false;
      if (queued && this.resetting === null) { queued = false; void check(); }
    }
  };
  scope.listen(document, 'visibilitychange', () => { if (!document.hidden) void check(); });
  scope.listen(window, 'pageshow', () => { void check(); });
  scope.listen(window, 'ws-live-build', () => { void check(); });
  void check();
  return true;
}
}
const pageUpdater = new ClientUpdater();
/** Install once from the page entry, owned by its lifetime scope. */
export function installForceUpdate(current: string, scope: Scope): Promise<boolean> { return pageUpdater.install(current, scope); }
