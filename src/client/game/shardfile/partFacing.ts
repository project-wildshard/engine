/**
 * NINE-DRAGON-BENCHMAX NB8 (mini-nb8j): a scene step's big front-sided plain mesh draws, on the phone, only the leaves of
 * its triangles the camera can see, as the slab chunks do (`slabRanges.ts`): out of the frustum, facing away, or specks.
 * Nine's banyan crown core is one 45 k-triangle mesh drawn whole wherever the street sees the tree, two thirds of it
 * facing away from the camera, which the GPU culls only after shading every vertex. The tree reorders the mesh's index,
 * so it is built only for a mesh inside one tile: the tile driver (`tiledMesh`) leaves such a mesh whole and in its order,
 * where a mesh across tiles has its index sorted by tile. A multi-material, morphing or never-culled mesh stays as it was,
 * as does a geometry two parts of a step share (the caller's check: Nine's crown cards draw twice, blended, in their own
 * order); a geometry reached again later keeps its one tree.
 */
import { Box3, type BufferGeometry, FrontSide, type Matrix4, type Mesh } from 'three';
import { workSlice } from '@wildshard/engine/core/workSlice';
import { TIER_CONFIG } from '@wildshard/engine/core/tier';
import type { Scope } from '@wildshard/engine/app/scope';
import { tileOf } from '../../../shared/game/shardfile/tileOrder';
import { tileKey } from './tileContent';
import { cullSlabRanges, slabRangesJob, SLAB_LEAF_TRIANGLES, type SlabRanges } from './slabRanges';

/** the fewest triangles a part needs for its own tree: below it the object's own frustum test is the cull */
export const FACED_PART_LEAST = 8192;

/** Whether `mesh` (placed by `toCell`, cell-local) gets a faced tree on this tier: plain, one front-sided material,
 *  frustum culled, indexed, big enough, and inside one tile. */
export function facedPart(mesh: Mesh, toCell: Matrix4): boolean {
  if (!TIER_CONFIG.slabFacing || (mesh as Mesh & { isInstancedMesh?: boolean }).isInstancedMesh === true) return false;
  const geometry = mesh.geometry, material = mesh.material, index = geometry.index;
  if (Array.isArray(material) || material.side !== FrontSide || !mesh.frustumCulled || geometry.groups.length > 0
    || Object.keys(geometry.morphAttributes).length > 0 || index === null || index.count / 3 < FACED_PART_LEAST) return false;
  if (geometry.boundingBox === null) geometry.computeBoundingBox();
  const box = new Box3().copy(geometry.boundingBox ?? new Box3()).applyMatrix4(toCell);
  if (box.isEmpty() || ![box.min.x, box.min.z, box.max.x, box.max.z].every(Number.isFinite)) return false;
  return tileKey(tileOf(box.min.x, box.min.z)) === tileKey(tileOf(box.max.x, box.max.z));
}

/** each cube face of normals in 5 × 5 cells (151 cells, the slab chunks' 3 × 3 is 55): narrower leaf cones */
export const PART_FACING_GRID = 5;

const TREES = new WeakMap<BufferGeometry, SlabRanges | null>();

/** Build each part's faced tree in work slices (before its tiles are read) and draw the part by it. */
export async function faceParts(meshes: readonly Mesh[], owner: Scope): Promise<void> {
  if (meshes.length === 0) return;
  const slice = workSlice(undefined, owner);
  for (const mesh of meshes) {
    const geometry = mesh.geometry;
    if (!TREES.has(geometry)) {
      // by facing first (`facingNode` Infinity), in finer cells: a crown's lumps face every way within any leaf's few metres
      const job = slabRangesJob(geometry, SLAB_LEAF_TRIANGLES, true, Infinity, PART_FACING_GRID);
      for (let step = job.next(); ; step = job.next()) {
        if (step.done === true) { TREES.set(geometry, step.value); break; }
        if (slice.due()) await slice.yield();
        // the index is only rewritten in the job's last step: a retired owner leaves the mesh as it was
        if (owner.disposed || owner.disposing) return;
      }
    }
    const ranges = TREES.get(geometry);
    if (ranges !== undefined && ranges !== null) cullSlabRanges(mesh, ranges, TIER_CONFIG.slabLodAngle, { single: true, liveRange: true });
  }
}
