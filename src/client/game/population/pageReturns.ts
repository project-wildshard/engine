import { PageReturnRowsSchema } from '@wildshard/format/namedJsonContracts';
import type { ShardContext } from '../plugin/context';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';
import { RespawnQueue } from '../../../shared/game/population/respawn';
import * as v from 'valibot';

/** A page's actor-return rows, admitted and held for the debug view. The server's NativeReturns runs them: the declared
 * guest owns delay, visibility/night eligibility and terrain retry law, and the host owns deaths, herd membership, the
 * named spawn stream and body construction (S3, flow:creature-returns). */
export function installPageReturns(ctx: ShardContext, input: unknown): RespawnQueue {
  const rows = v.parse(PageReturnRowsSchema, input), runtime = ctx.game.runtime, animals = runtime?.play?.animals, world = runtime?.world;
  if (animals === undefined || world === undefined || world === null) throw new Error('Actor returns require the page population');
  // SR12: the page draws row bodies and makes none (RowBodies is herdless), so NativeReturns on the server owns every return
  // and this queue only carries the admitted rules to the debug view. Its death listener and refill step are retired.
  if (!animals.herdless) throw new Error('Actor returns belong to the server: the page population must be herdless');
  return new RespawnQueue(rows.rules, rows.outOfSight, { order: 'reverse', limit: null, result: 'fresh' }, ReturnProgram.page(rows.program, ctx.scope));
}
