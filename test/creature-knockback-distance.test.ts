import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { groundFixture } from './fixtures/plain-ground';

const rapier = loadRapier(readFileSync('public/assets/physics/rapier.wasm'));

test.each([6, undefined])('a landed engine strike applies its optional %s metre shove', async (distance) => {
  const source = groundFixture(), spawn = source.creatures.spawns[0];
  if (spawn === undefined) throw new Error('Missing knockback actor');
  spawn.brain = null;
  source.spawn.z = 5.5;
  const sim = createShardfileSim(source, new Map(), { rapier: await rapier });
  try {
    const player = sim.host.players.get('actor.player');
    if (player === undefined) throw new Error('Missing live knockback target');
    sim.host.registerStrikeCatalogue(spawn.id, [{
      id: 'fixture.slam', shape: { kind: 'sphere', radius: 2 }, windup: 0.05, active: 0.1, recover: 0.1,
      cooldown: 0.1, range: 2, damage: 7, tags: ['creature.fixture'],
      ...(distance === undefined ? {} : { knockbackDistance: distance }),
    }]);
    for (let i = 0; i < 4; i++) sim.host.step();
    const start = player.position.z, hp = player.health.attributes.health;
    expect(sim.host.startDeclaredStrike(spawn.id, player.id, 'fixture.slam')).toBe(true);
    for (let i = 0; i < 60; i++) sim.host.step();
    expect(hp - player.health.attributes.health).toBeCloseTo(7);
    expect(Math.abs((start - player.position.z) - (distance ?? 0))).toBeLessThan(0.5);
  } finally {
    sim.dispose();
  }
});
