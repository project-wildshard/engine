/**
 * The road system's per-view budget (SHARD-PLATFORM SF17b, §3.2 road targets, G101): ≤ 60k triangles drawn and ≤ 8 draws in
 * any view, shadow draws included, while the collider keeps full resolution.
 *
 * Every road material is ONE mesh for the whole platform, so a view costs one draw per material whatever it sees. Its index
 * buffer is sorted into spatial bins (squares of the declared lattice; legacy callers use half a pitch), each with
 * a bounding sphere over its own triangles. Before the mesh draws, the bins inside the camera's frustum are copied into the
 * front of a dynamic index buffer and the draw range shrinks to them: one ordinary indexed draw of only what the view can
 * see. No multi-draw and no BatchedMesh (E271 / E272): it is a plain `drawElements` with an index range uploaded with
 * `bufferSubData`, and only when the visible set changes. A triangle is drawn whenever its bin's sphere meets the frustum
 * and the sphere bounds the triangle, so nothing in view is ever culled.
 *
 * Pure three.js (no DOM), so Node tests pin the per-view numbers.
 */
import { CHUNK_HALF } from '@wildshard/engine/core/config';
import { gpuOnlyAttributes, gpuOnlyTexture } from '@wildshard/engine/core/gpuOnly';
import { ownedArray } from '@wildshard/engine/core/ownedBuffer';
import { BufferAttribute, type BufferGeometry, type Camera, DoubleSide, DynamicDrawUsage, Frustum, InstancedMesh, type InterleavedBufferAttribute, type Material, Matrix4, Mesh, type Object3D, Sphere, type Texture, Vector3 } from 'three';
import type { PlatformRenderBytePlan } from './renderResidency';
import { takeClipRoom } from './clipRoom';

/** Drain ordered road construction without yielding (the synchronous/native callers). */
export function finishRoadSteps<T>(steps: Generator<void, T>): T {
  for (;;) { const next = steps.next(); if (next.done === true) return next.value; }
}

/** One bin: its sphere (in the mesh's local frame) and its run of the sorted source index. */
interface CullBin { readonly visibility?: { visible: boolean }; readonly lod?: readonly number[]; readonly sphere: Sphere; readonly start: number; readonly count: number; readonly levels: readonly { readonly start: number; readonly count: number }[]; readonly tile?: { readonly x: number; readonly z: number } }
/** A culled mesh's bins and its full, bin-sorted index (kept on the CPU to rebuild the drawn range from); past each LOD
 *  tier's distance a bin draws that tier's coarse run. */
export interface CullPlan { readonly source: Uint32Array; readonly bins: readonly CullBin[]; readonly lod: readonly number[] }
/** A far-bin LOD tier: past `distance` metres a bin draws a copy clustered on a `cell`-metre lattice. */
export interface CullLod { readonly distance: number; readonly cell: number }
/** The deck's far LOD tiers, nearest first (render only; the collider is the generator's full mesh). */
export const ROAD_LOD: readonly CullLod[] = [{ distance: 150, cell: 4 }, { distance: 450, cell: 12 }];

const BIN_DIVISOR = 2;
/** Fixed road tiles use world-grid edges; omitted size preserves the old centred-bin arithmetic. */
function binGrid(pitch: number, tileSize?: number): { size: number; offset: number } {
  const size = tileSize ?? pitch / BIN_DIVISOR;
  if (!Number.isFinite(size) || size <= 0) throw new RangeError('Invalid road tile size');
  return { size, offset: tileSize === undefined ? 0.5 : 0 };
}
/** A cell edge's distance from its cell centre (the seam's outer row meets the shard's own ground there). */
const CELL_EDGE = CHUNK_HALF;

/** IOSMEM (WILDSHARD-GAME-8G): the clip's and bin sort's working lists, growing typed storage off the JS heap. As
 *  number[] they held ~40-90 bytes a triangle of short-lived heap through an install (hundreds of MB on Driftwood's road),
 *  which an iPhone counts against the page until it collects. */
class Grow<A extends Uint32Array | Float64Array> {
  length = 0;
  private array: A;
  private readonly make: (size: number) => A;
  constructor(array: A, make: (size: number) => A) {
    this.array = array; this.make = make;}
  push(value: number): void {
    if (this.length === this.array.length) { const next = this.make(Math.max(64, this.array.length * 2)); next.set(this.array); this.array = next; }
    this.array[this.length++] = value;
  }
  /** The filled part; `exact` copies it out so a long-kept result never pins the spare capacity. */
  view(exact = false): A {
    if (!exact) return this.array.subarray(0, this.length) as A;
    return (this.length === this.array.length ? this.array : this.array.slice(0, this.length)) as A;
  }
}
const growU32 = (size: number): Grow<Uint32Array> => new Grow(new Uint32Array(size), (n) => new Uint32Array(n));
const growF64 = (size: number): Grow<Float64Array> => new Grow(new Float64Array(size), (n) => new Float64Array(n));

/** DF11: whether `getX/Y/Z/W(n)` of an attribute is exactly `array[n * itemSize + component]`: a plain, unnormalized
 *  attribute whose getters are three's own (no override, no spy). Then the hot loops index its array (a getter call
 *  returning a number boxed it: frame garbage while the road builds beside play); otherwise they call the getters as
 *  before. Checked again after every pause, so an array swapped or a getter set while paused is honoured from the next batch. */
function plainAttribute(attribute: BufferAttribute | InterleavedBufferAttribute): attribute is BufferAttribute {
  const proto = BufferAttribute.prototype;
  return attribute instanceof BufferAttribute && !attribute.normalized && attribute.getX === proto.getX && attribute.getY === proto.getY
    && attribute.getZ === proto.getZ && attribute.getW === proto.getW;
}

/** How the clip reads a run's corners and coordinates: from arrays when `refresh` finds them plain (`round` rounds each to
 *  Float32 as the geometry stores it), else through the accessors. `refresh` runs before the first triangle and after
 *  every pause. */
interface ClipReads {
  readonly refresh: () => void;
  indices: ArrayLike<number> | null; readonly indexAt: (i: number) => number;
  coords: ArrayLike<number> | null; coordStride: number; readonly round: boolean; readonly coordinate: (n: number, axis: number) => number;
}

/** The same attribute interpolation and index order, yielding between bounded triangle/copy batches. */
export function* clipToBinsSteps(geometry: BufferGeometry, pitch: number, tileSize?: number): Generator<void> {
  const index = geometry.getIndex(), names = Object.keys(geometry.attributes);
  if (index === null || index.count === 0) return;
  const attrs: (Attribute | undefined)[] = names.map((name) => geometry.getAttribute(name)), sizes = attrs.map((a) => a?.itemSize ?? 0), stride = sizes.reduce((a, b) => a + b, 0);
  const count = attrs[0]?.count ?? 0, position = geometry.getAttribute('position');
  const read = (n: number, into: Float64Array, at: number): void => {
    let o = at;
    for (let k = 0; k < attrs.length; k++) {
      const a = attrs[k], size = sizes[k] ?? 0;
      if (a !== undefined) for (let c = 0; c < size; c++) into[o + c] = a.array[n * size + c] ?? 0;
      else for (let c = 0; c < size; c++) into[o + c] = 0;
      o += size;
    }
  };
  const at = names.indexOf('position'), px = at === -1 ? 0 : sizes.slice(0, at).reduce((a, b) => a + b, 0);
  // DF11: the index and positions straight from their arrays while the index's getter is three's own
  const reads: ClipReads = { indices: null, indexAt: (i) => index.getX(i), coords: null, coordStride: 3, round: false,
    coordinate: (n, axis) => position.array[n * position.itemSize + axis] ?? 0,
    refresh: () => {
      const plain = plainAttribute(index) && index.itemSize === 1;
      reads.indices = plain ? index.array : null; reads.coords = plain ? position.array : null; reads.coordStride = position.itemSize;
    } };
  const { extra, out } = yield* clipCore(index.count / 3, reads, count, stride, px, read, pitch, tileSize);
  if (extra.length === 0) return;
  const total = count + extra.length / stride;
  let o = 0;
  for (const [k, name] of names.entries()) {
    const a = attrs[k], size = sizes[k] ?? 0; if (a === undefined) continue;
    // DW12b: a channel the merge made with room for the cut vertices grows in place; any other is copied, as before
    const room = takeClipRoom(a.array, total * size), array = room ?? new Float32Array(total * size);
    if (room === null) for (let i = 0; i < count * size; i++) { if (i % 4096 === 0) yield; array[i] = a.array[i] ?? 0; }
    for (let n = 0; n < extra.length / stride; n++) { if (n % 256 === 0) yield; for (let c = 0; c < size; c++) array[(count + n) * size + c] = extra[n * stride + o + c] ?? 0; }
    geometry.setAttribute(name, new BufferAttribute(array, size)); o += size;
    attrs[k] = undefined; // the old channel goes now, not after the last is copied
  }
  geometry.setIndex(new BufferAttribute(out.slice(), 1));
}

/**
 * The clip's arithmetic, shared by `clipToBins` and the byte plan (`cullCounts`): each triangle cut along the bin lines on
 * x then z, a new vertex interpolating all `stride` values linearly (position at `px`). A plan that reads only positions
 * gets exactly the builder's positions, new vertices and triangles: every value interpolates on its own.
 */
function* clipCore(triangles: number, reads: ClipReads, count: number, stride: number, px: number, read: (n: number, into: Float64Array, at: number) => void, pitch: number, tileSize?: number, retain = true): Generator<void, { extra: Float64Array; out: Uint32Array; added: number; corners: number }> {
  // Most triangles fit one bin, so the index is about three corners a triangle; cut triangles grow it.
  const { size: s, offset } = binGrid(pitch, tileSize), extra = growF64(retain ? stride * 64 : 0), out = growU32(retain ? triangles * 3 + 64 : 0);
  let added = 0, corners = 0;
  // SB38 (WILDSHARD-GAME-8Z): a cut triangle's polygons live in scratch, reused for every triangle: each vertex's values
  // in `pool` (a slot of `stride` values) with its index in `ids`, each polygon a run of slots. Before, every cut
  // triangle made a Float64Array and an object a vertex and arrays a polygon and a split, garbage JavaScriptCore grows
  // its heap for while the page builds the road beside play. The order of new vertices, their interpolation and the
  // index order are the old split's. Count-only admission (`retain` false) keeps no final index or copied channels.
  let pool = new Float64Array(stride * 32), ids = new Float64Array(32), used = 0;
  const slot = (n: number): number => {
    if (used === ids.length) {
      const grown = new Float64Array(pool.length * 2); grown.set(pool); pool = grown;
      const grownIds = new Float64Array(ids.length * 2); grownIds.set(ids); ids = grownIds;
    }
    ids[used] = n; return used++;
  };
  const value = (at: number, k: number): number => pool[at * stride + k] ?? 0;
  // polygon lists: `polys`/`next` hold runs (start, length) into their slot lists; `work`, `lo` and `hi` are one polygon each
  let polySlots: number[] = [], polyRuns: number[] = [], polyCount = 0;
  let nextSlots: number[] = [], nextRuns: number[] = [], nextCount = 0, nextFill = 0;
  const lo: number[] = [];
  let work: number[] = [], hi: number[] = [];
  let workLength = 0, loLength = 0, hiLength = 0;
  const pushNext = (from: readonly number[], length: number): void => {
    nextRuns[nextCount * 2] = nextFill; nextRuns[nextCount * 2 + 1] = length; nextCount++;
    for (let i = 0; i < length; i++) nextSlots[nextFill++] = from[i] ?? 0;
  };
  /** Split `work` by the line axis = c into `lo` and `hi` (new vertices interpolated, added in edge order). */
  const split = (axis: number, c: number): void => {
    loLength = 0; hiLength = 0;
    for (let i = 0; i < workLength; i++) {
      const a = work[i] ?? 0, b = work[(i + 1) % workLength] ?? 0;
      const da = value(a, px + axis) - c, db = value(b, px + axis) - c;
      if (da < 0) lo[loLength++] = a; else hi[hiLength++] = a;
      if ((da < 0) !== (db < 0)) {
        const t = da / (da - db), m = slot(0), at = m * stride, from = a * stride, to = b * stride;
        for (let k = 0; k < stride; k++) pool[at + k] = (pool[from + k] ?? 0) + ((pool[to + k] ?? 0) - (pool[from + k] ?? 0)) * t;
        pool[at + px + axis] = c;
        if (retain) for (let k = 0; k < stride; k++) extra.push(pool[at + k] ?? 0);
        ids[m] = count + added++;
        lo[loLength++] = m; hi[hiLength++] = m;
      }
    }
  };
  let indices: ArrayLike<number> | null = null, coords: ArrayLike<number> | null = null, cs = 3;
  const round = reads.round;
  for (let t = 0; t < triangles; t++) {
    if (t % 256 === 0) { yield; reads.refresh(); indices = reads.indices; coords = reads.coords; cs = reads.coordStride; }
    let a: number, b: number, third: number;
    if (indices !== null) { a = indices[t * 3] ?? 0; b = indices[t * 3 + 1] ?? 0; third = indices[t * 3 + 2] ?? 0; }
    else { a = reads.indexAt(t * 3); b = reads.indexAt(t * 3 + 1); third = reads.indexAt(t * 3 + 2); }
    // the corners' x and z (DF11: indexed in place when the reads are arrays, so no call returns a boxed number)
    let ax: number, bx: number, cx: number, az: number, bz: number, cz: number;
    if (coords !== null) {
      ax = coords[a * cs] ?? 0; bx = coords[b * cs] ?? 0; cx = coords[third * cs] ?? 0;
      az = coords[a * cs + 2] ?? 0; bz = coords[b * cs + 2] ?? 0; cz = coords[third * cs + 2] ?? 0;
      if (round) { ax = Math.fround(ax); bx = Math.fround(bx); cx = Math.fround(cx); az = Math.fround(az); bz = Math.fround(bz); cz = Math.fround(cz); }
    } else {
      ax = reads.coordinate(a, 0); bx = reads.coordinate(b, 0); cx = reads.coordinate(third, 0);
      az = reads.coordinate(a, 2); bz = reads.coordinate(b, 2); cz = reads.coordinate(third, 2);
    }
    // Most triangles already fit one bin. Keep their indices without allocating
    // polygons or copying attributes; only an interior cut needs interpolation.
    if (!crossesBin(ax, bx, cx, s, offset) && !crossesBin(az, bz, cz, s, offset)) {
      corners += 3; if (retain) { out.push(a); out.push(b); out.push(third); } continue;
    }
    used = 0;
    const sa = slot(a), sb = slot(b), sc = slot(third); // slots before reads: a growth replaces `pool`
    read(a, pool, sa * stride); read(b, pool, sb * stride); read(third, pool, sc * stride);
    polySlots[0] = 0; polySlots[1] = 1; polySlots[2] = 2; polyRuns[0] = 0; polyRuns[1] = 3; polyCount = 1;
    for (let axis = 0; axis <= 2; axis += 2) {
      nextCount = 0; nextFill = 0;
      for (let p = 0; p < polyCount; p++) {
        const from = polyRuns[p * 2] ?? 0; workLength = polyRuns[p * 2 + 1] ?? 0;
        let low = Infinity, high = -Infinity;
        for (let i = 0; i < workLength; i++) { const at = polySlots[from + i] ?? 0; work[i] = at; const v = value(at, px + axis); low = Math.min(low, v); high = Math.max(high, v); }
        for (let k = Math.ceil(low / s - offset); (k + offset) * s < high; k++) {
          const c = (k + offset) * s; if (c <= low) continue;
          split(axis, c);
          if (loLength >= 3) pushNext(lo, loLength);
          const spare = work; work = hi; hi = spare; workLength = hiLength;
        }
        if (workLength >= 3) pushNext(work, workLength);
      }
      const slots = polySlots, runs = polyRuns; polySlots = nextSlots; polyRuns = nextRuns; nextSlots = slots; nextRuns = runs;
      polyCount = nextCount;
    }
    for (let p = 0; p < polyCount; p++) {
      const from = polyRuns[p * 2] ?? 0, length = polyRuns[p * 2 + 1] ?? 0, first = ids[polySlots[from] ?? 0] ?? 0;
      for (let k = 1; k + 1 < length; k++) {
        corners += 3;
        if (retain) { out.push(first); out.push(ids[polySlots[from + k] ?? 0] ?? 0); out.push(ids[polySlots[from + k + 1] ?? 0] ?? 0); }
      }
    }
  }
  return { extra: extra.view(), out: out.view(), added, corners };
}


/** Match clipCore's strict interior-line test, including vertices on bin edges. */
function crossesBin(a: number, b: number, c: number, size: number, offset: number): boolean {
  const lo = Math.min(a, b, c), hi = Math.max(a, b, c);
  const k = Math.ceil(lo / size - offset), edge = (k + offset) * size;
  return (edge > lo ? edge : (k + 1 + offset) * size) < hi;
}

/** Lattice boxes within this many of the origin on every axis key as one number (a 46-bit integer: exact). */
const LOD_SPAN = 4096;
/** Exact edge predicate shared by each LOD vertex, without a closure per vertex. */
function onLodLine(v: number, size: number, offset: number, pitch: number): boolean {
  const bin = Math.abs(v / size - Math.round(v / size));
  if (Math.abs(bin - offset) * size < 1e-3) return true;
  const local = Math.abs(v - Math.round(v / pitch) * pitch);
  return Math.abs(local - CELL_EDGE) < 1e-3;
}

/**
 * DF11: the first vertex of each LOD lattice box and material, recorded once per key. A box and material in the usual
 * ranges is one exact integer key (a 46-bit number) in an open-addressed table on typed arrays: a Map held each key as a
 * boxed number and grew its table on the JS heap, one entry per box of every road install. Anything else keys a string.
 * A vertex reads its position from its array, so no coordinate is passed as an argument.
 */
class LodFirsts {
  private keys = ownedArray(Float64Array, 1024, { owner: 'grid/road-cull', asset: 'lod-firsts', kind: 'scratch' }).fill(-1);
  private values = ownedArray(Int32Array, 1024, { owner: 'grid/road-cull', asset: 'lod-firsts', kind: 'scratch' });
  private used = 0;
  private readonly named = new Map<string, number>();
  private readonly size: number; private readonly offset: number;
  private readonly pitch: number;
  private readonly cell: number;
  constructor(pitch: number, cell: number, tileSize?: number) {
    this.pitch = pitch; this.cell = cell;
    this.size = tileSize ?? pitch / BIN_DIVISOR; this.offset = tileSize === undefined ? 0.5 : 0;
  }
  /** `n`'s representative: the first vertex recorded for its box and material (`n` itself when it is the first, or when it
   *  lies on a bin or cell edge), at (`x`, `y`, `z`). */
  rep(n: number, x: number, y: number, z: number, layer: number, unlit: number): number {
    if (onLodLine(x, this.size, this.offset, this.pitch) || onLodLine(z, this.size, this.offset, this.pitch)) return n;
    return this.box(n, Math.floor(x / this.cell), Math.floor(y / this.cell), Math.floor(z / this.cell), layer, unlit);
  }
  /** `rep` with the position read from `positions[at..at + 2]` (rounded to Float32 when `round`): no coordinate is passed. */
  repAt(n: number, positions: ArrayLike<number>, at: number, round: boolean, layer: number, unlit: number): number {
    let x = positions[at] ?? 0, y = positions[at + 1] ?? 0, z = positions[at + 2] ?? 0;
    if (round) { x = Math.fround(x); y = Math.fround(y); z = Math.fround(z); }
    if (onLodLine(x, this.size, this.offset, this.pitch) || onLodLine(z, this.size, this.offset, this.pitch)) return n;
    return this.box(n, Math.floor(x / this.cell), Math.floor(y / this.cell), Math.floor(z / this.cell), layer, unlit);
  }
  private box(n: number, ix: number, iy: number, iz: number, layer: number, unlit: number): number {
    if (Math.abs(ix) < LOD_SPAN && Math.abs(iy) < LOD_SPAN && Math.abs(iz) < LOD_SPAN && Number.isInteger(layer) && layer >= 0 && layer < 64 && (unlit === 0 || unlit === 1)) {
      // the key lodKey always used: exact (under 2^47), never negative, so -1 marks an empty slot
      const high = (ix + LOD_SPAN) * 2 * LOD_SPAN + iy + LOD_SPAN, low = (iz + LOD_SPAN) * 128 + layer * 2 + unlit;
      return this.first(high, low, n);
    }
    const key = `${String(ix)},${String(iy)},${String(iz)},${String(layer)},${String(unlit)}`;
    const seen = this.named.get(key); if (seen === undefined) { this.named.set(key, n); return n; }
    return seen;
  }
  /** The value at key `high` * 2^20 + `low` (`high` < 2^26, `low` < 2^20: small integers, never boxed), or `n` stored
   *  there when the key is new. */
  private first(high: number, low: number, n: number): number {
    const key = high * 1048576 + low;
    if ((this.used + 1) * 2 > this.keys.length) this.grow();
    const mask = this.keys.length - 1;
    for (let at = (Math.imul(high, 0x9e3779b1) ^ Math.imul(low, 0x85ebca77)) & mask; ; at = (at + 1) & mask) {
      const held = this.keys[at] ?? -1;
      if (held === key) return this.values[at] ?? n;
      if (held === -1) { this.keys[at] = key; this.values[at] = n; this.used++; return n; }
    }
  }
  private grow(): void {
    const keys = this.keys, values = this.values;
    this.keys = ownedArray(Float64Array, keys.length * 2, { owner: 'grid/road-cull', asset: 'lod-firsts', kind: 'scratch' }).fill(-1); this.values = ownedArray(Int32Array, keys.length * 2, { owner: 'grid/road-cull', asset: 'lod-firsts', kind: 'scratch' }); this.used = 0;
    for (let at = 0; at < keys.length; at++) {
      const key = keys[at] ?? -1; if (key === -1) continue;
      const high = Math.floor(key / 1048576), low = key - high * 1048576;
      this.first(high, low, values[at] ?? 0);
    }
  }
}

/** A bin row of the sort (`cullPlanSteps`). */
interface BinRow { readonly key: string; readonly x: number; readonly z: number; readonly id: number; count: number }
type Attribute = ReturnType<BufferGeometry['getAttribute']>;
type Index = NonNullable<ReturnType<BufferGeometry['getIndex']>>;
/* DF11: the plan's per-triangle and per-vertex loops run in these plain functions, one 256-step chunk a call, between the
 * generator's pauses. A loop inside a generator resumed at each pause kept its numbers as heap objects (each running
 * min, max and sum boxed a step, ~21 KB a dock frame at 3x); here V8 keeps them as plain doubles. Same operations, same
 * order: `ix` and `pa` are the arrays while plain (refreshed after each pause), else three's getters. */
function binChunk(from: number, to: number, ix: ArrayLike<number> | null, pa: ArrayLike<number>, ps: number, index: Index, position: Attribute,
  size: number, offset: number, byBin: Map<number, Map<number, BinRow>>, binOf: Uint32Array, binCount: number): number {
  let next = binCount;
  for (let t = from; t < to; t++) {
    let x = 0, z = 0;
    if (ix !== null) for (let c = 0; c < 3; c++) { const n = ix[t * 3 + c] ?? 0; x += pa[n * ps] ?? 0; z += pa[n * ps + 2] ?? 0; }
    else for (let c = 0; c < 3; c++) { const n = index.getX(t * 3 + c); x += position.getX(n); z += position.getZ(n); }
    const bx = Math.floor(x / 3 / size + offset), bz = Math.floor(z / 3 / size + offset);
    let row = byBin.get(bx); if (row === undefined) { row = new Map(); byBin.set(bx, row); }
    let bin = row.get(bz);
    if (bin === undefined) { bin = { key: `${String(bx)},${String(bz)}`, x: bx, z: bz, id: next++, count: 0 }; row.set(bz, bin); }
    bin.count++; binOf[t] = bin.id;
  }
  return next;
}
/** One chunk of a bin's triangles: their corners onto `out`, each new vertex into `unique` and the running box `b`
 *  (min xyz, max xyz). Returns the unique count. */
function boundsChunk(list: Uint32Array, from: number, to: number, ix: ArrayLike<number> | null, pa: ArrayLike<number>, ps: number, index: Index, position: Attribute,
  out: Grow<Uint32Array>, boundedIn: Uint32Array, binId: number, unique: Uint32Array, uniqueCount: number, b: Float64Array): number {
  let count = uniqueCount;
  let minX = b[0] ?? 0, minY = b[1] ?? 0, minZ = b[2] ?? 0, maxX = b[3] ?? 0, maxY = b[4] ?? 0, maxZ = b[5] ?? 0;
  for (let i = from; i < to; i++) {
    const t = list[i] ?? 0;
    for (let c = 0; c < 3; c++) {
      const n = ix !== null ? ix[t * 3 + c] ?? 0 : index.getX(t * 3 + c); out.push(n);
      if (boundedIn[n] === binId) continue;
      boundedIn[n] = binId; unique[count++] = n;
      const x = ix !== null ? pa[n * ps] ?? 0 : position.getX(n), y = ix !== null ? pa[n * ps + 1] ?? 0 : position.getY(n), z = ix !== null ? pa[n * ps + 2] ?? 0 : position.getZ(n);
      minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
    }
  }
  b[0] = minX; b[1] = minY; b[2] = minZ; b[3] = maxX; b[4] = maxY; b[5] = maxZ;
  return count;
}
/** The largest squared distance from `centre` to a bin's unique vertices. */
function farthestFrom(centre: Vector3, unique: Uint32Array, uniqueCount: number, ix: ArrayLike<number> | null, pa: ArrayLike<number>, ps: number, position: Attribute): number {
  let farthest = 0;
  for (let i = 0; i < uniqueCount; i++) {
    const n = unique[i] ?? 0;
    const dx = centre.x - (ix !== null ? pa[n * ps] ?? 0 : position.getX(n)), dy = centre.y - (ix !== null ? pa[n * ps + 1] ?? 0 : position.getY(n)),
      dz = centre.z - (ix !== null ? pa[n * ps + 2] ?? 0 : position.getZ(n));
    farthest = Math.max(farthest, dx * dx + dy * dy + dz * dz);
  }
  return farthest;
}

/** Sort the identical bin/LOD runs with pauses inside triangle batches; no partial plan is published. */
export function* cullPlanSteps(geometry: BufferGeometry, pitch: number, lod: readonly CullLod[] = [], tileSize?: number): Generator<void, CullPlan> {
  const index = geometry.getIndex(), position = geometry.getAttribute('position');
  if (index === null) throw new Error('A culled road mesh needs an index');
  // each triangle's bin (`cullBin` of its centroid) as two numbers; a bin's string key, made once, orders the bins
  const { size, offset } = binGrid(pitch, tileSize);
  // Each triangle's bin id in one typed pass, then a counting sort keeps every bin's triangles in index order (IOSMEM:
  // no number[] list per bin on the JS heap).
  const triangles = index.count / 3, byBin = new Map<number, Map<number, BinRow>>(), binOf = new Uint32Array(triangles);
  // DF11: while the index, positions and grain are plain (`plainAttribute`, checked after every pause) the loops index
  // their arrays; otherwise they call three's getters exactly as before
  const grain = geometry.hasAttribute('grainUv') ? geometry.getAttribute('grainUv') : undefined;
  let ix: ArrayLike<number> | null = null, pa: ArrayLike<number> = [], ps = 3;
  const refresh = (): void => {
    const plain = plainAttribute(index) && index.itemSize === 1 && plainAttribute(position) && (grain === undefined || plainAttribute(grain));
    ix = plain ? index.array : null; pa = plain ? position.array : []; ps = position.itemSize;
  };
  let binCount = 0;
  for (let t0 = 0; t0 < triangles; t0 += 256) {
    yield; refresh();
    binCount = binChunk(t0, Math.min(triangles, t0 + 256), ix, pa, ps, index, position, size, offset, byBin, binOf, binCount);
  }
  const firsts = new Uint32Array(binCount + 1), members = new Uint32Array(triangles);
  for (const row of byBin.values()) for (const bin of row.values()) firsts[bin.id + 1] = bin.count;
  for (let b = 0; b < binCount; b++) firsts[b + 1] = (firsts[b + 1] ?? 0) + (firsts[b] ?? 0);
  { const cursor = firsts.slice(0, binCount); for (let t = 0; t < triangles; t++) { if (t % 4096 === 0) { yield; refresh(); } const b = binOf[t] ?? 0; members[cursor[b] ?? 0] = t; cursor[b] = (cursor[b] ?? 0) + 1; } }
  const out = growU32(triangles * 3 + 64), bins: CullBin[] = [];
  const clusters = lod.map((tier) => ({ firsts: new LodFirsts(pitch, tier.cell, tileSize), memo: new Int32Array(position.count).fill(-1) }));
  // Vertex clustering for a far LOD tier: each vertex maps to the first vertex of its `cell`-metre lattice box that wears the
  // same material (grain layer + unlit flag). Vertices on a bin edge or a cell edge (where the seam meets the shard's own
  // ground) stay themselves, so a coarse bin meets its fine neighbour and the shard's terrain without a crack. It reads
  // as the bin loops do (DF11: arrays while plain, else three's getters in the old order).
  const cluster = (tier: { readonly firsts: LodFirsts; readonly memo: Int32Array }, n: number): number => {
    const known = tier.memo[n] ?? -1; if (known >= 0) return known;
    let rep: number;
    if (ix !== null) {
      const layer = grain === undefined ? 0 : grain.array[n * grain.itemSize + 2] ?? 0, unlit = grain === undefined ? 0 : grain.array[n * grain.itemSize + 3] ?? 0;
      rep = tier.firsts.repAt(n, pa, n * ps, false, layer, unlit);
    } else rep = tier.firsts.rep(n, position.getX(n), position.getY(n), position.getZ(n), grain?.getZ(n) ?? 0, grain?.getW(n) ?? 0);
    tier.memo[n] = rep; return rep;
  };
  const ordered: BinRow[] = [];
  for (const row of byBin.values()) for (const bin of row.values()) ordered.push(bin);
  ordered.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  // A shared indexed vertex contributes once per bin to both bounds scans.
  // Keep triangle publication and LOD representative order unchanged.
  const boundedIn = new Uint32Array(position.count);
  const unique = ownedArray(Uint32Array, position.count, { owner: 'grid/road-cull', asset: 'bin-vertices', kind: 'scratch' });
  let binId = 0;
  const bounds = ownedArray(Float64Array, 6, { owner: 'grid/road-cull', asset: 'bin-bounds', kind: 'scratch' });
  for (const { id, x: tileX, z: tileZ } of ordered) {
    const list = members.subarray(firsts[id] ?? 0, firsts[id + 1] ?? 0);
    const start = out.length;
    let uniqueCount = 0;
    binId++;
    bounds[0] = Infinity; bounds[1] = Infinity; bounds[2] = Infinity; bounds[3] = -Infinity; bounds[4] = -Infinity; bounds[5] = -Infinity;
    for (let i0 = 0; i0 < list.length; i0 += 256) {
      yield; refresh();
      uniqueCount = boundsChunk(list, i0, Math.min(list.length, i0 + 256), ix, pa, ps, index, position, out, boundedIn, binId, unique, uniqueCount, bounds);
    }
    const count = out.length - start, levels: { start: number; count: number }[] = [];
    // three's Sphere.setFromPoints over these vertices without a Vector3 each: the box centre, then the farthest vertex
    const sphere = new Sphere();
    sphere.center.set((bounds[0] ?? 0) + (bounds[3] ?? 0), (bounds[1] ?? 0) + (bounds[4] ?? 0), (bounds[2] ?? 0) + (bounds[5] ?? 0)).multiplyScalar(0.5);
    if (count === 0) sphere.center.set(0, 0, 0);
    sphere.radius = Math.sqrt(farthestFrom(sphere.center, unique, uniqueCount, ix, pa, ps, position));
    for (const tier of clusters) {
      const from = out.length;
      for (let i = 0; i < list.length; i++) {
        if (i % 256 === 0) { yield; refresh(); }
        const t = list[i] ?? 0;
        const a = cluster(tier, ix !== null ? ix[t * 3] ?? 0 : index.getX(t * 3)), b = cluster(tier, ix !== null ? ix[t * 3 + 1] ?? 0 : index.getX(t * 3 + 1)),
          c = cluster(tier, ix !== null ? ix[t * 3 + 2] ?? 0 : index.getX(t * 3 + 2));
        if (a !== b && b !== c && a !== c) { out.push(a); out.push(b); out.push(c); }
      }
      levels.push({ start: from, count: out.length - from });
    }
    bins.push({ sphere, start, count, levels, ...(tileSize === undefined ? {} : { tile: { x: tileX, z: tileZ } }) });
  }
  return { source: out.view(true), bins, lod: lod.map((tier) => tier.distance) };
}

/** How the road builders cull a mesh (`cullRoadMesh` at `pitch`, the view camera) and where each mesh's plan is kept. */
export interface RoadCuller { readonly pitch: number; readonly tileSize?: number; readonly prepare?: (mesh: Mesh, plan: CullPlan) => Generator<void, void>; readonly camera?: () => Camera | undefined; readonly plans: Map<Mesh, CullPlan> }

/** Complete clipping and sorting before installing the live view hook and publishing its plan. */
export function* cullIntoSteps(culler: RoadCuller, mesh: Mesh, lod: readonly CullLod[] = []): Generator<void> {
  yield* clipToBinsSteps(mesh.geometry, culler.pitch, culler.tileSize);
  const plan = yield* cullPlanSteps(mesh.geometry, culler.pitch, lod, culler.tileSize);
  if (culler.prepare !== undefined) yield* culler.prepare(mesh, plan);
  publishRoadPlan(culler, mesh, plan);
}

/** Publish a fully prepared plan (including compact road tiles) behind the same
 * single indexed-draw culler. The caller owns geometry and must admit it first. */
export function publishRoadPlan(culler: RoadCuller, mesh: Mesh, plan: CullPlan): void {
  attachRoadCull(mesh, plan, culler.camera);
  culler.plans.set(mesh, plan);
}

/**
 * A run of triangles as a road geometry will hold them, read without building it: `position(k)` is component k (vertex
 * k / 3) exactly as the geometry's Float32 array will store it, `indices` local to the run, and the run's one material
 * (`roadSolid.ts`: a part never mixes layers, so the deck's far LOD key needs one layer per run).
 */
export interface CullSource { readonly vertices: number; readonly position: (k: number) => number; readonly indices: ArrayLike<number>; readonly layer?: number; readonly unlit?: number;
  /** DF11: the same components unrounded, when `position(k)` is exactly `Math.fround(float32[k] ?? 0)`: the count copies
   *  them into one Float32Array instead of calling `position` (a call returning a number boxed it). */
  readonly float32?: ArrayLike<number> }
/** What `cullRoadMesh` will hold: the geometry's vertices before and after `clipToBins`, and the sorted source's length. */
export interface CullCounts { readonly vertices: number; readonly clipped: number; readonly source: number }


/** Exact pre-allocation counts, with the same clipping arithmetic yielded in bounded batches. */
export function* cullCountsSteps(sources: readonly CullSource[], pitch: number, lod?: readonly CullLod[], tileSize?: number): Generator<void, CullCounts> {
  let vertices = 0, clipped = 0, source = 0;
  for (const run of sources) {
    // DF11: a run with its components as an array (`float32`) is indexed in place, rounded as the geometry will store it;
    // otherwise `position` is called as before. Either way every read is live, so an edit while paused is seen.
    const float32 = run.float32, at = (n: number, c: number): number => run.position(n * 3 + c);
    const read = (n: number, into: Float64Array, to: number): void => {
      if (float32 !== undefined) { into[to] = Math.fround(float32[n * 3] ?? 0); into[to + 1] = Math.fround(float32[n * 3 + 1] ?? 0); into[to + 2] = Math.fround(float32[n * 3 + 2] ?? 0); }
      else { into[to] = run.position(n * 3); into[to + 1] = run.position(n * 3 + 1); into[to + 2] = run.position(n * 3 + 2); }
    };
    const reads: ClipReads = { indices: run.indices, indexAt: (i) => run.indices[i] ?? 0, coords: float32 ?? null, coordStride: 3, round: true, coordinate: at, refresh: () => undefined };
    // Only an omitted tier list is privately known to stay empty. A supplied
    // empty array may acquire a tier while the original generator is paused.
    const { extra, out, added, corners } = yield* clipCore(run.indices.length / 3, reads, run.vertices, 3, 0, read, pitch, tileSize, lod !== undefined);
    vertices += run.vertices; clipped += run.vertices + added; source += corners;
    for (const tier of lod ?? []) {
      const memo = new Int32Array(run.vertices + extra.length / 3).fill(-1), firsts = new LodFirsts(pitch, tier.cell, tileSize);
      const layer = run.layer ?? 0, unlit = run.unlit ?? 0;
      // a clip vertex (past the run's own) reads the clip's Float64 values, rounded to Float32 as the geometry stores them
      const representative = (n: number): number => {
        const known = memo[n] ?? -1; if (known >= 0) return known;
        const rep = n >= run.vertices ? firsts.repAt(n, extra, (n - run.vertices) * 3, true, layer, unlit)
          : float32 !== undefined ? firsts.repAt(n, float32, n * 3, true, layer, unlit)
            : firsts.rep(n, at(n, 0), at(n, 1), at(n, 2), layer, unlit);
        memo[n] = rep; return rep;
      };
      for (let i = 0; i < out.length; i += 3) {
        if (i % 768 === 0) yield;
        const a = representative(out[i] ?? 0), b = representative(out[i + 1] ?? 0), c = representative(out[i + 2] ?? 0);
        if (a !== b && b !== c && a !== c) source += 3;
      }
    }
  }
  return { vertices, clipped, source };
}

/** Retained bytes: JS (typed arrays kept on the CPU) and GPU (buffers and every mip level). */
export interface RenderBytes { readonly jsBytes: number; readonly gpuBytes: number }

/** Yielded byte planning remains exact and completes before an allocation can be admitted. */
export function* meshBytesSteps(sources: readonly CullSource[], floats: number, cull?: { readonly pitch: number; readonly tileSize?: number; readonly lod?: readonly CullLod[] }, gpuOnly = false): Generator<void, RenderBytes & { readonly clipped: number }> {
  if (cull === undefined) {
    let vertices = 0, indices = 0;
    for (const run of sources) { vertices += run.vertices; indices += run.indices.length; }
    const vertexBytes = vertices * floats * 4, indexBytes = indices * 4;
    return { jsBytes: (gpuOnly ? 0 : vertexBytes) + indexBytes, gpuBytes: vertexBytes + indexBytes, clipped: vertices };
  }
  const counts = yield* cullCountsSteps(sources, cull.pitch, cull.lod, cull.tileSize);
  const vertexBytes = counts.clipped * floats * 4, indexBytes = counts.source * 4;
  // `clipped`: the vertices the clip will hold (DW12b: the lean merge makes each channel that size once)
  return { jsBytes: (gpuOnly ? 0 : vertexBytes) + 2 * indexBytes, gpuBytes: vertexBytes + indexBytes, clipped: counts.clipped };
}

/**
 * G144: an admitted road mesh keeps no CPU copy of what only the GPU reads. Every static vertex attribute (position too: the
 * cull reads its bins and sorted source, never the vertices, and nothing raycasts the road) and each texture's source (a
 * canvas painted once, the grain array) go the moment they upload; the dynamic drawn index and the cull's sorted source
 * stay. Call it right after `cullInto`, before the first draw. A lost context reloads the page (`markGpuOnly`).
 */
export function gpuOnlyRoad(mesh: Mesh, textures: readonly Texture[]): void {
  gpuOnlyAttributes(mesh.geometry, 'grid.road', []);
  for (const t of textures) gpuOnlyTexture(t, 'grid.road');
}
/** Sum retained bytes into one admission plan. */
export function bytePlan(id: string, ...parts: readonly RenderBytes[]): PlatformRenderBytePlan {
  return { id, jsBytes: parts.reduce((sum, p) => sum + p.jsBytes, 0), gpuBytes: parts.reduce((sum, p) => sum + p.gpuBytes, 0) };
}

/** The view's frustum in world space. Inside a render (`fresh`) three has already brought the camera's matrices up to date:
 *  updating it again per road draw walked the camera's whole subtree (the held weapon and hands) each time (G639). */
function frustumOf(camera: Camera, out: Frustum, scratch: Matrix4, fresh = false): Frustum {
  if (!fresh) camera.updateMatrixWorld();
  return out.setFromProjectionMatrix(scratch.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
}

/** The runs of a plan a camera draws: per bin in the frustum its fine run, or its coarse run past the LOD distance. */
function visibleRuns(plan: CullPlan, matrixWorld: Matrix4, frustum: Frustum, sphere: Sphere, eye: Vector3): { start: number; count: number; id: number }[] {
  const out: { start: number; count: number; id: number }[] = [];
  plan.bins.forEach((bin, k) => {
    if (bin.visibility?.visible === false) return;
    if (!frustum.intersectsSphere(sphere.copy(bin.sphere).applyMatrix4(matrixWorld))) return;
    const d = sphere.distanceToPoint(eye);
    const lod = bin.lod ?? plan.lod;
    let level = 0; while (level < lod.length && d > (lod[level] ?? Infinity)) level++;
    const run = level === 0 ? bin : bin.levels[level - 1] ?? bin;
    out.push({ start: run.start, count: run.count, id: k * 4 + level });
  });
  return out;
}

/** A culled mesh's live readout. */
export interface CullState { readonly bins: number; readonly visible: number; readonly triangles: number; readonly rebuilds: number }


function attachRoadCull(mesh: Mesh, plan: CullPlan, main?: () => Camera | undefined): { plan: CullPlan; state: () => CullState } {
  const geometry = mesh.geometry;
  const drawn = new BufferAttribute(new Uint32Array(plan.source.length), 1).setUsage(DynamicDrawUsage);
  let fine = 0; // until the first culled draw: every bin's fine run
  for (const bin of plan.bins) { drawn.array.set(plan.source.subarray(bin.start, bin.start + bin.count), fine); fine += bin.count; }
  geometry.setIndex(drawn); geometry.setDrawRange(0, fine);
  mesh.frustumCulled = false;
  const frustum = new Frustum(), matrix = new Matrix4(), sphere = new Sphere(), eye = new Vector3();
  // Views borrow the immutable plan's buffer; every draw reuses these selections.
  const choices = plan.bins.map(bin => [bin, ...bin.levels].map(run => plan.source.subarray(run.start, run.start + run.count)));
  const runs: Uint32Array[] = choices.map(row => row[0] ?? plan.source);
  let ids = plan.bins.map(() => 0), previous = ids.slice(), previousCount = 0;
  const update = { start: 0, count: 0 };
  let triangles = fine / 3, visible = plan.bins.length, rebuilds = 0;
  // DF11: each bin's world sphere (centre xyz, radius), worked out as three's Sphere.applyMatrix4 does and kept while the
  // mesh's world matrix holds; the draw tests it against the frustum's planes with plain numbers. Copying and moving a
  // Sphere per bin per draw boxed its fields (~33 KB a dock frame at 3x).
  const worldSpheres = ownedArray(Float64Array, plan.bins.length * 4, { owner: 'grid/road-cull', asset: 'world-spheres', kind: 'scratch' });
  const sphereMatrix = ownedArray(Float64Array, 16, { owner: 'grid/road-cull', asset: 'world-spheres', kind: 'scratch' }).fill(Number.NaN);
  const placeSpheres = (m: Matrix4): void => {
    const e = m.elements;
    let same = true;
    for (let i = 0; i < 16; i++) if (sphereMatrix[i] !== e[i]) { same = false; break; }
    if (same) return;
    sphereMatrix.set(e);
    for (let k = 0; k < plan.bins.length; k++) {
      const bin = plan.bins[k]; if (bin === undefined) continue;
      sphere.copy(bin.sphere).applyMatrix4(m);
      worldSpheres[k * 4] = sphere.center.x; worldSpheres[k * 4 + 1] = sphere.center.y; worldSpheres[k * 4 + 2] = sphere.center.z;
      worldSpheres[k * 4 + 3] = sphere.radius;
    }
  };
  const planes = frustum.planes;
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    const view = main?.();
    if (view !== undefined && camera !== view) return;
    frustumOf(camera, frustum, matrix, true); eye.setFromMatrixPosition(camera.matrixWorld);
    placeSpheres(mesh.matrixWorld);
    const ex = eye.x, ey = eye.y, ez = eye.z;
    let count = 0, changed = false;
    for (let k = 0; k < plan.bins.length; k++) {
      const bin = plan.bins[k];
      if (bin === undefined || bin.visibility?.visible === false) continue;
      // three's Frustum.intersectsSphere and Sphere.distanceToPoint, on the kept world sphere
      const cx = worldSpheres[k * 4] ?? 0, cy = worldSpheres[k * 4 + 1] ?? 0, cz = worldSpheres[k * 4 + 2] ?? 0, radius = worldSpheres[k * 4 + 3] ?? 0;
      let inside = true;
      for (let i = 0; i < 6; i++) {
        const plane = planes[i]; if (plane === undefined) continue;
        const n = plane.normal;
        if (n.x * cx + n.y * cy + n.z * cz + plane.constant < -radius) { inside = false; break; }
      }
      if (!inside) continue;
      const dx = ex - cx, dy = ey - cy, dz = ez - cz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - radius;
      const lod = bin.lod ?? plan.lod;
    let level = 0; while (level < lod.length && d > (lod[level] ?? Infinity)) level++;
      const run = choices[k]?.[level] ?? choices[k]?.[0];
      if (run === undefined) throw new Error('Missing road cull run');
      const id = k * 4 + level;
      runs[count] = run; ids[count] = id;
      if (previous[count] !== id) changed = true;
      count++;
    }
    if (!changed && count === previousCount) return;
    const spare = previous; previous = ids; ids = spare; previousCount = count; rebuilds++;
    let at = 0;
    for (let k = 0; k < count; k++) {
      const run = runs[k]; if (run === undefined) throw new Error('Missing visible road cull run');
      drawn.array.set(run, at); at += run.length;
    }
    drawn.clearUpdateRanges();
    if (at > 0) { update.count = at; drawn.updateRanges.push(update); drawn.needsUpdate = true; }
    geometry.setDrawRange(0, at);
    triangles = at / 3; visible = count;
  };
  return { plan, state: () => ({ bins: plan.bins.length, visible, triangles, rebuilds }) };
}

/** The road system's cost in one view: draws (shadow draws included) and triangles, as the renderer would issue them. */
export interface RoadViewCost { readonly draws: number; readonly triangles: number; readonly shadowDraws: number; readonly byMesh: Readonly<Record<string, { draws: number; triangles: number }>> }
/** The resident cost: unique triangles uploaded, the triangles instancing expands to, and the far-LOD index copies (they
 *  reuse the full mesh's vertices: index bytes only). */
export interface RoadResident { readonly triangles: number; readonly instanced: number; readonly meshes: number; readonly bins: number; readonly widestBin: number; readonly lodTriangles: number }

const isMesh = (o: Object3D): o is Mesh => o instanceof Mesh;
const trianglesOf = (geometry: BufferGeometry, start: number, count: number): number => {
  // a mesh still being painted in steps (9c533f9ac1) can stand with no index or position yet: it draws nothing
  const total = geometry.getIndex()?.count ?? (geometry.hasAttribute('position') ? geometry.getAttribute('position').count : 0);
  return Math.max(0, Math.min(total, start + count) - Math.max(0, start)) / 3;
};

/**
 * Count what a camera draws of the road system: a culled mesh's visible bins (evaluated here exactly as its pre-draw hook
 * does), any other mesh by three's own test (its bounding sphere, unless `frustumCulled` is off), one draw per geometry
 * group, instances multiplying triangles, and a second draw for each caster (the shadow pass).
 */
export function roadViewCost(roots: readonly Object3D[], camera: Camera, plans: ReadonlyMap<Mesh, CullPlan> = new Map()): RoadViewCost {
  const frustum = frustumOf(camera, new Frustum(), new Matrix4()), sphere = new Sphere(), byMesh: Record<string, { draws: number; triangles: number }> = {};
  let draws = 0, triangles = 0, shadowDraws = 0;
  for (const root of roots) root.traverseVisible((o) => {
    if (!isMesh(o)) return;
    o.updateMatrixWorld();
    const geometry: BufferGeometry = o.geometry, plan = plans.get(o);
    let d = 0, t = 0;
    if (plan !== undefined) {
      const runs = visibleRuns(plan, o.matrixWorld, frustum, sphere, new Vector3().setFromMatrixPosition(camera.matrixWorld));
      t = runs.reduce((sum, r) => sum + r.count, 0) / 3; d = t > 0 ? 1 : 0;
    } else {
      if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
      const bound = geometry.boundingSphere;
      const seen = !o.frustumCulled || bound === null || frustum.intersectsSphere(sphere.copy(bound).applyMatrix4(o.matrixWorld));
      if (seen) {
        const groups = Array.isArray(o.material) && geometry.groups.length > 0 ? geometry.groups : [{ start: geometry.drawRange.start, count: geometry.drawRange.count }];
        for (const g of groups) { const n = trianglesOf(geometry, g.start, g.count); if (n > 0) { d++; t += n; } }
        if (o instanceof InstancedMesh) t *= o.count;
      }
    }
    // three draws a transparent double-sided material twice (back faces, then front) unless it is forced single-pass
    const passes = (Array.isArray(o.material) ? o.material : [o.material]).some((m: Material) => m.transparent && m.side === DoubleSide && !m.forceSinglePass) ? 2 : 1;
    d *= passes; t *= passes;
    if (o.castShadow && d > 0) { shadowDraws += d; t *= 2; }
    if (d === 0) return;
    draws += d; triangles += t;
    const entry = byMesh[o.name] ?? { draws: 0, triangles: 0 };
    entry.draws += d; entry.triangles += t; byMesh[o.name] = entry;
  });
  return { draws: draws + shadowDraws, triangles, shadowDraws, byMesh };
}

/** Count the road system's resident triangles (unique) and what instancing expands them to. */
export function roadResident(roots: readonly Object3D[], plans: ReadonlyMap<Mesh, CullPlan> = new Map()): RoadResident {
  let triangles = 0, instanced = 0, meshes = 0, bins = 0, widestBin = 0, lodTriangles = 0;
  for (const plan of plans.values()) for (const bin of plan.bins) { bins++; widestBin = Math.max(widestBin, Math.round(bin.sphere.radius)); for (const l of bin.levels) lodTriangles += l.count / 3; }
  for (const root of roots) root.traverse((o) => {
    if (!isMesh(o)) return;
    const geometry: BufferGeometry = o.geometry, plan = plans.get(o);
    const n = plan !== undefined ? plan.bins.reduce((sum, b) => sum + b.count, 0) / 3 : trianglesOf(geometry, 0, Infinity);
    meshes++; triangles += n; instanced += o instanceof InstancedMesh ? n * o.count : n;
  });
  return { triangles, instanced, meshes, bins, widestBin, lodTriangles };
}
