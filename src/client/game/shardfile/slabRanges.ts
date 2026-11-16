import { type BufferGeometry, type Camera, Frustum, Matrix4, type Object3D, WebGLCoordinateSystem } from 'three';
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
  /** per node: left child, right child (-1 for a leaf), first triangle, end triangle */
  readonly nodes: Int32Array;
  readonly triangles: number;
}

/** triangles per leaf: a leaf's box test costs ~6 plane checks, and 256 triangles of a wall kit is a few metres */
export const SLAB_LEAF_TRIANGLES = 256;

function select(order: Uint32Array, key: Float32Array, lo: number, hi: number, k: number): void {
  // Hoare quickselect on key[order[i]] over [lo, hi), placing the k-th smallest at k with smaller-or-equal keys left of it
  let left = lo, right = hi - 1;
  while (right > left) {
    const a = key[order[left] ?? 0] ?? 0, b = key[order[(left + right) >> 1] ?? 0] ?? 0, c = key[order[right] ?? 0] ?? 0;
    const pivot = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
    let i = left, j = right;
    while (i <= j) {
      while ((key[order[i] ?? 0] ?? 0) < pivot) i++;
      while ((key[order[j] ?? 0] ?? 0) > pivot) j--;
      if (i <= j) { const t = order[i] ?? 0; order[i] = order[j] ?? 0; order[j] = t; i++; j--; }
    }
    if (k <= j) right = j; else if (k >= i) left = i; else return;
  }
}

/**
 * Reorder `geometry`'s index into k-d leaf order (before upload) and return the tree over its leaves, or null when the
 * chunk is one leaf (nothing below the object's own test) or has no index or positions.
 */
export function spatialSlabRanges(geometry: BufferGeometry, leaf: number = SLAB_LEAF_TRIANGLES): SlabRanges | null {
  const index = geometry.index, position = geometry.getAttribute('position');
  if (index === null || position === undefined || index.count % 3 !== 0) return null;
  const triangles = index.count / 3;
  if (triangles <= leaf) return null;
  const source = index.array, corners = new Uint32Array(index.count);
  for (let i = 0; i < index.count; i++) corners[i] = index.getX(i);
  const px = new Float32Array(position.count), py = new Float32Array(position.count), pz = new Float32Array(position.count);
  for (let v = 0; v < position.count; v++) { px[v] = position.getX(v); py[v] = position.getY(v); pz[v] = position.getZ(v); }
  const centre = [new Float32Array(triangles), new Float32Array(triangles), new Float32Array(triangles)] as const;
  for (let t = 0; t < triangles; t++) {
    const a = corners[t * 3] ?? 0, b = corners[t * 3 + 1] ?? 0, c = corners[t * 3 + 2] ?? 0;
    centre[0][t] = ((px[a] ?? 0) + (px[b] ?? 0) + (px[c] ?? 0)) / 3;
    centre[1][t] = ((py[a] ?? 0) + (py[b] ?? 0) + (py[c] ?? 0)) / 3;
    centre[2][t] = ((pz[a] ?? 0) + (pz[b] ?? 0) + (pz[c] ?? 0)) / 3;
  }
  const order = new Uint32Array(triangles);
  for (let t = 0; t < triangles; t++) order[t] = t;
  const capacity = 2 * Math.ceil(triangles / leaf), boxes = new Float32Array(capacity * 6), nodes = new Int32Array(capacity * 4);
  let used = 0;
  const build = (lo: number, hi: number): number => {
    const node = used++, n = hi - lo;
    nodes[node * 4 + 2] = lo; nodes[node * 4 + 3] = hi;
    if (n <= leaf) {
      nodes[node * 4] = -1; nodes[node * 4 + 1] = -1;
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let i = lo; i < hi; i++) for (let k = 0; k < 3; k++) {
        const v = corners[(order[i] ?? 0) * 3 + k] ?? 0, x = px[v] ?? 0, y = py[v] ?? 0, z = pz[v] ?? 0;
        if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z; if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
      }
      boxes.set([x0, y0, z0, x1, y1, z1], node * 6);
      return node;
    }
    // split the longest centroid extent, on a leaf boundary so every leaf but the last is full
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = lo; i < hi; i++) {
      const t = order[i] ?? 0, x = centre[0][t] ?? 0, y = centre[1][t] ?? 0, z = centre[2][t] ?? 0;
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z; if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
    }
    const ex = x1 - x0, ey = y1 - y0, ez = z1 - z0, axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
    const mid = lo + Math.floor(Math.ceil(n / leaf) / 2) * leaf;
    select(order, centre[axis], lo, hi, mid);
    const left = build(lo, mid), right = build(mid, hi);
    nodes[node * 4] = left; nodes[node * 4 + 1] = right;
    for (let k = 0; k < 3; k++) {
      boxes[node * 6 + k] = Math.min(boxes[left * 6 + k] ?? 0, boxes[right * 6 + k] ?? 0);
      boxes[node * 6 + 3 + k] = Math.max(boxes[left * 6 + 3 + k] ?? 0, boxes[right * 6 + 3 + k] ?? 0);
    }
    return node;
  };
  build(0, triangles);
  for (let t = 0; t < triangles; t++) {
    const from = (order[t] ?? 0) * 3;
    source[t * 3] = corners[from] ?? 0; source[t * 3 + 1] = corners[from + 1] ?? 0; source[t * 3 + 2] = corners[from + 2] ?? 0;
  }
  index.needsUpdate = true;
  return { boxes: boxes.slice(0, used * 6), nodes: nodes.slice(0, used * 4), triangles };
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
