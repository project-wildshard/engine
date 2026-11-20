/**
 * meta DRIFTWOOD-FPS DF8 / IPHONE13-DRIFTWOOD DW3 (mini-driftwood13m, 2026-11-20): the road's whole-mesh to tile handoff,
 * paced. About 20 s after control at Driftwood's dock the road tile ring is ready, and the backing (roadTileBacking.ts)
 * revealed every material's tile pool and retired every whole road mesh in one step: on the iPhone 13 a 32 ms
 * `grid.road tiles` lap in the grid's late step, a 32 ms render, then about 170 ms with the main thread held and no
 * callback running (a 245 ms frame). With the device slot `debug.roadHandoffPaced` on, the handoff takes one material a
 * step: its pool shows, then its whole mesh retires. What is drawn before and after is unchanged.
 */
import { jsonSlot } from '@wildshard/engine/saves/slots';
import { TIER } from '@wildshard/engine/core/tier';
import { graphicsMode } from '@wildshard/engine/core/graphicsMode';

export const ROAD_HANDOFF_PACED_SLOT = 'debug.roadHandoffPaced';
export const ROAD_HANDOFF_PACED_DEFAULT = false;
/** Unset at phone Low: off until cooled iPhone 13 pairs decide. */
export const ROAD_HANDOFF_PACED_PHONE_LOW = false;

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
  try { phoneLow = TIER === 'phone' && graphicsMode() === 'low'; } catch { /* no settings: not phone Low */ }
  picked = roadHandoffPaced(saved, phoneLow);
  return picked;
}
