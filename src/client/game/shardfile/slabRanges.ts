import { BufferAttribute, type BufferGeometry, type Camera, FrontSide, Frustum, type Material, Matrix4, type Object3D, Vector3, WebGLCoordinateSystem } from 'three';
import { drawNeutral } from '@wildshard/engine/render/drawNeutral';
import { ownedArray, type OwnedLabel } from '@wildshard/engine/core/ownedBuffer';

/**
 * NINE-DRAGON-BENCHMAX NB8: a slab chunk draws only the run of its triangles the camera can see. A resident cell's slab
 * chunk (`sharddev/bake/slabs.ts`) is up to 4 MB of one key in source order, so its bounds span the fragment (Nine's
 * kit chunks reach 190 m) and the object's frustum test keeps nearly every chunk: the phone's spawn view drew 37 of 49
 * chunks, 0.56 M triangles. Splitting chunks in the bake does not pay (NB9: more draws, the spawn view keeps its
 * triangles); ordering each chunk's triangles along a k-d tree of their centroids, then drawing the one contiguous run
 * from its first to its last leaf whose box meets the frustum, cuts triangles with no new draw, no extension, no new
 * program and no change to the shard's bytes. The index is reordered before its first upload; vertices are untouched.
 * NB8 (mini-nb8h): the tree first splits the triangles by the way they face (`SLAB_FACINGS` cells of the cube about the
 * origin, by their wound normal), then by place, so each leaf faces one way within a narrow cone; the phone leaves out a
 * leaf that shows the camera only its backs, which the GPU would cull after shading every vertex.
 */
export interface SlabRanges {
  /** per node: box min xyz, max xyz in the geometry's own frame */
  readonly boxes: Float32Array;
  /** per node, the root first: left child, right child (-1 for a leaf), first triangle, end triangle */
  readonly nodes: Int32Array;
  readonly triangles: number;
  /** per triangle in the reordered index, its size (its longest edge: a triangle shorter than a pixel every way is a
   *  speck); within a leaf the triangles run largest first, so a leaf's triangles above a size are a prefix of it */
  readonly size: Float32Array;
  /** NB8 (mini-nb8h): per node, the cone its triangles' wound normals lie in (axis xyz, cosine of its half angle); a cosine
   *  of -1 (an inner node, or a leaf of triangles with no area) never leaves a leaf out */
  readonly cones: Float32Array;
  /** NB23 (b): the phone's far levels, when the tree was built with them (`slabFarLevels`) */
  readonly far?: SlabFar;
}

/**
 * NINE-DRAGON-BENCHMAX NB23 (b), far slab decimation (Jake, 2026-11-16 ~23:20 Cancún: "probably b) yeah"): each leaf of a
 * phone slab chunk also has coarser copies of its triangles, one per level, laid after the chunk's own triangles in its
 * index (`slabLibrary.ts` reserves the room before the first upload). A level clusters the chunk's vertices on a grid of
 * `cells[k]` metres, apart by the way their face looks (`SLAB_FACINGS`, so a wall's corner keeps both its faces), and
 * moves each vertex to the one of its cluster nearest the cluster's middle; a triangle two of whose corners meet, or that
 * turns over, is dropped. The coarse triangles name the chunk's own vertices (an index, no new vertex), and one grid holds
 * for the whole chunk, so two leaves at one level share their seams. A leaf at least `cells[k] / farAngle` away draws
 * level k (`visibleSlabDraws`): every corner moves at most the cell's diagonal, under ~`farAngle` × 1.7 of the view.
 */
export interface SlabFar {
  /** each level's cell (m), finest first; Infinity for a level left out (no room) */
  readonly cells: Float64Array;
  /** per node and level (node × levels + level): its coarse triangles' first and end triangle in the index (after the
   *  chunk's own), or -1 where the leaf keeps its own triangles at that level (an inner node, or no saving) */
  readonly starts: Int32Array;
  readonly ends: Int32Array;
}
/** NB23 (b): a vertex channel two vertices must share to join one cluster (its colour, its surface kind), so a far level
 *  never paints one face's colour or kind across another's */
export interface SlabFarKind { readonly array: ArrayLike<number>; readonly itemSize: number }
/** NB23 (b): the far levels' cells (m): on Nine's plain slab key (0.52 M triangles) ~49 % and ~12 % of its triangles; a
 *  first cell of 0.15 m drew at the phone spawn's mid towers (~40-80 m), whose window frames it merged (3.7 k px) */
export const SLAB_FAR_CELLS: readonly number[] = [0.3, 0.8];
/** a leaf keeps its own triangles at a level that keeps more than this share of them (the index room is better spent) */
export const SLAB_FAR_KEEP = 0.8;

/** the facing cells a slab is split by first: each cube face in 3 × 3 (its middle cell holds the walls, floors and
 *  ceilings square to that axis), and one more for triangles with no area or of a cell too small for its own leaf */
export const SLAB_FACINGS = 55;
/** the most triangles a node splits by facing cell at: above it the tree splits by place, as it did before facing */
export const SLAB_FACING_NODE = 512;
/** the fewest triangles of one facing cell in such a node that get a leaf of their own */
export const SLAB_FACING_LEAST = 48;

/** triangles per leaf: a leaf's box test costs ~6 plane checks, and 256 triangles of a wall kit is a few metres */
export const SLAB_LEAF_TRIANGLES = 256;

/**
 * Reorder `geometry`'s index along a k-d tree of its triangles' centroids (each node split at the middle of its longest
 * extent, to leaves of at most `leaf` triangles), before upload, and return that tree; null when the chunk is one leaf
 * (nothing below the object's own test) or has no index or positions. Each level is one linear partition pass.
 */
export function spatialSlabRanges(geometry: BufferGeometry, leaf: number = SLAB_LEAF_TRIANGLES, faced = false): SlabRanges | null {
  const job = slabRangesJob(geometry, leaf, faced);
  for (;;) { const step = job.next(); if (step.done === true) return step.value; }
}

/** triangles of partition or pass work between two yields of `slabRangesJob` (~2-4 ms on a throttled phone) */
const SLAB_JOB_STEP = 32_768;

/**
 * `spatialSlabRanges` as a job that yields between bounded steps (NB8, mini-nb8e: a phone's merged key is ~0.5 M
 * triangles, ~0.1 s on the mini in one go), for a caller that spreads it over work slices. The geometry's index is only
 * rewritten in the last step, in one pass, so a draw between steps reads the index as it was. `facingNode` (with
 * `faced`): the node size the tree splits by facing at; mini-nb8j: a mesh whose triangles face every way within a few
 * metres (a tree crown's lumps) passes Infinity, so its root splits by facing first and each facing cell by place, and
 * a `facingGrid` finer than 3 (each cube face in n × n cells: narrower leaf cones, so more backs left out).
 */
export function* slabRangesJob(geometry: BufferGeometry, leaf: number = SLAB_LEAF_TRIANGLES, faced = false, facingNode: number = SLAB_FACING_NODE, facingGrid = 3): Generator<void, SlabRanges | null, void> {
  const index = geometry.index, position = geometry.getAttribute('position');
  if (index === null || position === undefined || index.count % 3 !== 0) return null;
  // NB23 (b): a chunk with far room (`slabLibrary.ts`): the room after its own triangles is not its triangles
  const own = slabTriangles(geometry);
  if (own === null) return null;
  const triangles = own;
  if (triangles <= leaf) return null;
  const corners = new Uint32Array(index.array.subarray(0, triangles * 3));
  // the bake's positions are plain float32 xyz, or a slab grid's packed Int16 xyz (MG10: read as they are, the same values
  // the float copy held); any other layout is read through the attribute
  const plain = position instanceof BufferAttribute && position.itemSize === 3 && !position.normalized && (position.array instanceof Float32Array || position.array instanceof Int16Array);
  const xyz: Float32Array | Int16Array = plain ? position.array as Float32Array | Int16Array : new Float32Array(position.count * 3);
  if (!plain) for (let v = 0; v < position.count; v++) { xyz[v * 3] = position.getX(v); xyz[v * 3 + 1] = position.getY(v); xyz[v * 3 + 2] = position.getZ(v); }
  // centroids (times three) and triangle ids, permuted together so every pass reads front to back
  const cx = new Float32Array(triangles), cy = new Float32Array(triangles), cz = new Float32Array(triangles), order = new Uint32Array(triangles);
  // mini-nb8h (`faced`, the phone's): each triangle's facing cell and its unit wound normal in 8 bits a component (the
  // leaf cones read it; \`coneOf\` widens each cone by the rounding)
  // the facing cells: 6 n² and the mixed one (55 at n = 3, `SLAB_FACINGS`; at most 6 · 6² + 1 in a byte)
  const grid = Math.max(1, Math.min(6, Math.round(facingGrid))), cells = 6 * grid * grid + 1;
  const sized = new Float32Array(triangles), facing = new Uint8Array(triangles), counts = new Int32Array(cells), normals = new Int8Array(faced ? triangles * 3 : 0);
  let work = 0;
  for (let t = 0; t < triangles; t++) {
    const a = (corners[t * 3] ?? 0) * 3, b = (corners[t * 3 + 1] ?? 0) * 3, c = (corners[t * 3 + 2] ?? 0) * 3;
    cx[t] = (xyz[a] ?? 0) + (xyz[b] ?? 0) + (xyz[c] ?? 0); cy[t] = (xyz[a + 1] ?? 0) + (xyz[b + 1] ?? 0) + (xyz[c + 1] ?? 0); cz[t] = (xyz[a + 2] ?? 0) + (xyz[b + 2] ?? 0) + (xyz[c + 2] ?? 0);
    order[t] = t;
    sized[t] = sizeOf(xyz, corners[t * 3] ?? 0, corners[t * 3 + 1] ?? 0, corners[t * 3 + 2] ?? 0);
    if (faced) facing[t] = facingOf(xyz, corners[t * 3] ?? 0, corners[t * 3 + 1] ?? 0, corners[t * 3 + 2] ?? 0, normals, t, grid);
    if (++work >= SLAB_JOB_STEP) { work = 0; yield; }
  }
  const rows: number[] = [];
  // top-down, depth first, left before right: a node's row is [left, right, first triangle, end triangle]; the root is
  // node 0 and children follow their parent (the numbering of a recursive build). Each entry: [first, end, parent, side]
  const stack: number[] = [0, triangles, -1, 0];
  while (stack.length > 0) {
    const side = stack.pop() ?? 0, parent = stack.pop() ?? -1, hi = stack.pop() ?? 0, lo = stack.pop() ?? 0;
    const node = rows.length / 4; rows.push(-1, -1, lo, hi);
    if (parent >= 0) rows[parent * 4 + side] = node;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity, f0 = cells, f1 = -1;
    for (let i = lo; i < hi; i++) {
      const x = cx[i] ?? 0, y = cy[i] ?? 0, z = cz[i] ?? 0, f = facing[i] ?? 0;
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z; if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
      if (f < f0) f0 = f; if (f > f1) f1 = f;
    }
    // mini-nb8h: a leaf faces one way: a node of at most `SLAB_FACING_NODE` triangles in several facing cells splits
    // between them (a bigger one by place, so its leaves stay as small in space as before)
    // (once, at the first node that small: a cell of fewer than `SLAB_FACING_LEAST` there joins the node's mixed leaf: a run that short is drawn across anyway,
    // SLAB_DRAW_GAP, and a leaf for each would only add nodes)
    if (f0 !== f1 && hi - lo <= facingNode && (parent < 0 || (rows[parent * 4 + 3] ?? 0) - (rows[parent * 4 + 2] ?? 0) > facingNode)) {
      counts.fill(0);
      for (let i = lo; i < hi; i++) { const cell = facing[i] ?? 0; counts[cell] = (counts[cell] ?? 0) + 1; }
      f0 = cells; f1 = -1;
      for (let i = lo; i < hi; i++) {
        if ((counts[facing[i] ?? 0] ?? 0) < SLAB_FACING_LEAST) facing[i] = cells - 1;
        const f = facing[i] ?? 0; if (f < f0) f0 = f; if (f > f1) f1 = f;
      }
      work += 2 * (hi - lo);
    }
    if (hi - lo <= leaf && f0 === f1) continue;
    const ex = x1 - x0, ey = y1 - y0, ez = z1 - z0, key = f0 !== f1 && hi - lo <= facingNode ? null : ex >= ey && ex >= ez ? cx : ey >= ez ? cy : cz;
    const cut = key === null ? (f0 + f1 + 1) >> 1 : key === cx ? (x0 + x1) / 2 : key === cy ? (y0 + y1) / 2 : (z0 + z1) / 2;
    let i = lo, j = hi - 1;
    while (i <= j) {
      if ((key === null ? facing[i] ?? 0 : key[i] ?? 0) < cut) { i++; continue; }
      // swap row i with row j and look at the new row i again
      let t: number;
      t = cx[i] ?? 0; cx[i] = cx[j] ?? 0; cx[j] = t; t = cy[i] ?? 0; cy[i] = cy[j] ?? 0; cy[j] = t;
      t = cz[i] ?? 0; cz[i] = cz[j] ?? 0; cz[j] = t; t = order[i] ?? 0; order[i] = order[j] ?? 0; order[j] = t;
      t = facing[i] ?? 0; facing[i] = facing[j] ?? 0; facing[j] = t; j--;
    }
    // every centroid on one side of the middle (all equal along the axis): split the run in half as it stands
    const mid = i === lo || i === hi ? (lo + hi) >> 1 : i;
    // the right half waits under the left, so the left subtree is numbered first
    stack.push(mid, hi, node, 1, lo, mid, node, 0);
    work += 2 * (hi - lo);
    if (work >= SLAB_JOB_STEP) { work = 0; yield; }
  }
  const nodes = Int32Array.from(rows), count = nodes.length / 4, boxes = new Float32Array(count * 6), cones = new Float32Array(count * 4);
  // NB8 (mini-nb8d): each leaf's triangles largest first, so the phone's size cut (`visibleSlabDraws`) is a prefix of it
  // mini-nb8h: and its cone (an inner node's never leaves anything out)
  for (let node = 0; node < count; node++) {
    if ((nodes[node * 4] ?? -1) >= 0) { cones[node * 4 + 3] = -1; continue; }
    const from = nodes[node * 4 + 2] ?? 0, to = nodes[node * 4 + 3] ?? 0;
    order.subarray(from, to).sort((a, b) => (sized[b] ?? 0) - (sized[a] ?? 0));
    if (faced) coneOf(normals, order, from, to, cones, node * 4); else cones[node * 4 + 3] = -1;
    work += 3 * (to - from);
    if (work >= SLAB_JOB_STEP) { work = 0; yield; }
  }
  // the index in its new order (one pass: no draw sees it half done), then each leaf's box read front to back, then
  // every parent's (children follow parents)
  const source = index.array, size = new Float32Array(triangles);
  for (let t = 0; t < triangles; t++) {
    const was = order[t] ?? 0, from = was * 3;
    source[t * 3] = corners[from] ?? 0; source[t * 3 + 1] = corners[from + 1] ?? 0; source[t * 3 + 2] = corners[from + 2] ?? 0;
    size[t] = sized[was] ?? 0;
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
  return { boxes, nodes, triangles, size, cones };
}

/** NB23 (b): the chunks whose index has far room after their own triangles (`slabLibrary.ts`), and how many are their own */
const ROOMED = new WeakMap<BufferGeometry, number>();
/** NB23 (b): mark `geometry`'s index as holding `own` triangles of its own, the rest far room */
export function slabRoom(geometry: BufferGeometry, own: number): void { ROOMED.set(geometry, own); }
/** NB23 (b): the triangles a chunk's index holds of its own: all of it, or those before its far room; null when the index
 *  is not whole triangles */
export function slabTriangles(geometry: BufferGeometry): number | null {
  const index = geometry.index; if (index === null) return null;
  const own = ROOMED.get(geometry);
  if (own !== undefined) return own * 3 <= index.count ? own : null;
  return index.count % 3 === 0 ? index.count / 3 : null;
}

/** MG10: the far levels' working tables (built in the slab tree worker) */
const FAR_SCRATCH: OwnedLabel = { owner: 'engine/slab-far', asset: 'far-levels', kind: 'scratch' };
/** MG10: ids for integer keys (below 2^53), handed out 0, 1, 2 ... in the order keys are first seen: an open-addressing
 *  table in two typed arrays, sized for at most `most` keys */
class IdTable {
  private readonly keys: Float64Array;
  private readonly ids: Int32Array;
  private readonly mask: number;
  size = 0;
  constructor(most: number) {
    let capacity = 16; while (capacity < most * 2) capacity *= 2;
    this.keys = ownedArray(Float64Array, capacity, FAR_SCRATCH); this.ids = ownedArray(Int32Array, capacity, FAR_SCRATCH).fill(-1); this.mask = capacity - 1;
  }
  clear(): void { if (this.size > 0) { this.ids.fill(-1); this.size = 0; } }
  id(key: number): number {
    const low = key >>> 0, high = Math.floor(key / 4294967296) >>> 0;
    let at = (Math.imul(low ^ Math.imul(high, 0x9e3779b1), 0x85ebca6b) ^ (low >>> 15)) & this.mask;
    for (;;) {
      const id = this.ids[at] ?? -1;
      if (id < 0) { this.keys[at] = key; this.ids[at] = this.size; return this.size++; }
      if (this.keys[at] === key) return id;
      at = (at + 1) & this.mask;
    }
  }
}

/** MG10: a growing run of triangle corners in a typed array (a number[] of them cost 8 bytes a corner and its growth) */
class Corners {
  private array = new Uint32Array(1024);
  length = 0;
  push(a: number, b: number, c: number): void {
    if (this.length + 3 > this.array.length) { const grown = ownedArray(Uint32Array, this.array.length * 2, FAR_SCRATCH); grown.set(this.array); this.array = grown; }
    this.array[this.length] = a; this.array[this.length + 1] = b; this.array[this.length + 2] = c; this.length += 3;
  }
  done(): Uint32Array { return this.array.slice(0, this.length); }
}

/**
 * NB23 (b): the far levels of a chunk whose index (`corners`, the tree's order) and tree `ranges` are built: per level
 * (`cells`, finest first), each leaf's coarse triangles, laid level after level and leaf after leaf (so a run of far leaves
 * at one level is one range), from triangle `ranges.triangles` on. Stops adding levels past `room` triangles (a level that
 * does not fit is left out, its cell Infinity). Returns the coarse corners to write after the chunk's own and the levels.
 */
export function slabFarLevels(corners: ArrayLike<number>, xyz: ArrayLike<number>, ranges: Omit<SlabRanges, 'far'>, cells: readonly number[] = SLAB_FAR_CELLS, room?: number, kinds: readonly SlabFarKind[] = []): { corners: Uint32Array; far: SlabFar } {
  const triangles = ranges.triangles, vertices = Math.floor(xyz.length / 3), count = ranges.nodes.length / 4, levels = cells.length;
  // each vertex's look: the facing cell of the first triangle that names it (a faceted kit's vertex is one face's)
  const looks = new Int16Array(vertices).fill(-1), scratch = new Int8Array(3), wound = new Float32Array(triangles * 3);
  for (let t = 0; t < triangles; t++) {
    const a = corners[t * 3] ?? 0, b = corners[t * 3 + 1] ?? 0, c = corners[t * 3 + 2] ?? 0;
    const cell = facingOf(xyz, a, b, c, scratch, 0), { x, y, z } = normalOf(xyz, a, b, c);
    wound[t * 3] = x; wound[t * 3 + 1] = y; wound[t * 3 + 2] = z;
    if ((looks[a] ?? 0) < 0) looks[a] = cell;
    if ((looks[b] ?? 0) < 0) looks[b] = cell;
    if ((looks[c] ?? 0) < 0) looks[c] = cell;
  }
  // MG10 (mini-ninemem7): the ids below come from typed hash tables, not Maps: a Map entry cost a worker ~60 bytes, and
  // Nine's largest chunk (~0.5 M vertices, five tables of them) took ~180 MB of WebKit for 0.3 s. Ids are handed out in
  // the order keys are first seen, as the Maps did, so the levels are the same bytes.
  const table = new IdTable(vertices);
  // and its kinds: the look becomes one id per facing cell and kind values (FNV-1a over the values' float32 bits)
  const look = new Int32Array(vertices);
  if (kinds.length === 0) for (let v = 0; v < vertices; v++) look[v] = (looks[v] ?? -1) + 1;
  else {
    const word = new Float32Array(1), bits = new Uint32Array(word.buffer);
    for (let v = 0; v < vertices; v++) {
      let hash = 0x811c9dc5;
      for (const { array, itemSize } of kinds) for (let k = 0; k < itemSize; k++) { word[0] = array[v * itemSize + k] ?? 0; hash = Math.imul(hash ^ (bits[0] ?? 0), 0x01000193) >>> 0; }
      look[v] = table.id(((looks[v] ?? -1) + 1) * 4294967296 + hash);
    }
  }
  const starts = new Int32Array(count * levels).fill(-1), ends = new Int32Array(count * levels).fill(-1), kept = Float64Array.from(cells);
  const out = new Corners(), grid = new IdTable(vertices);
  const moved = new Int32Array(vertices), place = ownedArray(Int32Array, vertices, FAR_SCRATCH), cluster = new Int32Array(vertices);
  for (let level = 0; level < levels; level++) {
    const size = cells[level] ?? Infinity, before = out.length;
    if (!(size > 0 && Number.isFinite(size))) { kept[level] = Infinity; continue; }
    // the clusters: grid cell (15 bits an axis, ±1.6 km at 0.1 m), then grid cell and look
    grid.clear();
    for (let v = 0; v < vertices; v++) {
      const x = Math.floor((xyz[v * 3] ?? 0) / size) + 16384, y = Math.floor((xyz[v * 3 + 1] ?? 0) / size) + 16384, z = Math.floor((xyz[v * 3 + 2] ?? 0) / size) + 16384;
      place[v] = grid.id((x * 32768 + y) * 32768 + z);
    }
    table.clear();
    for (let v = 0; v < vertices; v++) cluster[v] = table.id((place[v] ?? 0) * 2097152 + (look[v] ?? 0));
    const n = table.size, sum = new Float64Array(n * 3), members = new Int32Array(n), best = new Int32Array(n).fill(-1), near = new Float64Array(n).fill(Infinity);
    for (let v = 0; v < vertices; v++) { const id = cluster[v] ?? 0; sum[id * 3] = (sum[id * 3] ?? 0) + (xyz[v * 3] ?? 0); sum[id * 3 + 1] = (sum[id * 3 + 1] ?? 0) + (xyz[v * 3 + 1] ?? 0); sum[id * 3 + 2] = (sum[id * 3 + 2] ?? 0) + (xyz[v * 3 + 2] ?? 0); members[id] = (members[id] ?? 0) + 1; }
    for (let v = 0; v < vertices; v++) {
      const id = cluster[v] ?? 0, m = members[id] ?? 1;
      const dx = (xyz[v * 3] ?? 0) - (sum[id * 3] ?? 0) / m, dy = (xyz[v * 3 + 1] ?? 0) - (sum[id * 3 + 1] ?? 0) / m, dz = (xyz[v * 3 + 2] ?? 0) - (sum[id * 3 + 2] ?? 0) / m;
      const d = dx * dx + dy * dy + dz * dz; if (d < (near[id] ?? Infinity)) { near[id] = d; best[id] = v; }
    }
    for (let v = 0; v < vertices; v++) moved[v] = best[cluster[v] ?? 0] ?? v;
    for (let node = 0; node < count; node++) {
      if ((ranges.nodes[node * 4] ?? -1) >= 0) continue;
      const from = ranges.nodes[node * 4 + 2] ?? 0, to = ranges.nodes[node * 4 + 3] ?? 0, at = out.length;
      for (let t = from; t < to; t++) {
        const a = moved[corners[t * 3] ?? 0] ?? 0, b = moved[corners[t * 3 + 1] ?? 0] ?? 0, c = moved[corners[t * 3 + 2] ?? 0] ?? 0;
        if (a === b || b === c || a === c) continue;
        // turned over (or flat): its wound normal against the triangle it was
        const { x, y, z } = normalOf(xyz, a, b, c);
        if (x * (wound[t * 3] ?? 0) + y * (wound[t * 3 + 1] ?? 0) + z * (wound[t * 3 + 2] ?? 0) <= 0) continue;
        out.push(a, b, c);
      }
      const coarse = (out.length - at) / 3;
      if (coarse > SLAB_FAR_KEEP * (to - from)) { out.length = at; continue; }
      starts[node * levels + level] = triangles + at / 3; ends[node * levels + level] = triangles + out.length / 3;
    }
    if (out.length / 3 > (room ?? Infinity)) {
      // no room for this level: leave it out (a finer level that fit keeps its leaves)
      out.length = before; kept[level] = Infinity;
      for (let node = 0; node < count; node++) { starts[node * levels + level] = -1; ends[node * levels + level] = -1; }
    }
  }
  return { corners: out.done(), far: { cells: kept, starts, ends } };
}

/** a triangle's wound normal (not normalised; zero with no area), into `normal` */
const normal = new Vector3();
function normalOf(xyz: ArrayLike<number>, a: number, b: number, c: number): Vector3 {
  const ax = xyz[a * 3] ?? 0, ay = xyz[a * 3 + 1] ?? 0, az = xyz[a * 3 + 2] ?? 0;
  const ux = (xyz[b * 3] ?? 0) - ax, uy = (xyz[b * 3 + 1] ?? 0) - ay, uz = (xyz[b * 3 + 2] ?? 0) - az;
  const vx = (xyz[c * 3] ?? 0) - ax, vy = (xyz[c * 3 + 1] ?? 0) - ay, vz = (xyz[c * 3 + 2] ?? 0) - az;
  return normal.set(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}
/** a triangle's facing cell: the cube face its wound normal points through (+x, -x, +y, -y, +z, -z), then which of that
 *  face's `grid` × `grid` cells; the last cell (6 grid²) with no area */
function facingOf(xyz: ArrayLike<number>, a: number, b: number, c: number, normals: Int8Array, t: number, grid = 3): number {
  const { x: nx, y: ny, z: nz } = normalOf(xyz, a, b, c), x = Math.abs(nx), y = Math.abs(ny), z = Math.abs(nz);
  const big = Math.max(x, y, z), length = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (!(big > 0)) return 6 * grid * grid;
  normals[t * 3] = Math.round(nx / length * 127); normals[t * 3 + 1] = Math.round(ny / length * 127); normals[t * 3 + 2] = Math.round(nz / length * 127);
  const face = x === big ? (nx > 0 ? 0 : 1) : y === big ? (ny > 0 ? 2 : 3) : (nz > 0 ? 4 : 5);
  const u = x === big ? ny : y === big ? nz : nx, v = x === big ? nz : y === big ? nx : ny;
  return face * grid * grid + cellOf(u / big, grid) * grid + cellOf(v / big, grid);
}
/** which of `grid` equal parts of [-1, 1] `w` falls in */
function cellOf(w: number, grid: number): number { return grid === 3 ? w < -1 / 3 ? 0 : w < 1 / 3 ? 1 : 2 : Math.min(grid - 1, Math.floor((w + 1) / 2 * grid)); }
/** the most a unit normal turns rounded to 8 bits a component (half a step of 1/127 on each, ~0.0068 rad), with spare */
const NORMAL_ROUNDING = 0.012;
/** a leaf's cone (its triangles `order[from..to)`, their normals in `normals`): the mean of their unit wound normals
 *  and the least cosine of any of them to it, widened by `NORMAL_ROUNDING`, at `at`; -1 with a triangle of no area */
function coneOf(normals: Int8Array, order: ArrayLike<number>, from: number, to: number, cones: Float32Array, at: number): void {
  let mx = 0, my = 0, mz = 0;
  for (let i = from; i < to; i++) {
    const t = (order[i] ?? 0) * 3, x = normals[t] ?? 0, y = normals[t + 1] ?? 0, z = normals[t + 2] ?? 0, length = Math.sqrt(x * x + y * y + z * z);
    if (!(length > 0)) { cones[at + 3] = -1; return; }
    mx += x / length; my += y / length; mz += z / length;
  }
  const mean = Math.sqrt(mx * mx + my * my + mz * mz);
  if (!(mean > 0)) { cones[at + 3] = -1; return; }
  mx /= mean; my /= mean; mz /= mean;
  let least = 1;
  for (let i = from; i < to; i++) {
    const t = (order[i] ?? 0) * 3, x = normals[t] ?? 0, y = normals[t + 1] ?? 0, z = normals[t + 2] ?? 0;
    least = Math.min(least, (x * mx + y * my + z * mz) / Math.sqrt(x * x + y * y + z * z));
  }
  cones[at] = mx; cones[at + 1] = my; cones[at + 2] = mz; cones[at + 3] = Math.cos(Math.min(Math.PI, Math.acos(Math.min(1, least)) + NORMAL_ROUNDING));
}

/** a triangle's size: its longest edge. NB8 (mini-nb8g): not its thickness (its height off that edge): a long thin
 *  triangle under a pixel thick still draws as a line, and the thickness cut at 0.001 rad visibly dropped cables, the
 *  tree's ribbons and the gate's trim on Nine's phone spawn (same-instant A/B, ~2.1 k px); only a triangle short every
 *  way is a speck */
function sizeOf(xyz: ArrayLike<number>, a: number, b: number, c: number): number {
  const ax = xyz[a * 3] ?? 0, ay = xyz[a * 3 + 1] ?? 0, az = xyz[a * 3 + 2] ?? 0;
  const ux = (xyz[b * 3] ?? 0) - ax, uy = (xyz[b * 3 + 1] ?? 0) - ay, uz = (xyz[b * 3 + 2] ?? 0) - az;
  const vx = (xyz[c * 3] ?? 0) - ax, vy = (xyz[c * 3 + 1] ?? 0) - ay, vz = (xyz[c * 3 + 2] ?? 0) - az;
  const wx = vx - ux, wy = vy - uy, wz = vz - uz;
  return Math.sqrt(Math.max(ux * ux + uy * uy + uz * uz, vx * vx + vy * vy + vz * vz, wx * wx + wy * wy + wz * wz));
}

const frustum = new Frustum(), clip = new Matrix4();
/** whether the last `visibleSlabRun` or `visibleSlabDraws` found nothing to draw (and fell back to the first leaf) */
let nothingInView = false;
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
  nothingInView = start < 0;
  if (start < 0) { let node = 0; while ((ranges.nodes[node * 4] ?? -1) >= 0) node = ranges.nodes[node * 4] ?? 0; return [ranges.nodes[node * 4 + 2] ?? 0, ranges.nodes[node * 4 + 3] ?? 0]; }
  return [start, Math.max(start, last(ranges, 0))];
}

/**
 * NINE-DRAGON-BENCHMAX NB8 (mini-nb8d): the phone's draw of a slab chunk as one multi-draw of exactly its visible leaves,
 * each cut to its triangles at least `angle` × the leaf's distance long (`SlabRanges.size`: a leaf runs largest first,
 * so its kept triangles are a prefix). A triangle shorter than that every way is a speck under a pixel where it stands
 * (0.001 rad is ~0.7 device pixels at the phone's ~100° portrait at DPR 2), so it only shimmers; the shadow passes, warms and raycasts
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
/** mini-nb8h: whether every triangle of leaf `node` shows the camera at `local` its back, wherever in the leaf's box it
 *  lies: for a normal n in the leaf's cone (axis a, half angle θ) and v from the camera to a point of the box,
 *  v·n >= cos θ · (the box's least reach along a) - sin θ · (its furthest corner's distance) */
function backs(ranges: SlabRanges, node: number): boolean {
  const { boxes, cones } = ranges, at = node * 6, cone = node * 4, cos = cones[cone + 3] ?? -1;
  if (!(cos > 0)) return false;
  const ax = cones[cone] ?? 0, ay = cones[cone + 1] ?? 0, az = cones[cone + 2] ?? 0;
  const x0 = (boxes[at] ?? 0) - local.x, y0 = (boxes[at + 1] ?? 0) - local.y, z0 = (boxes[at + 2] ?? 0) - local.z;
  const x1 = (boxes[at + 3] ?? 0) - local.x, y1 = (boxes[at + 4] ?? 0) - local.y, z1 = (boxes[at + 5] ?? 0) - local.z;
  const reach = (ax > 0 ? x0 * ax : x1 * ax) + (ay > 0 ? y0 * ay : y1 * ay) + (az > 0 ? z0 * az : z1 * az);
  if (!(reach > 0)) return false;
  const fx = Math.max(Math.abs(x0), Math.abs(x1)), fy = Math.max(Math.abs(y0), Math.abs(y1)), fz = Math.max(Math.abs(z0), Math.abs(z1));
  // a margin of 1e-4 of the reach for float32 positions
  return cos * reach > Math.sqrt(Math.max(0, 1 - cos * cos)) * Math.sqrt(fx * fx + fy * fy + fz * fz) + 1e-4 * reach;
}
/** NB23 (b): each far level's ranges while a view is collected, appended after the leaves' own (`visibleSlabDraws`) */
const farDraws: (SlabDraws | undefined)[] = [];
function collect(ranges: SlabRanges, node: number, angle: number, facing: boolean, out: SlabDraws, farAngle: number): void {
  if (!visible(ranges.boxes, node)) return;
  const { nodes, boxes, size } = ranges, left = nodes[node * 4] ?? -1;
  if (left >= 0) { collect(ranges, left, angle, facing, out, farAngle); collect(ranges, nodes[node * 4 + 1] ?? 0, angle, facing, out, farAngle); return; }
  if (facing && backs(ranges, node)) return;
  const from = nodes[node * 4 + 2] ?? 0, to = nodes[node * 4 + 3] ?? 0, at = node * 6;
  // the camera's distance to the leaf's box (0 inside it), in the chunk's own frame
  const dx = Math.max((boxes[at] ?? 0) - local.x, 0, local.x - (boxes[at + 3] ?? 0));
  const dy = Math.max((boxes[at + 1] ?? 0) - local.y, 0, local.y - (boxes[at + 4] ?? 0));
  const dz = Math.max((boxes[at + 2] ?? 0) - local.z, 0, local.z - (boxes[at + 5] ?? 0));
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz), far = ranges.far;
  if (far !== undefined && farAngle > 0) {
    // NB23 (b): the coarsest level whose cell is under farAngle × the leaf's distance, if the leaf has it
    const levels = far.cells.length, reach = farAngle * distance;
    for (let level = levels - 1; level >= 0; level--) {
      if (!((far.cells[level] ?? Infinity) <= reach)) continue;
      const start = far.starts[node * levels + level] ?? -1;
      if (start < 0) continue;
      const draws = farDraws[level] ??= { starts: new Int32Array(64), counts: new Int32Array(64), n: 0, total: 0 };
      push(draws, start, far.ends[node * levels + level] ?? start);
      return;
    }
  }
  const floor = angle * distance;
  // the first triangle smaller than the floor (the leaf runs largest first)
  let lo = from, hi = to;
  while (lo < hi) { const mid = (lo + hi) >> 1; if ((size[mid] ?? 0) >= floor) lo = mid + 1; else hi = mid; }
  if (lo > from) push(out, from, lo);
}

/** The ranges of `ranges` that `camera` draws of an object drawn with `world`, every triangle under `angle` × its leaf's
 *  distance left out and, with `facing` (the caller's word that the GPU culls back faces: a front-sided material, a
 *  perspective camera, an unmirrored `world`), every leaf that shows the camera only its backs, into `out`; when nothing
 *  is left, the first leaf alone, so a parked warm still issues a real draw. */
export function visibleSlabDraws(ranges: SlabRanges, world: Matrix4, camera: Camera, angle: number, out: SlabDraws, facing = false, farAngle = 0): SlabDraws {
  clip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(world);
  frustum.setFromProjectionMatrix(clip, WebGLCoordinateSystem, camera.reversedDepth);
  local.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inverse.copy(world).invert());
  out.n = 0; out.total = 0;
  for (const draws of farDraws) if (draws !== undefined) { draws.n = 0; draws.total = 0; }
  collect(ranges, 0, angle, facing, out, farAngle);
  // NB23 (b): the far levels' ranges after the leaves' own (each level's run is in index order, so it joins as the leaves'
  // own do; two levels never join)
  for (const draws of farDraws) {
    // A coarser level can draw before the finer levels have scratch buffers.
    if (draws === undefined) continue;
    for (let i = 0; i < draws.n; i++) {
      const n = out.n;
      if (n === out.starts.length) { const starts = new Int32Array(n * 2), counts = new Int32Array(n * 2); starts.set(out.starts); counts.set(out.counts); out.starts = starts; out.counts = counts; }
      out.starts[n] = draws.starts[i] ?? 0; out.counts[n] = draws.counts[i] ?? 0; out.n = n + 1; out.total += draws.counts[i] ?? 0;
    }
  }
  nothingInView = out.n === 0;
  if (out.n === 0) { let node = 0; while ((ranges.nodes[node * 4] ?? -1) >= 0) node = ranges.nodes[node * 4] ?? 0; push(out, ranges.nodes[node * 4 + 2] ?? 0, ranges.nodes[node * 4 + 3] ?? 0); }
  return out;
}

/** the slice of a WebGL 2 context and of `WEBGL_multi_draw` the slab draw uses */
type DrawElementsInstanced = (mode: number, count: number, type: number, offset: number, instances: number) => void;
type DrawElements = (mode: number, count: number, type: number, offset: number) => void;
interface MultiDrawGl { drawElementsInstanced: DrawElementsInstanced; drawElements?: DrawElements; readonly UNSIGNED_INT: number; readonly UNSIGNED_SHORT: number }
interface MultiDrawExtension {
  readonly multiDrawElementsInstancedWEBGL: (mode: number, counts: Int32Array, countsOffset: number, type: number, offsets: Int32Array, offsetsOffset: number, instances: Int32Array, instancesOffset: number, drawCount: number) => void;
  readonly multiDrawElementsWEBGL?: (mode: number, counts: Int32Array, countsOffset: number, type: number, offsets: Int32Array, offsetsOffset: number, drawCount: number) => void;
}
interface SlabRenderer {
  readonly getContext: () => unknown;
  readonly extensions: { readonly has: (name: string) => boolean; readonly get: (name: string) => unknown };
  readonly info?: { readonly render: { readonly frame: number } };
}
/** NB8 (mini-nb8e): keyed by the renderer's extensions object, not the renderer: three builds a new one on a restored
 *  context (`initGLContext`), and an extension object from before the loss draws nothing */
const multiDraws = new WeakMap<object, MultiDrawExtension | null>();
function multiDrawOf(renderer: unknown): MultiDrawExtension | null {
  if (typeof renderer !== 'object' || renderer === null) return null;
  const extensions = Reflect.get(renderer, 'extensions') as SlabRenderer['extensions'] | undefined;
  if (typeof extensions !== 'object' || extensions === null) return null;
  const known = multiDraws.get(extensions);
  if (known !== undefined) return known;
  const extension = extensions.has('WEBGL_multi_draw') ? extensions.get('WEBGL_multi_draw') as MultiDrawExtension | null : null;
  const usable = extension !== null && typeof extension.multiDrawElementsInstancedWEBGL === 'function' ? extension : null;
  multiDraws.set(extensions, usable);
  return usable;
}

const draws: SlabDraws = { starts: new Int32Array(256), counts: new Int32Array(256), n: 0, total: 0 };
let offsets = new Int32Array(256), elements = new Int32Array(256), instances = new Int32Array(256);
/** the one draw armed on a context: its element count, the extension, and the renderer frame it was armed in */
interface Armed { readonly count: number; readonly extension: MultiDrawExtension; readonly info: { readonly frame: number } | undefined; readonly frame: number }
interface DrawHook { armed: Armed | null; readonly wrapper: (mode: number, count: number, type: number, offset: number, instances?: number) => void }
/** per context, the hook over `drawElementsInstanced` (instanced parts) and, mini-nb8j, over `drawElements` (a plain mesh) */
const hooks = new WeakMap<object, DrawHook>(), singleHooks = new WeakMap<object, DrawHook>();
/**
 * The context's draw hook (mini-nb8e, replacing mini-nb8d's per-draw swap): one wrapper over the context's
 * `drawElementsInstanced`, installed once per context and left in place, that turns a draw of exactly the armed size from
 * offset 0 into the multi-draw of `draws` and passes every other call through. It is armed in a part's `onBeforeRender`
 * and disarmed in its `onAfterRender`, and an arm only fires in the renderer frame it was made in, so a draw that throws
 * between the two (three never reaches `onAfterRender`) leaves no stale swap for the next frame's draws. A context lost and
 * restored keeps its JS object and the hook. Another wrapper laid over ours later is wrapped in turn.
 */
function hookOf(gl: MultiDrawGl, instanced = true): DrawHook | null {
  const method = instanced ? 'drawElementsInstanced' : 'drawElements', map = instanced ? hooks : singleHooks;
  const held = map.get(gl);
  if (held !== undefined && Reflect.get(gl, method) === held.wrapper) return held;
  const plain: unknown = Reflect.get(gl, method);
  if (typeof plain !== 'function') return null;
  const hook: DrawHook = {
    armed: null,
    // STR20: every draw on the context passes through here, so it takes its arguments by name (a rest array and a
    // Reflect.apply list were two arrays per draw) @frame
    wrapper: function wrapper(this: unknown, mode: number, elementCount: number, type: number, offset: number, instanceCount?: number): void {
      const armed = hook.armed;
      const single = instanced ? undefined : armed?.extension.multiDrawElementsWEBGL;
      if (armed === null || elementCount !== armed.count || offset !== 0 || (armed.info !== undefined && armed.info.frame !== armed.frame) || (!instanced && single === undefined)) {
        if (instanced) (plain as DrawElementsInstanced).call(this, mode, elementCount, type, offset, instanceCount ?? 1);
        else (plain as DrawElements).call(this, mode, elementCount, type, offset);
        return;
      }
      const n = draws.n, bytes = type === gl.UNSIGNED_INT ? 4 : type === gl.UNSIGNED_SHORT ? 2 : 1;
      if (offsets.length < n) { offsets = new Int32Array(n * 2); elements = new Int32Array(n * 2); instances = new Int32Array(n * 2); }
      for (let i = 0; i < n; i++) { offsets[i] = (draws.starts[i] ?? 0) * 3 * bytes; elements[i] = (draws.counts[i] ?? 0) * 3; instances[i] = instanceCount ?? 1; }
      if (single !== undefined) single.call(armed.extension, mode, elements, 0, type, offsets, 0, n);
      else armed.extension.multiDrawElementsInstancedWEBGL(mode, elements, 0, type, offsets, 0, instances, 0, n);
    },
  };
  Reflect.set(gl, method, hook.wrapper);
  map.set(gl, hook);
  return hook;
}

/** mini-nb8j: how `cullSlabRanges` draws a part other than a slab chunk */
export interface SlabCullOptions {
  /** a plain mesh (three draws it with `drawElements`) multi-draws its visible leaves too, with `multiDrawElementsWEBGL` */
  readonly single?: boolean;
  /** another owner sets the draw range between draws (a tile driver, `tiledMesh`): each draw reads it, culls only while it
   *  is the whole index, and puts back the range it found */
  readonly liveRange?: boolean;
  /** NB23 (b): the phone's `slabFarAngle`: a leaf draws its far level (`SlabRanges.far`) at least cell / farAngle away,
   *  in a perspective camera's view only (a shadow camera's distance is no measure of size on screen) */
  readonly farAngle?: number;
}

/** Draw `part` (whose geometry `ranges` was built on) as its visible run for each camera that renders it; the full
 *  range is restored after every draw, so shadow passes, warms, raycasts and bounds read the whole chunk. With an
 *  `angle` (the phone tier's `slabLodAngle`), `WEBGL_multi_draw` and an instanced part (three draws it with
 *  `drawElementsInstanced`), the draw is instead its visible leaves cut to their triangles at least `angle` × distance
 *  long (`visibleSlabDraws`), in one multi-draw; otherwise it stays the run. */
export function cullSlabRanges(part: Object3D & { geometry: BufferGeometry }, ranges: SlabRanges, angle = 0, options: SlabCullOptions = {}): void {
  const geometry = part.geometry, { start, count } = geometry.drawRange, live = options.liveRange === true;
  const instanced = (part as Object3D & { isInstancedMesh?: boolean }).isInstancedMesh === true;
  const multi = instanced ? angle > 0 : options.single === true;
  const copies = part as Object3D & { count?: number };
  let hook: DrawHook | null = null, drawn = false, held = -1;
  /** liveRange: the range found before this draw, put back after it (or before the next, when a draw threw) */
  let found: readonly [number, number] | null = null;
  /** mini-nb8e: a chunk that has drawn once (its pipeline is built) and has nothing in view issues no draw: three skips an
   *  instanced draw of zero copies (no GL call, no count), and the copies come back after it. Its first draw stays the
   *  first leaf, so a parked warm still builds its pipeline */
  const skip = (): boolean => {
    if (!instanced || !nothingInView || !drawn) { drawn = true; return false; }
    held = copies.count ?? 1; copies.count = 0;
    return true;
  };
  part.onBeforeRender = drawNeutral((renderer: unknown, _scene: unknown, camera: Camera, _geometry: unknown, material: Material): void => {
    if (hook !== null) { hook.armed = null; hook = null; }
    if (held >= 0) { copies.count = held; held = -1; }
    if (live) {
      if (found !== null) { geometry.setDrawRange(found[0], found[1]); found = null; }
      const now = geometry.drawRange;
      if (now.start !== 0 || now.count < ranges.triangles * 3) return;
      found = [now.start, now.count];
    }
    const usable = multi && geometry.groups.length === 0 ? multiDrawOf(renderer) : null;
    // mini-nb8j: a plain mesh needs the extension's non-instanced multi-draw
    const extension = usable !== null && (instanced || typeof usable.multiDrawElementsWEBGL === 'function') ? usable : null;
    if (extension === null) {
      const [from, to] = visibleSlabRun(ranges, part.matrixWorld, camera);
      geometry.setDrawRange(from * 3, (to - from) * 3);
      skip();
      return;
    }
    // mini-nb8h: back-facing leaves are left out only where the GPU culls them anyway: the pass's material (an
    // override's included) front-sided, a perspective camera (its eye a point) and an unmirrored world (three keeps the
    // winding)
    const facing = material.side === FrontSide && (camera as Camera & { isPerspectiveCamera?: boolean }).isPerspectiveCamera === true && part.matrixWorld.determinant() > 0;
    const perspective = (camera as Camera & { isPerspectiveCamera?: boolean }).isPerspectiveCamera === true;
    const out = visibleSlabDraws(ranges, part.matrixWorld, camera, angle, draws, facing, perspective ? options.farAngle ?? 0 : 0);
    if (skip()) return;
    if (out.n === 1) { geometry.setDrawRange((out.starts[0] ?? 0) * 3, (out.counts[0] ?? 0) * 3); return; }
    geometry.setDrawRange(0, out.total * 3);
    const info = (renderer as SlabRenderer).info?.render;
    hook = hookOf((renderer as SlabRenderer).getContext() as MultiDrawGl, instanced);
    if (hook === null) { const [from, to] = visibleSlabRun(ranges, part.matrixWorld, camera); geometry.setDrawRange(from * 3, (to - from) * 3); return; }
    hook.armed = { count: out.total * 3, extension, info, frame: info?.frame ?? 0 };
  });
  part.onAfterRender = drawNeutral((): void => {
    if (hook !== null) { hook.armed = null; hook = null; }
    if (held >= 0) { copies.count = held; held = -1; }
    if (!live) geometry.setDrawRange(start, count);
    else if (found !== null) { geometry.setDrawRange(found[0], found[1]); found = null; }
  });
}
