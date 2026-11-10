import { diagnosticNow } from '../../../shared/engine/core/clock';
import { engineString } from '../../../shared/engine/strings';
import { leaveSaved, markReload } from '../boot/lastEnd';
import { RELOAD_FALLBACK_MS, reloadingLine, reloadingShown, showReloading } from './reloadCover';
import { leaveAfterPaint } from '../boot/leaveAfterPaint';

/**
 * A reload the player asked for, from any control that offers one: the build pill (src/client/engine/ui/Update.ts) and
 * Settings ▸ Build (src/client/engine/ui/buildRow.ts). Jake, 2026-11-09: "It's just a browser page F5."
 *
 *   reloadForPlayer(button, { newer })   // the tap handler's first line
 *
 * RL3: the tap's own turn turns the control into a loading button and puts the full-page RELOADING cover up
 * (src/client/engine/ui/reloadCover.ts), before the save, the worker or anything else is awaited. The cover stays until
 * the page unloads. RL2: on the title it loads a fresh `/`, anywhere else the page reloads where it is.
 * QC3: a waiting worker is activated first (SKIP_WAITING, then its `activated` state) so the next document is the new
 * build's. RL5: that hand-over gets RELOAD_FALLBACK_MS from the tap; past it the page reloads hard and the cover says so.
 * Nothing to adopt (no worker, or it retired) is a plain reload. Every path ends in a navigation, one painted frame after
 * the cover (leaveAfterPaint).
 */

/** The title (or its menus) is up: the reload lands on a fresh `/` rather than where the page is. */
export function titleShowing(): boolean {
  return document.querySelector('#hud.intro .ws-menu:not(.hide), #hud.intro .ws-main:not(.hide)') !== null;
}

/** `why`: what the next boot records (src/client/engine/boot/lastEnd.ts), on the title and anywhere else. */
export function reloadForPlayer(control: HTMLElement | null, { newer = false, why = ['update at title', 'update tapped'] }: { newer?: boolean; why?: readonly [title: string, here: string] } = {}): void {
  if (reloadingShown()) return; // a reload is already under way: a second control's tap starts no second one
  const tapped = diagnosticNow();
  showReloading(control, newer ? engineString('s_reloading_update') : '');
  const title = titleShowing(), sw = window.__ws_sw;
  const reason = title ? why[0] : why[1];
  let gone = false;
  const plain = (): void => {
    if (gone) return;
    gone = true;
    leaveAfterPaint(() => {
      markReload(reason);
      if (title) location.replace('/');
      else location.reload();
    });
  };
  if (sw === undefined) { leaveSaved(plain); return; }
  leaveSaved(() => {
    // the budget runs from the tap: a save that took time leaves the hand-over only what is left of RELOAD_FALLBACK_MS
    const left = Math.round(RELOAD_FALLBACK_MS - (diagnosticNow() - tapped));
    // the hand-over ran out of time (not merely "nothing to adopt"): say so, in amber, on the way out
    const hard = (): void => { if (diagnosticNow() - tapped >= RELOAD_FALLBACK_MS - 50) reloadingLine(engineString('s_reloading_slow'), 'slow'); plain(); };
    if (left <= 0) { hard(); return; }
    void sw.adopt(title ? '/' : undefined, reason, left)
      .then(sent => { if (sent) gone = true; else hard(); return undefined; }, hard);
  });
}
