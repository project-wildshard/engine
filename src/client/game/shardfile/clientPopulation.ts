import { parse } from 'valibot';
import { buildYield } from '@wildshard/engine/core/workSlice';
import { ClientPopulationSchema } from '@wildshard/format/clientNative';
import { parseDecisionScripts } from '@wildshard/format/decisionScripts';
import type { ShardContext } from '../plugin/context';
import type { RuntimeHomePorts } from '../../../shared/game/plugin/runtimeRows';
import { bindPageHomes } from '../../../shared/game/population/pageHomes';
import { pagePopulationRows } from '../../../shared/game/population/pageRows';
import { productPainterLight } from '../looks/paintedLook';
import { wirePage } from './wirePage';
import { clientNativeBook } from './clientNativeBook';

/** Compiled population.homes feature keeps the original native bodies,
 * allocation order, refill identities and late floor-placement phase. */
export async function installClientPopulation(ctx: ShardContext, input: unknown): Promise<void> {
  const row = parse(ClientPopulationSchema, input), book = clientNativeBook(ctx);
  if (book.population !== null || !book.species || book.quest === null)
    throw new Error('Population requires its actual catalogue and saved page');
  const declared = pagePopulationRows(ctx.product.section('sim/runtime-plan'));
  const materialScope = ctx.product.section('look/painted').look.lightScope === 'material';
  const addresses = new Set([...declared.homes, ...declared.bosses, ...declared.actors ?? []].map(body => body.id));
  const rowBodies = ctx.game.runtime?.play?.animals; // herdless on the wire: its population spawns nothing, and the rows' bodies take the same light
  if (materialScope && rowBodies !== undefined) wirePage.dressRows(rowBodies, ctx.scope, body => { productPainterLight(ctx.product, body.mesh, ctx.scope); });
  for (const ids of Object.values(row.groups)) if (ids.some(id => !addresses.has(id))) throw new Error('Population group requires actual native bodies');
  const ports: RuntimeHomePorts = { system: row.system,
    decisionActors: parseDecisionScripts(ctx.product.section('sim/scripts')).filter(script => 'spawnGroup' in script.binding).flatMap(script => Object.values(script.actors)),
    ...(row.held === undefined ? {} : { held: row.held }),
    spawned: animal => { if (materialScope) productPainterLight(ctx.product, animal.mesh, ctx.scope); },
    ...(row.holds === undefined ? {} : { holds: { ...row.holds, flags: book.quest.flags } }),
  };
  book.population = await bindPageHomes(ctx, declared, ports, () => buildYield(ctx.scope, 4));
}

/** Internal lookup of the actual body. Its native owner retains all state. */
export function clientPopulationActor(ctx: ShardContext, id: string): ReturnType<NonNullable<ReturnType<typeof clientNativeBook>['population']>['held']> {
  const population = clientNativeBook(ctx).population;
  return population?.held(id) ?? population?.homes.find(home => home.id === id)?.animal ?? null;
}
/** Actual native group members for compiled presentation features. Group rows
 * contain addresses only; the keeper remains the sole owner of every body. */
export function clientPopulationActors(ctx: ShardContext, group: string): NonNullable<ReturnType<typeof clientPopulationActor>>[] {
  const population = ctx.product.section('client/plan').features.find(row => row.kind === 'population.homes');
  const ids = population?.kind === 'population.homes' ? population.groups[group] : undefined;
  if (ids === undefined || clientNativeBook(ctx).population === null) throw new Error(`Missing entered native population group: ${group}`);
  return ids.flatMap(id => clientPopulationActor(ctx, id) ?? []);
}
