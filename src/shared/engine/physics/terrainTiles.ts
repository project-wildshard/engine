import type { Collider } from '@dimforge/rapier3d-simd';
import type { Scope } from '../app/scope';
import { withOwner } from '../app/ownership';
import { decodeTerrainTile, type TerrainTileData } from '@wildshard/format/terrainTileBytes';
import type { Physics } from './Physics';
import { groups } from './groups';
import { isTerrainCollider, tagCollider } from './surface';

/** Install the baked critical heightfield in the local physics world; the owning scope removes it on unload. */
export function addBakedTerrainCollider(physics: Physics, bytes: Uint8Array, scope: Scope): Collider {
  const data = decodeTerrainTile(bytes);
  if (data.colours !== undefined) throw new Error('Collider terrain must contain heights only');
  return addTerrainTileCollider(physics, data, scope);
}

/** A heights lattice (row-major, as the wire carries it) as the world's ground heightfield, owned by `scope`. */
export function addTerrainTileCollider(physics: Physics, data: Pick<TerrainTileData, 'resolution' | 'x' | 'z' | 'size' | 'heights'>, scope: Scope): Collider {
  const r = data.resolution, heights = new Float32Array(r * r);
  for (let z = 0; z < r; z++) for (let x = 0; x < r; x++) heights[x * r + z] = data.heights[z * r + x] ?? 0;
  const collider = withOwner(scope, () => physics.world.createCollider(physics.R.ColliderDesc.heightfield(r - 1, r - 1, heights, { x: data.size, y: 1, z: data.size })
    .setTranslation(data.x + data.size / 2, 0, data.z + data.size / 2).setCollisionGroups(groups('WORLD')).setFriction(0.9)));
  tagCollider(collider, 'ground');
  // Physics already owns the scoped handle and forgets its capture before freeing a replaced world.
  return collider;
}

/**
 * SHARD-SOURCE AP18 (DEVSERVER): `wildshard watch`'s new ground. The lattice goes in as the world's heightfield under
 * `scope`, then every other terrain heightfield leaves the world (the boot's, or the last swap's). Returns how many went.
 */
export function swapTerrainCollider(physics: Physics, data: Pick<TerrainTileData, 'resolution' | 'x' | 'z' | 'size' | 'heights'>, scope: Scope): number {
  const fresh = addTerrainTileCollider(physics, data, scope), old: Collider[] = [];
  physics.world.forEachCollider(collider => { if (collider !== fresh && isTerrainCollider(collider)) old.push(collider); });
  for (const collider of old) physics.world.removeCollider(collider, true);
  return old.length;
}
