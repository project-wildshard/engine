import type { ShardContext } from '../plugin/context';
import { buildYield } from '@wildshard/engine/core/workSlice';

/**
 * End a stretch of a shard's world build (op-hitch45): `await worldBuildYield(ctx)` between pieces. A fresh timer task of
 * the shard's scope, or, in play with a frame due (the active game loop), a wait for the engine loop's next
 * drawn frame: a grid cell builds its world on the road, and WebKit draws no frame between back-to-back timer tasks.
 * Rejects once the shard's scope has closed (an unloaded cell stops building).
 */
export function worldBuildYield(ctx: Pick<ShardContext, 'scope'>, budgetMs?: number): Promise<void> { return buildYield(ctx.scope, budgetMs); }
