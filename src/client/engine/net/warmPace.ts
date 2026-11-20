/**
 * meta DRIFTWOOD-FPS DF10 (mini-df10): the warm other-player body (NET-LAG NL4, otherPlayers.ts) drawn one frame in
 * WARM_EVERY once it has settled. It is drawn under the world every frame so a first other player never links its programs
 * in the frame it appears: 8 draws a frame across Driftwood's whole route at phone Low, with nobody else there. Drawn on a
 * pace, its programs still stay built and current (a lighting change relinks them on its next drawn frame, never on a
 * player's first). With the device slot `debug.warmPace` on (unset: WARM_PACE_PHONE_LOW at phone Low) the body draws every
 * frame for WARM_SETTLE frames after its kit's items fill its hand (the boot's and the road's warm-ups take it then), then
 * one frame in WARM_EVERY.
 */
import { jsonSlot } from '../saves/slots';
import { TIER } from '../core/tier';
import { graphicsMode } from '../core/graphicsMode';

export const WARM_PACE_SLOT = 'debug.warmPace';
export const WARM_PACE_DEFAULT = false;
/** Unset at phone Low: off until a cooled phone pair and the look board decide. */
export const WARM_PACE_PHONE_LOW = false;
/** frames drawn every frame after the hand fills, before the pace starts */
export const WARM_SETTLE = 900;
/** once settled, the body draws one frame in this many */
export const WARM_EVERY = 30;

/** The slot's value: a boolean wins; unset, WARM_PACE_PHONE_LOW at phone Low, else WARM_PACE_DEFAULT. */
export function warmPace(saved: unknown, phoneLow = false): boolean {
  if (typeof saved === 'boolean') return saved;
  return phoneLow ? WARM_PACE_PHONE_LOW : WARM_PACE_DEFAULT;
}
/** Whether this page paces its warm body (read once, when the body is made). */
export function warmPaceOn(): boolean {
  let saved: unknown = null, phoneLow = false;
  try { saved = jsonSlot(WARM_PACE_SLOT, 'device').read(); } catch { /* storage blocked: the default */ }
  try { phoneLow = TIER === 'phone' && graphicsMode() === 'low'; } catch { /* no settings: not phone Low */ }
  return warmPace(saved, phoneLow);
}
/** Whether the warm body draws on this frame: `since` frames after its hand filled (-1: not yet filled). */
export function warmDrawn(paced: boolean, since: number): boolean {
  return !paced || since < WARM_SETTLE || (since - WARM_SETTLE) % WARM_EVERY === 0;
}
