import { installBakedMeshColliders, type BakedMeshColliderRow } from '@wildshard/engine/physics/meshCollision';
import { installDeclaredPropColliders, type PropColliderPort } from '@wildshard/engine/physics/declaredProps';
import type { Physics } from '@wildshard/engine/physics/Physics';
import type { Scope } from '@wildshard/engine/app/scope';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { propColliderDescriptors } from './props';
import { validateMeshCollisionAssets } from '@wildshard/format/meshCollisionAssets';

/** Stable namespace shared by published targets and the existing whole-world continuation adapter. */
export function shardfileColliderIds(source: Pick<Shardfile, 'props' | 'meshCollision'>): string[] {
  return [...source.props?.colliders.map(row => row.id) ?? [], ...source.meshCollision?.tiles.map(row => `mesh.tile.${row.x}.${row.z}`) ?? [],
    ...source.meshCollision?.panels.map(row => row.id) ?? []];
}

/** Install one combined collider map, or pending handle-only adapters during native world replacement. */
export function installShardfileColliders(source: Shardfile, assets: ReadonlyMap<string, Uint8Array>, physics: () => Physics, scope: Scope, restoring = false): ReadonlyMap<string, PropColliderPort> {
  // Every mesh chunk admits before either collider installer allocates; a malformed late panel leaves no partial world.
  validateMeshCollisionAssets(source, assets);
  const rows = source.props === null ? [] : propColliderDescriptors(source.props);
  const mesh: BakedMeshColliderRow[] = [...source.meshCollision?.tiles.map(row => ({ ...row, id: `mesh.tile.${row.x}.${row.z}`, initialActive: true })) ?? [],
    ...source.meshCollision?.panels ?? []].map(row => {
    const bytes = assets.get(row.file); if (bytes === undefined) throw new Error('Missing admitted mesh collider');
    return { id: row.id, bytes, initialActive: row.initialActive };
  });
  const owned = scope.child('shardfile-colliders');
  try {
    const props = installDeclaredPropColliders(rows, physics, owned, restoring ? new Map(rows.map(row => [row.id, { handles: [] }])) : undefined);
    const baked = installBakedMeshColliders(mesh, physics, owned, restoring ? new Map(mesh.map(row => [row.id, { handles: [] }])) : undefined);
    return new Map([...props, ...baked]);
  } catch (error) { owned.dispose(); throw error; }
}
