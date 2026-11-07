/** Finite construction of the existing elite owner over original entered loans. */
import * as v from 'valibot';
import { DeclaredEliteEntry } from '@wildshard/engine/ai/view/eliteEntry';
import { parseEliteEntryPageRows } from '@wildshard/format/eliteEntryRows';
import { parseClientPlan } from '@wildshard/format/clientPlan';
import type { ShardContext } from '../plugin/context';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';
import { pageAir } from '../population/pageAir';
import { SceneDressing } from './sceneDressing';
import { entryOwner, lateEntryOwner, presentEntryOwner, publishEntryOwner, type EliteEntryConstruction } from '../../../shared/game/shardfile/entryOwners';

/** Parsing/freezing the entry allocates no body, UI, programme instance or RNG
 * stream. Its original bind feature consumes these exact owners at play. */
export async function installClientEliteConstruction(ctx: ShardContext, input: unknown): Promise<EliteEntryConstruction> {
  const row = parseClientPlan({version: 1, features: [input]}).features[0];
  if (row?.kind !== 'elite.construct') throw new Error('Invalid elite construction feature');
  const runtime = ctx.game.runtime, world = runtime?.world, scope = ctx.scope, product = ctx.product;
  if (runtime === undefined || world === undefined || world === null || scope.disposed || scope.disposing)
    throw new Error('Elite construction requires its live original world');
  const game = world.game, construction = game.levelScope, models = entryOwner(scope, 'drawn-models', row.models);
  const weather = lateEntryOwner(scope, 'world-weather', row.weather), night = lateEntryOwner(scope, 'timed-encounters', row.night);
  const live = (): void => {
    if (scope.disposed || scope.disposing || construction.disposed || construction.disposing || ctx.scope !== scope || ctx.product !== product
      || ctx.game.runtime !== runtime || runtime.world !== world || world.game !== game || game.levelScope !== construction
      || entryOwner(scope, 'drawn-models', row.models) !== models) throw new Error('Elite construction owner left or changed');
  };
  live();
  if (presentEntryOwner(scope, 'elite-entry', row.owner) !== null) throw new Error('Elite construction owner already exists');
  const {admission} = v.parse(v.object({admission: v.unknown()}), await product.json(row.admission)); live();
  const rows = parseEliteEntryPageRows(row.rows), program = ReturnProgram.page(admission, scope);
  const ledges = SceneDressing.current(ctx).pieces.get(row.ledges.part)?.anchors[row.ledges.anchor] ?? [];
  const entry = new DeclaredEliteEntry(rows.entry, construction);
  const resolveWeather = () => { const rig = weather(), sky = rig.sky, storm = rig.storm;
    if (sky === null || storm === null) throw new Error('Elite weather owner is missing'); return {sky, storm, clock: sky.clock}; };
  let originalWeather: ReturnType<typeof resolveWeather> | undefined;
  const readWeather = () => { live(); const rig = weather(); originalWeather ??= resolveWeather();
    if (rig.sky !== originalWeather.sky || rig.storm !== originalWeather.storm || originalWeather.sky.clock !== originalWeather.clock)
      throw new Error('Elite weather owner changed'); return originalWeather; };
  const loan: EliteEntryConstruction = {entry, rows, construction, models, program: {id: row.program, scope: construction, value: program}, environment: pageAir, ledges,
    get clock() { return readWeather().clock; },
    get weather() { return readWeather().storm; },
    get patrol() { live(); return night().riders; }};
  live(); publishEntryOwner(scope, 'elite-entry', row.owner, loan); return loan;
}
