import { BufferAttribute, type BufferGeometry, type Camera, Frustum, Matrix4, type Object3D, WebGLCoordinateSystem } from 'three';
import { drawNeutral } from '@wildshard/engine/render/drawNeutral';

/**
 * NINE-DRAGON-BENCHMAX NB8: a slab chunk draws only the run of its triangles the camera can see. A resident cell's slab
 * chunk (`sharddev/bake/slabs.ts`) is up to 4 MB of one key in source order, so its bounds span the fragment (Nine's
 * kit chunks reach 190 m) and the object's frustum test keeps nearly every chunk: the phone's spawn view drew 37 of 49
 * chunks, 0.56 M triangles. Splitting chunks in the bake does not pay (NB9: more draws, the spawn view keeps its
 * triangles); ordering each chunk's triangles along a k-d tree of their centroids, then drawing the one contiguous run
 * from its first to its last leaf whose box meets the frustum, cuts triangles with no new draw, no extension, no new
 * program and no change to the shard's bytes. The index is reordered before its first upload; vertices are untouched.
 */
export interface SlabRanges {
  /** per node: box min xyz, max xyz in the geometry's own frame */
  readonly boxes: Float32Array;
  /** per node, the root first: left child, right child (-1 for a leaf), first triangle, end triangle */
  readonly nodes: Int32Array;
  readonly triangles: number;
}

/** triangles per leaf: a leaf's box test costs ~6 plane checks, and 256 triangles of a wall kit is a few metres */
export const SLAB_LEAF_TRIANGLES = 256;

/**
 * Reorder `geometry`'s index along a k-d tree of its triangles' centroids (each node split at the middle of its longest
 * extent, to leaves of at most `leaf` triangles), before upload, and return that tree; null when the chunk is one leaf
 * (nothing below the object's own test) or has no index or positions. Each level is one linear partition pass.
 */
export function spatialSlabRanges(geometry: BufferGeometry, leaf: number = SLAB_LEAF_TRIANGLES): SlabRanges | null {
  const index = geometry.index, position = geometry.getAttribute('position');
  if (index === null || position === undefined || index.count % 3 !== 0) return null;
  const triangles = index.count / 3;
  if (triangles <= leaf) return null;
  const source = index.array, corners = new Uint32Array(source);
  // the bake's positions are plain float32 xyz; any other layout is read through the attribute
  const plain = position instanceof BufferAttribute && position.itemSize === 3 && !position.normalized && position.array instanceof Float32Array;
  const xyz = plain ? position.array : new Float32Array(position.count * 3);
  if (!plain) for (let v = 0; v < position.count; v++) { xyz[v * 3] = position.getX(v); xyz[v * 3 + 1] = position.getY(v); xyz[v * 3 + 2] = position.getZ(v); }
  // centroids (times three) and triangle ids, permuted together so every pass reads front to back
  const cx = new Float32Array(triangles), cy = new Float32Array(triangles), cz = new Float32Array(triangles), order = new Uint32Array(triangles);
  for (let t = 0; t < triangles; t++) {
    const a = (corners[t * 3] ?? 0) * 3, b = (corners[t * 3 + 1] ?? 0) * 3, c = (corners[t * 3 + 2] ?? 0) * 3;
    cx[t] = (xyz[a] ?? 0) + (xyz[b] ?? 0) + (xyz[c] ?? 0); cy[t] = (xyz[a + 1] ?? 0) + (xyz[b + 1] ?? 0) + (xyz[c + 1] ?? 0); cz[t] = (xyz[a + 2] ?? 0) + (xyz[b + 2] ?? 0) + (xyz[c + 2] ?? 0);
    order[t] = t;
  }
  const rows: number[] = [];
  // top-down: a node's row is [left, right, first triangle, end triangle]; the root is node 0, children follow it
  const build = (lo: number, hi: number): number => {
    const node = rows.length / 4; rows.push(-1, -1, lo, hi);
    if (hi - lo <= leaf) return node;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = lo; i < hi; i++) {
      const x = cx[i] ?? 0, y = cy[i] ?? 0, z = cz[i] ?? 0;
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z; if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
    }
    const ex = x1 - x0, ey = y1 - y0, ez = z1 - z0, key = ex >= ey && ex >= ez ? cx : ey >= ez ? cy : cz;
    const cut = key === cx ? (x0 + x1) / 2 : key === cy ? (y0 + y1) / 2 : (z0 + z1) / 2;
    let i = lo, j = hi - 1;
    while (i <= j) {
      if ((key[i] ?? 0) < cut) { i++; continue; }
      // swap row i with row j and look at the new row i again
      let t: number;
      t = cx[i] ?? 0; cx[i] = cx[j] ?? 0; cx[j] = t; t = cy[i] ?? 0; cy[i] = cy[j] ?? 0; cy[j] = t;
      t = cz[i] ?? 0; cz[i] = cz[j] ?? 0; cz[j] = t; t = order[i] ?? 0; order[i] = order[j] ?? 0; order[j] = t; j--;
    }
    // every centroid on one side of the middle (all equal along the axis): split the run in half as it stands
    const mid = i === lo || i === hi ? (lo + hi) >> 1 : i;
    const left = build(lo, mid), right = build(mid, hi);
    rows[node * 4] = left; rows[node * 4 + 1] = right;
    return node;
  };
  build(0, triangles);
  // the index in its new order, then each leaf's box read front to back, then every parent's (children follow parents)
  for (let t = 0; t < triangles; t++) {
    const from = (order[t] ?? 0) * 3;
    source[t * 3] = corners[from] ?? 0; source[t * 3 + 1] = corners[from + 1] ?? 0; source[t * 3 + 2] = corners[from + 2] ?? 0;
  }
  const nodes = Int32Array.from(rows), count = nodes.length / 4, boxes = new Float32Array(count * 6);
  for (let node = count - 1; node >= 0; node--) {
    const left = nodes[node * 4] ?? -1, right = nodes[node * 4 + 1] ?? -1;
    if (left >= 0) {
      for (let k = 0; k < 3; k++) {
        boxes[node * 6 + k] = Math.min(boxes[left * 6 + k] ?? 0, boxes[right * 6 + k] ?? 0);
        boxes[node * 6 + 3 + k] = Math.max(boxes[left * 6 + 3 + k] ?? 0, boxes[right * 6 + 3 + k] ?? 0);
      }
      continue;
    }
    let bx0 = Infinity, by0 = Infinity, bz0 = Infinity, bx1 = -Infinity, by1 = -Infinity, bz1 = -Infinity;
    for (let c = (nodes[node * 4 + 2] ?? 0) * 3, end = (nodes[node * 4 + 3] ?? 0) * 3; c < end; c++) {
      const v = (source[c] ?? 0) * 3, x = xyz[v] ?? 0, y = xyz[v + 1] ?? 0, z = xyz[v + 2] ?? 0;
      if (x < bx0) bx0 = x; if (y < by0) by0 = y; if (z < bz0) bz0 = z; if (x > bx1) bx1 = x; if (y > by1) by1 = y; if (z > bz1) bz1 = z;
    }
    boxes[node * 6] = bx0; boxes[node * 6 + 1] = by0; boxes[node * 6 + 2] = bz0; boxes[node * 6 + 3] = bx1; boxes[node * 6 + 4] = by1; boxes[node * 6 + 5] = bz1;
  }
  index.needsUpdate = true;
  return { boxes, nodes, triangles };
}

const frustum = new Frustum(), clip = new Matrix4();
function visible(boxes: Float32Array, node: number): boolean {
  for (const plane of frustum.planes) {
    const { x, y, z } = plane.normal, at = node * 6;
    // the box corner furthest along the plane's normal
    const px = x > 0 ? boxes[at + 3] ?? 0 : boxes[at] ?? 0, py = y > 0 ? boxes[at + 4] ?? 0 : boxes[at + 1] ?? 0, pz = z > 0 ? boxes[at + 5] ?? 0 : boxes[at + 2] ?? 0;
    if (x * px + y * py + z * pz + plane.constant < 0) return false;
  }
  return true;
}
/** the first visible leaf's first triangle under `node`, or -1 */
function first(ranges: SlabRanges, node: number): number {
  if (!visible(ranges.boxes, node)) return -1;
  const left = ranges.nodes[node * 4] ?? -1;
  if (left < 0) return ranges.nodes[node * 4 + 2] ?? 0;
  const found = first(ranges, left);
  return found >= 0 ? found : first(ranges, ranges.nodes[node * 4 + 1] ?? 0);
}
/** the last visible leaf's end triangle under `node`, or -1 */
function last(ranges: SlabRanges, node: number): number {
  if (!visible(ranges.boxes, node)) return -1;
  const right = ranges.nodes[node * 4 + 1] ?? -1;
  if (right < 0) return ranges.nodes[node * 4 + 3] ?? 0;
  const found = last(ranges, right);
  return found >= 0 ? found : last(ranges, ranges.nodes[node * 4] ?? 0);
}

/** The triangle run `[start, end)` of `ranges` that `camera` can see of an object drawn with `world`; when no leaf is in
 *  view, the first leaf alone, so a parked warm still issues a real draw and builds its pipeline. */
export function visibleSlabRun(ranges: SlabRanges, world: Matrix4, camera: Camera): readonly [number, number] {
  clip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(world);
  frustum.setFromProjectionMatrix(clip, WebGLCoordinateSystem, camera.reversedDepth);
  const start = first(ranges, 0);
  if (start < 0) { let node = 0; while ((ranges.nodes[node * 4] ?? -1) >= 0) node = ranges.nodes[node * 4] ?? 0; return [ranges.nodes[node * 4 + 2] ?? 0, ranges.nodes[node * 4 + 3] ?? 0]; }
  return [start, Math.max(start, last(ranges, 0))];
}

/** Draw `part` (whose geometry `ranges` was built on) as its visible run for each camera that renders it; the full
 *  range is restored after every draw, so shadow passes, warms, raycasts and bounds read the whole chunk. */
export function cullSlabRanges(part: Object3D & { geometry: BufferGeometry }, ranges: SlabRanges): void {
  const geometry = part.geometry, { start, count } = geometry.drawRange;
  part.onBeforeRender = drawNeutral((_renderer: unknown, _scene: unknown, camera: Camera): void => {
    const [from, to] = visibleSlabRun(ranges, part.matrixWorld, camera);
    geometry.setDrawRange(from * 3, (to - from) * 3);
  });
  part.onAfterRender = drawNeutral((): void => { geometry.setDrawRange(start, count); });
}
