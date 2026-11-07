import { EasedFields } from '@wildshard/engine/world/easedFields';
import { parseEasedFields } from '@wildshard/format/easedFields';
import { boundQuestState } from '../../../shared/game/quest/boundState';
import { sceneScalar } from './sceneInputs';
import { installEnteredRuntimeService } from '../shard/retainedHooks';
import type { ShardContext } from '../plugin/context';

const weatherFields = new Map<string, EasedFields>();
/** Client-only weather targets read an existing quest's flag book. Load/enter snaps; play eases. */
export function installWeatherFields(ctx: ShardContext, input: unknown, quest: string): void {
  const fields = new EasedFields(parseEasedFields(input));
  if (fields.rows.fields.some(row => !ctx.product.shardfile.state.shared.some(field => field.name === row.field && field.privacy === 'host' && field.type === 'f64')))
    throw new Error('Weather presentation requires declared host fields');
  if (ctx.scope.disposed) throw new Error('Weather presentation left during admission');
  const flags = boundQuestState(ctx.scope, quest).flags;
  const publish = (): void => { for (const row of fields.rows.fields) sceneScalar(ctx.product.slug, row.field).value = fields.value(row.field); };
  const snap = (): void => { fields.step(0, flags.all, true); publish(); };
  weatherFields.set(ctx.product.slug, fields);
  ctx.debug.expose('weatherFields', fields);
  ctx.scope.onDispose(() => { if (weatherFields.get(ctx.product.slug) === fields) weatherFields.delete(ctx.product.slug); });
  installEnteredRuntimeService(ctx, scope => { snap(); scope.onDispose(() => {
    for (const row of fields.rows.fields) sceneScalar(ctx.product.slug, row.field).value = row.else;
  }); });
  ctx.system({ id: 'game.weather.fields', phase: 'update', run: dt => { fields.step(dt, flags.all); publish(); } });
}
/** Capture tooling settles the admitted table against real quest facts; no field or target is supplied by a shard. */
export function settleWeatherFields(slug: string, flags: readonly string[]): void {
  const fields = weatherFields.get(slug); if (fields === undefined) throw new Error('Weather fields are not installed');
  fields.step(0, flags, true);
  for (const row of fields.rows.fields) sceneScalar(slug, row.field).value = fields.value(row.field);
}
