import { parseRows, type ShardRows } from '@wildshard/format/rows';
import { groundFixture } from './plain-ground';

export function authoredStrikeFixture(id: string, distance: number, ability: Partial<NonNullable<ShardRows['species'][number]['abilities']>[number]>) {
  const source = groundFixture(true), [species] = source.rows.species, [strike] = source.rows.strikes, [spawn] = source.creatures.spawns;
  if (species?.temperament === undefined || strike === undefined || spawn === undefined) throw new Error('Missing authored strike fixture');
  source.spawn.z = spawn.at[2] - distance;
  spawn.strike = null;
  species.temperament.brain = 'pursue';
  species.temperament.tuning = { speed: 0, turnRate: 8, thinkDivisor: 1, attackCooldownTicks: 60, wanderRadius: 0, wanderEveryTicks: 60 };
  species.senses = { notice: 25 };
  species.abilities = [{ use: id, range: distance + 1, cooldown: 30, weight: 1, ...ability }];
  source.rows = parseRows({ ...source.rows, strikes: [{ ...strike, id, windup: 0, active: 0.05, recover: 0.1 }] });
  return source;
}
