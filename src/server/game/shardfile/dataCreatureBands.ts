import type { SimHost } from '@wildshard/engine/sim';
import type { ShardRows } from '@wildshard/format/rows';
import type { ShardCreatures } from '@wildshard/format/creatures';

/** Data layers use the existing host clocks, without changing native page rate tables or motor shape. */
export function installDataCreatureBands(host: SimHost, rows: ShardRows, creatures: ShardCreatures): void {
  if (host.embedded || host.bodyBands !== undefined || !rows.species.some(row => row.temperament !== undefined)) return;
  const layeredSpecies = new Set(rows.species.filter(row => row.temperament !== undefined).map(row => row.id));
  const layeredActors = new Set(creatures.spawns.filter(spawn => layeredSpecies.has(spawn.species)).map(spawn => spawn.id));
  const declarations = new Map(creatures.brains.map(brain => [brain.id, brain]));
  const divisors = new Map(creatures.spawns.map(spawn => {
    const brain = spawn.brain === null ? undefined : declarations.get(spawn.brain);
    return [spawn.id, brain?.thinkDivisor ?? 1];
  }));
  host.useBodyBands({ fixedSteps: true, physics: false,
    rate: body => layeredActors.has(body.entityId) ? 'ai' : 'always',
    present: body => !layeredActors.has(body.entityId) || host.hasPlayerInterest,
    legacyDivisor: body => divisors.get(body.entityId) ?? 1,
    rates: { ai: { bands: [{ upTo: 60, brainHz: 60, body: 'frame' }, { upTo: 160, brainHz: 15, body: 'half' },
      { upTo: Infinity, brainHz: 'paused', body: 'paused' }] } } });
}
