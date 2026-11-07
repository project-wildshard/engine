import type { ShardPlayHost } from '../../../shared/game/shard/runtime';

/** Read the installed legacy play owner lazily; absence or either storage refusal keeps the current frame. */
export function legacyHomeCheckpoint(read: () => Pick<ShardPlayHost, 'progress' | 'inventory'> | null): () => boolean {
  return () => {
    const play = read();
    if (play === null) return false;
    const progress = play.progress.checkpoint(), inventory = play.inventory.checkpoint();
    return progress && inventory;
  };
}
