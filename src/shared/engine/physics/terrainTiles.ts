import type { Collider } from '@dimforge/rapier3d-simd';
import type { Scope } from '../app/scope';
import { withOwner } from '../app/ownership';
import { decodeTerrainTile } from '@wildshard/format/terrainTileBytes';
import type { Physics } from './Physics';
import { groups } from './groups';
import { tagCollider } from './surface';

/** Install the baked critical heightfield in the local physics world; the owning scope removes it on unload. */
export function addBakedTerrainCollider(physics: Physics, bytes: Uint8Array, scope: Scope): Collider {
  const data = decodeTerrainTile(bytes), r = data.resolution;
  if (data.colours !== undefined) throw new Error('Collider terrain must contain heights only');
  const heights = new Float32Array(r * r);
  for (let z = 0; z < r; z++) for (let x = 0; x < r; x++) heights[x * r + z] = data.heights[z * r + x] ?? 0;
  const collider = withOwner(scope, () => physics.world.createCollider(physics.R.ColliderDesc.heightfield(r - 1, r - 1, heights, { x: data.size, y: 1, z: data.size })
    .setTranslation(data.x + data.size / 2, 0, data.z + data.size / 2).setCollisionGroups(groups('WORLD')).setFriction(0.9)));
  tagCollider(collider, 'ground');
  // Physics already owns the scoped handle and forgets its capture before freeing a replaced world.
  return collider;
}
