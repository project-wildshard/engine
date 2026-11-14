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

/**
 * PZ24 (meta PAGE-SIZE): one upload of each road canvas that depends on the grain only (the asphalt and the junction), shared
 * by every build of one road system: A1's ring-first halves painted and uploaded both twice, 8.4 MB of the iPhone profile's
 * GPU texture on Driftwood. Each user takes a count; the last release disposes the texture, so a half retired before the
 * other never pulls the map from under it.
 */
export class RoadMapShare {
  private readonly held = new Map<string, { readonly texture: Texture; users: number }>();
  /** a held map for `id`, counted for the caller, or undefined (paint it, then `hold` it) */
  take(id: string): Texture | undefined {
    const row = this.held.get(id); if (row === undefined) return undefined;
    row.users++; return row.texture;
  }
  has(id: string): boolean { return this.held.has(id); }
  /** the first user's freshly painted map, counted for it */
  hold(id: string, texture: Texture): void { if (!this.held.has(id)) this.held.set(id, { texture, users: 1 }); }
  release(id: string, texture: Texture): void {
    const row = this.held.get(id);
    if (row?.texture !== texture) { texture.dispose(); return; }
    if (--row.users > 0) return;
    this.held.delete(id); texture.dispose();
  }
}
