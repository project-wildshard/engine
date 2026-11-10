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
 *   - no menu or overlay is up over the world (bag, journal, map, the feedback composer: app.ui.blocking).
 *   - the mouse is in the page. A reload from the toolbar, the tab strip or the menu bar needs the pointer outside it,
 *     and the page can't tell that reload from a close: with the pointer out, it doesn't ask. A pointer-locked player
 *     reaches the browser's chrome only through Esc, which pauses. So the guard covers the keyboard slip Jake made.
 *   - nothing is leaving on purpose. `markUnload` / `markReload` precede every navigation the game makes (shard travel,
 *     graphics recovery, the reload pill, error-modal reloads, a stale build), and ⌘R / Ctrl+R / F5 count as the
 *     player's own reload. RL6 (Jake: "i sometimes see confirm reload") stays true: a reload the player asks for never
 *     prompts.
 */
const IN_WORLD: ReadonlySet<AppState> = new Set<AppState>(['play', 'dead', 'practice', 'playground']);
/** The player is in the world with nothing over it: the leave guard arms, and InputService takes the game's keys (KP3). */
export function inWorld(): boolean { return IN_WORLD.has(app.state) && !app.ui.blocking; }
/** A physical key on a hardware keyboard, typed into the page itself: a phone's soft keyboard types into a field, composes,
 *  or reports no code (Android's 229s), and none of those count. */
export function physicalKey(event: KeyboardEvent): boolean {
  const target = event.target;
  return event.code !== '' && !event.isComposing && !(target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)));
}

/** ⌘R, Ctrl+R (with or without Shift) and F5: the browser's reload keys, which a page sees before the browser acts */
export function isReloadKey(event: KeyboardEvent): boolean {
  return event.code === 'F5' || ((event.metaKey || event.ctrlKey) && event.code === 'KeyR');
}

// page-wide: a level swapped in place (E155) keeps what this page has already seen
let keyboard = false, reloadKeyAt = Number.NEGATIVE_INFINITY, pointerOut = false;
export interface LeaveGuard { armed: () => boolean }
/** `trusted`: tests pass `() => true`; a page counts only the browser's own key events */
export function installLeaveGuard(scope: Scope, trusted: (event: Event) => boolean = (event) => event.isTrusted): LeaveGuard {
  listenPage(scope, 'keydown', (event) => {
    if (isReloadKey(event)) reloadKeyAt = Date.now();
    if (trusted(event) && physicalKey(event)) keyboard = true;
  }, { capture: true });
  // the pointer left the page (toward the toolbar, the tab strip, the menu bar) or came back
  scope.listen(document, 'mouseout', (event) => { if (event instanceof MouseEvent && event.relatedTarget === null) pointerOut = true; });
  scope.listen(document, 'mouseover', () => { pointerOut = false; });
  const armed = (): boolean => keyboard && !pointerOut && inWorld() && !leavingOnPurpose() && Date.now() - reloadKeyAt > LEAVE_INTENT_MS;
  scope.listen(window, 'beforeunload', (event) => {
    if (!armed()) return;
    // KP4: the one sanctioned leave prompt. A cancelled beforeunload asks (Chrome 119+, Safari, Firefox); the browser
    // writes the words ("Leave site?"), a page's own text has been ignored since 2016
    event.preventDefault();
  });
  return { armed };
}
