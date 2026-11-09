import { app } from '../app/runtime';
import type { Scope } from '../../../shared/engine/app/scope';
import type { AppState } from '../app/systems';
import { LEAVE_INTENT_MS, leavingOnPurpose } from '../boot/lastEnd';
import { listenPage } from '../input/dom';
/**
 * KP4, the leave guard (Jake 2026-11-09, on his Mac: "I intuitively press Command [and Cmd+W] fucking close it to tab ...
 * you can't have a closed tab. You gotta intercept that"; then "show 'leave the game' and confirm for command W. Same for
 * command T, command N, command Q").
 *
 * The browser keeps ⌘W, ⌘Q and Ctrl+W for itself, and the page never sees them (Chrome's IsReservedCommandOrKey). What
 * a page can do is ask: a cancelled `beforeunload` makes the browser put up its own "Leave site?" dialog. The browser
 * picks the words, and only shows it once the page has had a gesture. So while the player is in the world, closing the
 * tab or quitting asks first. ⌘T and ⌘N unload nothing: the tab hides or the window blurs, and the HUD pauses into the
 * menu (HUD.ts).
 *
 * Armed only while all three hold:
 *   - app state is in the world (play, dead, a practice room). Title, loading, pause and error menus never ask.
 *   - this page has seen a real keyboard key. A touch-only phone never arms it; iOS Safari ignores the dialog anyway.
 *   - nothing is leaving on purpose. `markUnload` / `markReload` precede every navigation the game makes (shard travel,
 *     graphics recovery, the reload pill, error-modal reloads, a stale build), and ⌘R / Ctrl+R / F5 count as the
 *     player's own reload. RL6 (Jake: "i sometimes see confirm reload") stays true: a reload the player asks for never
 *     prompts.
 */
const IN_WORLD: ReadonlySet<AppState> = new Set<AppState>(['play', 'dead', 'practice', 'playground']);

/** ⌘R, Ctrl+R (with or without Shift) and F5: the browser's reload keys, which a page sees before the browser acts */
export function isReloadKey(event: KeyboardEvent): boolean {
  return event.code === 'F5' || ((event.metaKey || event.ctrlKey) && event.code === 'KeyR');
}

// page-wide: a level swapped in place (E155) keeps what this page has already seen
let keyboard = false, reloadKeyAt = Number.NEGATIVE_INFINITY;
export interface LeaveGuard { armed: () => boolean }
export function installLeaveGuard(scope: Scope): LeaveGuard {
  listenPage(scope, 'keydown', (event) => {
    keyboard = true;
    if (isReloadKey(event)) reloadKeyAt = Date.now();
  }, { capture: true });
  const armed = (): boolean => keyboard && IN_WORLD.has(app.state) && !leavingOnPurpose() && Date.now() - reloadKeyAt > LEAVE_INTENT_MS;
  scope.listen(window, 'beforeunload', (event) => {
    if (!armed()) return;
    // KP4: the one sanctioned leave prompt. A cancelled beforeunload asks (Chrome 119+, Safari, Firefox); the browser
    // writes the words ("Leave site?"), a page's own text has been ignored since 2016
    event.preventDefault();
  });
  return { armed };
}
