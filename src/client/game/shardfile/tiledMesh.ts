/**
 * Tile streaming T3 (G652): a merged recipe mesh (a scene step's rock set, wreck, trail…) by tile. Its triangles are
 * sorted once by the tile of their centroid (cell-local), and the mesh keeps one draw whose index holds only the resident
 * tiles' triangles, so tiling changes what it draws, never how many draws it takes.
 *
 *   const content = tiledMesh('rocks.shore', mesh, mesh.matrixWorld);   // null: nothing to tile
 *   if (content !== null) handles.addTiled(content);                   // the tile driver attaches its tiles
 *
 * An instanced part (a step's palms, hibiscus, reef) is sorted by the tile of each instance's position instead, and keeps
 * one draw whose first `count` instances are the resident tiles' (every per-instance attribute compacted alike).
 *
 * A mesh that is skinned, morphing or multi-material stays whole, as does one whose triangles (or instances) all fall in a
 * single tile (a moving part, say: its install pose says nothing about where it goes) and an instanced part with a
 * per-frame hook of its own (a culler that owns its count). Static content (`single`: a frozen weld's mesh) never moves,
 * so a mesh wholly in one tile follows that tile. A mesh its scene never culls (`frustumCulled` false: a painted sky sphere
 * kept on the eye, a backdrop) stays whole too: its triangles past the cell clamped into the border tiles, so the ring
 * around the city drew none of Nine's sky.
 */
import { BufferAttribute, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, type Matrix4, type Mesh, Object3D, SkinnedMesh } from 'three';
import { compactResident, tileKey, tileRanges, type TileContent } from './tileContent';
import { TILES_PER_SIDE, tileOf } from '../../../shared/game/shardfile/tileOrder';

const attributeReaders: readonly unknown[] = ['getX', 'getY', 'getZ'].map((key): unknown => Reflect.get(BufferAttribute.prototype, key));
function originalReader(attribute: BufferAttribute, key: string, expected: unknown): boolean {
  let cursor: object | null = attribute;
  while (cursor !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
    if (descriptor !== undefined) return 'value' in descriptor && descriptor.value === expected;
    const parent: unknown = Object.getPrototypeOf(cursor);
    cursor = typeof parent === 'object' && parent !== null ? parent : null;
  }
  return false;
}
function centroidArrays(index: BufferAttribute, position: BufferAttribute): { indices: Uint16Array | Uint32Array; positions: Float32Array } | null {
  for (const attribute of [index, position]) for (const key of ['array', 'itemSize', 'normalized']) {
    if (Object.getOwnPropertyDescriptor(attribute, key)?.value === undefined) return null;
  }
  if (index.normalized || position.normalized || index.itemSize !== 1 || position.itemSize !== 3
    || !originalReader(index, 'getX', attributeReaders[0]) || !originalReader(position, 'getX', attributeReaders[0])
    || !originalReader(position, 'getY', attributeReaders[1]) || !originalReader(position, 'getZ', attributeReaders[2])) return null;
  return (index.array instanceof Uint16Array || index.array instanceof Uint32Array) && position.array instanceof Float32Array
    ? { indices: index.array, positions: position.array } : null;
}

/** The tiles content of `mesh` (its geometry in `toCell` cell-local space), drawing nothing until a tile attaches. */
export function tiledMesh(id: string, mesh: Mesh, toCell: Matrix4, options: { readonly single?: boolean } = {}): TileContent | null {
  if (instanced(mesh)) return tiledInstances(id, mesh, toCell);
  const geometry = mesh.geometry, position = geometry.getAttribute('position');
  if (mesh instanceof SkinnedMesh || !mesh.frustumCulled || Array.isArray(mesh.material) || geometry.groups.length > 0
    || Object.keys(geometry.morphAttributes).length > 0 || !(position instanceof BufferAttribute) || position.count === 0) return null;
  const index = geometry.index ?? new BufferAttribute(position.count > 65535 ? Uint32Array.from({ length: position.count }, (_, k) => k) : Uint16Array.from({ length: position.count }, (_, k) => k), 1);
  const triangles = Math.floor(index.count / 3), keys = new Int32Array(triangles), e = toCell.elements;
  const count = new Int32Array(TILES_PER_SIDE * TILES_PER_SIDE), start = new Int32Array(count.length);
  const arrays = centroidArrays(index, position), centroids = arrays === null ? new Float32Array(triangles * 2) : undefined;
  for (let t = 0; t < triangles; t++) {
    let x = 0, y = 0, z = 0;
    if (arrays === null) {
      for (let c = 0; c < 3; c++) { const v = index.getX(t * 3 + c); x += position.getX(v); y += position.getY(v); z += position.getZ(v); }
    } else {
      const { indices, positions } = arrays, a = (indices[t * 3] ?? Number.NaN) * 3, b = (indices[t * 3 + 1] ?? Number.NaN) * 3, c = (indices[t * 3 + 2] ?? Number.NaN) * 3;
      // Keep the original zero-first accumulation, including signed zero.
      x = ((0 + (positions[a] ?? Number.NaN)) + (positions[b] ?? Number.NaN)) + (positions[c] ?? Number.NaN);
      y = ((0 + (positions[a + 1] ?? Number.NaN)) + (positions[b + 1] ?? Number.NaN)) + (positions[c + 1] ?? Number.NaN);
      z = ((0 + (positions[a + 2] ?? Number.NaN)) + (positions[b + 2] ?? Number.NaN)) + (positions[c + 2] ?? Number.NaN);
    }
    x /= 3; y /= 3; z /= 3;
    if (centroids !== undefined) {
      centroids[t * 2] = e[0] * x + e[4] * y + e[8] * z + e[12];
      centroids[t * 2 + 1] = e[2] * x + e[6] * y + e[10] * z + e[14];
      continue; // Custom readers keep their complete original scan before any tile classification/refusal.
    }
    // Match the former Float32 centroid storage before classifying, including edge rounding.
    const key = tileKey(tileOf(Math.fround(e[0] * x + e[4] * y + e[8] * z + e[12]),
      Math.fround(e[2] * x + e[6] * y + e[10] * z + e[14])));
    keys[t] = key; count[key] = (count[key] ?? 0) + 1;
  }
  // Stable counting partition: retain every triangle's original ordinal within its tile,
  // without a second centroid scan or a full intermediate coordinate buffer.
  for (let tile = 1; tile < count.length; tile++) start[tile] = (start[tile - 1] ?? 0) + (count[tile - 1] ?? 0);
  const order = new Uint32Array(triangles), next = Int32Array.from(start);
  for (let triangle = 0; triangle < triangles; triangle++) {
    const key = keys[triangle] ?? 0, at = next[key] ?? 0; order[at] = triangle; next[key] = at + 1;
  }
  const ranges = centroids === undefined ? { order, start, count } : tileRanges(centroids, 2, 0, 1), tiles = new Set<number>();
  ranges.count.forEach((n, key) => { if (n > 0) tiles.add(key); });
  if (tiles.size < (options.single === true ? 1 : 2)) return null;
  // the source order stays on the CPU (the index is small next to the vertices); the drawn index is rewritten in place
  const source = index.array.slice(), resident = new Set<number>();
  if (geometry.index === null) geometry.setIndex(index);
  // rewritten on every tile change: never a static buffer whose CPU copy a GPU-only release may drop (E264)
  index.setUsage(DynamicDrawUsage);
  const draw = (): void => {
    const drawnCount = compactResident(ranges, resident, source, index.array, 3);
    geometry.setDrawRange(0, drawnCount * 3); index.needsUpdate = true;
  };
  draw();
  return { id, tiles: () => tiles, attach: (tile, scope) => {
    if (!tiles.has(tile) || scope.disposed) return Promise.resolve();
    resident.add(tile); draw();
    scope.onDispose(() => { resident.delete(tile); draw(); });
    return Promise.resolve();
  } };
}

function instanced(mesh: Mesh): mesh is InstancedMesh { return mesh instanceof InstancedMesh; }
/** geometries whose per-instance channels a tiled part already compacts (a shared geometry is never compacted twice) */
const claimed = new WeakSet();

/** An instanced part by tile: each instance's position (cell-local, through `toCell`) picks its tile; the first `count`
 *  instances drawn are the resident tiles', every per-instance attribute rewritten from its CPU copy. */
function tiledInstances(id: string, mesh: InstancedMesh, toCell: Matrix4): TileContent | null {
  if (mesh.onBeforeRender !== Object3D.prototype.onBeforeRender || mesh.count < 2) return null;
  const matrices = mesh.instanceMatrix.array, e = toCell.elements, n = mesh.count, places = new Float32Array(n * 2);
  for (let k = 0; k < n; k++) {
    const x = matrices[k * 16 + 12] ?? 0, y = matrices[k * 16 + 13] ?? 0, z = matrices[k * 16 + 14] ?? 0;
    places[k * 2] = e[0] * x + e[4] * y + e[8] * z + e[12];
    places[k * 2 + 1] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  const ranges = tileRanges(places, 2, 0, 1), tiles = new Set<number>();
  ranges.count.forEach((count, key) => { if (count > 0) tiles.add(key); });
  if (tiles.size < 2) return null;
  // the instance matrices, colours and per-instance geometry channels (a seed, a sway phase) move together
  const channels = [mesh.instanceMatrix, ...(mesh.instanceColor === null ? [] : [mesh.instanceColor]),
    ...Object.values(mesh.geometry.attributes).filter((attribute): attribute is InstancedBufferAttribute => attribute instanceof InstancedBufferAttribute)];
  // every channel must hold the part's instances (a per-instance channel on a geometry shared with another part may hold
  // fewer: compacting it would overrun), and a geometry's own channels are compacted by one part only
  const shared = channels.length > 1 + (mesh.instanceColor === null ? 0 : 1);
  if (channels.some(channel => channel.array.length < n * channel.itemSize) || (shared && claimed.has(mesh.geometry))) return null;
  if (shared) claimed.add(mesh.geometry);
  // rewritten on every tile change: never static channels whose CPU copies a GPU-only release drops after upload (E264;
  // a released per-instance channel overran here entering Nine)
  for (const channel of channels) channel.setUsage(DynamicDrawUsage);
  const copies = channels.map(channel => ({ channel, source: channel.array.slice(0, n * channel.itemSize) })), resident = new Set<number>();
  const draw = (): void => {
    let count = 0;
    for (const { channel, source } of copies) { count = compactResident(ranges, resident, source, channel.array, channel.itemSize); channel.needsUpdate = true; }
    mesh.count = count;
  };
  draw();
  return { id, tiles: () => tiles, attach: (tile, scope) => {
    if (!tiles.has(tile) || scope.disposed) return Promise.resolve();
    resident.add(tile); draw();
    scope.onDispose(() => { resident.delete(tile); draw(); });
    return Promise.resolve();
  } };
}
