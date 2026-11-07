import type { Mesh, Texture } from 'three';
import type { LookScope } from '../../../shared/game/grid/roadLayout';

/** Keep the original native resources, without retaining a road builder's
 * lexical environment and its whole-platform construction arrays. Pools share
 * these materials/textures; only the original allocation owns their disposal. */
export function ownRoadMesh(scope: LookScope, mesh: Mesh, textures: readonly Texture[]): void {
  for (const texture of textures) scope.onDispose(() => { texture.dispose(); });
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials) scope.onDispose(() => { material.dispose(); });
  // Read the current geometry: S3 replaces the whole-road buffer with an empty
  // parent after the tile ring is ready, and disposes that original immediately.
  scope.onDispose(() => { mesh.geometry.dispose(); });
  scope.onDispose(() => { mesh.removeFromParent(); });
}
