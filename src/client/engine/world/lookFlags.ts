/**
 * The look loop's layers (PINE-HOLLOW PH-L1 / L4 / L8, the user's picks PH-U34; the before-the-loop grade and ground
 * went in E162): a shard's look-loop grade over its own, and its boreal ground.
 *
 *   const g = groundSet(def);                   // Terrain.build, the boot manifest
 */
import type { LevelAssets, RGB } from '../../../shared/engine/level/data';

/** the ground layers the terrain loads, with the boreal set (canopy litter, moss, tiling breakup) when the shard has one */
export function groundSet(def: { assets?: LevelAssets | undefined }): { layers: readonly string[]; tints: readonly RGB[]; boreal: { normalK: readonly number[]; trailDust: readonly number[]; grassTint: readonly number[] } | null } {
  const a = def.assets;
  if (!a) return { layers: [], tints: [], boreal: null }; // no PBR ground (Driftwood)
  const b = a.boreal;
  return { layers: a.groundLayers, tints: a.groundTints, boreal: b ? { normalK: b.normalK, trailDust: b.trailDust, grassTint: b.grassTint } : null };
}
