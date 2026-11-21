import { BufferAttribute, BufferGeometry, Sphere, Vector3 } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import type { CullPlan } from './roadCull';
import { compactRoadTileSteps, RoadTileArena, type RoadTileGeometry } from './roadTileGeometry';
import { coarseRoadTileSteps } from './roadTileCoarse';
import { persistRoadTile, type RoadTileReference, type RoadTileStore } from './roadTileArchive';
import type { CaptureJob } from './roadTileCaptureWorker';

/** DL11: one road source's tile capture as the capture worker runs it: the page path's compaction, coarse merge and
 * archive writes (`persistRoadTile`: its stored-body check and put) in its order, on a copy of the source arrays.
 * Answers the source's fine and coarse references in authored order. DW12 (mini-dw12c): a `lean` job compacts, merges and
 * encodes every tile into six reused arenas (fine and merge, four coarse children, the body), one tile at a time, so it
 * allocates a fixed handful of arrays however many tiles it writes; the bodies are the same bytes. */
function drain<T>(steps: Generator<void, T>): T {
  for (;;) { const next = steps.next(); if (next.done === true) return next.value; }
}
export async function captureJobTiles(job: CaptureJob, store: RoadTileStore): Promise<{ fine: RoadTileReference[]; coarse: RoadTileReference[] }> {
  const source = new BufferGeometry();
  for (const row of job.attributes) source.setAttribute(row.name, new BufferAttribute(row.array, row.itemSize, row.normalized));
  const plan: CullPlan = { source: job.source, lod: job.lod, bins: job.bins.map(bin => ({ ...bin,
    sphere: new Sphere(new Vector3(bin.sphere[0], bin.sphere[1], bin.sphere[2]), bin.sphere[3]) })) };
  const scope = new Scope('road-tile-capture');
  const arenas = job.lean === true ? [0, 1, 2, 3, 4, 5].map(() => new RoadTileArena()) : undefined;
  const persist = async (data: RoadTileGeometry): Promise<RoadTileReference> => {
    try { return await persistRoadTile(scope, store, data, arenas?.[5]); } finally { data.geometry.dispose(); }
  };
  try {
    const fine: RoadTileReference[] = [], coarse: RoadTileReference[] = [];
    for (const bin of plan.bins) {
      if (bin.tile === undefined) throw new Error('Road backing requires the tile lattice');
      fine.push(await persist(drain(compactRoadTileSteps(source, plan, bin.tile.x, bin.tile.z, arenas?.[0]))));
    }
    for (const { x, z } of job.parents) {
      const data = drain(coarseRoadTileSteps(source, plan, x, z, arenas?.slice(0, 5)));
      if (data.plan.source.length === 0) { data.geometry.dispose(); continue; }
      coarse.push(await persist(data));
    }
    return { fine, coarse };
  } finally { scope.dispose(); source.dispose(); }
}
