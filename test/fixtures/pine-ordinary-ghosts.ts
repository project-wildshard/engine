import type { Shardfile } from '@wildshard/format/shardSchema';
import type { SimHost } from '../../src/server/engine/sim';
import { encounterRows } from '../../src/shared/engine/sim/encounterRows';

/** ONE-FORMAT OF23c: from r9 Pine declares every body and its roster stands none. The roster has no ghost recipe, and the
 *  one standing ghost is the elite, whose finish comes from eliteDrops. A case proving the ordinary death drop declares
 *  two ordinary ghosts (a plain deer row wearing the elite's variant) past Pine's own ids, beside the reward spot. */
export function declareOrdinaryGhosts(shard: Shardfile): void {
  const spawns = shard.creatures.spawns, elite = spawns.find(row => row.variant === 'ghost');
  const plain = spawns.find(row => row.species === elite?.species && row.rank === undefined);
  if (elite === undefined || plain === undefined) throw new Error('Pine declares no ghost or plain deer');
  const top = Math.max(...spawns.flatMap(row => /^creature:(\d+)$/u.exec(row.id)?.[1] ?? []).map(Number));
  for (const at of [1, 2]) spawns.push({ ...plain, variant: elite.variant, seed: elite.seed, scale: elite.scale, id: `creature:${String(top + at)}`, at: [5 + at * 40, elite.at[1], -225] });
}
/** An ordinary (not elite) standing ghost stag, moved to the reward spot. */
export function ordinaryGhost(host: SimHost) {
  const elites = new Set([...encounterRows(host).values()].map(read => read().body));
  const body = [...host.entities].find(([id, actor]) => actor.variant === 'ghost' && actor.alive && !elites.has(id))?.[1];
  if (body === undefined) throw new Error('No ordinary ghost stag standing');
  body.position.set(5, body.position.y, -225);
  return body;
}
