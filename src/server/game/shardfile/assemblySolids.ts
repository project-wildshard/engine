import type { SimHost } from '@wildshard/engine/sim';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { PropColliderState } from '@wildshard/engine/physics/declaredProps';
import { installShardfileColliders } from '../../../shared/game/shardfile/collisionBindings';
import { registerInstalled } from './installedSides';
import { installNativeCollision, type NativeCollisionBake } from '../population/nativeBake';

/** The hosts that stand a native plan's solids; with neither, the plan's ground and the shard's prop solids stand instead. */
const COLLISION_HOSTS: ReadonlySet<string> = new Set(['collision', 'collision.pieces']);

/** ONE-FORMAT OF22a3: true when a plan names no collision host, so its solids are the shard's own `props.colliders`. */
export function standsOwnSolids(hosts: readonly string[]): boolean { return !hosts.some(host => COLLISION_HOSTS.has(host)); }

/**
 * ONE-FORMAT OF22a3: a native plan with no `collision` host stands its bake's ground (the heightfield alone) and the shard's
 * declared prop solids, as an ordinary upload's simulation does (`bindShardfileSim`). A restore keeps the saved world's
 * ground, as the host's `skipOnRestore` does, and reconnects the prop solids' handles from their `props.declared` step.
 */
export function installAssemblySolids(host: SimHost, shard: Shardfile, assets: ReadonlyMap<string, Uint8Array>, ground: { readonly bake: NativeCollisionBake; readonly resolution: number } | null, restoring: boolean): void {
  if (shard.meshCollision !== null) throw new Error('A native plan with no collision host stands prop solids only');
  if (ground !== null && !restoring) installNativeCollision(host, { ground: ground.bake.ground, solids: [] }, { resolution: ground.resolution });
  const colliders = installShardfileColliders(shard, assets, () => host.physics, host.scope, restoring);
  if (ground !== null || colliders.size > 0) registerInstalled(host, 'collision');
  if (colliders.size === 0) return;
  host.onStep('props.declared', () => undefined, {
    snapshot: () => Object.fromEntries([...colliders].map(([id, port]) => [id, { handles: port.snapshot().handles }])),
    restore: value => {
      if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== colliders.size) throw new Error('Invalid declared collider continuation');
      for (const [id, port] of colliders) {
        const state = value[id];
        if (state === null || typeof state !== 'object' || Array.isArray(state) || !Array.isArray(state['handles']) || Object.keys(state).length !== 1) throw new Error('Invalid declared collider handles');
        const handles = state['handles'].map(handle => { if (typeof handle !== 'number' || !Number.isFinite(handle) || handle < 0) throw new Error('Invalid declared collider handle'); return handle; });
        port.restore({ handles } satisfies PropColliderState);
      }
    },
  });
}
