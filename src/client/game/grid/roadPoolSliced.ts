/**
 * meta DRIFTWOOD-FPS DW3 (mini-dw3, 2026-11-23): the road tile pools merge in slices after the handoff too. Once the road
 * is handed over, every tile publish or retirement re-merged its material's whole pool in one step and drew the new mesh
 * at once: on the iPhone 13 at phone Low (main 075d23671, DW1's route, cap 30) the plateau climb had four to five frames
 * of 51 to 72 ms, each a `grid.road tiles` / `game.grid.frame` update of 22 to 34 ms plus a 3.2 MB upload of the merged
 * deck. With the device slot `debug.roadPoolSliced` on, a pool stays deferred (RoadTilePool.slice): a publish or a
 * retirement only records its tile, the backing advances the merge in ROAD_MERGE_SLICE_MS slices a step, and the masks a
 * tile's parent receives meanwhile wait for the merge that holds the tile, so no quadrant shows a hole or a double while
 * the old draw stands. The road drawn after the merge is the same; a tile change shows a few frames later.
 */
import { jsonSlot } from '@wildshard/engine/saves/slots';
import { TIER } from '@wildshard/engine/core/tier';
import { graphicsMode } from '@wildshard/engine/core/graphicsMode';

export const ROAD_POOL_SLICED_SLOT = 'debug.roadPoolSliced';
export const ROAD_POOL_SLICED_DEFAULT = false;
/** Unset at phone Low: off until cooled iPhone 13 pairs decide (DW3). */
export const ROAD_POOL_SLICED_PHONE_LOW = false;

/** The slot's value: a boolean wins; unset, ROAD_POOL_SLICED_PHONE_LOW at phone Low, else ROAD_POOL_SLICED_DEFAULT. */
export function roadPoolSliced(saved: unknown, phoneLow = false): boolean {
  if (typeof saved === 'boolean') return saved;
  return phoneLow ? ROAD_POOL_SLICED_PHONE_LOW : ROAD_POOL_SLICED_DEFAULT;
}
let picked: boolean | undefined;
/** Whether the road pools merge in slices after the handoff; read once per page. */
export function roadPoolSlicedOn(): boolean {
  if (picked !== undefined) return picked;
  let saved: unknown = null, phoneLow = false;
  try { saved = jsonSlot(ROAD_POOL_SLICED_SLOT, 'device').read(); } catch { /* storage blocked: the default */ }
  try { phoneLow = TIER === 'phone' && graphicsMode() === 'low'; } catch { /* no settings: not phone Low */ }
  picked = roadPoolSliced(saved, phoneLow);
  return picked;
}
