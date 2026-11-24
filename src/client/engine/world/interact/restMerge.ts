/**
 * meta DRIFTWOOD-FPS DF10 (mini-df10): the interactables' moving lit parts in the still merge while they rest. FC16 drew
 * every still lit copy as one mesh but kept each opening, turning or pushed part (chest lids, door panels, lever handles,
 * plates, barrels once moved) in its own geometry's mesh for good: 5 to 6 extra draws a frame across Driftwood's route at
 * phone Low. With the device slot `debug.litRestMerge` on (unset: LIT_REST_MERGE_PHONE_LOW at phone Low), those parts
 * start in the merge and leave it only while they move; REST_TICKS frames after their last move they rejoin it (one bake).
 * Glowing parts (their tint changes every frame) keep their own meshes, as before.
 */
import { jsonSlot } from '../../saves/slots';
import { TIER } from '../../core/tier';
import { graphicsMode } from '../../core/graphicsMode';

export const LIT_REST_MERGE_SLOT = 'debug.litRestMerge';
const coalescedStillSlot = jsonSlot('debug.interactStillCoalesce', 'device');

/** DW3: apply a tick's poses before publishing the lit still mesh. On at phone Low unless saved false (mini-dw3,
 *  2026-11-23: iPhone 13 pairs with the two road slots, the road crossing's frames over 50 ms 8 on against 12 off). */
export function coalescedStillBakesOn(): boolean {
  try { return TIER === 'phone' && coalescedStillSlot.read() !== false; }
  catch { return false; }
}
export const LIT_REST_MERGE_DEFAULT = false;
/** Unset at phone Low: on (DF10, mini-df10b: iPhone 13 route draws p95 about 93 -> 79, a matched 35 °C pair held its frames, the blind board passed). */
export const LIT_REST_MERGE_PHONE_LOW = true;
/** frames a moved part holds still before it rejoins the merge */
export const REST_TICKS = 45;

/** The slot's value: a boolean wins; unset, LIT_REST_MERGE_PHONE_LOW at phone Low, else LIT_REST_MERGE_DEFAULT. */
export function litRestMerge(saved: unknown, phoneLow = false): boolean {
  if (typeof saved === 'boolean') return saved;
  return phoneLow ? LIT_REST_MERGE_PHONE_LOW : LIT_REST_MERGE_DEFAULT;
}
/** Whether this page rests moved lit parts in the merge (read when a kit finishes). */
export function litRestMergeOn(): boolean {
  let saved: unknown = null, phoneLow = false;
  try { saved = jsonSlot(LIT_REST_MERGE_SLOT, 'device').read(); } catch { /* storage blocked: the default */ }
  try { phoneLow = TIER === 'phone' && graphicsMode() === 'low'; } catch { /* no settings: not phone Low */ }
  return litRestMerge(saved, phoneLow);
}
