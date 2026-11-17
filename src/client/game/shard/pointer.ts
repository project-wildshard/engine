import type { ShardManifest } from './manifest';

/**
 * ONE-FORMAT OF8: the one descriptor pointer of a hybrid (a shard whose built-in client-plan page owns its runtime).
 * The pointer is `shardfile`, as for every other shard; `gridShardfile` is still read until ONE-FORMAT M9 retires it.
 * A shard with no client-plan runtime has no hybrid pointer: its `shardfile` is plain data admission.
 */
export function hybridPointer(manifest: Pick<ShardManifest, 'shardfile' | 'gridShardfile' | 'clientPlanRuntime'>): string | undefined {
  // the grid's readers take `shardfile` first and the page this; one pointer keeps them on one descriptor
  if (manifest.shardfile !== undefined && manifest.gridShardfile !== undefined) throw new Error('A manifest names its shardfile once (shardfile or gridShardfile)');
  return manifest.gridShardfile ?? (manifest.clientPlanRuntime === true ? manifest.shardfile : undefined);
}

/** OF8: the pointer of a plain data shard, admitted as data; undefined for a hybrid (`hybridPointer`) or a shard with none. */
export function dataPointer(manifest: Pick<ShardManifest, 'shardfile' | 'gridShardfile' | 'clientPlanRuntime'>): string | undefined {
  return hybridPointer(manifest) === undefined ? manifest.shardfile : undefined;
}
