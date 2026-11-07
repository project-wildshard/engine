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
import { BufferAttribute, type BufferGeometry, type Camera, DoubleSide, DynamicDrawUsage, Frustum, InstancedMesh, type Material, Matrix4, Mesh, type Object3D, Sphere, type Texture, Vector3 } from 'three';
import type { PlatformRenderBytePlan } from './renderResidency';

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


/** The same attribute interpolation and index order, yielding between bounded triangle/copy batches. */
export function* clipToBinsSteps(geometry: BufferGeometry, pitch: number, tileSize?: number): Generator<void> {
  const index = geometry.getIndex(), names = Object.keys(geometry.attributes);
  if (index === null || index.count === 0) return;
  const attrs = names.map((name) => geometry.getAttribute(name)), sizes = attrs.map((a) => a.itemSize), stride = sizes.reduce((a, b) => a + b, 0);
  const count = attrs[0]?.count ?? 0, position = geometry.getAttribute('position');
  const read = (n: number): Float64Array => {
    const v = new Float64Array(stride); let o = 0;
    for (let k = 0; k < attrs.length; k++) {
      const a = attrs[k], size = sizes[k] ?? 0;
      if (a !== undefined) for (let c = 0; c < size; c++) v[o + c] = a.array[n * size + c] ?? 0;
      o += size;
    }
    return v;
  };
  const at = names.indexOf('position'), px = at === -1 ? 0 : sizes.slice(0, at).reduce((a, b) => a + b, 0);
  const { extra, out } = yield* clipCore(index.count / 3, (i) => index.getX(i), count, stride, px, read, (n, axis) => position.array[n * position.itemSize + axis] ?? 0, pitch, tileSize);
  if (extra.length === 0) return;
  const total = count + extra.length / stride;
  let o = 0;
  for (const [k, name] of names.entries()) {
    const a = attrs[k], size = sizes[k] ?? 0; if (a === undefined) continue;
    const array = new Float32Array(total * size);
    for (let i = 0; i < count * size; i++) { if (i % 4096 === 0) yield; array[i] = a.array[i] ?? 0; }
    for (let n = 0; n < extra.length / stride; n++) { if (n % 256 === 0) yield; for (let c = 0; c < size; c++) array[(count + n) * size + c] = extra[n * stride + o + c] ?? 0; }
    geometry.setAttribute(name, new BufferAttribute(array, size)); o += size;
  }
  geometry.setIndex(new BufferAttribute(Uint32Array.from(out), 1));
}

/**
 * The clip's arithmetic, shared by `clipToBins` and the byte plan (`cullCounts`): each triangle cut along the bin lines on
 * x then z, a new vertex interpolating all `stride` values linearly (position at `px`). A plan that reads only positions
 * gets exactly the builder's positions, new vertices and triangles: every value interpolates on its own.
 */
function* clipCore(triangles: number, indexAt: (i: number) => number, count: number, stride: number, px: number, read: (n: number) => Float64Array, coordinate: (n: number, axis: number) => number, pitch: number, tileSize?: number, retain = true): Generator<void, { extra: number[]; out: number[]; added: number; corners: number }> {
  const { size: s, offset } = binGrid(pitch, tileSize), extra: number[] = [], out: number[] = [];
  let added = 0, corners = 0;
  // Count-only admission needs no final index or copied interpolation channels.
  // Polygon vertices still retain every value used by the original split.
  const add = (v: Float64Array): number => { if (retain) for (const x of v) extra.push(x); return count + added++; };
  interface V { n: number; v: Float64Array }
  /** Split a convex polygon by the line axis = c into its below and above parts (new vertices interpolated). */
  const split = (poly: readonly V[], axis: number, c: number): [V[], V[]] => {
    const lo: V[] = [], hi: V[] = [];
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length]; if (b === undefined) return;
      const da = (a.v[px + axis] ?? 0) - c, db = (b.v[px + axis] ?? 0) - c;
      (da < 0 ? lo : hi).push(a);
      if ((da < 0) !== (db < 0)) {
        const t = da / (da - db), v = new Float64Array(stride);
        for (let k = 0; k < stride; k++) v[k] = (a.v[k] ?? 0) + ((b.v[k] ?? 0) - (a.v[k] ?? 0)) * t;
        v[px + axis] = c; const m = { n: add(v), v }; lo.push(m); hi.push(m);
      }
    });
    return [lo, hi];
  };
  for (let t = 0; t < triangles; t++) {
    if (t % 256 === 0) yield;
    const a = indexAt(t * 3), b = indexAt(t * 3 + 1), third = indexAt(t * 3 + 2);
    // Most triangles already fit one bin. Keep their indices without allocating
    // polygons or copying attributes; only an interior cut needs interpolation.
    if (!crossesBin(coordinate(a, 0), coordinate(b, 0), coordinate(third, 0), s, offset)
      && !crossesBin(coordinate(a, 2), coordinate(b, 2), coordinate(third, 2), s, offset)) {
      corners += 3; if (retain) out.push(a, b, third); continue;
    }
    const tri: V[] = [a, b, third].map((n) => ({ n, v: read(n) }));
    let polys: V[][] = [tri];
    for (const axis of [0, 2]) {
      const next: V[][] = [];
      for (let poly of polys) {
        const values = poly.map((p) => p.v[px + axis] ?? 0), lo = Math.min(...values), hi = Math.max(...values);
        for (let k = Math.ceil(lo / s - offset); (k + offset) * s < hi; k++) {
          const c = (k + offset) * s; if (c <= lo) continue;
          const [below, above] = split(poly, axis, c);
          if (below.length >= 3) next.push(below);
          poly = above;
        }
        if (poly.length >= 3) next.push(poly);
      }
      polys = next;
    }
    for (const poly of polys) for (let k = 1; k + 1 < poly.length; k++) {
      corners += 3;
      if (retain) out.push(poly[0]?.n ?? 0, poly[k]?.n ?? 0, poly[k + 1]?.n ?? 0);
    }
  }
  return { extra, out, added, corners };
}


/** Match clipCore's strict interior-line test, including vertices on bin edges. */
function crossesBin(a: number, b: number, c: number, size: number, offset: number): boolean {
  const lo = Math.min(a, b, c), hi = Math.max(a, b, c);
  const k = Math.ceil(lo / size - offset), edge = (k + offset) * size;
  return (edge > lo ? edge : (k + 1 + offset) * size) < hi;
}

/** Sort the identical bin/LOD runs with pauses inside triangle batches; no partial plan is published. */
export function* cullPlanSteps(geometry: BufferGeometry, pitch: number, lod: readonly CullLod[] = [], tileSize?: number): Generator<void, CullPlan> {
  const index = geometry.getIndex(), position = geometry.getAttribute('position');
  if (index === null) throw new Error('A culled road mesh needs an index');
  // each triangle's bin (`cullBin` of its centroid) as two numbers; a bin's string key, made once, orders the bins
  const { size, offset } = binGrid(pitch, tileSize);
  const triangles = index.count / 3, byBin = new Map<number, Map<number, { readonly key: string; readonly x: number; readonly z: number; readonly list: number[] }>>();
  for (let t = 0; t < triangles; t++) {
    if (t % 256 === 0) yield;
    let x = 0, z = 0;
    for (let c = 0; c < 3; c++) { const n = index.getX(t * 3 + c); x += position.getX(n); z += position.getZ(n); }
    const bx = Math.floor(x / 3 / size + offset), bz = Math.floor(z / 3 / size + offset);
    let row = byBin.get(bx); if (row === undefined) { row = new Map(); byBin.set(bx, row); }
    const bin = row.get(bz);
    if (bin === undefined) row.set(bz, { key: `${String(bx)},${String(bz)}`, x: bx, z: bz, list: [t] }); else bin.list.push(t);
  }
  const out: number[] = [], bins: CullBin[] = [];
  const clusters = lod.map((tier) => clusterer(geometry, pitch, tier.cell, tileSize));
  const ordered: { readonly key: string; readonly x: number; readonly z: number; readonly list: number[] }[] = [];
  for (const row of byBin.values()) for (const bin of row.values()) ordered.push(bin);
  ordered.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  // A shared indexed vertex contributes once per bin to both bounds scans.
  // Keep triangle publication and LOD representative order unchanged.
  const boundedIn = new Uint32Array(position.count);
  let binId = 0;
  for (const { list, x: tileX, z: tileZ } of ordered) {
    const start = out.length, unique: number[] = [];
    binId++;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < list.length; i++) {
      if (i % 256 === 0) yield;
      const t = list[i] ?? 0;
      for (let c = 0; c < 3; c++) {
        const n = index.getX(t * 3 + c); out.push(n);
        if (boundedIn[n] === binId) continue;
        boundedIn[n] = binId; unique.push(n);
        const x = position.getX(n), y = position.getY(n), z = position.getZ(n);
        minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
      }
    }
    const count = out.length - start, levels: { start: number; count: number }[] = [];
    // three's Sphere.setFromPoints over these vertices without a Vector3 each: the box centre, then the farthest vertex
    const sphere = new Sphere();
    sphere.center.set(minX + maxX, minY + maxY, minZ + maxZ).multiplyScalar(0.5);
    if (count === 0) sphere.center.set(0, 0, 0);
    let farthest = 0;
    for (const n of unique) {
      const dx = sphere.center.x - position.getX(n), dy = sphere.center.y - position.getY(n), dz = sphere.center.z - position.getZ(n);
      farthest = Math.max(farthest, dx * dx + dy * dy + dz * dz);
    }
    sphere.radius = Math.sqrt(farthest);
    for (const cluster of clusters) {
      const from = out.length;
      for (let i = 0; i < list.length; i++) {
        if (i % 256 === 0) yield;
        const t = list[i] ?? 0;
        const a = cluster(index.getX(t * 3)), b = cluster(index.getX(t * 3 + 1)), c = cluster(index.getX(t * 3 + 2));
        if (a !== b && b !== c && a !== c) out.push(a, b, c);
      }
      levels.push({ start: from, count: out.length - from });
    }
    bins.push({ sphere, start, count, levels, ...(tileSize === undefined ? {} : { tile: { x: tileX, z: tileZ } }) });
  }
  return { source: Uint32Array.from(out), bins, lod: lod.map((tier) => tier.distance) };
}

/**
 * Vertex clustering for a far LOD tier: each vertex maps to the first vertex of its `cell`-metre lattice box that wears the
 * same material (grain layer + unlit flag). Vertices on a bin edge or a cell edge (where the seam meets the shard's own
 * ground) stay themselves, so a coarse bin meets its fine neighbour and the shard's terrain without a crack.
 */
function clusterer(geometry: BufferGeometry, pitch: number, cell: number, tileSize?: number): (n: number) => number {
  const position = geometry.getAttribute('position'), grain = geometry.hasAttribute('grainUv') ? geometry.getAttribute('grainUv') : undefined;
  const first = new Map<number | string, number>(), memo = new Int32Array(position.count).fill(-1);
  return (n: number): number => {
    const known = memo[n] ?? -1; if (known >= 0) return known;
    const key = lodKey(position.getX(n), position.getY(n), position.getZ(n), grain?.getZ(n) ?? 0, grain?.getW(n) ?? 0, pitch, cell, tileSize);
    let rep = n;
    if (key !== null) { const seen = first.get(key); if (seen === undefined) first.set(key, n); else rep = seen; }
    memo[n] = rep; return rep;
  };
}

/** Lattice boxes within this many of the origin on every axis key as one number (a 46-bit integer: exact). */
const LOD_SPAN = 4096;
/** A vertex's LOD lattice box and material; null on a bin edge or a cell edge (it stays itself). One box and material is
 *  one key: a number in the usual ranges (string keys built per vertex were ~280 ms of a phone-tier road install), the
 *  string form outside them. */
function lodKey(x: number, y: number, z: number, layer: number, unlit: number, pitch: number, cell: number, tileSize?: number): number | string | null {
  const s = tileSize ?? pitch / BIN_DIVISOR, offset = tileSize === undefined ? 0.5 : 0;
  if (onLodLine(x, s, offset, pitch) || onLodLine(z, s, offset, pitch)) return null;
  const ix = Math.floor(x / cell), iy = Math.floor(y / cell), iz = Math.floor(z / cell);
  if (Math.abs(ix) < LOD_SPAN && Math.abs(iy) < LOD_SPAN && Math.abs(iz) < LOD_SPAN && Number.isInteger(layer) && layer >= 0 && layer < 64 && (unlit === 0 || unlit === 1)) {
    return ((((ix + LOD_SPAN) * 2 * LOD_SPAN + iy + LOD_SPAN) * 2 * LOD_SPAN + iz + LOD_SPAN) * 64 + layer) * 2 + unlit;
  }
  return `${String(ix)},${String(iy)},${String(iz)},${String(layer)},${String(unlit)}`;
}

/** Exact edge predicate shared by each LOD vertex, without a closure per vertex. */
function onLodLine(v: number, size: number, offset: number, pitch: number): boolean {
  const bin = Math.abs(v / size - Math.round(v / size));
  if (Math.abs(bin - offset) * size < 1e-3) return true;
  const local = Math.abs(v - Math.round(v / pitch) * pitch);
  return Math.abs(local - CELL_EDGE) < 1e-3;
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
export interface CullSource { readonly vertices: number; readonly position: (k: number) => number; readonly indices: ArrayLike<number>; readonly layer?: number; readonly unlit?: number }
/** What `cullRoadMesh` will hold: the geometry's vertices before and after `clipToBins`, and the sorted source's length. */
export interface CullCounts { readonly vertices: number; readonly clipped: number; readonly source: number }


/** Exact pre-allocation counts, with the same clipping arithmetic yielded in bounded batches. */
export function* cullCountsSteps(sources: readonly CullSource[], pitch: number, lod?: readonly CullLod[], tileSize?: number): Generator<void, CullCounts> {
  let vertices = 0, clipped = 0, source = 0;
  for (const run of sources) {
    const read = (n: number): Float64Array => Float64Array.of(run.position(n * 3), run.position(n * 3 + 1), run.position(n * 3 + 2));
    // Only an omitted tier list is privately known to stay empty. A supplied
    // empty array may acquire a tier while the original generator is paused.
    const { extra, out, added, corners } = yield* clipCore(run.indices.length / 3, (i) => run.indices[i] ?? 0, run.vertices, 3, 0, read, (n, axis) => run.position(n * 3 + axis), pitch, tileSize, lod !== undefined);
    vertices += run.vertices; clipped += run.vertices + added; source += corners;
    const at = (n: number, c: number): number => (n < run.vertices ? run.position(n * 3 + c) : Math.fround(extra[(n - run.vertices) * 3 + c] ?? 0));
    for (const tier of lod ?? []) {
      const memo = new Int32Array(run.vertices + extra.length / 3).fill(-1), first = new Map<number | string, number>();
      const representative = (n: number): number => {
        const known = memo[n] ?? -1; if (known >= 0) return known;
        const key = lodKey(at(n, 0), at(n, 1), at(n, 2), run.layer ?? 0, run.unlit ?? 0, pitch, tier.cell, tileSize);
        let rep = n;
        if (key !== null) { const seen = first.get(key); if (seen === undefined) first.set(key, n); else rep = seen; }
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
export function* meshBytesSteps(sources: readonly CullSource[], floats: number, cull?: { readonly pitch: number; readonly tileSize?: number; readonly lod?: readonly CullLod[] }, gpuOnly = false): Generator<void, RenderBytes> {
  if (cull === undefined) {
    let vertices = 0, indices = 0;
    for (const run of sources) { vertices += run.vertices; indices += run.indices.length; }
    const vertexBytes = vertices * floats * 4, indexBytes = indices * 4;
    return { jsBytes: (gpuOnly ? 0 : vertexBytes) + indexBytes, gpuBytes: vertexBytes + indexBytes };
  }
  const counts = yield* cullCountsSteps(sources, cull.pitch, cull.lod, cull.tileSize);
  const vertexBytes = counts.clipped * floats * 4, indexBytes = counts.source * 4;
  return { jsBytes: (gpuOnly ? 0 : vertexBytes) + 2 * indexBytes, gpuBytes: vertexBytes + indexBytes };
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
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    const view = main?.();
    if (view !== undefined && camera !== view) return;
    frustumOf(camera, frustum, matrix, true); eye.setFromMatrixPosition(camera.matrixWorld);
    let count = 0, changed = false;
    for (let k = 0; k < plan.bins.length; k++) {
      const bin = plan.bins[k];
      if (bin === undefined || bin.visibility?.visible === false || !frustum.intersectsSphere(sphere.copy(bin.sphere).applyMatrix4(mesh.matrixWorld))) continue;
      const d = sphere.distanceToPoint(eye);
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
