import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { authoredStrikeFixture } from './fixtures/authored-strike';

const rapier = loadRapier(readFileSync('public/assets/physics/rapier.wasm'));

test.each([6, undefined])('a landed engine strike applies its optional %s metre shove', async (distance) => {
  const source = authoredStrikeFixture('fixture.slam', 1.5, distance === undefined ? {} : { effect: 'knockback', strength: distance });
  const sim = createShardfileSim(source, new Map(), { rapier: await rapier });
  try {
    const player = sim.host.players.get('actor.player');
    if (player === undefined) throw new Error('Missing live knockback target');
    const start = player.position.z, hp = player.health.attributes.health;
    for (let i = 0; i < 60; i++) sim.host.step();
    expect(hp - player.health.attributes.health).toBeCloseTo(7);
    expect(Math.abs((start - player.position.z) - (distance ?? 0))).toBeLessThan(0.5);
  } finally {
    sim.dispose();
  }
});
