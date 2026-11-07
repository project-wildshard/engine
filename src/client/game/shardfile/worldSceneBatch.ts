import { BatchedMesh, Matrix4, type BufferGeometry, type Camera, type Material } from 'three';
import { ChangedBatchedMesh } from '@wildshard/engine/render/changedTextureUploads';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BatchedCull } from '@wildshard/engine/models/cull';
import { InstancedBatch } from '@wildshard/engine/models/instancedBatch';
import type { Scope } from '@wildshard/engine/app/scope';
import type { WorldRegistry } from '@wildshard/engine/world/registry';
import { withOwner } from '@wildshard/engine/app/ownership';
import { ownSceneResource } from '@wildshard/engine/app/sceneOwnership';
import type { WorldSceneBatchRow } from '@wildshard/format/worldSceneBatch';

/**
 * Client-only fixed LOD instances of one material, each copy choosing its authored near / far geometry by distance. PF2
 * (G936): one BatchedMesh where the renderer multi-draws (a graph look too: the grid's cell clip keeps its #extension
 * first), as legacy drew Pine's crags. No multi-draw support or slots whose layouts differ
 * draw an InstancedBatch (one InstancedMesh per geometry slot, E271 / E272's path). Named placements that name the
 * batch draw on their own. Finishing registers it (the registry draws it).
 * Copies marked `merge` become one static geometry at their near level, drawn as one copy (G639: Pine's 18 crag skin
 * tiles were 18 draws in each of the main and shadow passes).
 */
const IDENTITY = new Matrix4();
/** a BatchedMesh holds geometries of one attribute set and one index presence */
const oneLayout = (geometries: readonly BufferGeometry[]): boolean =>
  new Set(geometries.map(g => `${String(g.index !== null)}:${Object.keys(g.attributes).sort().join(',')}`)).size <= 1;

export class WorldSceneBatch {
  private value: InstancedBatch | BatchedMesh | undefined;
  private fixed: BatchedCull[] | undefined;
  constructor(private readonly row: WorldSceneBatchRow, private readonly material: Material,
    private readonly geometry: readonly BufferGeometry[], private readonly owner: Scope, private readonly registry: Pick<WorldRegistry, 'add'>,
    private readonly multiDraw = false) {}

  /** The batch object (built with its fixed copies on first use; refused once its owner is gone). */
  object(): InstancedBatch | BatchedMesh { return this.finish(); }

  /** Idempotent: its fixed copies, hidden until the first view chooses each one's level. */
  finish(): InstancedBatch | BatchedMesh {
    if (this.owner.disposed) throw new Error('World scene batch owner is disposed');
    if (this.value !== undefined) return this.value;
    const merged = this.row.fixed.filter(row => row.merge === true), culled = this.row.fixed.filter(row => row.merge !== true);
    const skin = merged.length > 0 ? this.merged(merged) : null, all = skin === null ? [...this.geometry] : [...this.geometry, skin];
    const batch = this.multiDraw && oneLayout(all) ? this.batchedMesh(all, culled.length + (skin === null ? 0 : 1)) : this.instancedBatch();
    this.value = batch;
    this.owner.onDispose(() => { batch.removeFromParent(); });
    const ids = this.geometry.map(geometry => batch.addGeometry(geometry));
    if (batch instanceof InstancedBatch) {
      const uses = new Map<number, number>();
      for (const row of culled) for (const slot of new Set([row.lod0, row.lod1])) uses.set(slot, (uses.get(slot) ?? 0) + 1);
      for (const [slot, count] of uses) { const id = ids[slot]; if (id !== undefined) batch.reserve(id, count); }
    }
    if (skin !== null) batch.addInstance(batch.addGeometry(skin));
    this.fixed = culled.map(row => {
      const near = ids[row.lod0], far = ids[row.lod1];
      if (near === undefined || far === undefined) throw new Error('Missing fixed scene batch geometry');
      const instance = batch.addInstance(near);
      batch.setMatrixAt(instance, new Matrix4().fromArray(row.matrix)); batch.setVisibleAt(instance, false);
      return new BatchedCull([{ mesh: batch, instance, geometry: Int32Array.of(near, far), until2: null }],
        Uint32Array.of(0, 1), Float64Array.from(row.sphere), [0, row.near], { ...this.row.cull, far: row.far });
    });
    if (batch instanceof BatchedMesh) ownSceneResource(batch, this.owner);
    else for (const mesh of batch.children) ownSceneResource(mesh, this.owner);
    withOwner(this.owner, () => { this.registry.add({ id: this.row.id, name: this.row.name, category: 'nature', file: 'src/client/game/shardfile/worldSceneBatch.ts', object: batch }); });
    return batch;
  }

  private instancedBatch(): InstancedBatch {
    const row = this.row;
    return withOwner(this.owner, () => new InstancedBatch(this.material, { name: row.name, castShadow: row.castShadow, receiveShadow: row.receiveShadow }));
  }

  /** One multi-draw batch sized to what it holds (the merged skin came after the rows' declared capacity) */
  private batchedMesh(all: readonly BufferGeometry[], instances: number): BatchedMesh {
    const row = this.row;
    const vertices = all.reduce((n, g) => n + g.getAttribute('position').count, 0), indices = all.reduce((n, g) => n + (g.index?.count ?? 0), 0);
    const mesh = withOwner(this.owner, () => new ChangedBatchedMesh(Math.max(1, instances), vertices, indices, this.material));
    mesh.name = row.name; mesh.sortObjects = row.sortObjects; mesh.perObjectFrustumCulled = row.perObjectFrustumCulled;
    mesh.castShadow = row.castShadow; mesh.receiveShadow = row.receiveShadow;
    return mesh;
  }

  /** The merge copies' near geometries in the batch's frame, one geometry the batch's owner frees. */
  private merged(rows: WorldSceneBatchRow['fixed']): BufferGeometry {
    const moved = new Set<BufferGeometry>();
    const parts = rows.map(row => {
      const geometry = this.geometry[row.lod0];
      if (geometry === undefined) throw new Error('Missing merged scene batch geometry');
      const matrix = new Matrix4().fromArray(row.matrix);
      if (matrix.equals(IDENTITY)) return geometry;
      const copy = geometry.clone().applyMatrix4(matrix); moved.add(copy); return copy;
    });
    const layout = (part: BufferGeometry): string => `${String(part.index !== null)}:${Object.keys(part.attributes).sort().join(',')}`;
    if (new Set(parts.map(layout)).size > 1) throw new Error('Merged scene batch copies need one attribute layout');
    const geometry = mergeGeometries(parts, false);
    for (const copy of moved) copy.dispose();
    geometry.computeBoundingSphere();
    ownSceneResource(geometry, this.owner);
    return geometry;
  }

  /** The resident's existing view camera drives fixed instances alongside ordinary placed-model culling. */
  update(camera: Camera): void {
    if (this.fixed === undefined) return;
    for (const part of this.fixed) part.update(camera);
  }
}
