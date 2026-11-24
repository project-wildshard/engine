/**
 * meta DRIFTWOOD-FPS DF8 / IPHONE13-DRIFTWOOD DW3 (mini-driftwood13m, 2026-11-20): the road's whole-mesh to tile handoff,
 * paced. About 20 s after control at Driftwood's dock the road tile ring is ready, and the backing (roadTileBacking.ts)
 * revealed every material's tile pool and retired every whole road mesh in one step: on the iPhone 13 a 32 ms
 * `grid.road tiles` lap in the grid's late step, a 32 ms render, then about 170 ms with the main thread held and no
 * callback running (a 245 ms frame). With the device slot `debug.roadHandoffPaced` on, the handoff takes one material a
 * step: its pool shows, then its whole mesh retires. What is drawn before and after is unchanged.
 * mini-driftwood13n: the dock's 31 to 35 ms `grid.road tiles` laps were the stream's publishes re-merging each hidden pool
 * (two a step); paced, the hidden pools only record their tiles and merge once, in slices, at the handoff (RoadTilePool.settle).
 */
import { jsonSlot } from '@wildshard/engine/saves/slots';
import { TIER } from '@wildshard/engine/core/tier';

export const ROAD_HANDOFF_PACED_SLOT = 'debug.roadHandoffPaced';
export const ROAD_HANDOFF_PACED_DEFAULT = false;
/** Unset at phone Low: on (mini-driftwood13n, 2026-11-20). With the hidden pools merging once (engine 9e587428f), three
 *  cooled iPhone 13 dock pairs had no road lap over 18 ms on (off: 9 to 28 ms laps) and 3/3/3 frames over 50 ms against
 *  6/3/3 (meta project/evidence/driftwood-fps/df8-road-pools-2026-11-20.md). */
export const ROAD_HANDOFF_PACED_PHONE_LOW = true;

/** The slot's value: a boolean wins; unset, ROAD_HANDOFF_PACED_PHONE_LOW at phone Low, else ROAD_HANDOFF_PACED_DEFAULT. */
export function roadHandoffPaced(saved: unknown, phoneLow = false): boolean {
  if (typeof saved === 'boolean') return saved;
  return phoneLow ? ROAD_HANDOFF_PACED_PHONE_LOW : ROAD_HANDOFF_PACED_DEFAULT;
}
let picked: boolean | undefined;
/** Whether the road handoff is paced; read once per page. */
export function roadHandoffPacedOn(): boolean {
  if (picked !== undefined) return picked;
  let saved: unknown = null, phoneLow = false;
  try { saved = jsonSlot(ROAD_HANDOFF_PACED_SLOT, 'device').read(); } catch { /* storage blocked: the default */ }
  phoneLow = TIER === 'phone'; // QA 11-24 row 31: every phone, Low or High (nothing drawn changes)
  picked = roadHandoffPaced(saved, phoneLow);
  return picked;
}
