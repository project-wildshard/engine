import { BufferAttribute, type BufferGeometry, type Camera, Frustum, Matrix4, type Object3D, Vector3, WebGLCoordinateSystem } from 'three';
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
  /** per triangle in the reordered index, its thickness (twice its area over its longest edge: the narrowest it can look
   *  on screen); within a leaf the triangles run thickest first, so a leaf's triangles above a size are a prefix of it */
  readonly thickness: Float32Array;
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
  const thick = new Float32Array(triangles);
  for (let t = 0; t < triangles; t++) thick[t] = thicknessOf(xyz, corners[t * 3] ?? 0, corners[t * 3 + 1] ?? 0, corners[t * 3 + 2] ?? 0);
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
  const nodes = Int32Array.from(rows), count = nodes.length / 4, boxes = new Float32Array(count * 6);
  // NB8 (mini-nb8d): each leaf's triangles thickest first, so the phone's size cut (`visibleSlabDraws`) is a prefix of it
  for (let node = 0; node < count; node++) {
    if ((nodes[node * 4] ?? -1) >= 0) continue;
    order.subarray(nodes[node * 4 + 2] ?? 0, nodes[node * 4 + 3] ?? 0).sort((a, b) => (thick[b] ?? 0) - (thick[a] ?? 0));
  }
  // the index in its new order, then each leaf's box read front to back, then every parent's (children follow parents)
  const thickness = new Float32Array(triangles);
  for (let t = 0; t < triangles; t++) {
    const was = order[t] ?? 0, from = was * 3;
    source[t * 3] = corners[from] ?? 0; source[t * 3 + 1] = corners[from + 1] ?? 0; source[t * 3 + 2] = corners[from + 2] ?? 0;
    thickness[t] = thick[was] ?? 0;
  }
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
  return { boxes, nodes, triangles, thickness };
}

/** a triangle's thickness: twice its area over its longest edge, the height it stands off that edge */
function thicknessOf(xyz: ArrayLike<number>, a: number, b: number, c: number): number {
  const ax = xyz[a * 3] ?? 0, ay = xyz[a * 3 + 1] ?? 0, az = xyz[a * 3 + 2] ?? 0;
  const ux = (xyz[b * 3] ?? 0) - ax, uy = (xyz[b * 3 + 1] ?? 0) - ay, uz = (xyz[b * 3 + 2] ?? 0) - az;
  const vx = (xyz[c * 3] ?? 0) - ax, vy = (xyz[c * 3 + 1] ?? 0) - ay, vz = (xyz[c * 3 + 2] ?? 0) - az;
  const wx = vx - ux, wy = vy - uy, wz = vz - uz;
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  const longest = Math.sqrt(Math.max(ux * ux + uy * uy + uz * uz, vx * vx + vy * vy + vz * vz, wx * wx + wy * wy + wz * wz));
  return longest > 0 ? Math.sqrt(cx * cx + cy * cy + cz * cz) / longest : 0;
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

/**
 * NINE-DRAGON-BENCHMAX NB8 (mini-nb8d): the phone's draw of a slab chunk as one multi-draw of exactly its visible leaves,
 * each cut to its triangles at least `angle` × the leaf's distance thick (`SlabRanges.thickness`: a leaf runs thickest
 * first, so its kept triangles are a prefix). A triangle thinner than that is under a pixel where it stands (0.001 rad is
 * ~0.7 device pixels at the phone's ~100° portrait at DPR 2), so it only shimmers; the shadow passes, warms and raycasts
 * still read the whole chunk. Leaves next to each other in the index join into one range, as do two ranges at most
 * `SLAB_DRAW_GAP` triangles apart (the gap is drawn), so a view's ranges stay a few hundred.
 */
export interface SlabDraws {
  /** each range's first triangle and triangle count, `n` of them */
  starts: Int32Array; counts: Int32Array; n: number;
  /** the triangles the ranges draw */
  total: number;
}
/** two ranges this close (in triangles) draw as one: a range is a draw inside the multi-draw */
export const SLAB_DRAW_GAP = 32;

const local = new Vector3(), inverse = new Matrix4();
function push(out: SlabDraws, from: number, to: number): void {
  const n = out.n, at = n - 1;
  if (n > 0) {
    const end = (out.starts[at] ?? 0) + (out.counts[at] ?? 0);
    if (from - end <= SLAB_DRAW_GAP) { out.total += to - end; out.counts[at] = to - (out.starts[at] ?? 0); return; }
  }
  if (n === out.starts.length) {
    const starts = new Int32Array(n * 2), counts = new Int32Array(n * 2);
    starts.set(out.starts); counts.set(out.counts); out.starts = starts; out.counts = counts;
  }
  out.starts[n] = from; out.counts[n] = to - from; out.n = n + 1; out.total += to - from;
}
function collect(ranges: SlabRanges, node: number, angle: number, out: SlabDraws): void {
  if (!visible(ranges.boxes, node)) return;
  const { nodes, boxes, thickness } = ranges, left = nodes[node * 4] ?? -1;
  if (left >= 0) { collect(ranges, left, angle, out); collect(ranges, nodes[node * 4 + 1] ?? 0, angle, out); return; }
  const from = nodes[node * 4 + 2] ?? 0, to = nodes[node * 4 + 3] ?? 0, at = node * 6;
  // the camera's distance to the leaf's box (0 inside it), in the chunk's own frame
  const dx = Math.max((boxes[at] ?? 0) - local.x, 0, local.x - (boxes[at + 3] ?? 0));
  const dy = Math.max((boxes[at + 1] ?? 0) - local.y, 0, local.y - (boxes[at + 4] ?? 0));
  const dz = Math.max((boxes[at + 2] ?? 0) - local.z, 0, local.z - (boxes[at + 5] ?? 0));
  const floor = angle * Math.sqrt(dx * dx + dy * dy + dz * dz);
  // the first triangle thinner than the floor (the leaf runs thickest first)
  let lo = from, hi = to;
  while (lo < hi) { const mid = (lo + hi) >> 1; if ((thickness[mid] ?? 0) >= floor) lo = mid + 1; else hi = mid; }
  if (lo > from) push(out, from, lo);
}

/** The ranges of `ranges` that `camera` draws of an object drawn with `world`, every triangle under `angle` × its leaf's
 *  distance left out, into `out`; when nothing is left, the first leaf alone, so a parked warm still issues a real draw. */
export function visibleSlabDraws(ranges: SlabRanges, world: Matrix4, camera: Camera, angle: number, out: SlabDraws): SlabDraws {
  clip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(world);
  frustum.setFromProjectionMatrix(clip, WebGLCoordinateSystem, camera.reversedDepth);
  local.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inverse.copy(world).invert());
  out.n = 0; out.total = 0;
  collect(ranges, 0, angle, out);
  if (out.n === 0) { let node = 0; while ((ranges.nodes[node * 4] ?? -1) >= 0) node = ranges.nodes[node * 4] ?? 0; push(out, ranges.nodes[node * 4 + 2] ?? 0, ranges.nodes[node * 4 + 3] ?? 0); }
  return out;
}

/** the slice of a WebGL 2 context and of `WEBGL_multi_draw` the slab draw uses */
interface MultiDrawGl { drawElementsInstanced: (mode: number, count: number, type: number, offset: number, instances: number) => void; readonly UNSIGNED_INT: number; readonly UNSIGNED_SHORT: number }
interface MultiDrawExtension { readonly multiDrawElementsInstancedWEBGL: (mode: number, counts: Int32Array, countsOffset: number, type: number, offsets: Int32Array, offsetsOffset: number, instances: Int32Array, instancesOffset: number, drawCount: number) => void }
interface SlabRenderer { readonly getContext: () => unknown; readonly extensions: { readonly has: (name: string) => boolean; readonly get: (name: string) => unknown } }
const multiDraws = new WeakMap<object, MultiDrawExtension | null>();
function multiDrawOf(renderer: unknown): MultiDrawExtension | null {
  if (typeof renderer !== 'object' || renderer === null) return null;
  const known = multiDraws.get(renderer);
  if (known !== undefined) return known;
  const extensions = Reflect.get(renderer, 'extensions') as SlabRenderer['extensions'] | undefined;
  const extension = extensions !== undefined && extensions.has('WEBGL_multi_draw') ? extensions.get('WEBGL_multi_draw') as MultiDrawExtension : null;
  multiDraws.set(renderer, extension);
  return extension;
}

const draws: SlabDraws = { starts: new Int32Array(256), counts: new Int32Array(256), n: 0, total: 0 };
let offsets = new Int32Array(256), elements = new Int32Array(256), instances = new Int32Array(256);
/**
 * Swap the context's next `drawElementsInstanced` of `count` elements from offset 0 (the draw three issues for the
 * part, its draw range set to [0, `count`)) for one multi-draw of `draws`, under three's own mode, index type, instance
 * count, program, vertex array and uniforms; three counts it as the one call it issued, `count` elements. Any other
 * draw passes through; the returned function puts the context's own method back.
 */
function swapNextDraw(gl: MultiDrawGl, extension: MultiDrawExtension, count: number): () => void {
  const own = Object.getOwnPropertyDescriptor(gl, 'drawElementsInstanced'), plain = gl.drawElementsInstanced;
  gl.drawElementsInstanced = function drawElementsInstanced(this: unknown, mode: number, elementCount: number, type: number, offset: number, instanceCount: number): void {
    if (elementCount !== count || offset !== 0) { Reflect.apply(plain, this, [mode, elementCount, type, offset, instanceCount]); return; }
    const n = draws.n, bytes = type === gl.UNSIGNED_INT ? 4 : type === gl.UNSIGNED_SHORT ? 2 : 1;
    if (offsets.length < n) { offsets = new Int32Array(n * 2); elements = new Int32Array(n * 2); instances = new Int32Array(n * 2); }
    for (let i = 0; i < n; i++) { offsets[i] = (draws.starts[i] ?? 0) * 3 * bytes; elements[i] = (draws.counts[i] ?? 0) * 3; instances[i] = instanceCount; }
    extension.multiDrawElementsInstancedWEBGL(mode, elements, 0, type, offsets, 0, instances, 0, n);
  };
  return () => { if (own === undefined) Reflect.deleteProperty(gl, 'drawElementsInstanced'); else Object.defineProperty(gl, 'drawElementsInstanced', own); };
}

/** Draw `part` (whose geometry `ranges` was built on) as its visible run for each camera that renders it; the full
 *  range is restored after every draw, so shadow passes, warms, raycasts and bounds read the whole chunk. With an
 *  `angle` (the phone tier's `slabLodAngle`) and `WEBGL_multi_draw`, the draw is instead its visible leaves cut to
 *  their triangles at least `angle` × distance thick (`visibleSlabDraws`), in one multi-draw; without the extension it
 *  stays the run. */
export function cullSlabRanges(part: Object3D & { geometry: BufferGeometry }, ranges: SlabRanges, angle = 0): void {
  const geometry = part.geometry, { start, count } = geometry.drawRange;
  let restore: (() => void) | null = null;
  part.onBeforeRender = drawNeutral((renderer: unknown, _scene: unknown, camera: Camera): void => {
    const extension = angle > 0 && geometry.groups.length === 0 ? multiDrawOf(renderer) : null;
    if (extension === null) {
      const [from, to] = visibleSlabRun(ranges, part.matrixWorld, camera);
      geometry.setDrawRange(from * 3, (to - from) * 3);
      return;
    }
    const out = visibleSlabDraws(ranges, part.matrixWorld, camera, angle, draws);
    if (out.n === 1) { geometry.setDrawRange((out.starts[0] ?? 0) * 3, (out.counts[0] ?? 0) * 3); return; }
    geometry.setDrawRange(0, out.total * 3);
    restore = swapNextDraw((renderer as SlabRenderer).getContext() as MultiDrawGl, extension, out.total * 3);
  });
  part.onAfterRender = drawNeutral((): void => {
    if (restore !== null) { restore(); restore = null; }
    geometry.setDrawRange(start, count);
  });
}
