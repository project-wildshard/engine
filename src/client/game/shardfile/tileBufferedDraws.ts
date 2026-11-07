import { type Group, Sphere, Vector3 } from 'three';
import type { SceneBuffers } from '@wildshard/format/sceneBuffers';
import { tilesTouching, type TileContent } from './tileContent';

/** Static buffered chunks follow the render ring using their authored culling
 * spheres, including every LOD band. Missing bounds or uncullable draws stay
 * whole. Geometry, materials and native LOD objects retain their original owner. */
export function tileBufferedDraws(id: string, root: Group, rows: SceneBuffers): TileContent | null {
  const originals = [...root.children], order = new Map(originals.map((node, index) => [node, index]));
  if (originals.length !== rows.draws.length) throw new Error('Buffered draw roster differs');
  const geometries = new Map(rows.geometries.map(row => [row.id, row]));
  const chunks = rows.draws.flatMap((row, index) => {
    const node = originals[index];
    if (node === undefined) throw new Error('Missing buffered draw object');
    const bands = row.levels === undefined ? [row.draw] : row.levels.map(level => level.draw);
    const bounds = new Sphere(); bounds.makeEmpty();
    for (const band of bands) {
      if (band === undefined) continue;
      const sphere = geometries.get(band.geometry)?.sphere;
      if (!band.frustum || sphere === undefined) return [];
      const local = new Sphere(new Vector3(sphere[0] + band.at[0] + row.at[0], sphere[1] + band.at[1] + row.at[1], sphere[2] + band.at[2] + row.at[2]), sphere[3]);
      bounds.union(local);
    }
    if (bounds.isEmpty()) return [];
    // The group matrix is cell-local, before the scene joins its regional root.
    // Plain meshes already include band.at in their node matrix; LOD roots do not.
    // Resolve both authored translations explicitly, then apply the group once.
    bounds.applyMatrix4(root.matrixWorld);
    const tiles = new Set(tilesTouching(bounds.center.x, bounds.center.z, bounds.radius));
    node.removeFromParent();
    return [{ node, tiles, attached: new Set<number>() }];
  });
  if (chunks.length === 0) return null;
  const tiles = new Set(chunks.flatMap(chunk => [...chunk.tiles]));
  return { id, tiles: () => tiles, attach: (tile, scope) => {
    if (scope.disposed || scope.disposing) return Promise.resolve();
    for (const chunk of chunks) {
      if (!chunk.tiles.has(tile) || chunk.attached.has(tile)) continue;
      chunk.attached.add(tile); root.add(chunk.node);
      scope.onDispose(() => {
        chunk.attached.delete(tile);
        if (chunk.attached.size === 0) chunk.node.removeFromParent();
      });
    }
    // Ring traversal and reattachment order never replace authored draw order.
    root.children.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    return Promise.resolve();
  } };
}
