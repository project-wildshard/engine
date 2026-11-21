/**
 * meta DRIFTWOOD-FPS DF9 (mini-df9, 2026-11-20): far copies of the wide static meshes at phone Low, by square, in their
 * own index. Driftwood's ground, its merged palms, rocks, coconuts, crags, bushes, props and kit span the island in one
 * draw each, so every one of their triangles draws at every distance: at the dock 240k of the 570k on the phone's Low
 * frame lie past 100 m (the grid rig's census, meta project/evidence/driftwood-fps/df9-far-lod-2026-11-20.md).
 *
 * With the device slot `debug.farLod` on, each such mesh's triangles are sorted into squares of its local xz at its
 * first draw (before the Memory saver lets its arrays go): `SQUARE` m, or the tiles of a tiled mesh (tiledMesh.ts, whose
 * index the tile driver owns: `farTiles`). After control, in slices, each square gets coarser copies (meshoptimizer's
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
  /** draw the squares at their levels; false: the mesh can no longer take them */
  readonly apply: () => boolean;
}

/** What the far copies did on this page (the bench reads it as `__wsFarLod`). */
export const farLodReport = { meshes: 0, tiled: 0, squares: 0, ready: 0, writes: 0, full: 0, drawn: 0, captureMs: 0, buildMs: 0, refused: 0,
  whole: {} as Record<string, number>, log: [] as [string, number, number][] };

const tracked = new WeakMap<THREE.BufferGeometry, Tracked | null>();
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
  for (const starts of groups) {
    if (starts.length === 0) continue;
    const full = ownedArray(Uint32Array, starts.length * 3, KEPT);
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

function track(mesh: THREE.Mesh, squares: Square[], positions: Float32Array, apply: () => boolean): Tracked {
  mesh.updateWorldMatrix(true, false);
  const entry: Tracked = { mesh, squares, positions, looks: looksOf(mesh.geometry), scale: mesh.matrixWorld.getMaxScaleOnAxis(), ready: false,
    last: new THREE.Vector3(Infinity, Infinity, Infinity), looked: false, apply };
  farLodReport.meshes++; farLodReport.squares += squares.length;
  if (farLodReport.log.length < 64) farLodReport.log.push([mesh.name, Math.round(diagnosticNow()), squares.reduce((n, square) => n + square.full.length / 3, 0)]);
  for (const square of squares) farLodReport.full += square.full.length / 3;
  queue.push(entry); startBuilding();
  return entry;
}

/** The square's triangles at `level` (0: its own); a level not built falls back to the finer one. */
function trianglesAt(square: Square, level: number): Uint32Array {
  for (let l = level; l >= 1; l--) { const copy = square.copies[l - 1]; if (copy !== null && copy !== undefined) return copy; }
  return square.full;
}

/** Sort `mesh`'s triangles into SQUARE m squares now (its arrays are still here); its copies are built later, in slices. */
function capture(mesh: THREE.Mesh, geometry: THREE.BufferGeometry): Tracked {
  const t0 = diagnosticNow();
  const position = geometry.attributes['position'] as THREE.BufferAttribute | THREE.InterleavedBufferAttribute, vertices = position.count, positions = floats(position);
  const index = geometry.index, count = index === null ? vertices : index.count;
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
  const groups = sizes.map(n => ownedArray(Uint32Array, n, SCRATCH)), fill = ownedArray(Int32Array, sizes.length, SCRATCH);
  for (let t = 0; t < triangles; t++) { const id = ids[t] ?? 0, at = fill[id] ?? 0; const group = groups[id]; if (group !== undefined) group[at] = t * 3; fill[id] = at + 1; }
  const squares = squaresOf(positions, corners, groups);
  let drawn = count;
  const apply = (): boolean => {
    let total = 0;
    for (const square of squares) total += trianglesAt(square, square.level).length;
    const out = ownedArray(Uint32Array, total, SCRATCH);
    let at = 0;
    for (const square of squares) { const part = trianglesAt(square, square.level); out.set(part, at); at += part.length; }
    if (geometry.index === null) {
      // a soup: its first index, as large as all its faces, so a finer pick later still fits
      const array = vertices > 65535 ? ownedArray(Uint32Array, count, SOUP) : ownedArray(Uint16Array, count, SOUP); array.set(out);
      geometry.setIndex(new THREE.BufferAttribute(array, 1));
    } else if (!writeIndexTriangles(geometry.index, [{ at: 0, triangles: out }], false)) return false;
    geometry.setDrawRange(0, total);
    farLodReport.drawn += (total - drawn) / 3; drawn = total;
    return true;
  };
  farLodReport.captureMs += diagnosticNow() - t0;
  return track(mesh, squares, positions, apply);
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
  const positions = floats(position), tiles: number[] = [], groups: Uint32Array[] = [];
  for (let tile = 0; tile < ranges.count.length; tile++) {
    const n = ranges.count[tile] ?? 0; if (n === 0) continue;
    const starts = ownedArray(Uint32Array, n, SCRATCH), from = ranges.start[tile] ?? 0;
    for (let k = 0; k < n; k++) starts[k] = (ranges.order[from + k] ?? 0) * 3;
    tiles.push(tile); groups.push(starts);
  }
  const squares = squaresOf(positions, source, groups), bySquare = new Map<number, Square>();
  squares.forEach((square, i) => { const tile = tiles[i]; if (tile !== undefined) bySquare.set(tile, square); });
  const entry = track(mesh, squares, positions, () => { redraw(); return true; });
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

/**
 * A square's copy within `error` (local units): its corners welded by position, simplified with its border locked, and
 * each corner of each new face mapped back to one of the original vertices there. With `looks` (colour, cover...) the
 * corner takes the original whose look is nearest the new face's (the mean of its corners' originals), so a face on the
 * sand keeps sand at a corner it shares with the grass; between originals of one look, and with no looks, the one whose
 * face turns most like the new face (a merged face keeps a neighbour's normal).
 */
export function squareCopy(simplify: Simplifier['simplify'], positions: Float32Array, full: Uint32Array, error: number, looks: Looks | null = null): Uint32Array {
  const weldOf = new Map<number, number>(), byKey = new Map<number | string, number>(), welded: number[] = [], originals: number[][] = [];
  const at = (v: number, j: number): number => positions[v * 3 + j] ?? 0;
  const widx = ownedArray(Uint32Array, full.length, SCRATCH);
  // a position's key: millimetres from the square's first corner, packed exactly in a double (x and z within 65 m, y
  // within 262 m of it), else as text
  const first = full[0] ?? 0, ox = at(first, 0), oy = at(first, 1), oz = at(first, 2);
  const keyOf = (v: number): number | string => {
    const x = Math.round((at(v, 0) - ox) * 1000) + 65536, y = Math.round((at(v, 1) - oy) * 1000) + 262144, z = Math.round((at(v, 2) - oz) * 1000) + 65536;
    if (x >= 0 && x < 131072 && z >= 0 && z < 131072 && y >= 0 && y < 524288) return x + 131072 * (z + 131072 * y);
    return `${String(x)},${String(y)},${String(z)}`;
  };
  for (let i = 0; i < full.length; i++) {
    const v = full[i] ?? 0;
    let w = weldOf.get(v);
    if (w === undefined) {
      const key = keyOf(v);
      w = byKey.get(key);
      if (w === undefined) { w = welded.length / 3; byKey.set(key, w); welded.push(at(v, 0), at(v, 1), at(v, 2)); originals.push([]); }
      weldOf.set(v, w); originals[w]?.push(v);
    }
    widx[i] = w;
  }
  // each original vertex's face direction (its first face in this square)
  const faceOf = new Map<number, [number, number, number]>();
  const normal = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): [number, number, number] => {
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  };
  for (let t = 0; t < full.length; t += 3) {
    const a = full[t] ?? 0, b = full[t + 1] ?? 0, c = full[t + 2] ?? 0;
    const f = normal(at(a, 0), at(a, 1), at(a, 2), at(b, 0), at(b, 1), at(b, 2), at(c, 0), at(c, 1), at(c, 2));
    for (const v of [a, b, c]) if (!faceOf.has(v)) faceOf.set(v, f);
  }
  const wpos = ownedArray(Float32Array, welded.length, SCRATCH); wpos.set(welded);
  const [out] = simplify(widx, wpos, 3, 0, error, ['LockBorder', 'ErrorAbsolute', 'Prune']);
  const copy = ownedArray(Uint32Array, out.length, SCRATCH);
  const w3 = (w: number, j: number): number => wpos[w * 3 + j] ?? 0;
  const size = looks?.size ?? 0, hue = ownedArray(Float64Array, size, SCRATCH);
  for (let t = 0; t < out.length; t += 3) {
    const a = out[t] ?? 0, b = out[t + 1] ?? 0, c = out[t + 2] ?? 0;
    const f = normal(w3(a, 0), w3(a, 1), w3(a, 2), w3(b, 0), w3(b, 1), w3(b, 2), w3(c, 0), w3(c, 1), w3(c, 2));
    if (looks !== null) {
      // the new face's look: the mean over its corners' originals
      hue.fill(0); let n = 0;
      for (const w of [a, b, c]) for (const v of originals[w] ?? []) { for (let j = 0; j < size; j++) hue[j] = (hue[j] ?? 0) + (looks.values[v * size + j] ?? 0); n++; }
      for (let j = 0; j < size; j++) hue[j] = (hue[j] ?? 0) / Math.max(1, n);
    }
    for (let k = 0; k < 3; k++) {
      const list = originals[out[t + k] ?? 0] ?? [];
      let best = list[0] ?? 0, score = -Infinity;
      if (list.length > 1) for (const v of list) {
        const g = faceOf.get(v); let s = g === undefined ? -2 : g[0] * f[0] + g[1] * f[1] + g[2] * f[2];
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
  return copy;
}

let simplifier: Simplifier | null = null, loading: Promise<void> | null = null, building = false, started = false;

/** Build the queued meshes' copies in slices of SLICE_MS, a gap between, from START_MS after the first capture. */
function startBuilding(): void {
  if (building) return;
  building = true;
  loading ??= (async (): Promise<void> => {
    try {
      const loaded = (await import('three/examples/jsm/libs/meshopt_simplifier.module.js')).MeshoptSimplifier;
      await loaded.ready; simplifier = loaded;
    } catch { farLodReport.refused++; }
  })();
  const work = builds();
  const slice = (): void => {
    if (simplifier === null) { pageScope.timeout(250, slice); return; }
    const t0 = diagnosticNow();
    let done = false;
    while (diagnosticNow() - t0 < SLICE_MS) if (work.next().done === true) { done = true; break; }
    farLodReport.buildMs += diagnosticNow() - t0;
    if (done) { building = false; if (queue.length > 0) startBuilding(); return; }
    pageScope.timeout(SLICE_GAP_MS, slice);
  };
  // the boot's captures wait out its first frames; a later one (a merge's rebuilt block) starts at once
  pageScope.timeout(started ? 0 : START_MS, slice);
  started = true;
}

function* builds(): Generator<void, void> {
  while (queue.length > 0) {
    const entry = queue.shift();
    if (entry === undefined || entry.positions === null || simplifier === null) continue;
    const positions = entry.positions;
    // the coarsest copies first (the far squares hold most triangles), then each finer level; the squares are picked
    // again as each level lands
    for (let l = FAR_LEVELS.length - 1; l >= 0; l--) {
      const level = FAR_LEVELS[l]; if (level === undefined) continue;
      for (const square of entry.squares) {
        const copy = squareCopy(simplifier.simplify, positions, square.full, level.error / entry.scale, entry.looks);
        // a copy no smaller than its square's own is left out (trianglesAt falls back to the finer one)
        if (copy.length < square.full.length * 0.95) { const kept = ownedArray(Uint32Array, copy.length, KEPT); kept.set(copy); square.copies[l] = kept; }
        yield;
      }
      entry.ready = true; entry.looked = false;
    }
    entry.positions = null; entry.looks = null; farLodReport.ready++;
  }
}

const local = new THREE.Vector3(), inverse = new THREE.Matrix4();
let wroteAt = -1;

/** Each view draw of a tracked mesh: pick each square's level from the camera, and draw them when any changed. */
function look(entry: Tracked, camera: THREE.Camera, frame: number): boolean {
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
  wroteAt = frame; farLodReport.writes++;
  return entry.apply();
}

/**
 * Install on the page's renderer: an eligible mesh is captured at its first draw by any camera (a loading frame's hidden
 * draws come first, and the Memory saver lets the arrays go after them) and, once its copies are built, drawn by square
 * as the view's `camera()` sees it. A no-op unless `debug.farLod` is on at phone Low.
 */
export function installFarLod(renderer: Renderer, camera: () => THREE.Camera): void {
  if (!farLodOn()) return;
  Reflect.set(globalThis, '__wsFarLod', farLodReport);
  drawHooks(renderer).lod = (drawer, geometry, object) => {
    let entry = tracked.get(geometry);
    if (entry === undefined) {
      const why = refusal(object, geometry);
      entry = why === null && isMesh(object) ? capture(object, geometry) : null;
      if (why !== null && why !== 'small' && why !== 'kind') farLodReport.whole[why] = (farLodReport.whole[why] ?? 0) + 1;
      // a range still growing (the dressing's clipped reveal) is looked at again at its next draw
      if (why !== 'range') tracked.set(geometry, entry);
    }
    if (entry !== null && entry.ready && drawer === camera() && !look(entry, drawer, renderCount(renderer))) tracked.set(geometry, null);
  };
}
