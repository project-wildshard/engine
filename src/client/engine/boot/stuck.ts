import { installChunkRecovery, recoverChunkFailure } from './browserChunkRecovery';
import { saveStorage } from '../saves/slots';
/**
 * The boot's safety net under the game's own error handling (E144). src/client/engine/ui/ErrorModal.ts is armed by src/client/app/main.ts, so a
 * failure BEFORE main evaluates never reached it: a main chunk that 404'd (a service worker holding a build the host no
 * longer serves) left the first-paint loader frozen at 00:00.0, DOWNLOAD 0 %, SETUP 0 %, with nothing on screen to say
 * so. Dependency-light on purpose: it rides in the index chunk that index.html loads, beside src/client/app/entry.ts.
 *
 *   guardBoot(entered)   entry.ts's `import(main)` promise:
 *     rejects      → report it (queued offline, sent by the next boot), then recover() by itself once, with no card; a
 *                    second failure inside the reload budget (src/client/engine/core/reloadGuard.ts, shared with the error modal),
 *                    or after index.html's own 12 s self-reload (RL3: one retry a page, not two), opens the error modal
 *                    instead (MF3: no card of its own): it never loops.
 *   RL4: a slow boot gets no "Still starting" card; index.html's self-reload covers a boot that never settles.
 *
 *   recover()   records the deliberate retry and reloads immediately. Shell delivery and bounded network fallback
 *               belong to the worker; the page does not probe, adopt or run cache maintenance before navigating.
 */
import { ErrorReporter, safeUrl, sendReport } from '../core/errorReport';
import { countReload, recentReloads } from '../core/reloadGuard';
import { markReload } from './lastEnd';
import { showEnd } from './endPlay';
import { pageScope } from '../../../shared/engine/app/resources';


declare const __BUILD_ID__: string; // vite.config.ts define

/** RL3 / RL4: the once-a-session boot retry (session save `boot.selfReload`), shared with index.html's 12 s self-reload */
const SELF_RELOAD_KEY = 'boot.selfReload';
function retriedThisSession(): boolean {
  try { return store('session').getItem(SELF_RELOAD_KEY) !== null; } catch { return true; }
}

/** what went wrong, for the card's small print */
let detail = '';
// lib.dom says it always exists; it doesn't (an insecure context, a WebView without service workers)
const nav: { serviceWorker?: ServiceWorkerContainer | undefined } = navigator;

function store(kind: 'session' | 'local'): ReturnType<typeof saveStorage> { return saveStorage(kind === 'local' ? 'device' : 'session'); }

function report(error: unknown): void {
  try {
    const entry = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/b/"],script[type="module"][src*="/assets/"]')?.src ?? '';
    const reporter = new ErrorReporter({
      send: sendReport,
      context: () => ({ build: __BUILD_ID__, shard: '', url: safeUrl(location.href), loop: 'boot', entry: entry.split('/').pop() ?? '', online: navigator.onLine, controlled: (nav.serviceWorker?.controller ?? null) !== null }),
      session: store('session'), local: store('local'), now: () => performance.now(),
    });
    void reporter.report('boot-entry', error, { fatal: true });
  } catch { /* the net must never throw */ }
}

/** A player's retry navigates immediately. The worker owns bounded shell delivery;
 * UI recovery never waits for a probe, activation or cache maintenance. */
export function recover(): Promise<void> {
  countReload();
  try { store('session').setItem(SELF_RELOAD_KEY, String(Date.now())); } catch { /* the reload budget still counts it */ }
  markReload(`stuck boot recovery (${detail.slice(0, 80)})`);
  location.reload();
  return Promise.resolve();
}

/**
 * A cached app met a newer deployment's built-in product (src/client/game/shardfile/folder.ts `readIndexBytes`): recover()
 * once, so the reload comes up on the new build. False, without reloading, when a counted reload is already inside the
 * window (it did not bring the new build): the caller shows its error instead of looping. Concurrent callers share one.
 */
export function staleClientRecovery(recent: () => number, reload: () => Promise<void>): () => Promise<boolean> {
  let pending: Promise<boolean> | undefined;
  return () => {
    pending ??= (async () => {
      if (recent() > 0) return false;
      detail = 'app older than its product';
      await reload();
      return true;
    })();
    return pending;
  };
}
/** The page's one stale-client recovery (staleClientRecovery). */
export const recoverStaleClient: () => Promise<boolean> = staleClientRecovery(() => recentReloads().length, recover);

function failed(error: unknown): void {
  detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  report(error);
  // STAGING-BUGBASH SB53: offline, the reload cannot load the page either. It spent the one retry, its own entry modules
  // failed, and the card sat at START 0 % once the network was back. Wait for the network, then recover as ever.
  if (!navigator.onLine) {
    const owner = pageScope.child('boot.offline');
    showOfflineLine(owner);
    owner.listen(window, 'online', () => { owner.dispose(); settle(error); });
    return;
  }
  settle(error);
}
/** The offline wait's words on the card: what stopped the start, and that it carries on by itself. */
export const OFFLINE_START_LINE = 'This device is offline, so the game stopped loading. It starts again by itself when the connection is back.';
/**
 * QA 11-24 row 25 (mini-mw MW15): a first visit is never controlled by the service worker (`sw.js` claims only on a forced
 * update, `sw-ready-uncontrolled.test.ts`), so offline after ENTER THE MMO the start's own chunks fail, and the SB53 wait
 * above held the card at START 84 % with its clock ticking and no word, for as long as the device stayed offline. Its line
 * says why on the card, plainly and from this chunk, and goes with the wait.
 */
function showOfflineLine(owner: ReturnType<typeof pageScope.child>): void {
  try {
    // no loading card: nothing stands frozen (the title is up), so nothing to explain
    const card = document.querySelector<HTMLElement>('.ws-load:not([data-veil])');
    if (card === null) return;
    const line = document.createElement('div');
    line.className = 'ws-load-offline'; line.setAttribute('role', 'alert'); line.textContent = OFFLINE_START_LINE;
    line.style.cssText = 'flex:none;box-sizing:border-box;width:calc(100% - 32px);max-width:560px;margin:8px auto;padding:12px;'
      + 'border:1px solid #ffb547;background:rgba(13,27,38,0.92);color:#e8f5fa;font:12px/1.45 monospace;z-index:2147483000';
    card.append(line);
    owner.onDispose(() => { line.remove(); });
  } catch { /* the net must never throw */ }
}
function settle(error: unknown): void {
  if (recentReloads().length === 0 && !retriedThisSession()) {
    // the common case (a build the host no longer serves): one automatic recovery, no tap and no card (RL4). The reload
    // lands on the title: the drop modal there says why (Jake, 11-12: "where's my error modal at?")
    showEnd({ code: 'BOOT-FAIL', why: 'The game hit an error while starting, so it reloaded to recover.', error, retry: true });
    void recover();
    return;
  }
  // MF3: a failure after the one retry is the error modal (RELOAD HERE), not a card of the boot's own
  void showFailure();
}
async function showFailure(): Promise<void> {
  try { const { showError } = await import('../ui/ErrorModal'); showError(`The game failed to start (${detail})`); }
  catch { /* the net must never throw */ }
}

/** Watch entry.ts's main-module promise: a rejection gets a way out instead of a frozen loader. */
export function guardBoot(entered: Promise<unknown>): void {
  installChunkRecovery();
  void (async () => {
    try { await entered; } catch (e) { if (!await recoverChunkFailure(e)) failed(e); }
  })();
}
