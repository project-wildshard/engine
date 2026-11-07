/** S3's owned road-tile producer. Compact the fine and every LOD run together:
 * a later publication may change distance without borrowing a whole-road buffer.
 * No material, GPU allocation or residency lease is created here. The caller
 * admits the returned byte plan before publication and owns geometry.dispose(). */
import { BufferAttribute, BufferGeometry } from 'three';
import type { CullPlan, RenderBytes } from './roadCull';

/** One independent tile, with rebased indices and no references to the source geometry's arrays. */
export interface RoadTileGeometry {
  /** Coarse tile identity; its bins keep their individual fine-quadrant identities. */
  readonly identity?: { readonly x: number; readonly z: number };
  readonly geometry: BufferGeometry;
  readonly plan: CullPlan;
  readonly bytes: RenderBytes;
}

/** Source geometry must still have its CPU attributes (before gpuOnlyRoad upload).
 * Copy in bounded batches; cancelling the generator never publishes partial data.
 * All runs share one local vertex table, preserving original attribute storage,
 * normalization and the exact fine/LOD triangle order. */
export function* compactRoadTileSteps(source: BufferGeometry, plan: CullPlan, x: number, z: number): Generator<void, RoadTileGeometry> {
  const bin = plan.bins.find(row => row.tile?.x === x && row.tile.z === z);
  if (bin === undefined) throw new Error('Missing road tile geometry');
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
