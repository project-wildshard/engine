import type { Scope } from '@wildshard/engine/app/scope';
import { lastEnd, markReload, type LastEnd } from '@wildshard/engine/boot/lastEnd';

/**
 * STAGING-BUGBASH SB37b (K2 `old-cache-first-page`, staging smoke v0.1.34 and v0.1.40): an old shell's title kept painting its
 * old build after the candidate's worker had installed and activated behind it, because no document is claimed (sw.ts, 039d:
 * claiming slowed the warm Home load) and sw.js navigates clients only on J383's forced path. The candidate came only with the
 * player's next navigation.
 *
 * The page, not the worker, reloads: only a cold title (never a world page's pause ▸ EXIT TO MAIN), only while it sits idle
 * on the main screen (no ZONE SELECT, Settings, Name prompt, sign-in or drop card open, the tab visible, no tap or key for
 * HANDOVER_QUIET_MS), and never on a page a hand-over itself opened (no loop, whatever the worker serves). A worker-driven `client.navigate` would snatch a menu the player has open.
 * It helps shells built from this change on: an older title has no listener.
 */

/** no tap, key or wheel for this long before the title may reload under the player */
export const HANDOVER_QUIET_MS = 5000;
const TICK_MS = 1000;
/** the reload's reason (lastEnd), which the next document reads to never hand over twice in a row */
export const HANDOVER_REASON = 'idle title handover';
/** what the title holds open over the main screen: Settings, a dialog (Name, sign-in), the drop and error cards */
const OPEN = '.ws-gmenu.show, [aria-modal="true"], #wsdrop, #wserr, .ws-fail';
/** QA-FEEDBACK-2026-11-24 row 7: only a shown one holds the title. index.html's portrait guard (`.ws-rotate`, aria-modal, display none
 *  in portrait) and a dismissed drop card matched OPEN on every page, so no title ever handed over and an update waited on the
 *  player's next tap (the frozen title Jake saw after each staging release). */
function shown(el: Element): boolean {
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  return typeof el.checkVisibility === 'function' ? el.checkVisibility() : true;
}
const openOver = (): boolean => [...document.querySelectorAll(OPEN)].some(shown);

/** Arm the hand-over on a cold title. `onMain`: the main screen shows and nothing of the menu's own is in flight. */
export function armTitleHandover(owner: Scope, onMain: () => boolean, previous: Pick<LastEnd, 'kind' | 'reason'> = lastEnd()): void {
  if (previous.kind === 'intentional' && previous.reason.startsWith(HANDOVER_REASON)) return;
  let target: string | null = window.__ws_sw?.activated ?? null;
  let input = Date.now();
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) {
    owner.listen(window, type, () => { input = Date.now(); }, { capture: true, passive: true });
  }
  // a player looking back at the tab gets the quiet window too, never a reload a second later
  owner.listen(document, 'visibilitychange', () => { if (document.visibilityState === 'visible') input = Date.now(); });
  owner.listen(window, 'ws-sw-activated', event => {
    const value: unknown = event instanceof CustomEvent ? event.detail : null;
    if (typeof value === 'object' && value !== null && 'build' in value && typeof value.build === 'string') target = value.build;
  });
  let gone = false;
  owner.interval(TICK_MS, () => {
    if (gone || target === null || owner.disposed || document.visibilityState !== 'visible') return;
    if (Date.now() - input < HANDOVER_QUIET_MS || !onMain() || openOver()) return;
    gone = true;
    // no cover to paint first (leaveAfterPaint's reason): nobody tapped, the title simply comes back as the new build
    markReload(`${HANDOVER_REASON}: new build ${target.slice(0, 7)} activated behind it`);
    location.reload();
  });
}
