/** S3's owned road-tile producer. Compact the fine and every LOD run together:
 * a later publication may change distance without borrowing a whole-road buffer.
 * No material, GPU allocation or residency lease is created here. The caller
 * admits the returned byte plan before publication and owns geometry.dispose(). */
import { BufferAttribute, BufferGeometry, type TypedArray } from 'three';
import { ownedArray } from '@wildshard/engine/core/ownedBuffer';
import type { CullPlan, RenderBytes } from './roadCull';

/** One independent tile, with rebased indices and no references to the source geometry's arrays. */
export interface RoadTileGeometry {
  /** Coarse tile identity; its bins keep their individual fine-quadrant identities. */
  readonly identity?: { readonly x: number; readonly z: number };
  readonly geometry: BufferGeometry;
  readonly plan: CullPlan;
  readonly bytes: RenderBytes;
}

/**
 * meta IPHONE13-DRIFTWOOD DW12 (mini-dw12c, 2026-11-21): the capture job's lean storage. In headless WebKit a ~35 MB
 * road source's worker capture (~500 tiles) put WebContent up 157 to 173 MB: every tile built a `Map` of source to local
 * vertex, two growing number arrays and its own output arrays, then an encoded copy and the cache put's copy, and the
 * worker's collector let all of it stand until the job ended. With an arena (`captureJobTiles` when `lean`), a tile
 * compacts through one vertex table kept per source geometry and writes into arrays the arena reuses for every tile, so a
 * job allocates a fixed handful of arrays however many tiles it writes (+25 to 38 MB on the same job).
 */
const ARENA = { owner: 'grid/road-tile-capture', asset: 'arena' } as const, TABLE = { owner: 'grid/road-tile-capture', asset: 'vertex-table' } as const;
export class RoadTileArena {
  private readonly arrays = new Map<string, TypedArray>();
  /** How many arrays this arena has allocated (tests: a fixed number per job, not per tile). */
  allocations = 0;
  /** A view of `length` elements of `template`'s type under `key`, valid until the next `take` of that key; its contents
   *  are unspecified (the caller writes all of it). A buffer a store took (transferred, so detached) is replaced. */
  take<T extends TypedArray>(key: string, template: T, length: number): T {
    let array = this.arrays.get(key);
    if (array === undefined || array.constructor !== template.constructor || array.length < length || array.buffer.byteLength === 0) {
      const Type = template.constructor as { new (size: number): T; readonly BYTES_PER_ELEMENT: number };
      const grown = array?.constructor === template.constructor && array.buffer.byteLength > 0 ? array.length * 2 : 0;
      array = ownedArray(Type, Math.max(length, grown), ARENA); this.arrays.set(key, array); this.allocations++;
    }
    return array.subarray(0, length) as T;
  }
}
/** The vertex table a source's tiles compact through: `stamp` marks the vertices the current tile has seen (a new stamp a
 *  tile, so nothing is cleared), `local` holds their tile index, `order` the first-seen order. */
interface VertexTable { stamp: Uint32Array; local: Uint32Array; order: Uint32Array; generation: number; busy: boolean }
const vertexTables = new WeakMap<BufferGeometry, VertexTable>();
let vertexTablesMade = 0;
/** How many vertex tables lean compaction has allocated (tests: one per source, not one per tile). */
export function roadVertexTablesMade(): number { return vertexTablesMade; }
function newVertexTable(source: BufferGeometry, indices: number): VertexTable {
  let vertices = 0;
  for (const name of Object.keys(source.attributes)) vertices = Math.max(vertices, source.getAttribute(name).count);
  vertexTablesMade++;
  return { stamp: ownedArray(Uint32Array, vertices, TABLE), local: ownedArray(Uint32Array, vertices, TABLE), order: ownedArray(Uint32Array, indices, TABLE), generation: 0, busy: false };
}
/** The source's table, or a private one while another compaction of the same source holds it. */
function borrowVertexTable(source: BufferGeometry, indices: number): VertexTable {
  let table = vertexTables.get(source);
  if (table?.busy === true) table = newVertexTable(source, indices);
  else if (table === undefined) { table = newVertexTable(source, indices); vertexTables.set(source, table); }
  if (table.order.length < indices) table.order = ownedArray(Uint32Array, Math.max(indices, table.order.length * 2), TABLE);
  if (table.generation >= 0xffff_fffe) { table.stamp.fill(0); table.generation = 0; }
  table.generation++; table.busy = true;
  return table;
}
function growVertexTable(table: VertexTable, vertex: number): void {
  const size = Math.max(vertex + 1, table.stamp.length * 2), stamp = ownedArray(Uint32Array, size, TABLE), local = ownedArray(Uint32Array, size, TABLE);
  stamp.set(table.stamp); local.set(table.local); table.stamp = stamp; table.local = local;
}

/** Source geometry must still have its CPU attributes (before gpuOnlyRoad upload).
 * Copy in bounded batches; cancelling the generator never publishes partial data.
 * All runs share one local vertex table, preserving original attribute storage,
 * normalization and the exact fine/LOD triangle order. With an `arena` (DW12) the tile is views over the arena's arrays,
 * the same bytes, valid until the arena's next use. */
export function* compactRoadTileSteps(source: BufferGeometry, plan: CullPlan, x: number, z: number, arena?: RoadTileArena): Generator<void, RoadTileGeometry> {
  const bin = plan.bins.find(row => row.tile?.x === x && row.tile.z === z);
  if (bin === undefined) throw new Error('Missing road tile geometry');
  if (arena !== undefined) return yield* compactLeanSteps(source, plan, bin, x, z, arena);
  const runs = [bin, ...bin.levels], vertices: number[] = [], local = new Map<number, number>();
  const indices: number[] = [], mapped: { start: number; count: number }[] = [];
  for (const run of runs) {
    const start = indices.length;
    if (!Number.isSafeInteger(run.start) || !Number.isSafeInteger(run.count) || run.start < 0 || run.count < 0
      || run.count % 3 !== 0 || run.start + run.count > plan.source.length) throw new Error('Invalid road tile index range');
    for (let i = run.start; i < run.start + run.count; i++) {
      if ((i - run.start) % 768 === 0) yield;
      const vertex = plan.source[i];
      if (vertex === undefined) throw new Error('Missing road tile vertex');
      let index = local.get(vertex);
      if (index === undefined) { index = vertices.length; local.set(vertex, index); vertices.push(vertex); }
      indices.push(index);
    }
    mapped.push({ start, count: indices.length - start });
  }
  const geometry = new BufferGeometry();
  let completed = false;
  try {
    let vertexBytes = 0;
    for (const name of Object.keys(source.attributes)) {
      const attribute = source.getAttribute(name);
      if (!(attribute instanceof BufferAttribute)) throw new Error('Road tile attributes must be unpacked');
      const size = attribute.itemSize;
      // Slice preserves the source scalar type with an independently owned buffer.
      const values = attribute.array.slice(0, vertices.length * size);
      if (values.length !== vertices.length * size) throw new Error('Road tile attribute is too short');
      for (const [index, vertex] of vertices.entries()) {
        if (index % 256 === 0) yield;
        if (vertex >= attribute.count) throw new Error('Road tile attribute misses a vertex');
        for (let component = 0; component < size; component++) {
          const value = attribute.array[vertex * size + component];
          if (value === undefined) throw new Error('Missing road tile attribute component');
          values[index * size + component] = value;
        }
      }
      geometry.setAttribute(name, new BufferAttribute(values, size, attribute.normalized));
      vertexBytes += values.byteLength;
    }
    const fine = mapped[0];
    if (fine === undefined) throw new Error('Missing road tile fine run');
    const index = Uint32Array.from(indices);
    geometry.setIndex(new BufferAttribute(index, 1));
    geometry.setDrawRange(fine.start, fine.count);
    geometry.boundingSphere = bin.sphere.clone();
    const tilePlan: CullPlan = { source: index, lod: [...plan.lod], bins: [{ sphere: bin.sphere.clone(),
      start: fine.start, count: fine.count, levels: mapped.slice(1), tile: { x, z } }] };
    completed = true;
    // Publication creates one separate dynamic index. Attributes and immutable
    // runs remain CPU-owned until upload; both index buffers are included.
    return { geometry, plan: tilePlan, bytes: { jsBytes: vertexBytes + index.byteLength * 2,
      gpuBytes: vertexBytes + index.byteLength } };
  } finally { if (!completed) geometry.dispose(); }
}

/** DW12: `compactRoadTileSteps` through the source's vertex table into `arena`; the same bytes, runs and yields. */
function* compactLeanSteps(source: BufferGeometry, plan: CullPlan, bin: CullPlan['bins'][number], x: number, z: number, arena: RoadTileArena): Generator<void, RoadTileGeometry> {
  const runs = [bin, ...bin.levels];
  let total = 0;
  for (const run of runs) {
    if (!Number.isSafeInteger(run.start) || !Number.isSafeInteger(run.count) || run.start < 0 || run.count < 0
      || run.count % 3 !== 0 || run.start + run.count > plan.source.length) throw new Error('Invalid road tile index range');
    total += run.count;
  }
  const index = arena.take('index', new Uint32Array(0), total), mapped: { start: number; count: number }[] = [];
  const table = borrowVertexTable(source, total), generation = table.generation;
  const geometry = new BufferGeometry();
  let completed = false, vertices = 0, at = 0;
  try {
    for (const run of runs) {
      const start = at;
      for (let i = run.start; i < run.start + run.count; i++) {
        if ((i - run.start) % 768 === 0) yield;
        const vertex = plan.source[i];
        if (vertex === undefined) throw new Error('Missing road tile vertex');
        if (vertex >= table.stamp.length) growVertexTable(table, vertex);
        if (table.stamp[vertex] !== generation) { table.stamp[vertex] = generation; table.local[vertex] = vertices; table.order[vertices++] = vertex; }
        index[at++] = table.local[vertex] ?? 0;
      }
      mapped.push({ start, count: at - start });
    }
    let vertexBytes = 0;
    const order = table.order;
    for (const name of Object.keys(source.attributes)) {
      const attribute = source.getAttribute(name);
      if (!(attribute instanceof BufferAttribute)) throw new Error('Road tile attributes must be unpacked');
      const size = attribute.itemSize, array = attribute.array;
      if (array.length < vertices * size) throw new Error('Road tile attribute is too short');
      const values = arena.take(name, array, vertices * size);
      for (let local = 0; local < vertices; local++) {
        if (local % 256 === 0) yield;
        const vertex = order[local] ?? 0;
        if (vertex >= attribute.count) throw new Error('Road tile attribute misses a vertex');
        for (let component = 0; component < size; component++) {
          const value = array[vertex * size + component];
          if (value === undefined) throw new Error('Missing road tile attribute component');
          values[local * size + component] = value;
        }
      }
      geometry.setAttribute(name, new BufferAttribute(values, size, attribute.normalized));
      vertexBytes += values.byteLength;
    }
    const fine = mapped[0];
    if (fine === undefined) throw new Error('Missing road tile fine run');
    geometry.setIndex(new BufferAttribute(index, 1));
    geometry.setDrawRange(fine.start, fine.count);
    geometry.boundingSphere = bin.sphere.clone();
    const tilePlan: CullPlan = { source: index, lod: [...plan.lod], bins: [{ sphere: bin.sphere.clone(),
      start: fine.start, count: fine.count, levels: mapped.slice(1), tile: { x, z } }] };
    completed = true;
    return { geometry, plan: tilePlan, bytes: { jsBytes: vertexBytes + index.byteLength * 2, gpuBytes: vertexBytes + index.byteLength } };
  } finally { table.busy = false; if (!completed) geometry.dispose(); }
}
