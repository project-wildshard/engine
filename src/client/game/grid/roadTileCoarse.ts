import type { BufferGeometry } from 'three';
import type { CullPlan } from './roadCull';
import { compactRoadTileSteps, type RoadTileGeometry } from './roadTileGeometry';
import { mergeRoadTileSteps } from './roadTilePool';

/** One125m parent from up to four62.5m patches, using the road's existing first
 * distance LOD (or its original triangles for already-simple textured pieces).
 * Keep separate patch bins so a published fine child masks just its quadrant. */
export function* coarseRoadTileSteps(source: BufferGeometry, plan: CullPlan, x: number, z: number): Generator<void, RoadTileGeometry> {
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(z)) throw new Error('Invalid coarse road coordinate');
  const children: RoadTileGeometry[] = [];
  try {
    for (const bin of plan.bins) {
      const tile = bin.tile;
      if (tile === undefined || Math.floor(tile.x / 2) !== x || Math.floor(tile.z / 2) !== z) continue;
      const run = bin.levels[0] ?? bin;
      const reduced: CullPlan = { source: plan.source, lod: [], bins: [{ ...bin, start: run.start, count: run.count, levels: [], lod: [] }] };
      children.push(yield* compactRoadTileSteps(source, reduced, tile.x, tile.z));
    }
    if (children.length === 0 || children.length > 4) throw new Error('Missing coarse road patches');
    const merged = yield* mergeRoadTileSteps(children);
    try {
      const vertexBytes = Object.values(merged.geometry.attributes).reduce((sum, attribute) => sum + attribute.array.byteLength, 0);
      const indices = merged.plan.source.byteLength;
      return { identity: { x, z }, ...merged, bytes: { jsBytes: vertexBytes + 2 * indices, gpuBytes: vertexBytes + indices } };
    } catch (error) { merged.geometry.dispose(); throw error; }
  } finally { for (const child of children) child.geometry.dispose(); }
}
