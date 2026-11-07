import type { Collider } from '@dimforge/rapier3d-simd';
import type { Scope } from '../app/scope';
import { withOwner } from '../app/ownership';
import { decodeMeshCollision, type MeshCollisionData } from '@wildshard/format/meshCollisionBytes';
import type { Physics } from './Physics';
import { groups } from './groups';
import { tagCollider, type Material } from './surface';
import type { PropColliderPort, PropColliderState } from './declaredProps';

function createMesh(physics: Physics, data: MeshCollisionData, owner: unknown, material: Material): Collider {
  const collider = physics.world.createCollider(physics.R.ColliderDesc.trimesh(data.vertices, data.indices, physics.R.TriMeshFlags.FIX_INTERNAL_EDGES)
    .setCollisionGroups(groups('WORLD')).setFriction(0.9));
  tagCollider(collider, material, owner); return collider;
}


/** One admitted chunk at its cell-local rest pose; scripts may activate a named panel, never rewrite its geometry. */
export interface BakedMeshColliderRow { id: string; bytes: Uint8Array; initialActive: boolean }

/** Install exact static chunks with the existing target/snapshot ports. All bytes and restored handles are
 * preflighted before native allocation; a lazy physics getter follows world replacement. Restoring allocates
 * nothing and preserves native activation. Empty initial handles are allowed only as pending restore adapters.
 */
export function installBakedMeshColliders(rows: readonly BakedMeshColliderRow[], physics: Physics | (() => Physics), scope: Scope,
  restoring?: ReadonlyMap<string, PropColliderState>): ReadonlyMap<string, PropColliderPort> {
  if (scope.disposed) throw new Error('Mesh collision requires a live scope');
  if (rows.length > 128 || new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Mesh collision row identities or capacity');
  const current = typeof physics === 'function' ? physics : () => physics;
  const prepared = rows.map(row => ({ row, data: decodeMeshCollision(row.bytes) }));
  const read = (id: string, data: MeshCollisionData, value: PropColliderState): Collider => {
    const handle = value.handles[0], world = current().world;
    if (value.handles.length !== 1 || handle === undefined || !Number.isFinite(handle) || handle < 0 || !world.colliders.contains(handle)) throw new Error(`Missing mesh collision handle ${id}`);
    const collider = world.getCollider(handle), indices = collider.indices();
    if (collider.parent() !== null || collider.shapeType() !== current().R.ShapeType.TriMesh || indices === undefined
      || indices.length !== data.indices.length) throw new Error(`Mesh collision restored geometry mismatch ${id}`);
    const vertices = collider.vertices();
    // FIX_INTERNAL_EDGES merges/reorders vertices; compare the actual ordered triangle coordinates and winding.
    for (let i = 0; i < indices.length; i++) {
      const actual = indices[i], expected = data.indices[i];
      if (actual === undefined || expected === undefined) throw new Error(`Mesh collision restored geometry mismatch ${id}`);
      for (let axis = 0; axis < 3; axis++) if (vertices[actual * 3 + axis] !== data.vertices[expected * 3 + axis]) throw new Error(`Mesh collision restored geometry mismatch ${id}`);
    }
    const at = collider.translation(), rotation = collider.rotation();
    if (at.x !== 0 || at.y !== 0 || at.z !== 0 || rotation.x !== 0 || rotation.y !== 0 || rotation.z !== 0 || rotation.w !== 1) throw new Error(`Mesh collision restored pose mismatch ${id}`);
    return collider;
  };
  if (restoring !== undefined) {
    if (restoring.size !== rows.length || rows.some(row => !restoring.has(row.id))) throw new Error('Mesh collision restore identities');
    const used = new Set<number>();
    for (const { row, data } of prepared) {
      const value = restoring.get(row.id); if (value === undefined) throw new Error('Mesh collision restore identities');
      if (value.handles.length === 0) continue;
      const collider = read(row.id, data, value);
      if (used.has(collider.handle)) throw new Error('Duplicate mesh collision restored handle'); used.add(collider.handle);
    }
  }
  const owned = scope.child('baked-mesh-colliders'), ports = new Map<string, PropColliderPort>();
  try {
    for (const { row, data } of prepared) {
      const saved = restoring?.get(row.id);
      let handles = saved === undefined ? [] : [...saved.handles];
      if (restoring === undefined) {
        // Native ownership follows handles through replacement, rather than retaining the old world wrapper.
        const collider = withOwner(null, () => createMesh(current(), data, row.id, 'ground'));
        handles = [collider.handle]; collider.setEnabled(row.initialActive);
      }
      const collider = () => {
        const handle = handles[0], world = current().world;
        if (handles.length !== 1 || handle === undefined || !world.colliders.contains(handle)) throw new Error(`Missing mesh collision handle ${row.id}`);
        return world.getCollider(handle);
      };
      if (handles.length > 0) tagCollider(collider(), 'ground', row.id);
      ports.set(row.id, { active: () => collider().isEnabled(), setActive: value => collider().setEnabled(value),
        snapshot: () => ({ handles: [...handles] }), restore: value => {
          const restored = read(row.id, data, value); tagCollider(restored, 'ground', row.id); handles = [...value.handles];
        } });
      owned.capture('colliders', () => {
        const world = current().world;
        for (const handle of handles) if (world.colliders.contains(handle)) world.removeCollider(world.getCollider(handle), false);
      });
    }
    return ports;
  } catch (error) { owned.dispose(); throw error; }
}
