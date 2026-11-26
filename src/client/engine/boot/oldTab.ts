// Fix-preview PV11 and PV12 (Jake, 2026-11-26): an old tab's cards, in one module. A Worker version carries the code of
// the few builds before it (previousDeploy.mjs KEEP_PROMOTED), so a tab older than that meets a missing file, and Jake's
// answer for tabs left open too long: "a logout after 24 hours of a game client being open is simplest". Each card sends
// one Sentry event, tagged with the card and the build.
import type { Scope } from '../../../shared/engine/app/scope';
import { pageScope } from '../../../shared/engine/app/resources';
import { engineString } from '../../../shared/engine/strings';
import { engineScreenTags, type BrowserErrorTags, type ErrorScreen } from '../telemetry/browserErrors';
import { saveEnvironment } from '../../../shared/engine/saves/environment';
import { pageLogin, signOut } from '../net/playerLogin';
import { markReload } from './lastEnd';

/** The cards an old tab can show. */
export type OldTabCard = 'old-tab-updated' | 'day-logout';
/** PV12: a client open this long logs out and reloads onto the current build. */
export const DAY_LOGOUT_MS: number = 24 * 60 * 60 * 1000;
/** How long the logout card stays up before the page reloads, so a player reads why. */
export const LOGOUT_CARD_MS = 4000;

/** What the cards touch, so a test drives them without a page. */
export interface OldTabPorts {
  /** Paint a card; `reload` is the card's button, when it has one. */
  readonly show: (card: OldTabCard, text: string, reload?: () => void) => void;
  readonly capture: (error: Error, tags: BrowserErrorTags) => void;
  readonly reload: () => void;
  readonly signOut: () => void;
  readonly build: string;
  /** Wall-clock milliseconds: a sleeping laptop's timers stop, its clock does not. */
  readonly now: () => number;
}

const tags = (card: ErrorScreen, build: string, diagnostic: Record<string, unknown>): BrowserErrorTags =>
  ({ ...engineScreenTags(card, 'old-tab', 'running', diagnostic), build });

/** PV12: arm the day logout. At 24 hours open the tab shows a short card, sends its event, signs out and reloads onto the
 *  current build. A timer alone misses a laptop that slept through the mark, so every return to the tab checks the clock
 *  too. Fires once; the scope's end disarms it. */
export function armDayLogout(scope: Scope, ports: OldTabPorts, openedAt: number = ports.now()): void {
  let fired = false;
  const fire = (): void => {
    if (fired || scope.disposed) return;
    const open = ports.now() - openedAt;
    if (open < DAY_LOGOUT_MS) return;
    fired = true;
    ports.show('day-logout', engineString('s_old_tab_day_logout'));
    try { ports.capture(new Error(`a client open ${String(Math.round(open / 3_600_000))} h logged out (PV12)`), tags('day-logout', ports.build, { openMs: open })); }
    catch { /* a report never holds the logout */ }
    try { ports.signOut(); } catch { /* the reload still lands on the current build */ }
    scope.timeout(LOGOUT_CARD_MS, () => { ports.reload(); });
  };
  scope.timeout(Math.max(0, openedAt + DAY_LOGOUT_MS - ports.now()), fire);
  if (typeof document !== 'undefined') scope.listen(document, 'visibilitychange', () => { if (!document.hidden) fire(); });
  if (typeof window !== 'undefined') scope.listen(window, 'pageshow', fire);
}

/** The cards' look: one bottom card over everything, as the force-update card was. */
export function paintOldTabCard(card: OldTabCard, text: string, reload?: () => void): void {
  document.getElementById('ws-old-tab')?.remove();
  const node = document.createElement('div'); node.id = 'ws-old-tab'; node.dataset['card'] = card; node.setAttribute('role', 'alert');
  node.style.cssText = 'position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 16px);transform:translateX(-50%);z-index:2147483647;max-width:min(92vw,420px);padding:12px 16px;border-radius:8px;background:#07131d;color:white;font:14px system-ui;text-align:center';
  const line = document.createElement('div'); line.textContent = text; node.append(line);
  if (reload !== undefined) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = engineString('s_old_tab_reload');
    button.style.cssText = 'margin-top:8px;padding:6px 14px;border-radius:6px;border:0;font:inherit;font-weight:600';
    pageScope.listen(button, 'click', reload, { once: true }); node.append(button);
  }
  document.documentElement.append(node);
}

declare const __BUILD_ID__: string;
async function captureLater(error: Error, cardTags: BrowserErrorTags): Promise<void> {
  try { (await import('../telemetry/browserErrors')).captureBrowserError(error, cardTags); } catch { /* a report never holds the card */ }
}
/** The page's ports: the card over the page, Sentry through the page's reporter, the page's sign-in storage. */
export function browserOldTabPorts(): OldTabPorts {
  let build = ''; try { build = __BUILD_ID__; } catch { /* under Node */ }
  return {
    show: paintOldTabCard, build, now: () => Date.now(),
    capture: (error, cardTags) => { void captureLater(error, cardTags); },
    signOut: () => { const storage = saveEnvironment().storage('global'); if (storage !== null) signOut(pageLogin(storage)); },
    reload: () => { try { markReload('client open 24 h: logged out (PV12)', 'reload'); } catch { /* the reload goes anyway */ } location.reload(); },
  };
}
/** PV12: the page entry arms the day logout once, owned by the page's lifetime scope. */
export function installDayLogout(scope: Scope): void { armDayLogout(scope, browserOldTabPorts()); }

// ── PV11: one handler for a file this tab's build names and the server no longer has ──

/** What went missing: a code file (`vite:preloadError`, a failed dynamic import), a pack or a book. */
export type OldTabMiss = 'code' | 'pack' | 'book';
/** The existing once-per-session reload cap (forceUpdate.ts): one reload a session, so a second miss shows the card and
 *  never loops. */
export const OLD_TAB_RELOAD_KEY = 'boot.force-cache.j383';

export interface MissPorts {
  readonly show: OldTabPorts['show'];
  readonly capture: OldTabPorts['capture'];
  readonly build: string;
  /** May this tab reload by itself now: no world running, and the session's one reload not spent (it spends it). */
  readonly claim: () => boolean;
  /** The reload into the live build (past this tab's worker). */
  readonly reload: () => void;
}
/** A pack ends in `.pack` or `.pack.br`, a book is JSON; anything else a content read misses counts as a pack. */
export function missKind(url: string): Exclude<OldTabMiss, 'code'> {
  const path = url.split(/[?#]/u)[0] ?? '';
  return path.endsWith('.json') ? 'book' : 'pack';
}
/** One page's handler: the first miss shows "Wildshard was updated" with one event, and reloads once when the tab may;
 *  a tab that may not (a world running, or the session's reload spent) keeps the card up with its Reload button. Later
 *  misses on the same page add nothing: one card, one event. Returns what it did. */
export function createOldTabHandler(ports: MissPorts): (kind: OldTabMiss, what: string) => 'reload' | 'card' | 'shown' {
  let shown = false;
  return (kind, what) => {
    if (shown) return 'shown';
    shown = true;
    const auto = ports.claim();
    ports.show('old-tab-updated', engineString('s_old_tab_updated'), auto ? undefined : ports.reload);
    try { ports.capture(new Error(`old tab: its ${kind} is gone from the server (PV11)`), tags('old-tab-updated', ports.build, { kind, what, reload: auto })); }
    catch { /* a report never holds the card */ }
    // the reload puts the RELOADING cover ("Wildshard was updated · getting the new version") over the card, then leaves
    if (auto) ports.reload();
    return auto ? 'reload' : 'card';
  };
}
/** The session's one self-reload, shared with forceUpdate.ts's retry. */
export function claimSessionReload(store: Pick<Storage, 'getItem' | 'setItem'> | null): boolean {
  try {
    if (store === null || store.getItem(OLD_TAB_RELOAD_KEY) !== null) return false;
    store.setItem(OLD_TAB_RELOAD_KEY, '1'); return true;
  } catch { return false; }
}
