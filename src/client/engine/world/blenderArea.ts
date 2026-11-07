/**
 * The part of a level the Blender-built terrain covers (E52; per level since PH-0.3). A level declares it in its
 * manifest's `blender.area`, in world metres; the Blender pipeline (`scripts/blender/lib/export-scene.mjs --chunk <id>`)
 * and the level's own loader read the same rectangle, so both clip at exactly the same lines.
 *
 * The edges sit on the procedural terrain's own grid lines (TERRAIN_RES² over CHUNK_SIZE), so the procedural mesh loses
 * whole cells and the Blender terrain — sampled from the same heights along those lines — meets it without a seam.
 * The Blender grid is twice as fine (STEP = half a procedural cell).
 */
import { CHUNK_SIZE, TERRAIN_RES } from '../../../shared/engine/core/config';

/** one procedural terrain cell, metres */
export const CELL: number = CHUNK_SIZE / (TERRAIN_RES - 1);
/** the Blender terrain's grid step, metres */
export const STEP: number = CELL / 2;

/** a level's Blender area: world bounds in metres */
export interface BlenderArea { x0: number; x1: number; z0: number; z1: number }

/** a level's Blender area in world metres; null when it has none */
export function blenderAreaFor(level: { blender?: { area: BlenderArea } }): BlenderArea | null {
  return level.blender?.area ?? null;
}
