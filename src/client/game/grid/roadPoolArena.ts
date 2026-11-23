/**
 * meta DRIFTWOOD-FPS DW3 (mini-dw3, 2026-11-23): the road tile pools merge into two reused arenas. Every merge of a
 * material's pool allocated new arrays for every attribute and the merged index (the culler's source); the attribute
 * copies went GPU-only at their upload (gpuOnlyRoad), so each was garbage a frame later. On desktop WebKit, DW1's route
 * allocated 1.4 GB of typed arrays, 0.48 GB of them these merged arrays (route-bench --leg-alloc on main d22d0fcfd), and on
 * the iPhone 13 JSC runs a 75 to 176 ms full collection every ~23 s, each a frame over 50 ms. With the device slot
 * `debug.roadPoolArena` on, a pool merges into whichever of its two RoadTileArenas the drawn mesh does not use, so the
 * merge reuses the arrays two merges back instead of allocating; the arrays grow by doubling. The road drawn is the same.
 */
import { jsonSlot } from '@wildshard/engine/saves/slots';
import { TIER } from '@wildshard/engine/core/tier';
import { graphicsMode } from '@wildshard/engine/core/graphicsMode';

export const ROAD_POOL_ARENA_SLOT = 'debug.roadPoolArena';
export const ROAD_POOL_ARENA_DEFAULT = false;
/** Unset at phone Low: off until cooled iPhone 13 pairs decide (DW3). */
export const ROAD_POOL_ARENA_PHONE_LOW = false;

/** The slot's value: a boolean wins; unset, ROAD_POOL_ARENA_PHONE_LOW at phone Low, else ROAD_POOL_ARENA_DEFAULT. */
export function roadPoolArena(saved: unknown, phoneLow = false): boolean {
  if (typeof saved === 'boolean') return saved;
  return phoneLow ? ROAD_POOL_ARENA_PHONE_LOW : ROAD_POOL_ARENA_DEFAULT;
}
let picked: boolean | undefined;
/** Whether the road pools merge into reused arenas; read once per page. */
export function roadPoolArenaOn(): boolean {
  if (picked !== undefined) return picked;
  let saved: unknown = null, phoneLow = false;
  try { saved = jsonSlot(ROAD_POOL_ARENA_SLOT, 'device').read(); } catch { /* storage blocked: the default */ }
  try { phoneLow = TIER === 'phone' && graphicsMode() === 'low'; } catch { /* no settings: not phone Low */ }
  picked = roadPoolArena(saved, phoneLow);
  return picked;
}
