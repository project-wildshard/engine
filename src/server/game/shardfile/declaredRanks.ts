import { creatureRank } from '@wildshard/format/creatureRanks';
import type { ShardCreatures } from '@wildshard/format/creatures';
import type { SimHost, SimSpawn } from '@wildshard/engine/sim';

/** ONE-FORMAT OF33b (OF29c; Q-CC33 (a), shard-format OF33a): the elites primitive. A declared spawn row's `rank` makes a
 * stronger version of the same creature, by the format's own multipliers (`@wildshard/format/creatureRanks`, the table the
 * format's size cap reads): this scales the body's hp and size before the level is built, so a save keeps them; the
 * blows it lands are scaled by `installDeclaredRanks`, and its loot rolls by the personal roll (`loot/personal.ts`).
 * An unranked row keeps its own numbers. Pine's `population.elites` and Nalati's `riding.elites` join at M8. */
export function rankCreatureSpawns(spawns: readonly SimSpawn[], placements: ShardCreatures['spawns']): SimSpawn[] {
  const ranks = new Map(placements.flatMap(row => row.rank === undefined ? [] : [[row.id, creatureRank(row.rank)] as const]));
  return ranks.size === 0 ? [...spawns] : spawns.map(spawn => {
    const rank = ranks.get(spawn.id);
    return rank === undefined ? spawn : { ...spawn, scale: spawn.scale * rank.size, spec: { ...spawn.spec, hp: spawn.spec.hp * rank.hp } };
  });
}

/** Every blow a ranked body lands, whatever strike or ability lands it, takes its rank's damage multiplier. Returns
 * whether any body is ranked; a shard with none installs nothing. The body is resolved per blow, since bodies spawn,
 * respawn and leave after installation. */
export function installDeclaredRanks(host: SimHost, placements: ShardCreatures['spawns']): boolean {
  if (!placements.some(row => row.rank !== undefined)) return false;
  host.events.answer('damage.modify', request => {
    if (request === null || request.source === 'env') return request;
    const body = host.entities.get(request.source.id);
    if (body?.rank === undefined || body.combatActor() !== request.source) return request;
    return { ...request, amount: request.amount * creatureRank(body.rank).damage };
  }, host.scope);
  return true;
}
