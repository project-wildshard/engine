import type { Scope } from '../../../shared/engine/app/scope';
import type { Events } from '../../../shared/engine/events/events';
import { isDev, onDev } from '../core/devMode';

// QA row 42 (Jake, 2026-11-10): "Let's get rid of the boost button. Let's make boost be like an undocumented double tap on the
// hoverboard … when you double tap hoverboard, it changes color and makes it really obvious we're in boost mode. When you
// double tap it again, it turns boost off. When you hit it once, you get on the hoverboard, you get off the hoverboard."
//
// A tap acts at once, exactly as before: nothing waits to see whether a second tap follows, so a single tap has no added lag.
// A second tap inside BOOST_TAP_MS is the double tap: it toggles boost and leaves the rider on the board. Riding, the first
// tap has already stepped off, so the second steps back on (a ~0.3 s dip the board's 0.25 s fade mostly hides); standing, the
// first stepped on, so the second leaves the board alone. Boost stays Developer-only (the motion law fences it with isDev,
// the server with allowDeveloperBoost): with Developer mode off a second tap is an ordinary tap. The H key and the HOVER tab
// are the one `hover` action, so the keyboard double-taps the same way.

/** A second tap this soon after the first is a double tap. 300 ms: a deliberate double tap lands in 150-250 ms; two single
 *  taps (on, then off) are seldom closer. */
export const BOOST_TAP_MS = 300;

/** The last unpaired tap: when, and whether the rider was on the board before it. */
export interface HoverTaps { at: number; wasOn: boolean }
export const hoverTaps = (): HoverTaps => ({ at: Number.NEGATIVE_INFINITY, wasOn: false });

/** What one tap does: toggle the board, toggle boost. */
export interface HoverTapAct { readonly hover: boolean; readonly boost: boolean }

/** One tap of HOVER at `now` (ms). A first tap toggles the board; a second within BOOST_TAP_MS (Developer mode only) toggles
 *  boost and undoes a first tap that stepped off. A third tap starts a new pair. */
export function hoverTap(taps: HoverTaps, now: number, riding: boolean, boostAllowed: boolean): HoverTapAct {
  const gap = now - taps.at;
  if (boostAllowed && gap >= 0 && gap <= BOOST_TAP_MS) {
    taps.at = Number.NEGATIVE_INFINITY;
    return { hover: taps.wasOn, boost: true };
  }
  taps.at = now; taps.wasOn = riding;
  return { hover: true, boost: false };
}

/** The player as a HOVER tap sees it. */
export interface HoverPort { readonly hover: boolean; readonly hoverBoost: boolean; setHover: (on: boolean) => void; setBoost: (on: boolean) => void }

/** The `hover` action (H, the HOVER tab): a tap, through `hoverTap`. Toggles read the player live, so an online page whose
 *  first toggle has not been stepped yet cancels it rather than doubling it. */
export function pressHover(player: HoverPort, taps: HoverTaps, now: number): void {
  const act = hoverTap(taps, now, player.hover, isDev());
  if (act.hover) player.setHover(!player.hover);
  if (act.boost) player.setBoost(!player.hoverBoost);
}

/** Boost shows while it moves the board: Developer mode, riding, latched. */
export const boostShown = (player: Pick<HoverPort, 'hover' | 'hoverBoost'>): boolean => isDev() && player.hover && player.hoverBoost;

/** The HOVER tab turns amber (`.boost`) while boost is shown. */
export function mountBoostLook(button: HTMLElement, player: Pick<HoverPort, 'hover' | 'hoverBoost'>, events: Events, scope: Scope): void {
  const sync = (): void => { button.classList.toggle('boost', boostShown(player)); };
  events.on('player.hover', sync, scope);
  events.on('player.boost', sync, scope);
  scope.onDispose(onDev(sync));
  scope.onDispose(() => { button.classList.remove('boost'); });
  sync();
}
