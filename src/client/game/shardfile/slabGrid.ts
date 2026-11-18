import { Box3, BufferAttribute, type BufferGeometry, InterleavedBufferAttribute, type Object3D, Sphere, Vector3 } from 'three';
import { ownedArray, type OwnedLabel } from '@wildshard/engine/core/ownedBuffer';

/**
 * ONE-FORMAT OF-EM28b3: a slab chunk's positions stay 16-bit on the GPU (and on the CPU, where the leaf trees, far levels
 * and picking read them), on the tile grid codec RM8.1e's tile primitives use (`glslCodec.ts`): unnormalized Int16 grid
 * values, which the drawing part's own uniform scale (the step) and translation (the origin) turn back into the anchor's
 * metres. Three's stock programs read them through the model matrix; a graph's `positionLocal`, `objectOrigin` and
 * vertex position read the authored metres through `wsCodecStep` / `wsCodecOrigin`. Each vertex keeps a fourth, zero
 * word: a 4-byte-aligned stride, which Metal (ANGLE on the iPhone) reads without a converted copy. 8 bytes a vertex
 * instead of float32's 12; Nine's phone slabs held 13.70 MB of float positions (OF-EM28).
 *
 * The step is a power of two of at least `SLAB_GRID_STEP` and the origin a whole number of steps, so two chunks on one
 * step share one lattice and a vertex they share lands on the same point in both (no crack at a chunk seam).
 */
export interface SlabGrid { readonly origin: readonly [number, number, number]; readonly step: number }

/** the finest grid step (m): 3.9 mm, so a vertex moves at most 2 mm; a chunk up to 256 m across keeps it */
export const SLAB_GRID_STEP: number = 2 ** -8;
/** the coarsest (a vertex within 7.8 mm, under the 1 cm parity line; a chunk up to 1 km across): a wider one stays float */
export const SLAB_GRID_COARSEST: number = 2 ** -6;
const MOST = 32767;
/** the gridded positions (kept on the CPU for the leaf trees, far levels and picking) and the worker's widened copy */
const GRID_POSITIONS: OwnedLabel = { owner: 'engine/slab-grid', asset: 'slab-position', kind: 'geometry-cpu' };
const GRID_XYZ: OwnedLabel = { owner: 'engine/slab-grid', asset: 'slab-tree-xyz', kind: 'scratch' };

/** the grid of every gridded slab chunk geometry */
const GRIDS = new WeakMap<BufferGeometry, SlabGrid>();
/** the grid `geometry`'s positions are on, if they are */
export function slabGrid(geometry: BufferGeometry): SlabGrid | undefined { return GRIDS.get(geometry); }
/** a chunk read already on a grid (a baked Int16 slab's node scale and translation, OF-EM28b4): recorded before its
 *  merge, so only chunks on one grid merge (`mergeSlabChunks`) */
export function markSlabGrid(geometry: BufferGeometry, grid: SlabGrid): void { GRIDS.set(geometry, grid); }

/** the grid holding the box `min`..`max`: the finest power-of-two step at least `SLAB_GRID_STEP` whose 16-bit range
 *  about the snapped middle covers it; null past `SLAB_GRID_COARSEST` */
export function slabGridFor(min: readonly number[], max: readonly number[]): SlabGrid | null {
  for (let step = SLAB_GRID_STEP; step <= SLAB_GRID_COARSEST; step *= 2) {
    const at = (axis: number): number => Math.round(((min[axis] ?? 0) + (max[axis] ?? 0)) / 2 / step) * step;
    const origin: [number, number, number] = [at(0), at(1), at(2)];
    if ([0, 1, 2].every(axis => Math.max((origin[axis] ?? 0) - (min[axis] ?? 0), (max[axis] ?? 0) - (origin[axis] ?? 0)) / step <= MOST)) return { origin, step };
  }
  return null;
}

/**
 * Put `geometry`'s positions on a slab grid before their first upload and return it: plain float32 xyz are quantized
 * (each within half a step), a chunk already on a grid (`markSlabGrid`) keeps its Int16 values; either way the position
 * becomes a 4-word Int16 channel and the geometry's bounds move into grid units. Null (left as it was): no positions to
 * grid, or a layout this does not read (normalized, interleaved floats).
 */
export function gridSlabPositions(geometry: BufferGeometry): SlabGrid | null {
  const position: unknown = geometry.getAttribute('position'), known = GRIDS.get(geometry);
  let grid: SlabGrid, words: Int16Array;
  if (known !== undefined) {
    const array: unknown = position instanceof BufferAttribute ? position.array : position instanceof InterleavedBufferAttribute ? position.data.array : null;
    if (!(array instanceof Int16Array) || !(position instanceof BufferAttribute || position instanceof InterleavedBufferAttribute) || position.normalized || position.itemSize !== 3) {
      // already 4-word Int16 (gridded here before) or not Int16 at all
      return position instanceof BufferAttribute && position.array instanceof Int16Array && position.itemSize === 4 ? known : null;
    }
    grid = known; words = ownedArray(Int16Array, position.count * 4, GRID_POSITIONS);
    for (let v = 0; v < position.count; v++) { words[v * 4] = position.getX(v); words[v * 4 + 1] = position.getY(v); words[v * 4 + 2] = position.getZ(v); }
  } else {
    if (!(position instanceof BufferAttribute) || position.normalized || position.itemSize !== 3 || !(position.array instanceof Float32Array)
      || position.count === 0 || position.array.length !== position.count * 3) return null;
    const xyz = position.array, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let at = 0; at < xyz.length; at++) { const value = xyz[at] ?? 0, axis = at % 3; if (value < (min[axis] ?? 0)) min[axis] = value; if (value > (max[axis] ?? 0)) max[axis] = value; }
    if (![...min, ...max].every(Number.isFinite)) return null;
    const fits = slabGridFor(min, max);
    if (fits === null) return null;
    grid = fits; words = ownedArray(Int16Array, position.count * 4, GRID_POSITIONS);
    const { origin: [ox, oy, oz], step } = grid;
    for (let v = 0; v < position.count; v++) {
      words[v * 4] = Math.round(((xyz[v * 3] ?? 0) - ox) / step); words[v * 4 + 1] = Math.round(((xyz[v * 3 + 1] ?? 0) - oy) / step);
      words[v * 4 + 2] = Math.round(((xyz[v * 3 + 2] ?? 0) - oz) / step);
    }
  }
  const gridded = new BufferAttribute(words, 4, false);
  if (position instanceof BufferAttribute) { gridded.name = position.name; gridded.setUsage(position.usage); }
  geometry.setAttribute('position', gridded);
  const { origin: [ox, oy, oz], step } = grid, origin = new Vector3(ox, oy, oz);
  const box = geometry.boundingBox, sphere = geometry.boundingSphere;
  if (box !== null) geometry.boundingBox = new Box3(box.min.clone().sub(origin).divideScalar(step), box.max.clone().sub(origin).divideScalar(step));
  if (sphere !== null) geometry.boundingSphere = new Sphere(sphere.center.clone().sub(origin).divideScalar(step), sphere.radius / step);
  GRIDS.set(geometry, grid);
  return grid;
}

/** `part` draws `geometry` on its grid: its own (fixed) matrix is the grid's scale and translation inside its parent */
export function placeSlabPart(part: Object3D, geometry: BufferGeometry): void {
  const grid = GRIDS.get(geometry);
  if (grid === undefined) return;
  part.position.set(...grid.origin); part.scale.setScalar(grid.step); part.quaternion.identity();
  part.updateMatrix();
}

/** a chunk's positions as xyz in its own frame, for the slab tree worker: float as baked, or a slab grid's Int16 words
 *  packed three a vertex (grid units). MG10 (mini-ninemem10): no longer widened to float: the trees and far levels read the
 *  same values from the 16-bit copy, which is half the bytes on the main thread at `readyFrame` and while held for the
 *  far pass, and the worker no longer widens it either */
export function slabXyz(geometry: BufferGeometry): Float32Array | Int16Array | null {
  const position: unknown = geometry.getAttribute('position');
  if (!(position instanceof BufferAttribute) || position.normalized) return null;
  if (position.itemSize === 3 && position.array instanceof Float32Array) return position.array.slice();
  if (position.itemSize < 3 || !(position.array instanceof Int16Array)) return null;
  const words = position.array, stride = position.itemSize, xyz = ownedArray(Int16Array, position.count * 3, GRID_XYZ);
  for (let v = 0; v < position.count; v++) { xyz[v * 3] = words[v * stride] ?? 0; xyz[v * 3 + 1] = words[v * stride + 1] ?? 0; xyz[v * 3 + 2] = words[v * stride + 2] ?? 0; }
  return xyz;
}

/** the far levels' cells (m) in `geometry`'s own frame: grid units on a grid */
export function slabFarCells(geometry: BufferGeometry, cells: readonly number[]): number[] {
  const step = GRIDS.get(geometry)?.step ?? 1;
  return cells.map(cell => cell / step);
}
