import { Scope } from '../../../shared/engine/app/scope';

// This page-lifetime gate runs before dynamic engine imports and their download retries.
const scope = new Scope('ui.RotateGate');

/**
 * Rotate gate (E38): Wildshard is portrait-only on phones. The page itself is index.html's `.ws-rotate`, shown by a
 * media query in src/client/engine/ui/styles/rotate.css the instant the device turns (no JS needed to paint it); this module does
 * the rest while it is up:
 *
 *   - swallows input: every press / key / wheel that starts behind the page is stopped at the window, capture phase
 *     (releases — pointerup / pointercancel / keyup — still go through, so nothing is left held down);
 *   - pauses a running game: `ws:background` (HUD: pause into the menu if riding, never unpause), so turning back to
 *     portrait lands on the pause menu, not mid-fight;
 *   - `rotateGated()` — main.ts adds it to the frame gate, so the world neither ticks nor renders behind the page.
 *
 * Keyed on `(pointer: coarse)`, never on the ?touch flag: a desktop is landscape by nature, `?touch` on one is not
 * gated. `min-aspect-ratio: 5/4` keeps a portrait phone whose soft keyboard squashed the viewport (the review
 * composer) from counting as landscape.
 */

/** must match the @media rule in rotate.css */
const QUERY = '(orientation: landscape) and (pointer: coarse) and (min-aspect-ratio: 5/4)';
const mq = matchMedia(QUERY);

/** true while the rotate page covers the game */
export const rotateGated = (): boolean => mq.matches;

scope.listen(mq, 'change', () => {
  if (mq.matches) document.dispatchEvent(new Event('ws:background'));
});

const swallow = (e: Event): void => {
  if (!mq.matches) return;
  e.stopImmediatePropagation();
  if (e.cancelable) e.preventDefault();
};
for (const type of ['pointerdown', 'mousedown', 'touchstart', 'click', 'dblclick', 'contextmenu', 'keydown', 'wheel']) {
  scope.listen(window, type, swallow, { capture: true, passive: false });
}
