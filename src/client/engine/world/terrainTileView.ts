/**
 * The render half of a baked terrain tile (SHARD-PLATFORM SF15a, SF9a's wire format): one mesh per admitted tile, its
 * triangles split along the same diagonal as the Rapier heightfield collider (`terrainTileHeight`), so the drawn ground is
 * the ground the player stands on. The tile's lifetime is the scope it is handed: the scope owns the geometry and takes
 * the mesh out of the scene on dispose. Only the coarse tile's index stays on the CPU (refinement rewrites it in place);
 * the other vertex data is GPU-only after its first upload.
 *
 * - **Coarse tiles** (L1: 125 m, 17 × 17 samples) can hide any of their four quadrants in place while fine tiles cover
 *   them (`maskTerrainTile`): one index allocation, one draw, no overlapping surfaces.
 * - **Every other tile** (L0) hangs a skirt below its four edges, so the step where a fine edge meets a coarse neighbour's
 *   straighter edge never opens a crack. The skirt sits under the surface and never changes where the ground is.
 * - Normals are central differences of the **shared lattice** the tiles were cut from (`lattice`: the level's 257²
 *   collider) at each vertex, so every tile that holds a point (two L0 neighbours, an L1 / L0 seam) lights it alike.
 *   Without one, the tile's own grid (second-order one-sided at a tile edge): those agree only to O(h²), and across a sharp
 *   ridge that is a hard tonal line along the tile edge (E435 tiles-shade).
 */
import { BufferAttribute, BufferGeometry, Mesh, type Material, type Object3D } from 'three';
import type { Scope } from '../../../shared/engine/app/scope';
import { gpuOnlyTrees, refillGpuOnly } from '../core/gpuOnly';
import { decodeTerrainTile, type TerrainTileData } from '@wildshard/format/terrainTileBytes';
import { keepShadowWhole } from './shadowChunks';

/** the coarse (L1) tile a quadrant mask applies to: 17 × 17 samples over 125 m, four 8 × 8-cell quadrants */
const COARSE = { resolution: 17, size: 125, half: 8 } as const;

interface TileState { readonly indices: BufferAttribute; readonly resolution: number }
const coarseTiles = new WeakMap<Mesh, TileState>();
/** Where each installed tile sits on the ground, for `refreshTerrainTile`. */
const shapes = new WeakMap<Mesh, Pick<TerrainTileData, 'resolution' | 'x' | 'z' | 'size'>>();

/** True when this tile is a coarse tile whose quadrants refinement may hide. */
/** a coarse (L1) terrain tile: no skirt, its quadrants masked under fine tiles */
export function isCoarse(data: TerrainTileData): boolean { return data.resolution === COARSE.resolution && data.size === COARSE.size; }

/** A grid's slope along one axis at sample `at` of `n`: central inside, second-order one-sided on the grid's edge. Sample
 * `i` of the line is `heights[base + i * stride]` (no closure per vertex: a tile's normals run once per sample at boot). */
function gridSlope(at: number, n: number, step: number, heights: ArrayLike<number>, base: number, stride: number): number {
  const s0 = heights[base] ?? 0, s1 = heights[base + stride] ?? 0;
  if (n === 2) return (s1 - s0) / step;
  if (at === 0) return (-3 * s0 + 4 * s1 - (heights[base + 2 * stride] ?? 0)) / (2 * step);
  const last = heights[base + (n - 1) * stride] ?? 0, before = heights[base + (n - 2) * stride] ?? 0;
  if (at === n - 1) return (3 * last - 4 * before + (heights[base + (n - 3) * stride] ?? 0)) / (2 * step);
  return ((heights[base + (at + 1) * stride] ?? 0) - (heights[base + (at - 1) * stride] ?? 0)) / (2 * step);
}

/** Write the unit normal of slopes (dx, dz) at vertex `vertex`. */
function writeNormal(out: Float32Array, vertex: number, dx: number, dz: number): void {
  const length = Math.hypot(dx, 1, dz), at = vertex * 3;
  out[at] = -dx / length; out[at + 1] = 1 / length; out[at + 2] = -dz / length;
}

/** Grid normals from the tile's own heights (one-sided at its edges, so neighbours agree only to O(h²)). */
function gridNormals(data: TerrainTileData, out: Float32Array): void {
  const r = data.resolution, step = data.size / (r - 1), heights = data.heights;
  for (let z = 0; z < r; z++) for (let x = 0; x < r; x++) writeNormal(out, z * r + x, gridSlope(x, r, step, heights, z * r, 1), gridSlope(z, r, step, heights, x, r));
}

/** The lattice sample index of world coordinate `w` on one axis, or −1 when `w` is not one of its samples. */
function latticeIndex(w: number, origin: number, step: number, n: number): number {
  const g = (w - origin) / step, i = Math.round(g);
  return Math.abs(g - i) < 1e-3 && i >= 0 && i < n ? i : -1;
}

/**
 * Normals from the shared lattice the tile was cut from: each vertex's normal is a function of its world position only
 * (central differences of the lattice there, one-sided only on the lattice's own edge), so tiles sharing a point agree
 * exactly. False (nothing written) when a vertex is not a lattice sample.
 */
function latticeNormals(data: TerrainTileData, lattice: TerrainTileData, out: Float32Array): boolean {
  const r = data.resolution, cell = data.size / (r - 1), n = lattice.resolution, step = lattice.size / (n - 1), columns: number[] = [], rows: number[] = [];
  for (let i = 0; i < r; i++) {
    const x = latticeIndex(data.x + i * cell, lattice.x, step, n), z = latticeIndex(data.z + i * cell, lattice.z, step, n);
    if (x < 0 || z < 0) return false;
    columns.push(x); rows.push(z);
  }
  const heights = lattice.heights;
  for (let z = 0; z < r; z++) for (let x = 0; x < r; x++) {
    const lx = columns[x] ?? 0, lz = rows[z] ?? 0;
    writeNormal(out, z * r + x, gridSlope(lx, n, step, heights, lz * n, 1), gridSlope(lz, n, step, heights, lx, n));
  }
  return true;
}

/** The perimeter in walk order (+x along z = 0, +z along x = r − 1, −x along z = r − 1, −z along x = 0): skirts face outward. */
function perimeter(r: number): number[] {
  const ring: number[] = [];
  for (let x = 0; x < r - 1; x++) ring.push(x);
  for (let z = 0; z < r - 1; z++) ring.push(z * r + r - 1);
  for (let x = r - 1; x > 0; x--) ring.push((r - 1) * r + x);
  for (let z = r - 1; z > 0; z--) ring.push(z * r);
  return ring;
}

/**
 * Install one admitted terrain render tile under `root`; `scope` owns its geometry and its place in the scene.
 * The mesh receives shadows; it casts them only when `shadow` is set (an L0 tile wholly inside the shadow disc). `material`
 * stays the caller's (one family material shared by every tile). It takes the tile's wire bytes, or the tile already
 * decoded (and validated) by `decodeTerrainTile` off the main thread (SF18b's decode workers). `lattice` is the shared
 * height lattice the tile was cut from (the level's collider, every tile's vertices among its samples): the normals come
 * from it, so the tile's edges light like its neighbours'; a tile off that lattice falls back to its own grid.
 */
export function installTerrainTile(bytes: Uint8Array | TerrainTileData, ports: { root: Object3D; scope: Scope; material: Material; shadow: boolean; lattice?: TerrainTileData }): Mesh {
  if (ports.scope.disposed) throw new Error('terrain tile: its scope is already disposed');
  const data = bytes instanceof Uint8Array ? decodeTerrainTile(bytes) : bytes, r = data.resolution, coarse = isCoarse(data);
  const { positions, normals, colour, vertices } = tileVertices(data, ports.lattice);
  const ring = coarse ? 0 : vertices - r * r, gridIndices = (r - 1) ** 2 * 6, total = gridIndices + ring * 6;
  const indices = vertices > 65535 ? new Uint32Array(total) : new Uint16Array(total);
  for (let z = 0; z < r - 1; z++) for (let x = 0; x < r - 1; x++) {
    // Rapier's split: the triangles (x, z) (x, z+1) (x+1, z) and (x+1, z) (x, z+1) (x+1, z+1), diagonal (x+1, z)–(x, z+1).
    const vertex = z * r + x;
    indices.set([vertex, vertex + r, vertex + 1, vertex + 1, vertex + r, vertex + r + 1], (z * (r - 1) + x) * 6);
  }
  const edge = coarse ? [] : perimeter(r), grid = r * r;
  edge.forEach((border, i) => { const next = (i + 1) % edge.length, b = edge[next] ?? border; indices.set([border, b, grid + i, b, grid + next, grid + i], gridIndices + i * 6); });
  const geometry = ports.scope.own(new BufferGeometry());
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setAttribute('color', new BufferAttribute(colour, 3));
  const index = new BufferAttribute(indices, 1);
  geometry.setIndex(index); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  // normals and colours are read by nothing after the upload; position and the index stay for picking raycasts
  const mesh = new Mesh(geometry, ports.material);
  gpuOnlyTrees([mesh], 'shardfile.terrain', ['position']);
  mesh.name = `terrain:${data.x},${data.z}`; mesh.position.set(data.x, 0, data.z); mesh.receiveShadow = true; mesh.castShadow = ports.shadow;
  mesh.matrixAutoUpdate = false; mesh.updateMatrix();
  // a tile is already one shadow-culling piece, and the caller's shadow disc switches its castShadow: never split it (SF16)
  keepShadowWhole(mesh);
  if (coarse) coarseTiles.set(mesh, { indices: index, resolution: r });
  shapes.set(mesh, { resolution: r, x: data.x, z: data.z, size: data.size });
  ports.root.add(mesh); ports.scope.onDispose(() => { mesh.removeFromParent(); coarseTiles.delete(mesh); });
  return mesh;
}

/** A tile's vertex arrays, its skirt ring after the grid on a fine tile: what `installTerrainTile` uploads. */
function tileVertices(data: TerrainTileData, lattice: TerrainTileData | undefined): { positions: Float32Array; normals: Float32Array; colour: Float32Array; vertices: number } {
  const r = data.resolution, colours = data.colours;
  if (colours === undefined) throw new Error('terrain tile: a render tile needs vertex colours (a heights-only payload is a collider)');
  const coarse = isCoarse(data), ring = coarse ? [] : perimeter(r), grid = r * r, vertices = grid + ring.length;
  // a coarse tile has no skirt, so it draws the decoded colours as they are; a skirted tile extends a copy
  const positions = new Float32Array(vertices * 3), normals = new Float32Array(vertices * 3), colour = coarse ? colours : new Float32Array(vertices * 3);
  const cell = data.size / (r - 1);
  for (let z = 0; z < r; z++) for (let x = 0; x < r; x++) {
    const at = (z * r + x) * 3;
    positions[at] = x * cell; positions[at + 1] = data.heights[z * r + x] ?? 0; positions[at + 2] = z * cell;
  }
  if (!coarse) colour.set(colours);
  if (lattice === undefined || !latticeNormals(data, lattice, normals)) gridNormals(data, normals);
  const depth = data.size / 16;
  ring.forEach((border, i) => {
    const from = border * 3, to = (grid + i) * 3;
    positions[to] = positions[from] ?? 0; positions[to + 1] = (positions[from + 1] ?? 0) - depth; positions[to + 2] = positions[from + 2] ?? 0;
    for (let c = 0; c < 3; c++) { normals[to + c] = normals[from + c] ?? 0; colour[to + c] = colour[from + c] ?? 0; }
  });
  return { positions, normals, colour, vertices };
}

/**
 * SHARD-SOURCE AP18 (dev only: `wildshard watch`'s ground swap). Cut this installed tile again from a new whole-ground
 * lattice (heights and colours, the 257² the tiles were baked from) and rewrite its vertices in their buffers: the same
 * vertices `installTerrainTile` makes from a tile the bake cut from that lattice. False, and nothing written, when the tile
 * is not one of this module's or its vertices are not the lattice's samples.
 */
export function refreshTerrainTile(mesh: Mesh, lattice: TerrainTileData): boolean {
  const shape = shapes.get(mesh), colours = lattice.colours;
  if (shape === undefined || colours === undefined) return false;
  const r = shape.resolution, n = lattice.resolution, step = lattice.size / (n - 1), cell = shape.size / (r - 1);
  const heights = new Float32Array(r * r), colour = new Float32Array(r * r * 3);
  for (let z = 0; z < r; z++) for (let x = 0; x < r; x++) {
    const lx = latticeIndex(shape.x + x * cell, lattice.x, step, n), lz = latticeIndex(shape.z + z * cell, lattice.z, step, n);
    if (lx < 0 || lz < 0) return false;
    const at = lz * n + lx, i = z * r + x;
    heights[i] = lattice.heights[at] ?? 0; colour.set(colours.subarray(at * 3, at * 3 + 3), i * 3);
  }
  const fresh = tileVertices({ ...shape, heights, colours: colour }, lattice);
  const geometry = mesh.geometry, position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal'), tint = geometry.getAttribute('color');
  if (!(position instanceof BufferAttribute) || !(normal instanceof BufferAttribute) || !(tint instanceof BufferAttribute) || position.count !== fresh.vertices) return false;
  position.array.set(fresh.positions); position.needsUpdate = true;
  refillGpuOnly(normal, fresh.normals); refillGpuOnly(tint, fresh.colour);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return true;
}

/**
 * Hide a coarse tile's quadrants (0 = −x −z, 1 = +x −z, 2 = −x +z, 3 = +x +z) in place while fine tiles cover them.
 * The tile's one index buffer is rewritten and its draw range shortened, so no allocation, no extra draw and no
 * overlapping surface. An empty set shows the whole tile again; all four hides it from the draw list. A fine tile has
 * nothing under it: an empty set is a no-op there, any quadrant an error.
 */
export function maskTerrainTile(mesh: Mesh, excluded: ReadonlySet<number>): void {
  for (const quadrant of excluded) if (!Number.isInteger(quadrant) || quadrant < 0 || quadrant > 3) throw new Error('terrain tile: a quadrant is 0..3');
  const tile = coarseTiles.get(mesh);
  if (tile === undefined) {
    if (excluded.size === 0) return;
    throw new Error('terrain tile: only an installed coarse (L1) tile can mask quadrants');
  }
  const r = tile.resolution, array = tile.indices.array; let at = 0;
  for (let z = 0; z < r - 1; z++) for (let x = 0; x < r - 1; x++) {
    if (excluded.has(Number(x >= COARSE.half) + Number(z >= COARSE.half) * 2)) continue;
    const vertex = z * r + x;
    array[at] = vertex; array[at + 1] = vertex + r; array[at + 2] = vertex + 1;
    array[at + 3] = vertex + 1; array[at + 4] = vertex + r; array[at + 5] = vertex + r + 1; at += 6;
  }
  tile.indices.clearUpdateRanges(); tile.indices.addUpdateRange(0, at); tile.indices.needsUpdate = true;
  mesh.geometry.setDrawRange(0, at); mesh.visible = at > 0;
}
