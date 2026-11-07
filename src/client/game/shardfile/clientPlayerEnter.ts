import { parse } from 'valibot';
import { ClientPlayerEnterSchema } from '@wildshard/format/clientNative';
import type { ShardContext } from '../plugin/context';
import { bindPlayerImpulse } from '../../../shared/game/shardfile/dataCreaturePorts';

/** World-time bounds retain the original staged fall-recovery selection. */
export function installClientPlayerEnter(ctx: ShardContext, input: unknown): void {
  const row = parse(ClientPlayerEnterSchema, input), runtime = ctx.game.runtime;
  if (runtime === undefined) throw new Error('Player view policy requires its actual world owner');
  const bounds = row.bounds;
  if (bounds !== undefined) runtime.hooks.levelBounds = () => ({ ...bounds });
}
/** Play-time pose and forces use the existing player and declared mode rows. */
export function enterClientPlayer(ctx: ShardContext, input: unknown): void {
  const row = parse(ClientPlayerEnterSchema, input), world = ctx.game.runtime?.world;
  if (world === undefined || world === null) throw new Error('Player entry requires its actual world');
  if (row.pitch !== undefined) world.player.pitch = row.pitch;
  const columns = row.columns;
  if (columns !== undefined) bindPlayerImpulse(velocity => { ctx.app.player?.impulse(velocity); }).columns(ctx.product.shardfile.modes?.traverse ?? [],
    () => world.player.position, () => ctx.app.player?.mode === columns.enabledMode,
    (id, run) => { ctx.system({ id, phase: 'fixed.pre', run }); });
}
