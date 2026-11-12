import type { Scope } from '../../../shared/engine/app/scope';
import { listenTap } from '../input/dom';

/** The touch Rounds chip's press (TE-ENG2's RELOAD chip, docked in the touch layer by HUD.mountBar).
 *  TE-ENG5: the touch layer cancels its own touchstart / touchend (TouchControls, E46), so a tap on the chip never
 *  becomes a click; the press answers the pointer's release instead, as the layer's pills do. A keyboard click still
 *  presses, and the click that may follow an answered tap does not press twice (listenTap). */
export function listenReloadChip(scope: Scope, chip: HTMLButtonElement, press: () => void): void {
  // Keep chip gestures out of the look/fire layer. The input service owns the same reload action as desktop R.
  scope.listen(chip, 'pointerdown', (event) => { event.stopPropagation(); });
  listenTap(scope, chip, press);
}
