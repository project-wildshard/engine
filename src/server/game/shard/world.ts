import type { World } from '@wildshard/engine/core/bootstrap';
import type { ShardManifest } from '../../../client/game/shard/manifest';

/** Game presentation metadata stays beside the generic engine world. */
export interface ShardWorld extends World { chunk: ShardManifest }
