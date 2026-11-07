import * as THREE from 'three';
import { SHADOW_LAYER } from '../core/shadowLayer';
import { geometryBoundsSteps } from './geometryBounds';
import { castWholeInLastCascade } from './cascadeCull';

/**
 * E153: island-wide merged casters draw into each shadow map in pieces.
 *
 * The terrain and the merged vegetation / rock meshes span the island (bounding spheres 160–280 m), so every shadow map
 * whose box they touch drew all of them: the 7 m near cascade drew 236 k triangles, the 22 m one 272 k, the far one
 * 350 k, and each sun-fade ghost as much again (Driftwood's phone rig: 3 cascades + 2 ghosts at 2048²; 1.4–1.5 M
 * shadow triangles a frame, 0.32 M before the day's rig changes). Per-cascade culling (cascadeCull.ts) could not help:
 * one draw is one sphere.
 *
 * Each such mesh stops casting and gets shadow-only children (SHADOW_LAYER: the shadow pass draws them, the view never
 * does), one per `cell` × `cell` square of its triangles, each a drawRange into ONE shared index sorted by square. The
 * vertex buffers are the mesh's own (the same BufferAttribute objects: no copy, no second upload); the only new memory
 * is that index (2 or 4 bytes a vertex). Every shadow texel keeps the same depth: the same triangles, the same material
 * and customDepthMaterial, the same transform (children at identity), culled per piece instead of whole.
 *
 * Only static, single-material, whole-range meshes (no morphs, skins, instances, batches or dynamic positions), once
 */

const MIN_RADIUS = 40; // m: smaller meshes are culled well enough whole
const MIN_TRIS = 2000;
/** m: a caster this wide splits whatever its triangle count (PF3: Pine's 256-triangle boundary ring, 355 m round the origin,
 *  passed every cascade's test whole and drew each redraw, ~0.25 ms of a Chromium-4x phone shadow pass, though its shadow
 *  reaches the cascade only at the world's edge). Twice the phone cascade's reach. */
const WIDE_RADIUS = 120;
const MAX_CELLS = 64; // per mesh: the cell grows with the mesh (every piece is a scene object the shadow pass tests)

interface ChunkUserData { shadowChunked?: boolean }

/**
 * Meshes that are already a caster-sized piece and switch their own `castShadow` (SHARD-PLATFORM SF16): a baked 62.5 m
 * terrain tile whose casting the 80 m shadow disc turns on and off. Split, it drew 36–64 always-casting pieces per tile
 * (the disc's switch reached only the silent parent): 160–270 shadow draws a frame on the M1 template, 85 % of its calls.
 */
const whole = new WeakSet<THREE.Object3D>();
/** Keep `mesh` out of `chunkShadowCasters`: it casts whole, and its own `castShadow` stays the switch. */
export function keepShadowWhole(mesh: THREE.Mesh): void { whole.add(mesh); }

export interface ShadowChunkReport { meshes: number; pieces: number; tris: number }

/** Triangles a split walks between pause points (SF67: an island-wide terrain is ~0.5 M triangles, one 0.3 s task at 4×). */
const PAUSE_EVERY = 16384;

/** One pass of the work: every eligible mesh's split, pausing (`yield`) every PAUSE_EVERY triangles. */
function* chunkWork(scene: THREE.Scene, report: ShadowChunkReport): Generator<void, void> {
  const found: THREE.Mesh[] = [];
  scene.traverse((o) => { if (eligible(o)) found.push(o); });
  for (const mesh of found) {
    if ((mesh.userData as ChunkUserData).shadowChunked === true) continue;
    // Eligibility used to scan every unbounded caster inside scene.traverse,
    // before the sliced worker reached its first pause point.
    if (mesh.geometry.boundingSphere === null) yield* geometryBoundsSteps(mesh.geometry, 'sphere');
    const radius = mesh.geometry.boundingSphere?.radius ?? 0;
    mesh.updateWorldMatrix(true, false);
    const reach = radius * mesh.matrixWorld.getMaxScaleOnAxis();
    if (!(reach >= MIN_RADIUS) || (triangles(mesh.geometry) < MIN_TRIS && !(reach >= WIDE_RADIUS))) continue;
    const n = yield* split(mesh);
    if (n > 0) { report.meshes++; report.pieces += n; report.tris += triangles(mesh.geometry); }
    yield;
  }
}


/**
 * The same split, its pieces and its order identical to `chunkShadowCasters`, in slices (SF67, E461): at every pause point
 * it calls `due()`, and awaits the promise it returns (the caller's clock decides: a painted frame after ~12 ms of work).
 * A mesh changes only when its own split finishes, so a pause never leaves a half-split mesh in the scene.
 */
export async function chunkShadowCastersSliced(scene: THREE.Scene, due: () => Promise<void> | null): Promise<ShadowChunkReport> {
  const report: ShadowChunkReport = { meshes: 0, pieces: 0, tris: 0 };
  const work = chunkWork(scene, report);
  while (work.next().done !== true) {
    const pause = due();
    if (pause !== null) await pause;
  }
  return report;
}

function triangles(g: THREE.BufferGeometry): number {
  return Math.floor((g.index ? g.index.count : g.attributes['position']?.count ?? 0) / 3);
}

const isMesh = (o: THREE.Object3D): o is THREE.Mesh => (o as Partial<THREE.Mesh>).isMesh === true;

function eligible(o: THREE.Object3D): o is THREE.Mesh {
  if (!isMesh(o) || !o.castShadow || whole.has(o)) return false;
  // a split mesh and the pieces it made are marked: the walk passes them before the prototype tests
  if ((o.userData as ChunkUserData).shadowChunked === true) return false;
  if ('isInstancedMesh' in o || 'isSkinnedMesh' in o || 'isBatchedMesh' in o) return false;
  const mesh = o;
  if (Array.isArray(mesh.material)) return false;
  const g = mesh.geometry;
  const pos = g.attributes['position'];
  if (!(pos instanceof THREE.BufferAttribute) || pos.usage !== THREE.StaticDrawUsage) return false; // interleaved or rewritten per frame: whole
  if (Object.keys(g.morphAttributes).length > 0 || g.groups.length > 1) return false;
  if (g.drawRange.start !== 0 || Number.isFinite(g.drawRange.count)) return false;
  return triangles(g) >= 2; // MIN_TRIS, or WIDE_RADIUS for a wide one: tested with the radius (chunkWork)
}

/** the mesh's triangles into squares of its local xz; returns the pieces made (0: it stays whole). Yields every
 *  PAUSE_EVERY triangles walked; the mesh itself changes only at the end. */
function* split(mesh: THREE.Mesh): Generator<void, number> {
  const g: THREE.BufferGeometry = mesh.geometry;
  const pos = g.attributes['position'];
  if (pos === undefined) return 0;
  const src = g.index;
  const nTri = triangles(g);
  // the arrays themselves (what getX / getZ / fromBufferAttribute read for an unnormalised attribute): in the page those
  // accessors see every attribute class, and the walks over every vertex of an island-wide caster were the chunking's
  // largest cost (Nine's home region, 4x CPU)
  const indices = src === null ? null : src.array, xyz = pos instanceof THREE.BufferAttribute && !pos.normalized && pos.itemSize === 3 ? pos.array : null;
  const vert = (t: number, k: number): number => (indices !== null ? indices[3 * t + k] ?? 0 : 3 * t + k);
  yield* geometryBoundsSteps(g, 'box');
  const box = g.boundingBox;
  if (box === null) return 0;
  const w = box.max.x - box.min.x, d = box.max.z - box.min.z;
  const cell = Math.max(1e-3, Math.sqrt((w * d) / MAX_CELLS), w / 8, d / 8);
  const nx = Math.max(1, Math.ceil(w / cell)), nz = Math.max(1, Math.ceil(d / cell));
  const cellOf = new Uint16Array(nTri);
  const counts = new Uint32Array(nx * nz);
  for (let t = 0; t < nTri; t++) {
    let cx = 0, cz = 0;
    for (let k = 0; k < 3; k++) { const v = vert(t, k); cx += xyz !== null ? xyz[3 * v] ?? 0 : pos.getX(v); cz += xyz !== null ? xyz[3 * v + 2] ?? 0 : pos.getZ(v); }
    const ix = Math.min(nx - 1, Math.max(0, Math.floor((cx / 3 - box.min.x) / cell)));
    const iz = Math.min(nz - 1, Math.max(0, Math.floor((cz / 3 - box.min.z) / cell)));
    const c = iz * nx + ix;
    cellOf[t] = c;
    counts[c] = (counts[c] ?? 0) + 1;
    if (t % PAUSE_EVERY === PAUSE_EVERY - 1) yield;
  }
  let used = 0;
  for (const c of counts) if (c > 0) used++;
  if (used < 2) return 0;
  // one index, sorted by cell
  const start = new Uint32Array(nx * nz);
  let acc = 0;
  for (let c = 0; c < counts.length; c++) { start[c] = acc; acc += counts[c] ?? 0; }
  const vertices = pos.count;
  const index = vertices > 65535 ? new Uint32Array(nTri * 3) : new Uint16Array(nTri * 3);
  const fill = start.slice();
  for (let t = 0; t < nTri; t++) {
    const c = cellOf[t] ?? 0, at = fill[c] ?? 0;
    fill[c] = at + 1;
    for (let k = 0; k < 3; k++) index[3 * at + k] = vert(t, k);
    if (t % PAUSE_EVERY === PAUSE_EVERY - 1) yield;
  }
  const shared = new THREE.BufferAttribute(index, 1);
  const pieces = new THREE.Group();
  pieces.name = `${mesh.name || 'mesh'}-shadow-pieces`;
  pieces.matrixAutoUpdate = false;
  const sphere = new THREE.Box3(), p = new THREE.Vector3();
  for (let c = 0; c < counts.length; c++) {
    const count = counts[c] ?? 0;
    if (count === 0) continue;
    const geo = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(g.attributes)) geo.setAttribute(name, attr);
    geo.setIndex(shared);
    const first = (start[c] ?? 0) * 3;
    geo.setDrawRange(first, count * 3);
    sphere.makeEmpty();
    for (let i = first; i < first + count * 3; i++) {
      const v = index[i] ?? 0;
      sphere.expandByPoint(xyz !== null ? p.set(xyz[3 * v] ?? 0, xyz[3 * v + 1] ?? 0, xyz[3 * v + 2] ?? 0) : p.fromBufferAttribute(pos, v));
    }
    if (count > PAUSE_EVERY / 4) yield;
    geo.boundingBox = sphere.clone();
    geo.boundingSphere = sphere.getBoundingSphere(new THREE.Sphere());
    const piece = new THREE.Mesh(geo, mesh.material);
    piece.name = `${pieces.name}-${String(c)}`;
    piece.castShadow = true;
    (piece.userData as ChunkUserData).shadowChunked = true;
    piece.receiveShadow = false;
    piece.layers.set(SHADOW_LAYER);
    piece.matrixAutoUpdate = false;
    piece.customDepthMaterial = mesh.customDepthMaterial;
    piece.customDistanceMaterial = mesh.customDistanceMaterial;
    piece.onBeforeShadow = (...a) => { mesh.onBeforeShadow(...a); };
    piece.onAfterShadow = (...a) => { mesh.onAfterShadow(...a); };
    pieces.add(piece);
  }
  mesh.castShadow = false;
  (mesh.userData as ChunkUserData).shadowChunked = true;
  // DW: the last cascade draws it whole, in one draw, the others its pieces (cascadeCull.ts); a never-culled mesh would
  // skip that test and cast into every map, so it keeps its pieces alone
  if (mesh.frustumCulled) castWholeInLastCascade(mesh, pieces.children.filter(isMesh));
  mesh.add(pieces);
  pieces.updateMatrixWorld(true);
  return pieces.children.length;
}
