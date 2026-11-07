import type { Collider } from '@dimforge/rapier3d-simd';
import type { Scope } from '../app/scope';
import { withOwner } from '../app/ownership';
import type { StripMesh } from '../sim/strips';
import type { Physics } from './Physics';
import { groups } from './groups';
import { tagCollider } from './surface';
/** Platform geometry is tagged separately so regional state hashes can omit shared deck and seam duplicates. */
export const PLATFORM_COLLIDER_OWNER = 'platform.grid';
/** The strip's collider, which the caller's owner holds. */
export function stripCollider(physics: Physics, mesh: Pick<StripMesh, 'origin' | 'positions' | 'indices'>): Collider {
  const collider = physics.world.createCollider(physics.R.ColliderDesc.trimesh(mesh.positions, mesh.indices, physics.R.TriMeshFlags.FIX_INTERNAL_EDGES)
    .setTranslation(mesh.origin.x, 0, mesh.origin.z).setCollisionGroups(groups('WORLD')));
  tagCollider(collider, 'stone', PLATFORM_COLLIDER_OWNER);
  return collider;
}
/** Install the generated field itself as the WORLD collider; the renderer draws these same vertices. */
export function installStripCollider(physics: Physics, mesh: Pick<StripMesh, 'origin' | 'positions' | 'indices'>, scope: Scope): void {
  if (scope.disposed) throw new Error('Cannot install a strip into a disposed scope');
  withOwner(scope, () => { stripCollider(physics, mesh); });
}
