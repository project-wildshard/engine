/** Original day-clock encounter construction over finite admitted owners. */
import { parseClientPlan } from '@wildshard/format/clientPlan';
import type { ShardContext } from '../plugin/context';
import { TimedEncounters } from '../boss/timedEncounters';
import { SceneDressing } from './sceneDressing';
import { entryOwner, lateEntryOwner, presentEntryOwner, publishEntryOwner } from '../../../shared/game/shardfile/entryOwners';
import { buildYield } from '@wildshard/engine/core/workSlice';

/** Keep two original figure copies, their shared storm alias, the existing
 * species programme and the late day clock; publish no replacement authority. */
export async function installClientTimedEncounters(ctx: ShardContext, input: unknown): Promise<TimedEncounters> {
  const row = parseClientPlan({version: 1, features: [input]}).features[0];
  if (row?.kind !== 'timed.encounters') throw new Error('Invalid timed encounter construction');
  const runtime = ctx.game.runtime, world = runtime?.world, scope = ctx.scope, product = ctx.product;
  if (runtime === undefined || world === undefined || world === null || scope.disposed || scope.disposing)
    throw new Error('Timed encounters require their live original world');
  const {game} = world, construction = game.levelScope;
  const draws = entryOwner(scope, 'fixed-draws', row.draws), species = entryOwner(scope, 'species', row.species);
  const weather = lateEntryOwner(scope, 'world-weather', row.weather);
  const resolveClock = () => { const rig = weather(), sky = rig.sky, storm = rig.storm;
    if (sky === null || storm === null) throw new Error('Timed encounters require their original sky and storm');
    return {rig, sky, storm, clock: sky.clock}; };
  let originalClock: ReturnType<typeof resolveClock> | undefined;
  const live = (): void => {
    if (scope.disposed || scope.disposing || construction.disposed || construction.disposing || ctx.scope !== scope || ctx.product !== product
      || ctx.game.runtime !== runtime || runtime.world !== world || world.game !== game || game.levelScope !== construction
      || entryOwner(scope, 'fixed-draws', row.draws) !== draws || entryOwner(scope, 'species', row.species) !== species)
      throw new Error('Timed encounter construction owner left or changed');
  };
  live();
  if (presentEntryOwner(scope, 'timed-encounters', row.owner) !== null || !draws.ready) throw new Error('Timed encounter owner already exists or draws are not ready');
  if (species.prepareMemory(row.guest, construction)) { await buildYield(construction); live(); }
  const guest = species.program(row.guest), sites = row.sites === undefined ? null : SceneDressing.current(ctx).sites.get(row.sites)?.sites ?? null;
  const figures = {rider: construction.own(draws.handle(row.figures.rider).copy()), captain: construction.own(draws.handle(row.figures.captain).copy())};
  const night = await scope.run(() => TimedEncounters.install(ctx, {game, sky: world.sky, player: world.player, forest: world.forest, sites,
    get clock() { live(); const rig = weather(); originalClock ??= resolveClock();
      if (rig.sky !== originalClock.sky || rig.storm !== originalClock.storm || originalClock.sky.clock !== originalClock.clock) throw new Error('Timed encounter clock owner changed');
      return originalClock.clock; }},
  row.file, {...figures, storm: figures[row.figures.storm]}, guest));
  live(); publishEntryOwner(scope, 'timed-encounters', row.owner, night);
  return night;
}
