import { buildYield } from '@wildshard/engine/core/workSlice';
import { parseDecisionScripts } from '@wildshard/format/decisionScripts';
import type { ShardContext } from '../plugin/context';
import type { RuntimeHomePorts } from '../../../shared/game/plugin/runtimeRows';
import { bindPageHomes } from '../../../shared/game/population/pageHomes';
import { pagePopulationRows } from '../../../shared/game/population/pageRows';
import { folderPainterLight } from '../looks/paintedLook';
import type { Animal } from '@wildshard/engine/entities/AnimalView';
import { wirePage } from './wirePage';
import { clientNativeBook } from './clientNativeBook';
import type { PageHomesRow } from './clientPlan';

/** The engine's page population row (OF29e8, `PageHomesRow`) keeps the original native bodies,
 * allocation order, refill identities and late floor-placement phase. */
export async function installClientPopulation(ctx: ShardContext, row: PageHomesRow): Promise<void> {
  const book = clientNativeBook(ctx);
  if (book.population !== null || !book.species || book.quest === null)
    throw new Error('Population requires its actual catalogue and saved page');
  const declared = pagePopulationRows(ctx.product.section('sim/runtime-plan'));
  const materialScope = ctx.product.section('look/painted').look.lightScope === 'material';
  // OF20b: a group may name a declared spawn beside the plan (Sky Reach's ray wake); the server's row is its body
  const addresses = new Set([...declared.homes, ...declared.bosses, ...declared.actors ?? [], ...ctx.product.shardfile.creatures.spawns].map(body => body.id));
  const rowBodies = ctx.game.runtime?.play?.animals; // herdless on the wire: its population spawns nothing, and the rows' bodies take the same light
  if (materialScope && rowBodies !== undefined) wirePage.dressRows(rowBodies, ctx.scope, body => { folderPainterLight(ctx.product, body.mesh, ctx.scope); });
  for (const ids of Object.values(row.groups)) if (ids.some(id => !addresses.has(id))) throw new Error('Population group requires actual native bodies');
  const ports: RuntimeHomePorts = { system: row.system,
    decisionActors: parseDecisionScripts(ctx.product.section('sim/scripts')).filter(script => 'spawnGroup' in script.binding).flatMap(script => Object.values(script.actors)),
    ...(row.held === undefined ? {} : { held: row.held }),
    spawned: animal => { if (materialScope) folderPainterLight(ctx.product, animal.mesh, ctx.scope); },
    ...(row.holds === undefined ? {} : { holds: { ...row.holds, flags: book.quest.flags } }),
  };
  book.population = await bindPageHomes(ctx, declared, ports, () => buildYield(ctx.scope, 4));
}

/** Internal lookup of the actual body. Its native owner retains all state. */
export function clientPopulationActor(ctx: ShardContext, id: string): ReturnType<NonNullable<ReturnType<typeof clientNativeBook>['population']>['held']> {
  const population = clientNativeBook(ctx).population;
  return population?.held(id) ?? population?.homes.find(home => home.id === id)?.animal ?? null;
}
/** A group member's body as a presentation feature draws on it: the keeper's where this page spawns its own, else the server's
 *  row of the same name (J130). A row arrives after entry and may come back as another body, so a caller asks each frame. */
export type ClientPopulationBody = () => Animal | null;
/** ONE-FORMAT OF29e7b: the bodies of the declared spawns a row names itself (a trail's `members`), by address, as a group's. */
export function clientMemberBodies(ctx: ShardContext, ids: readonly string[]): readonly ClientPopulationBody[] {
  if (clientNativeBook(ctx).population === null) throw new Error('Missing entered native population');
  return ids.map(id => () => clientPopulationActor(ctx, id) ?? wirePage.namedBody(id));
}
