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

export const WARM_PACE_SLOT = 'debug.warmPace';
export const WARM_PACE_DEFAULT = false;
/** Unset at phone Low: on (DF10, mini-df10b: iPhone 13 route draws p95 about 93 -> 79, a matched 35 °C pair held its frames, the blind board passed). */
export const WARM_PACE_PHONE_LOW = true;
/** frames drawn every frame after the hand fills, before the pace starts */
export const WARM_SETTLE = 900;
/** once settled, the body draws one frame in this many */
export const WARM_EVERY = 30;

/** The slot's value: a boolean wins; unset, WARM_PACE_PHONE_LOW at phone Low, else WARM_PACE_DEFAULT. */
export function warmPace(saved: unknown, phoneLow = false): boolean {
  if (typeof saved === 'boolean') return saved;
  return phoneLow ? WARM_PACE_PHONE_LOW : WARM_PACE_DEFAULT;
}
/**
 * DF10 (mini-df10c): the settle ends WARM_AFTER frames after the road warm-up the filled body asked for has finished,
 * instead of after WARM_SETTLE frames. The dock (the boot's first 15 s) drew the body's 7 draws in 92% of its frames.
 * Device slot `debug.warmSettle` (unset: WARM_SETTLE_PHONE_LOW at phone Low).
 */
export const WARM_SETTLE_SLOT = 'debug.warmSettle';
export const WARM_SETTLE_DEFAULT = false;
/** Unset at phone Low: on (DF10, mini-df10d: decided with `debug.coveBatch` by one cooled iPhone 13 pair). */
export const WARM_SETTLE_PHONE_LOW = true;
/** frames drawn every frame after the road warm-up finishes, before the pace starts (the slot on) */
export const WARM_AFTER = 60;
/** The slot's value: a boolean wins; unset, WARM_SETTLE_PHONE_LOW at phone Low, else WARM_SETTLE_DEFAULT. */
export function warmSettle(saved: unknown, phoneLow = false): boolean {
  if (typeof saved === 'boolean') return saved;
  return phoneLow ? WARM_SETTLE_PHONE_LOW : WARM_SETTLE_DEFAULT;
}
/** Whether this page ends its warm body's settle on the road warm-up (read once, when the body is made). */
export function warmSettleOn(): boolean {
  let saved: unknown = null, phoneLow = false;
  try { saved = jsonSlot(WARM_SETTLE_SLOT, 'device').read(); } catch { /* storage blocked: the default */ }
  phoneLow = TIER === 'phone'; // QA 11-24 row 31: every phone, Low or High (nothing drawn changes)
  return warmSettle(saved, phoneLow);
}
/** Whether this page paces its warm body (read once, when the body is made). */
export function warmPaceOn(): boolean {
  let saved: unknown = null, phoneLow = false;
  try { saved = jsonSlot(WARM_PACE_SLOT, 'device').read(); } catch { /* storage blocked: the default */ }
  phoneLow = TIER === 'phone'; // QA 11-24 row 31: every phone, Low or High (nothing drawn changes)
  return warmPace(saved, phoneLow);
}
/** Whether the warm body draws on this frame: `since` frames after its hand filled (-1: not yet filled). `settle`: the frames
 *  it draws every frame before the pace (WARM_SETTLE, or with `debug.warmSettle` the frames until its road warm-up is done
 *  plus WARM_AFTER). */
export function warmDrawn(paced: boolean, since: number, settle: number = WARM_SETTLE): boolean {
  return !paced || since < settle || (since - settle) % WARM_EVERY === 0;
}
