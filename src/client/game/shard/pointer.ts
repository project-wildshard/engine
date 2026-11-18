import type { ShardManifest } from './manifest';

/**
 * ONE-FORMAT OF8: the one descriptor pointer of a runtime shard (a shard whose built-in client-plan page owns its runtime).
 * The pointer is `shardfile`, as for every other shard; `gridShardfile` is still read until ONE-FORMAT M9 retires it.
 * A shard with no client-plan runtime has no runtime pointer: its `shardfile` is plain data admission.
 */
export function runtimePagePointer(manifest: Pick<ShardManifest, 'shardfile' | 'gridShardfile' | 'clientPlanRuntime'>): string | undefined {
  // the grid's readers take `shardfile` first and the page this; one descriptor keeps them together. Both keys naming the same
  // file is one pointer (an old build may write both); two different files is the conflict this refuses.
  if (manifest.shardfile !== undefined && manifest.gridShardfile !== undefined && manifest.shardfile !== manifest.gridShardfile) {
    throw new Error('A manifest names its shardfile once (shardfile or gridShardfile)');
  }
  return manifest.gridShardfile ?? (manifest.clientPlanRuntime === true ? manifest.shardfile : undefined);
}

/** OF8: the pointer of a plain shard, admitted as data; undefined for a runtime shard (`runtimePagePointer`) or a shard with none. */
export function dataPointer(manifest: Pick<ShardManifest, 'shardfile' | 'gridShardfile' | 'clientPlanRuntime'>): string | undefined {
  return runtimePagePointer(manifest) === undefined ? manifest.shardfile : undefined;
}
