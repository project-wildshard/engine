import { BufferAttribute, BufferGeometry } from 'three';
import { buildFarProxy, edgeLeanDrop, type FarEdgeLean, type FarGrid, type FarLookRuntime, type FarLookSource, type FarPart, type FarProxyMesh } from '../../../shared/game/grid/farProxy';

/**
 * G348 (Jake: the near and far placeholders are generic for any shard the MMO loads): the one placeholder mesh the bakes
 * build, for the SDK build (`wildshard build`, `@wildshard/sharddev/bake/placeholders`) and the repo's bake runners alike.
 * A far proxy and a near placeholder are the same single-draw shape (4 × 4 regions in TEXCOORD_0.x, skirts, the cell's
 * cliff face, the shard's look in vertex colours); the near one is denser, carries the shard's own world as parts and
 * reduces its ground by geometric error. Node-safe; nothing here knows a shard.
 */
/** A height grid as `terrain.bin` or a shardfile terrain collider holds it (res² heights over size metres, 4 splat bytes per vertex). */
export type PlaceholderGrid = FarGrid;
/** A shard's far look (its palette by height, slope and splat; its haze, cliff and grade), authored in its folder. */
export type PlaceholderLook = FarLookSource;
/** What the runtime reads beside the mesh (`far.json` / `near.json`'s `look`). */
export type PlaceholderLookRuntime = FarLookRuntime;
/** A model merged into the placeholder: cell-local metres and linear RGB per vertex, indexed. */
export type PlaceholderPart = FarPart;

/**
 * The placeholder geometry: the grid in the look, plus parts, refused over `cap` triangles (default the far cap).
 * `reduce` reduces each region's ground lattice (the near placeholder's geometric-error ground); `lean` leans the near
 * ground back from the cell border (G342 round 5).
 */
export function placeholderGeometry(grid: PlaceholderGrid, look: PlaceholderLook, parts: readonly PlaceholderPart[] = [], cap?: number,
  reduce?: (positions: Float32Array, index: Uint32Array, attributes: Float32Array) => Uint32Array, lean?: PlaceholderLean): BufferGeometry {
  return farProxyGeometry(buildFarProxy(grid, look, parts, cap, reduce, lean));
}

/** A placeholder's edge lean (G342 round 5) and how far it lowers the ground at a point (what a placed copy sinks by). */
export type PlaceholderLean = FarEdgeLean;
export function placeholderLeanDrop(grid: PlaceholderGrid, lean: PlaceholderLean): (x: number, z: number) => number { return edgeLeanDrop(grid, lean); }

/** The far mesh as geometry (region in uv.x, cliff in uv.y), kept here rather than beside the far material
 *  (`grid/farView.ts`) so a Node build's closure reaches no renderer module (the native sim loader refuses one). */
function farProxyGeometry(mesh: FarProxyMesh): BufferGeometry {
  const uv = new Float32Array(mesh.region.length * 2); mesh.region.forEach((r, i) => { uv[i * 2] = r; uv[i * 2 + 1] = mesh.cliff[i] ?? 0; });
  return new BufferGeometry().setAttribute('position', new BufferAttribute(mesh.positions, 3)).setAttribute('normal', new BufferAttribute(mesh.normals, 3))
    .setAttribute('color', new BufferAttribute(mesh.colours, 3)).setAttribute('uv', new BufferAttribute(uv, 2)).setIndex(new BufferAttribute(mesh.index, 1));
}
