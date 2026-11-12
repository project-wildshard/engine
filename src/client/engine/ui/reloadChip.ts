import type { Scope } from '../../../shared/engine/app/scope';
import { listenTap } from '../input/dom';

/** The touch Rounds chip's press (TE-ENG2's RELOAD chip, docked in the touch layer by HUD.mountBar).
 *  TE-ENG5: the touch layer cancels its own touchstart / touchend (TouchControls, E46), so a tap on the chip never
 *  becomes a click; the press answers the pointer's release instead, as the layer's pills do. A keyboard click still
 *  presses, and the click that may follow an answered tap does not press twice (listenTap). A release only presses
 *  when the same pointer went down on the chip and lifts over it: a press that began elsewhere, or a thumb that went
 *  down on the chip and dragged off it (a touch keeps its implicit capture on the chip), is not a tap. */
export function listenReloadChip(scope: Scope, chip: HTMLButtonElement, press: () => void): void {
  let down: number | undefined;
  // Keep chip gestures out of the look/fire layer. The input service owns the same reload action as desktop R.
  scope.listen(chip, 'pointerdown', (event) => { event.stopPropagation(); down = event.pointerId; });
  scope.listen(chip, 'pointercancel', () => { down = undefined; });
  // registered before listenTap's, so a release that is no tap never reaches it
  scope.listen(chip, 'pointerup', (event) => {
    const r = chip.getBoundingClientRect();
    const over = event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
    const tap = down === event.pointerId && over;
    down = undefined;
    if (!tap) event.stopImmediatePropagation();
  });
  listenTap(scope, chip, press);
}
