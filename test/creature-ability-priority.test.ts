import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseRows } from '@wildshard/format/rows';
import { createShardfileSim, prepareShardfileSimRestore } from '../src/server/game/plugin/simulation';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { groundFixture } from './fixtures/plain-ground';

const rapier = loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
const actorId = 'fixture.actor';
const biteId = 'fixture.bite';
const chargeId = 'fixture.charge';

function sourceAt(distance: number) {
  const source = groundFixture(true);
  const species = source.rows.species[0], bite = source.rows.strikes[0], spawn = source.creatures.spawns[0];
  if (species === undefined || bite === undefined || spawn === undefined || species.temperament === undefined) {
    throw new Error('Missing layered ability fixture');
  }
  source.spawn.z = 7 - distance;
  spawn.strike = null;
  species.temperament.brain = 'pursue';
  species.temperament.tuning = { speed: 0, turnRate: 8, thinkDivisor: 1, attackCooldownTicks: 60,
    wanderRadius: 0, wanderEveryTicks: 60 };
  species.senses = { notice: 25 };
  species.abilities = [
    { use: biteId, range: 2, cooldown: 3, weight: 1, hpBelow: 0.8, damage: 13 },
    { use: chargeId, range: [8, 20], cooldown: 4, weight: 100 },
  ];
  source.rows = parseRows({ ...source.rows, strikes: [
    { ...bite, recover: 0.1 },
    { ...bite, id: chargeId, shape: { kind: 'lane', length: 20, width: 2 }, range: 20, speed: 10 },
  ] });
  return source;
}

test('a real declared creature chooses ranged charge and retains its exact running strike on restore', async () => {
  const source = sourceAt(12), physics = await rapier;
  const sim = createShardfileSim(source, new Map(), { rapier: physics });
  const resumed = prepareShardfileSimRestore(source, new Map(), { rapier: physics });
  try {
    sim.host.step();
    expect(sim.host.strikes.get(actorId)?.spec?.id).toBe(chargeId);
    resumed.restore(snapshotSimHost(sim.host));
    for (let tick = 0; tick < 40; tick++) {
      sim.host.step();
      resumed.host.step();
      expect(snapshotSimHost(resumed.host)).toEqual(snapshotSimHost(sim.host));
    }
  } finally {
    resumed.host.dispose();
    sim.dispose();
  }
});

test('ability priority uses inclusive range, health and weight gates before damage and cooldown', async () => {
  const source = sourceAt(1.5), physics = await rapier;
  const species = source.rows.species[0];
  if (species?.abilities === undefined) throw new Error('Missing ability options');
  species.abilities.unshift({ use: 'fixture.disabled', range: 2, cooldown: 3, weight: 0 });
  species.abilities.push({ use: 'fixture.followup', range: [1, 2], cooldown: 20, weight: 200 });
  const bite = source.rows.strikes[0];
  if (bite === undefined) throw new Error('Missing bite');
  source.rows = parseRows({ ...source.rows, strikes: [
    ...source.rows.strikes, { ...bite, id: 'fixture.disabled' }, { ...bite, id: 'fixture.followup' },
  ] });
  const sim = createShardfileSim(source, new Map(), { rapier: physics });
  try {
    const actor = sim.host.entities.get(actorId);
    if (actor === undefined) throw new Error('Missing live ability actor');
    actor.hp = actor.maxHp * 0.7;
    sim.host.step();
    expect(sim.host.strikes.get(actorId)?.spec?.id).toBe(biteId);
    const targetHealth = sim.host.nearestPlayer(actor.position).health.attributes;
    const hp = targetHealth.health;
    let followup = false;
    for (let tick = 0; tick < 60 && !followup; tick++) {
      sim.host.step();
      followup = sim.host.strikes.get(actorId)?.spec?.id === 'fixture.followup';
    }
    expect(targetHealth.health).toBeCloseTo(hp - 13);
    expect(followup).toBe(true);
  } finally {
    sim.dispose();
  }

  const fresh = createShardfileSim(source, new Map(), { rapier: physics });
  try {
    fresh.host.step();
    expect(fresh.host.strikes.get(actorId)?.spec?.id).toBe('fixture.followup');
  } finally {
    fresh.dispose();
  }
});
