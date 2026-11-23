/**
 * meta DRIFTWOOD-FPS DF9 (mini-df9, 2026-11-20): far copies of the wide static meshes at phone Low, by square, in their
 * own index. Driftwood's ground, its merged palms, rocks, coconuts, crags, bushes, props and kit span the island in one
 * draw each, so every one of their triangles draws at every distance: at the dock 240k of the 570k on the phone's Low
 * frame lie past 100 m (the grid rig's census, meta project/evidence/driftwood-fps/df9-far-lod-2026-11-20.md).
 *
 * With the device slot `debug.farLod` on, each such mesh's triangles are sorted into squares of its local xz at its
 * first draw (before the Memory saver lets its arrays go): `SQUARE` m, or the tiles of a tiled mesh (tiledMesh.ts, whose
 * index the tile driver owns: `farTiles`). In slices under the loading card, each square gets coarser copies (meshoptimizer's
 * simplifier, three's wasm build): within `error` m of the square's surface, its border locked, so a coarse square meets
 * a fine one on the same vertices with no crack; a loose piece smaller than `error` (a far coconut) is pruned. A copy keeps the mesh's own vertices (colour, cover, sway) and is only a
 * new list of them. Each view draw, the squares past `at` m of the camera draw their copy: the index is rewritten
 * (writeIndexTriangles: straight into the GPU buffer when the Memory saver released the array; a tiled mesh's own
 * compaction) and the draw range shortened. One draw before and after, the same buffers and material: merges stay
 * merges. `error` at `at` is 0.6 of a pixel on the phone's Low raster (402 px wide, 92° tall: 194 px a metre at 1 m).
 *
 * A mesh with no index (a faceted soup: each face its own three vertices) gets one at its first coarse square. A copy's
 * corners are welded by position, and each corner takes the original vertex whose face turns most like the new face, so
 * a merged face keeps a neighbour's colour and normal.
 */
import * as THREE from 'three';
import { jsonSlot } from '../saves/slots';
import { TIER } from '../core/tier';
import { graphicsMode } from '../core/graphicsMode';
import { MERGED_VIEW } from '../core/shadowLayer';
import { ownedArray } from '../../../shared/engine/core/ownedBuffer';
import { drawHooks } from './drawHooks';
import { arrayReleased } from './releasedArrays';
import { indexTurned, writeIndexTriangles } from './memorySaver';
import { renderCount } from './frameCounter';
import { pageScope } from '../../../shared/engine/app/resources';
import { diagnosticNow } from '../../../shared/engine/core/clock';
import type { MeshoptSimplifier } from 'three/examples/jsm/libs/meshopt_simplifier.module.js';
import type { Renderer } from './renderer';

export const FAR_LOD_SLOT = 'debug.farLod';
export const FAR_LOD_DEFAULT = false;
/** Unset at phone Low: off until a look board and an iPhone 13 pair decide (DF9, mini-df9). */
export const FAR_LOD_PHONE_LOW = false;

/** The slot's value: a boolean wins; unset, FAR_LOD_PHONE_LOW at phone Low, else FAR_LOD_DEFAULT. */
export function farLod(saved: unknown, phoneLow = false): boolean {
  if (typeof saved === 'boolean') return saved;
  return phoneLow ? FAR_LOD_PHONE_LOW : FAR_LOD_DEFAULT;
}
let picked: boolean | undefined;
/** Whether far copies draw on this page (phone tier, Low, the slot); read once per page. */
export function farLodOn(): boolean {
  if (picked !== undefined) return picked;
  let saved: unknown = null, low = false;
  try { saved = jsonSlot(FAR_LOD_SLOT, 'device').read(); } catch { /* storage blocked: the default */ }
  try { low = graphicsMode() === 'low'; } catch { /* no settings: not Low */ }
  picked = TIER === 'phone' && low && farLod(saved, true);
  return picked;
}
/** Tests: set or forget the page's pick. */
export function resetFarLod(on?: boolean): void { picked = on; }

/** Past `at` m (camera to the square's box) a square draws the copy within `error` m. */
export const FAR_LEVELS: readonly { readonly at: number; readonly error: number }[] = [
  { at: 20, error: 0.06 }, { at: 40, error: 0.12 }, { at: 80, error: 0.24 }, { at: 160, error: 0.48 }, { at: 320, error: 0.96 },
];
const SQUARE = 32; // m
const HYSTERESIS = 4; // m: a square changes copy only this far past its line, so a camera on the line does not flicker
const MIN_RADIUS = 40, MAX_RADIUS = 1500; // m: smaller meshes cull whole; wider ones are seas and skies (shader-moved)
const MIN_TRIS = 2000;
const MOVED = 1.5; // m of camera travel before a mesh's squares are looked at again
const SLICE_MS = 4, SLICE_GAP_MS = 8, START_MS = 2000;
const KEPT = { owner: 'engine/farLod', asset: 'square-index', kind: 'geometry-cpu' } as const;
const SCRATCH = { owner: 'engine/farLod', asset: 'positions', kind: 'scratch' } as const;
const SOUP = { owner: 'engine/farLod', asset: 'soup-index', kind: 'geometry-cpu' } as const;

interface Square {
  readonly lo: readonly [number, number, number]; readonly hi: readonly [number, number, number];
  /** its triangles, as the mesh's vertices */
  readonly full: Uint32Array;
  /** each level's copy (null: not built, or no saving) */
  readonly copies: (Uint32Array | null)[];
  level: number;
}
interface Tracked {
  readonly mesh: THREE.Mesh; readonly squares: Square[];
  /** local positions, until every square has its copies */
  positions: Float32Array | null;
  /** each vertex's look (its colour and painted channels), or null with none; dropped with the positions */
  looks: Looks | null;
  readonly scale: number;
  ready: boolean; readonly last: THREE.Vector3; looked: boolean;
  /** DF9b: its content's key (`built`) */
  readonly key: string;
  /** draw the squares at their levels; false: the mesh can no longer take them */
  readonly apply: () => boolean;
}

/** What the far copies did on this page (the bench reads it as `__wsFarLod`). */
export const farLodReport = { meshes: 0, tiled: 0, squares: 0, ready: 0, reused: 0, writes: 0, full: 0, drawn: 0, captureMs: 0, buildMs: 0, refused: 0,
  /** DF9 (mini-dfload): build ms at the loading pace, the settle step's ms, what it left for play and captured itself */
  loadingBuildMs: 0, settleMs: -1, settleLeft: -1, settleCaptured: 0, buildAtSettle: -1,
  loadingWrites: 0, loadingDraws: 0,
  whole: {} as Record<string, number>, log: [] as [string, number, number][] };

const tracked = new WeakMap<THREE.BufferGeometry, Tracked | null>();
/** DF9 (mini-dfload): square-levels still to build (each a yield of `builds`) */
let pending = 0;
const queue: Tracked[] = [];

const isMesh = (o: THREE.Object3D): o is THREE.Mesh => (o as Partial<THREE.Mesh>).isMesh === true;

/** Why a mesh draws whole (null: it may take far copies): a static, single-material, whole-range, wide mesh whose arrays
 *  are still on the CPU. A merged copy (groundMerge's `props.merged`) takes them: each rebuild is a new geometry. */
function refusal(mesh: THREE.Object3D, geometry: THREE.BufferGeometry): string | null {
  if (!isMesh(mesh) || 'isInstancedMesh' in mesh || 'isSkinnedMesh' in mesh || 'isBatchedMesh' in mesh) return 'kind';
  const position = geometry.attributes['position'], index = geometry.index;
  const count = index === null ? position?.count ?? 0 : index.count;
  if (count < MIN_TRIS * 3 || count % 3 !== 0) return 'small';
  if (Array.isArray(mesh.material) || mesh.material.transparent) return 'material';
  if (mesh.userData[MERGED_VIEW] === true) return 'merge';
  if (mesh.geometry !== geometry || geometry.groups.length > 1 || Object.keys(geometry.morphAttributes).length > 0) return 'groups';
  if (geometry.drawRange.start !== 0 || geometry.drawRange.count < count) return 'range'; // a piece of a shared buffer, or a reveal
  // an interleaved ground (the cove's terrainlo tiles) lies a hand's width under the island's own: a coarse copy of it
  // rises through the sand (the DF9 lagoon board's green triangles)
  if (position instanceof THREE.InterleavedBufferAttribute) return 'layered';
  if (!(position instanceof THREE.BufferAttribute) || position.usage !== THREE.StaticDrawUsage || position.updateRanges.length > 0) return 'dynamic';
  if (index !== null && (index.usage !== THREE.StaticDrawUsage || index.updateRanges.length > 0)) return 'dynamic';
  if ((position instanceof THREE.BufferAttribute && arrayReleased(position)) || (index !== null && arrayReleased(index))) return 'released';
  if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
  const reach = (geometry.boundingSphere?.radius ?? 0) * mesh.matrixWorld.getMaxScaleOnAxis();
  return reach < MIN_RADIUS ? 'narrow' : reach > MAX_RADIUS ? 'wide' : null;
}

/** a corner's look distance (squared) against its face turn (a dot, -1 to 1): a tenth of a channel apart weighs about
 *  as much as a turn of 25° */
const LOOK_WEIGHT = 10;

/** each vertex's look: `size` values a vertex, in `values` */
export interface Looks { readonly values: Float32Array; readonly size: number }
/** the channels a vertex's look is read from: every channel but its place and facing (colour, texture place, a painted
 *  ground's cover and canopy, a sway weight): at a texture seam a corner keeps its own face's side */
const UNLOOKED = new Set(['position', 'normal', 'tangent', 'skinIndex', 'skinWeight']);
/** each vertex's look (a copy; null: the geometry has no such channel) */
function looksOf(geometry: THREE.BufferGeometry): Looks | null {
  const channels = Object.entries(geometry.attributes).filter(([name, a]) => !UNLOOKED.has(name) && a.itemSize <= 4 && !(a instanceof THREE.BufferAttribute && arrayReleased(a))).map(([, a]) => a);
  const size = channels.reduce((n, a) => n + a.itemSize, 0), count = geometry.attributes['position']?.count ?? 0;
  if (size === 0 || count === 0) return null;
  const values = ownedArray(Float32Array, count * size, SCRATCH);
  let at = 0;
  for (const a of channels) {
    for (let i = 0; i < count && i < a.count; i++) for (let j = 0; j < a.itemSize; j++) values[i * size + at + j] = a.getComponent(i, j);
    at += a.itemSize;
  }
  return { values, size };
}

/** `position`'s values as local floats (a copy). */
function floats(position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): Float32Array {
  const n = position.count, out = ownedArray(Float32Array, n * 3, SCRATCH);
  if (position instanceof THREE.BufferAttribute && !position.normalized && position.array instanceof Float32Array && position.itemSize === 3) out.set(position.array.subarray(0, n * 3));
  else for (let i = 0; i < n; i++) { out[i * 3] = position.getX(i); out[i * 3 + 1] = position.getY(i); out[i * 3 + 2] = position.getZ(i); }
  return out;
}

/** The squares of `groups` (each a list of triangle starts into `corners`), with their boxes. */
function squaresOf(positions: Float32Array, corners: ArrayLike<number>, groups: readonly Uint32Array[]): Square[] {
  const squares: Square[] = [];
  // DF9b: one kept array for the mesh's lists, each square's a view of it. A buffer the ledger counts carries a weak
  // reference and a finalizer, and JavaScriptCore visits those at every collection: a buffer a square (5,400 lists and
  // 27,000 copies on the route) put the desktop's eden pauses up by a third
  const pool = ownedArray(Uint32Array, groups.reduce((n, starts) => n + starts.length * 3, 0), KEPT);
  let pooled = 0;
  for (const starts of groups) {
    if (starts.length === 0) continue;
    const full = pool.subarray(pooled, pooled + starts.length * 3); pooled += starts.length * 3;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < starts.length; i++) {
      const t = starts[i] ?? 0;
      for (let k = 0; k < 3; k++) {
        const v = corners[t + k] ?? 0; full[i * 3 + k] = v;
        const x = positions[v * 3] ?? 0, y = positions[v * 3 + 1] ?? 0, z = positions[v * 3 + 2] ?? 0;
        if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z; if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
      }
    }
    squares.push({ lo: [x0, y0, z0], hi: [x1, y1, z1], full, copies: FAR_LEVELS.map(() => null), level: 0 });
  }
  return squares;
}

function track(mesh: THREE.Mesh, squares: Square[], positions: Float32Array | null, apply: () => boolean, key: string): Tracked {
  mesh.updateWorldMatrix(true, false);
  // DF9b: squares taken back from `built` (positions null) are ready at once, nothing to build
  const entry: Tracked = { mesh, squares, positions, looks: positions === null ? null : looksOf(mesh.geometry), scale: mesh.matrixWorld.getMaxScaleOnAxis(),
    ready: positions === null, last: new THREE.Vector3(Infinity, Infinity, Infinity), looked: false, apply, key };
  farLodReport.meshes++; farLodReport.squares += squares.length;
  if (farLodReport.log.length < 64) farLodReport.log.push([mesh.name, Math.round(diagnosticNow()), squares.reduce((n, square) => n + square.full.length / 3, 0)]);
  for (const square of squares) farLodReport.full += square.full.length / 3;
  if (positions === null) { farLodReport.ready++; farLodReport.reused++; } else { queue.push(entry); pending += squares.length * FAR_LEVELS.length; startBuilding(); }
  return entry;
}

/**
 * DF9b (mini-df9b): built squares by content, so the copies are built once a page. On the route's road return the grid
 * admits Driftwood again and every wide mesh comes back as a new geometry with the same arrays (the desktop census caught 20
 * captures at ~201 s); each one was cut and built again, its old copies garbage. Its key hashes the mesh's positions, index,
 * look channels, tiles and scale; squares are kept here once built, up to BUILT_TRIANGLES of them, the oldest dropped first.
 */
const built = new Map<string, readonly Square[]>();
const BUILT_TRIANGLES = 2_000_000;
let builtTriangles = 0;
const trianglesOf = (squares: readonly Square[]): number => squares.reduce((n, square) => n + square.full.length / 3, 0);
function remember(key: string, squares: readonly Square[]): void {
  if (built.has(key)) return;
  built.set(key, squares); builtTriangles += trianglesOf(squares);
  for (const [old, held] of built) {
    if (builtTriangles <= BUILT_TRIANGLES || old === key) break;
    built.delete(old); builtTriangles -= trianglesOf(held);
  }
}
/** A mesh's squares again, each at the finest level (its lists and copies shared: they never change once built). */
const again = (known: readonly Square[]): Square[] => known.map(square => ({ lo: square.lo, hi: square.hi, full: square.full, copies: square.copies, level: 0 }));

let h1 = 0, h2 = 0;
/** Hash `values`' first `n` (integers, or a float array's bits) into h1 and h2. */
function hashValues(values: ArrayLike<number>, n: number): void {
  const bits = values instanceof Float32Array || values instanceof Int32Array ? new Uint32Array(values.buffer, values.byteOffset, Math.min(n, values.length)) : null;
  const scaled = bits === null && (values instanceof Float64Array || !ArrayBuffer.isView(values));
  const source = bits ?? values, length = Math.min(n, source.length);
  for (let i = 0; i < length; i++) {
    const raw = source[i] ?? 0, x = scaled ? Math.round(raw * 1048576) | 0 : raw | 0;
    h1 = Math.imul(h1 ^ x, 16777619); h2 = Math.imul(h2 + x, 2246822519) ^ (h2 >>> 15);
  }
  h1 = Math.imul(h1 ^ length, 16777619); h2 = Math.imul(h2 + length, 2246822519) ^ (h2 >>> 15);
}
/** The key of a mesh's content: its positions, `source` index (the geometry's own when omitted), look channels, extra
 *  integer lists (a tiled mesh's tiles), whether its index draws turned, and its scale. */
function contentKey(geometry: THREE.BufferGeometry, source: ArrayLike<number> | null, extra: readonly ArrayLike<number>[], turned: boolean, scale: number): string {
  h1 = 2166136261; h2 = 3266489917;
  const position = geometry.attributes['position'];
  if (position instanceof THREE.BufferAttribute) hashValues(position.array, position.count * position.itemSize);
  const index = geometry.index;
  if (source !== null) hashValues(source, source.length);
  else if (index !== null) hashValues(index.array, index.count);
  for (const [name, a] of Object.entries(geometry.attributes)) {
    if (UNLOOKED.has(name) || a.itemSize > 4 || !(a instanceof THREE.BufferAttribute) || arrayReleased(a)) continue;
    hashValues(a.array, a.count * a.itemSize);
  }
  for (const list of extra) hashValues(list, list.length);
  return `${String(h1 >>> 0)}.${String(h2 >>> 0)}.${String(turned)}.${String(Math.round(scale * 1e6))}`;
}

/** The square's triangles at `level` (0: its own); a level not built falls back to the finer one. */
function trianglesAt(square: Square, level: number): Uint32Array {
  for (let l = level; l >= 1; l--) { const copy = square.copies[l - 1]; if (copy !== null && copy !== undefined) return copy; }
  return square.full;
}

const STAGE = { owner: 'engine/farLod', asset: 'index-stage', kind: 'geometry-cpu' } as const;
let stage16 = new Uint16Array(0), stage32 = new Uint32Array(0);
/** DF9b: the page's staging index of the mesh's element type, at least `count` long: one for every mesh (one rewrite a
 *  frame, used at once), grown to the widest mesh and kept. */
function staging(narrow: boolean, count: number): Uint16Array | Uint32Array {
  if (narrow) { if (stage16.length < count) stage16 = ownedArray(Uint16Array, count, STAGE); return stage16; }
  if (stage32.length < count) stage32 = ownedArray(Uint32Array, count, STAGE);
  return stage32;
}

/** Sort `mesh`'s triangles into SQUARE m squares now (its arrays are still here); its copies are built later, in slices. */
function capture(mesh: THREE.Mesh, geometry: THREE.BufferGeometry): Tracked {
  const t0 = diagnosticNow();
  const position = geometry.attributes['position'] as THREE.BufferAttribute | THREE.InterleavedBufferAttribute, vertices = position.count;
  const index = geometry.index, count = index === null ? vertices : index.count;
  mesh.updateWorldMatrix(true, false);
  const key = contentKey(geometry, null, [], index !== null && indexTurned(index), mesh.matrixWorld.getMaxScaleOnAxis()), known = built.get(key);
  const sorted = known === undefined ? cut(geometry, position, count) : { squares: again(known), positions: null };
  let drawn = count;
  // DF9b: the index's element type, read now (once the Memory saver lets the array go, reading it brings it back from the
  // GPU); a soup's own index is 16-bit when its vertices allow
  const narrow = index === null ? vertices <= 65535 : index.array instanceof Uint16Array;
  const write = { at: 0, triangles: staging(narrow, count), length: 0 }, writes = [write];
  const apply = (): boolean => {
    let total = 0;
    for (const square of sorted.squares) total += trianglesAt(square, square.level).length;
    // DF9b: the squares go into the page's one staging index (no new array a band change: on the iPhone 13 a whole index
    // each write doubled the full collections), then into the mesh's index from its start
    const out = staging(narrow, count);
    let at = 0;
    for (const square of sorted.squares) { const part = trianglesAt(square, square.level); out.set(part, at); at += part.length; }
    if (geometry.index === null) {
      // a soup: its first index, as large as all its faces, so a finer pick later still fits
      const array = narrow ? ownedArray(Uint16Array, count, SOUP) : ownedArray(Uint32Array, count, SOUP); array.set(out.subarray(0, total));
      geometry.setIndex(new THREE.BufferAttribute(array, 1));
    } else {
      write.triangles = out; write.length = total;
      if (!writeIndexTriangles(geometry.index, writes, false)) return false;
    }
    geometry.setDrawRange(0, total);
    farLodReport.drawn += (total - drawn) / 3; drawn = total;
    return true;
  };
  farLodReport.captureMs += diagnosticNow() - t0;
  return track(mesh, sorted.squares, sorted.positions, apply, key);
}

/** `geometry`'s triangles sorted into SQUARE m squares, with its local positions for the build. */
function cut(geometry: THREE.BufferGeometry, position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, count: number): { squares: Square[]; positions: Float32Array } {
  const positions = floats(position), index = geometry.index;
  const corners = ownedArray(Uint32Array, count, SCRATCH);
  if (index === null) for (let i = 0; i < count; i++) corners[i] = i;
  else {
    corners.set(index.array.subarray(0, count));
    // MG10: an index WebKit's convention turned already (its last vertex first) goes back to the mesh's own order
    if (indexTurned(index)) for (let i = 0; i < count; i += 3) { const a = corners[i] ?? 0; corners[i] = corners[i + 1] ?? 0; corners[i + 1] = corners[i + 2] ?? 0; corners[i + 2] = a; }
  }
  const triangles = count / 3, ids = ownedArray(Int32Array, triangles, SCRATCH), byKey = new Map<number, number>(), sizes: number[] = [];
  for (let t = 0; t < triangles; t++) {
    let x = 0, z = 0;
    for (let k = 0; k < 3; k++) { const v = corners[t * 3 + k] ?? 0; x += positions[v * 3] ?? 0; z += positions[v * 3 + 2] ?? 0; }
    const key = (Math.floor(x / 3 / SQUARE) + 32768) * 65536 + Math.floor(z / 3 / SQUARE) + 32768;
    let id = byKey.get(key); if (id === undefined) { id = sizes.length; byKey.set(key, id); sizes.push(0); }
    ids[t] = id; sizes[id] = (sizes[id] ?? 0) + 1;
  }
  const startsPool = ownedArray(Uint32Array, triangles, SCRATCH), groups: Uint32Array[] = [];
  let grouped = 0;
  for (const n of sizes) { groups.push(startsPool.subarray(grouped, grouped + n)); grouped += n; }
  const fill = ownedArray(Int32Array, sizes.length, SCRATCH);
  for (let t = 0; t < triangles; t++) { const id = ids[t] ?? 0, at = fill[id] ?? 0; const group = groups[id]; if (group !== undefined) group[at] = t * 3; fill[id] = at + 1; }
  return { squares: squaresOf(positions, corners, groups), positions };
}

/** What a tiled mesh draws for a resident tile: the tile's copy at its level, or null for its own triangles. */
export interface FarTiles { readonly copy: (tile: number) => Uint32Array | null }

/**
 * DF9: a tiled mesh's tiles as far squares (tiledMesh.ts calls this as it sorts the mesh, while its arrays are here): the
 * tile driver keeps its index and residency, and its compaction asks `copy(tile)` for each resident tile; `redraw` is
 * called when the camera moves a tile to another level. Null unless far copies are on.
 * `order`, `start` and `count` are the mesh's triangles by tile (tileContent's TileRanges), `source` its own index.
 */
export function farTiles(mesh: THREE.Mesh, source: ArrayLike<number>, ranges: { readonly order: ArrayLike<number>; readonly start: ArrayLike<number>; readonly count: ArrayLike<number> }, redraw: () => void): FarTiles | null {
  if (!farLodOn()) return null;
  const geometry = mesh.geometry, position = geometry.attributes['position'];
  if (!(position instanceof THREE.BufferAttribute) || arrayReleased(position) || Array.isArray(mesh.material) || mesh.material.transparent) return null;
  if (source.length < MIN_TRIS * 3) return null;
  const t0 = diagnosticNow();
  mesh.updateWorldMatrix(true, false);
  const key = contentKey(geometry, source, [ranges.order, ranges.start, ranges.count], false, mesh.matrixWorld.getMaxScaleOnAxis()), known = built.get(key);
  const tiles: number[] = [], groups: Uint32Array[] = [];
  const startsPool = known === undefined ? ownedArray(Uint32Array, source.length / 3, SCRATCH) : null;
  let grouped = 0;
  for (let tile = 0; tile < ranges.count.length; tile++) {
    const n = ranges.count[tile] ?? 0; if (n === 0) continue;
    tiles.push(tile);
    if (startsPool === null) continue;
    const starts = startsPool.subarray(grouped, grouped + n), from = ranges.start[tile] ?? 0; grouped += n;
    for (let k = 0; k < n; k++) starts[k] = (ranges.order[from + k] ?? 0) * 3;
    groups.push(starts);
  }
  const positions = known === undefined ? floats(position) : null;
  const squares = positions === null ? again(known ?? []) : squaresOf(positions, source, groups), bySquare = new Map<number, Square>();
  squares.forEach((square, i) => { const tile = tiles[i]; if (tile !== undefined) bySquare.set(tile, square); });
  const entry = track(mesh, squares, positions, () => { redraw(); return true; }, key);
  farLodReport.tiled++; farLodReport.captureMs += diagnosticNow() - t0;
  tracked.set(geometry, entry);
  return { copy: (tile) => {
    const square = bySquare.get(tile);
    if (square === undefined || square.level === 0) return null;
    const triangles = trianglesAt(square, square.level);
    return triangles === square.full ? null : triangles;
  } };
}

type Simplifier = typeof MeshoptSimplifier;

/** DF9b: the build's working arrays, kept from square to square and grown, never shrunk: the per-square maps, lists and
 *  copies of the first build were the garbage that doubled the iPhone 13's full collections. Each `*Gen` array marks an
 *  entry written in this call (`gen`), so nothing is cleared between squares. */
const work = {
  gen: 0,
  /** by mesh vertex: the call that welded it, its welded vertex, the next vertex welded to the same one, its face's call */
  weldGen: new Int32Array(0), weldOf: new Int32Array(0), next: new Int32Array(0), faceGen: new Int32Array(0),
  /** by mesh vertex: its first face's direction */
  face: new Float64Array(0),
  /** by welded vertex: its first and last original (a list in welding order), its key (mm from the square's first corner) */
  head: new Int32Array(0), tail: new Int32Array(0), keys: new Float64Array(0),
  /** the weld's open table: a welded vertex per slot, and the call that wrote the slot */
  slots: new Int32Array(0), slotGen: new Int32Array(0),
  widx: new Uint32Array(0), wpos: new Float32Array(0), hue: new Float64Array(0),
  /** a square's copy; a level's copies of one mesh, end to end, and each square's place and length there (-1: none) */
  copy: new Uint32Array(0), level: new Uint32Array(0), at: new Int32Array(0), length: new Int32Array(0),
};
/** `current` if it holds `n`, else a new zeroed array of at least `n` (twice the old length). */
function grown<T extends Int32Array | Uint32Array | Float32Array | Float64Array>(current: T, n: number, Type: { new (length: number): T; readonly BYTES_PER_ELEMENT: number }): T {
  return current.length >= n ? current : ownedArray(Type, Math.max(n, current.length * 2), SCRATCH);
}
const SIMPLIFY_FLAGS: ('LockBorder' | 'ErrorAbsolute' | 'Prune')[] = ['LockBorder', 'ErrorAbsolute', 'Prune'];

/**
 * A square's copy within `error` (local units): its corners welded by position, simplified with its border locked, and
 * each corner of each new face mapped back to one of the original vertices there. With `looks` (colour, cover...) the
 * corner takes the original whose look is nearest the new face's (the mean of its corners' originals), so a face on the
 * sand keeps sand at a corner it shares with the grass; between originals of one look, and with no looks, the one whose
 * face turns most like the new face (a merged face keeps a neighbour's normal).
 */
export function squareCopy(simplify: Simplifier['simplify'], positions: Float32Array, full: Uint32Array, error: number, looks: Looks | null = null): Uint32Array {
  const length = copyOf(simplify, positions, full, error, looks, () => true);
  return work.copy.slice(0, Math.max(0, length));
}

/** squareCopy into the build's working array `work.copy`: its length, or -1 (nothing mapped) when `keep` refuses it. */
function copyOf(simplify: Simplifier['simplify'], positions: Float32Array, full: Uint32Array, error: number, looks: Looks | null,
  keep: (length: number) => boolean): number {
  const vertices = Math.floor(positions.length / 3), n = full.length;
  const w = work;
  w.weldGen = grown(w.weldGen, vertices, Int32Array); w.weldOf = grown(w.weldOf, vertices, Int32Array); w.next = grown(w.next, vertices, Int32Array);
  w.faceGen = grown(w.faceGen, vertices, Int32Array); w.face = grown(w.face, vertices * 3, Float64Array);
  w.head = grown(w.head, n, Int32Array); w.tail = grown(w.tail, n, Int32Array); w.keys = grown(w.keys, n * 3, Float64Array);
  let capacity = 16; while (capacity < n * 2) capacity *= 2;
  w.slots = grown(w.slots, capacity, Int32Array); w.slotGen = grown(w.slotGen, capacity, Int32Array);
  w.widx = grown(w.widx, n, Uint32Array); w.wpos = grown(w.wpos, n * 3, Float32Array);
  const gen = ++w.gen, mask = capacity - 1;
  const { weldGen, weldOf, next, faceGen, face, head, tail, keys, slots, slotGen, widx, wpos } = w;
  const at = (v: number, j: number): number => positions[v * 3 + j] ?? 0;
  // a position's key: whole millimetres from the square's first corner; equal keys weld
  const first = full[0] ?? 0, ox = at(first, 0), oy = at(first, 1), oz = at(first, 2);
  let welded = 0;
  for (let i = 0; i < n; i++) {
    const v = full[i] ?? 0;
    let found = -1;
    if (weldGen[v] === gen) found = weldOf[v] ?? 0;
    else {
      const x = Math.round((at(v, 0) - ox) * 1000), y = Math.round((at(v, 1) - oy) * 1000), z = Math.round((at(v, 2) - oz) * 1000);
      let slot = (Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(z | 0, 83492791)) & mask;
      while (slotGen[slot] === gen) {
        const c = slots[slot] ?? 0;
        if (keys[c * 3] === x && keys[c * 3 + 1] === y && keys[c * 3 + 2] === z) { found = c; break; }
        slot = (slot + 1) & mask;
      }
      if (found < 0) {
        found = welded++; slotGen[slot] = gen; slots[slot] = found;
        keys[found * 3] = x; keys[found * 3 + 1] = y; keys[found * 3 + 2] = z;
        wpos[found * 3] = at(v, 0); wpos[found * 3 + 1] = at(v, 1); wpos[found * 3 + 2] = at(v, 2);
        head[found] = -1; tail[found] = -1;
      }
      weldGen[v] = gen; weldOf[v] = found;
      // v joins its welded vertex's originals, in welding order
      next[v] = -1;
      const last = tail[found] ?? -1;
      if (last < 0) head[found] = v; else next[last] = v;
      tail[found] = v;
    }
    widx[i] = found;
  }
  // each original vertex's face direction (its first face in this square)
  for (let t = 0; t < n; t += 3) {
    const a = full[t] ?? 0, b = full[t + 1] ?? 0, c = full[t + 2] ?? 0;
    if (faceGen[a] === gen && faceGen[b] === gen && faceGen[c] === gen) continue;
    const ux = at(b, 0) - at(a, 0), uy = at(b, 1) - at(a, 1), uz = at(b, 2) - at(a, 2), vx = at(c, 0) - at(a, 0), vy = at(c, 1) - at(a, 1), vz = at(c, 2) - at(a, 2);
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    for (let k = 0; k < 3; k++) {
      const v = k === 0 ? a : k === 1 ? b : c;
      if (faceGen[v] === gen) continue;
      faceGen[v] = gen; face[v * 3] = nx / l; face[v * 3 + 1] = ny / l; face[v * 3 + 2] = nz / l;
    }
  }
  const [out] = simplify(widx.subarray(0, n), wpos.subarray(0, welded * 3), 3, 0, error, SIMPLIFY_FLAGS);
  if (!keep(out.length)) return -1;
  w.copy = grown(w.copy, out.length, Uint32Array);
  const copy = w.copy;
  const w3 = (q: number, j: number): number => wpos[q * 3 + j] ?? 0;
  const size = looks?.size ?? 0;
  w.hue = grown(w.hue, size, Float64Array);
  const hue = w.hue;
  for (let t = 0; t < out.length; t += 3) {
    const a = out[t] ?? 0, b = out[t + 1] ?? 0, c = out[t + 2] ?? 0;
    const ux = w3(b, 0) - w3(a, 0), uy = w3(b, 1) - w3(a, 1), uz = w3(b, 2) - w3(a, 2), vx = w3(c, 0) - w3(a, 0), vy = w3(c, 1) - w3(a, 1), vz = w3(c, 2) - w3(a, 2);
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    const f0 = nx / l, f1 = ny / l, f2 = nz / l;
    if (looks !== null) {
      // the new face's look: the mean over its corners' originals
      hue.fill(0, 0, size); let count = 0;
      for (let k = 0; k < 3; k++) {
        for (let v = head[k === 0 ? a : k === 1 ? b : c] ?? -1; v >= 0; v = next[v] ?? -1) {
          for (let j = 0; j < size; j++) hue[j] = (hue[j] ?? 0) + (looks.values[v * size + j] ?? 0);
          count++;
        }
      }
      for (let j = 0; j < size; j++) hue[j] = (hue[j] ?? 0) / Math.max(1, count);
    }
    for (let k = 0; k < 3; k++) {
      const h = head[out[t + k] ?? 0] ?? -1;
      let best = Math.max(0, h), score = -Infinity;
      if (h >= 0 && (next[h] ?? -1) >= 0) for (let v = h; v >= 0; v = next[v] ?? -1) {
        let s = faceGen[v] === gen ? (face[v * 3] ?? 0) * f0 + (face[v * 3 + 1] ?? 0) * f1 + (face[v * 3 + 2] ?? 0) * f2 : -2;
        if (looks !== null) {
          let d = 0;
          for (let j = 0; j < size; j++) { const e = (looks.values[v * size + j] ?? 0) - (hue[j] ?? 0); d += e * e; }
          s -= LOOK_WEIGHT * d;
        }
        if (s > score) { score = s; best = v; }
      }
      copy[t + k] = best;
    }
  }
  return out.length;
}

let simplifier: Simplifier | null = null, loading: Promise<void> | null = null, building = false, started = false;

/**
 * DRIFTWOOD-FPS DF9 (mini-dfload): the loading card's pace. On the iPhone 13 the copies built for 5.7 s after control (1.2 s
 * on the desktop) and their slices sat in the dock's long frames. From `beginFarCopies` (the boot, once its first frame is
 * planned) the builder runs LOAD_SLICE_MS slices with no gap and no start delay, beside the card's waits on GPU links and
 * tiles, and `settleFarCopies` (the boot's last step before control) builds what is left before the card goes. After it,
 * a later capture (a cell admitted in play) builds at the play pace as before.
 */
let loadingPace = false;
const LOAD_SLICE_MS = 12, LOAD_GAP_MS = 0;
let drained: (() => void)[] = [];

/** Build the queued meshes' copies in slices of SLICE_MS, a gap between, from START_MS after the first capture. */
function startBuilding(): void {
  if (building) return;
  building = true;
  void loadSimplifier();
  const steps = builds();
  const slice = (): void => {
    if (simplifier === null) { pageScope.timeout(250, slice); return; }
    const t0 = diagnosticNow(), sliceMs = loadingPace ? LOAD_SLICE_MS : SLICE_MS;
    let done = false;
    while (diagnosticNow() - t0 < sliceMs) if (steps.next().done === true) { done = true; break; }
    const ms = diagnosticNow() - t0;
    farLodReport.buildMs += ms; if (loadingPace) farLodReport.loadingBuildMs += ms;
    if (done) {
      building = false;
      if (queue.length > 0) { startBuilding(); return; }
      const waiting = drained; drained = [];
      for (const resolve of waiting) resolve();
      return;
    }
    pageScope.timeout(loadingPace ? LOAD_GAP_MS : SLICE_GAP_MS, slice);
  };
  // the boot's captures wait out its first frames; a later one (a merge's rebuilt block) starts at once
  pageScope.timeout(started || loadingPace ? 0 : START_MS, slice);
  started = true;
}

function loadSimplifier(): Promise<void> {
  loading ??= (async (): Promise<void> => {
    try {
      const loaded = (await import('three/examples/jsm/libs/meshopt_simplifier.module.js')).MeshoptSimplifier;
      await loaded.ready; simplifier = loaded;
    } catch { farLodReport.refused++; }
  })();
  return loading;
}

/** Square-levels of far copies still to build (0: every captured mesh has its copies). */
export function farCopiesPending(): number { return pending; }

/** The boot from its first planned frame to control: build at the loading pace (no start delay, long slices, no gap). */
export function beginFarCopies(): void {
  if (!farLodOn() || loadingPace) return;
  loadingPace = true;
  void loadSimplifier();
}

/** The far-copy step's budget (ms): past it the rest builds in play. The iPhone 13's whole build was 5.7 s of slices. */
export const SETTLE_BUDGET_MS = 8000;
/** What `settleFarCopies` did: its ms, the square-levels it built and those it left for play (over its budget). */
export interface FarSettle { readonly ms: number; readonly built: number; readonly left: number; readonly captured: number }

/**
 * Before control: capture every eligible mesh `scene` shows that no draw has captured yet (a wide mesh out of the spawn
 * view, first drawn on the route), then build every queued copy, reporting square-levels done of the total. Gives up
 * after `budgetMs`, leaving the rest to the play pace. Afterwards the builder keeps the play pace.
 */
export async function settleFarCopies(options: { readonly scene?: THREE.Object3D; readonly budgetMs?: number; readonly progress?: (done: number, total: number) => void } = {}): Promise<FarSettle> {
  if (!farLodOn()) return { ms: 0, built: 0, left: 0, captured: 0 };
  const t0 = diagnosticNow(), budget = options.budgetMs ?? SETTLE_BUDGET_MS;
  let captured = 0;
  loadingPace = true;
  options.scene?.traverseVisible(object => {
    if (!isMesh(object) || object.layers.mask === 0 || tracked.has(object.geometry)) return;
    if (refusal(object, object.geometry) !== null) return;
    tracked.set(object.geometry, capture(object, object.geometry)); captured++;
  });
  const total = pending, progress = options.progress;
  progress?.(0, total);
  if (pending > 0 || building) {
    if (!building && queue.length > 0) startBuilding();
    const done = new Promise<void>(resolve => { drained.push(resolve); });
    // the card's count moves at least every half second (the bar's 2 s rule) and the budget is kept
    for (;;) {
      const left = budget - (diagnosticNow() - t0);
      if (left <= 0) break;
      const finished = await Promise.race([done.then(() => true), new Promise<boolean>(resolve => { pageScope.timeout(Math.min(500, left), () => { resolve(false); }); })]);
      progress?.(total - pending, total);
      if (finished || (pending === 0 && !building)) break;
    }
  }
  loadingPace = false;
  const ms = diagnosticNow() - t0;
  farLodReport.settleMs = Math.round(ms); farLodReport.settleLeft = pending; farLodReport.settleCaptured = captured; farLodReport.buildAtSettle = Math.round(farLodReport.buildMs);
  return { ms, built: total - pending, left: pending, captured };
}

function* builds(): Generator<void, void> {
  while (queue.length > 0) {
    const entry = queue.shift();
    if (entry === undefined) continue;
    if (entry.positions === null || simplifier === null) { pending -= entry.squares.length * FAR_LEVELS.length; continue; }
    const positions = entry.positions;
    // the coarsest copies first (the far squares hold most triangles), then each finer level; the squares are picked
    // again as each level lands
    for (let l = FAR_LEVELS.length - 1; l >= 0; l--) {
      const level = FAR_LEVELS[l]; if (level === undefined) continue;
      // DF9b: the level's copies go end to end into the working arrays, then into one kept array (squaresOf's pool)
      const squares = entry.squares;
      work.at = grown(work.at, squares.length, Int32Array); work.length = grown(work.length, squares.length, Int32Array);
      let filled = 0;
      for (let i = 0; i < squares.length; i++) {
        const square = squares[i]; pending--;
        if (square === undefined) continue;
        // a copy no smaller than its square's own is left out (trianglesAt falls back to the finer one)
        const limit = square.full.length * 0.95;
        const length = copyOf(simplifier.simplify, positions, square.full, level.error / entry.scale, entry.looks, (n) => n < limit);
        work.length[i] = length; work.at[i] = filled;
        if (length > 0) {
          if (work.level.length < filled + length) { const wider = ownedArray(Uint32Array, Math.max(filled + length, work.level.length * 2), SCRATCH); wider.set(work.level.subarray(0, filled)); work.level = wider; }
          work.level.set(work.copy.subarray(0, length), filled); filled += length;
        }
        yield;
      }
      const pool = ownedArray(Uint32Array, filled, KEPT);
      pool.set(work.level.subarray(0, filled));
      for (let i = 0; i < squares.length; i++) {
        const square = squares[i], at = work.at[i] ?? 0, length = work.length[i] ?? -1;
        if (square !== undefined && length >= 0) square.copies[l] = pool.subarray(at, at + length);
      }
      entry.ready = true; entry.looked = false;
    }
    entry.positions = null; entry.looks = null;
    farLodReport.ready++;
    remember(entry.key, entry.squares);
  }
}

const local = new THREE.Vector3(), inverse = new THREE.Matrix4();
let wroteAt = -1;

/** Each view draw of a tracked mesh: pick each square's level from the camera, and draw them when any changed. */
function look(entry: Tracked, camera: THREE.Camera, frame: number | null): boolean {
  camera.getWorldPosition(local);
  if (entry.looked && local.distanceToSquared(entry.last) < MOVED * MOVED) return true;
  if (wroteAt === frame) return true; // one rewrite a frame: the others wait for the next view draw
  entry.last.copy(local);
  inverse.copy(entry.mesh.matrixWorld).invert();
  local.applyMatrix4(inverse);
  let changed = !entry.looked;
  for (const square of entry.squares) {
    const dx = Math.max(square.lo[0] - local.x, 0, local.x - square.hi[0]), dy = Math.max(square.lo[1] - local.y, 0, local.y - square.hi[1]);
    const dz = Math.max(square.lo[2] - local.z, 0, local.z - square.hi[2]), d = Math.hypot(dx, dy, dz) * entry.scale;
    let level = square.level;
    while (level < FAR_LEVELS.length && d > (FAR_LEVELS[level]?.at ?? Infinity) + HYSTERESIS) level++;
    while (level > 0 && d < (FAR_LEVELS[level - 1]?.at ?? 0) - HYSTERESIS) level--;
    if (level !== square.level) { square.level = level; changed = true; }
  }
  entry.looked = true;
  if (!changed) return true;
  if (frame === null) farLodReport.loadingWrites++;
  else wroteAt = frame;
  farLodReport.writes++;
  return entry.apply();
}

/** Select the spawn bands under the card. A released index writes directly to its GL buffer. Return the
 * meshes with a new or dirty CPU index so a parked draw uploads those before their first visible draw. */
export async function prepareFarCopyIndices(scene: THREE.Object3D, camera: THREE.Camera,
  current: () => boolean, pause: () => Promise<void>): Promise<ReadonlySet<THREE.Mesh>> {
  const entries: Tracked[] = [], refresh = new Set<THREE.Mesh>();
  scene.traverseVisible(object => {
    if (!isMesh(object) || !object.layers.test(camera.layers)) return;
    const entry = tracked.get(object.geometry);
    if (entry?.ready === true && entry.mesh === object) entries.push(entry);
  });
  let slice = diagnosticNow();
  for (const entry of entries) {
    if (!current()) break;
    const mesh = entry.mesh, geometry = mesh.geometry;
    if (mesh.parent === null || tracked.get(geometry) !== entry) continue;
    const previous = geometry.index, version = previous?.version;
    if (!look(entry, camera, null)) tracked.set(geometry, null);
    else if (geometry.index !== previous || geometry.index?.version !== version) refresh.add(mesh);
    if (diagnosticNow() - slice >= LOAD_SLICE_MS) { await pause(); slice = diagnosticNow(); }
  }
  return refresh;
}

/** Prime only the changed CPU indices through the same offscreen draw that warms the spawn's buffers. */
export async function uploadFarCopyIndices(renderer: Renderer, scene: THREE.Scene, camera: THREE.Camera,
  target: THREE.WebGLRenderTarget, current: () => boolean, pause: () => Promise<void>):
Promise<{ writes: number; queued: number; drawn: number }> {
  const before = farLodReport.loadingWrites;
  const refresh = await prepareFarCopyIndices(scene, camera, current, pause);
  let drawn = 0;
  if (refresh.size > 0 && current()) {
    const { warmParkedDraws } = await import('./parkedDraws');
    if (current()) drawn = await warmParkedDraws(renderer, scene, camera, target, scene, current, pause, { refresh });
  }
  farLodReport.loadingDraws += drawn;
  return { writes: farLodReport.loadingWrites - before, queued: refresh.size, drawn };
}

/**
 * Install on the page's renderer: an eligible mesh is captured at its first draw by any camera (a loading frame's hidden
 * draws come first, and the Memory saver lets the arrays go after them) and, once its copies are built, drawn by square
 * as the view's `camera()` sees it. A no-op unless `debug.farLod` is on at phone Low.
 */
export function installFarLod(renderer: Renderer, camera: () => THREE.Camera): void {
  if (!farLodOn()) return;
  Reflect.set(globalThis, '__wsFarLod', farLodReport);
  // DF9b: a geometry refused for its draw range, by the range it had (a range that stays short was refused every draw)
  const ranged = new WeakMap<THREE.BufferGeometry, number>();
  drawHooks(renderer).lod = (drawer, geometry, object) => {
    let entry = tracked.get(geometry);
    if (entry === undefined) {
      const range = geometry.drawRange.start === 0 ? geometry.drawRange.count : -1 - geometry.drawRange.start;
      if (ranged.get(geometry) === range) return;
      const why = refusal(object, geometry);
      entry = why === null && isMesh(object) ? capture(object, geometry) : null;
      if (why !== null && why !== 'small' && why !== 'kind') farLodReport.whole[why] = (farLodReport.whole[why] ?? 0) + 1;
      // a range still growing (the dressing's clipped reveal) is looked at again at its next draw
      if (why === 'range') ranged.set(geometry, range); else tracked.set(geometry, entry);
    }
    if (entry !== null && entry.ready && drawer === camera() && !look(entry, drawer, renderCount(renderer))) tracked.set(geometry, null);
  };
}
