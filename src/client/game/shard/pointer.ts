import type { ShardManifest } from './manifest';

/**
 * ONE-FORMAT OF8/OF9b: the one descriptor pointer of a runtime shard (a shard whose built-in client-plan page owns its runtime).
 * The pointer is `shardfile`, as for every other shard (FORMAT-PRUNE FP8: format migrates the old key; the page never reads it).
 * A shard with no client-plan runtime has no runtime pointer: its `shardfile` is plain data admission.
 */
export function runtimePagePointer(manifest: Pick<ShardManifest, 'shardfile' | 'clientPlanRuntime'>): string | undefined {
  return manifest.clientPlanRuntime === true ? manifest.shardfile : undefined;
}

/** OF8: the pointer of a plain shard, admitted as data; undefined for a runtime shard (`runtimePagePointer`) or a shard with none. */
export function dataPointer(manifest: Pick<ShardManifest, 'shardfile' | 'clientPlanRuntime'>): string | undefined {
  return runtimePagePointer(manifest) === undefined ? manifest.shardfile : undefined;
}
