import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parse, object, boolean, number } from 'valibot';
import { parseRows } from '@wildshard/format/rows';
import { CREATURE_SIZES } from '@wildshard/format/creatureSizes';
import type { CreatureSize } from '@wildshard/format/creatureLayers';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { createShardfileSim, prepareShardfileSimRestore } from '../src/server/game/plugin/simulation';
import { creatureVolumeFixture } from './fixtures/creature-volume-skin';
import { huntFixture } from './fixtures/layer-hunt';

const rapier = loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
async function wolf(size: CreatureSize, scale = 1, hunt = false) {
  const { source, assets } = await creatureVolumeFixture(), species = source.rows.species[0], look = source.rows.looks[0], spawn = source.creatures.spawns[0];
  if (species === undefined || look === undefined || spawn === undefined) throw new Error('Missing sized wolf fixture');
  species.kind = 'fixture.wolf'; species.label = 'Wolf';
  species.body = { size, scale, look: look.id }; look.recipe = 'engine.sphere';
  const hunting = huntFixture().rows.species[0]?.temperament;
  if (hunting === undefined) throw new Error('Missing hunt temperament');
  species.temperament = hunt ? hunting : {
    brain: 'pursue', reaction: 'aggressive', leash: 50, assist: 0, home: { speed: 2, stop: 1 },
    tuning: { speed: 3, turnRate: 4, thinkDivisor: 3, attackCooldownTicks: 60, wanderRadius: 0, wanderEveryTicks: 420 },
  };
  species.senses = { notice: 6 };
  spawn.yaw = Math.PI; source.rows = parseRows(source.rows);
  return { source, assets };
}

test.each([1, 1.2])('large wolf free scale %s uses one class stride and aggro on its real controller', async free => {
  const { source, assets } = await wolf('large', free), original = JSON.stringify(source);
  const sim = createShardfileSim(source, assets, { rapier: await rapier }), restored = prepareShardfileSimRestore(source, assets, { rapier: await rapier });
  try {
    const actor = sim.host.entities.get('fixture.actor'); if (actor === undefined) throw new Error('Missing real wolf');
    const start = actor.position.clone();
    for (let tick = 0; tick < 60; tick++) sim.host.step();
    expect(actor.desiredSpeed).toBe(3 * CREATURE_SIZES.large.stride);
    expect(actor.speed).toBeCloseTo(4.5, 6); expect(actor.position.distanceTo(start)).toBeGreaterThan(1);
    expect(actor.scale).toBe(2 * free); expect(actor.cellWeight).toBe(4);
    restored.restore(snapshotSimHost(sim.host));
    for (let tick = 0; tick < 60; tick++) { sim.host.step(); restored.host.step(); }
    expect(snapshotSimHost(restored.host)).toEqual(snapshotSimHost(sim.host));
    expect(sim.host.entities.size).toBe(1); expect(JSON.stringify(source)).toBe(original);
  } finally { sim.dispose(); restored.host.dispose(); }
});

test.each(['medium', 'large'] as const)('native hunt awareness applies %s class aggro before its original meter', async size => {
  const { source, assets } = await wolf(size, 1.2, true), sim = createShardfileSim(source, assets, { rapier: await rapier });
  try {
    for (let tick = 0; tick < 3; tick++) sim.host.step();
    const saved = sim.host.adapters.get('brain.fixture.actor')?.snapshot();
    if (typeof saved !== 'string') throw new Error('Missing real hunt continuation');
    const state = parse(object({ memory: object({ sensed: boolean(), awareness: number() }) }), JSON.parse(saved)).memory;
    expect(state.sensed).toBe(size === 'large'); expect(state.awareness > 0).toBe(size === 'large');
  } finally { sim.dispose(); }
});

test.each(Object.keys(CREATURE_SIZES) as CreatureSize[])('%s actor publishes exactly the defining cell weight', async size => {
  const { source, assets } = await wolf(size), sim = createShardfileSim(source, assets, { rapier: await rapier });
  try { expect(sim.host.entities.get('fixture.actor')?.cellWeight).toBe(CREATURE_SIZES[size].cellWeight); }
  finally { sim.dispose(); }
});

test('medium class retains omitted-body native motion, perception and saved bytes', async () => {
  const { source, assets } = await wolf('medium'), older = structuredClone(source), species = older.rows.species[0];
  if (species === undefined) throw new Error('Missing original wolf'); delete species.body;
  const medium = createShardfileSim(source, assets, { rapier: await rapier }), native = createShardfileSim(older, assets, { rapier: await rapier });
  try {
    for (let tick = 0; tick < 120; tick++) { medium.host.step(); native.host.step(); }
    expect(medium.host.entities.get('fixture.actor')?.desiredSpeed).toBe(0);
    expect(snapshotSimHost(medium.host)).toEqual(snapshotSimHost(native.host));
    expect(native.host.entities.get('fixture.actor')?.cellWeight).toBe(1);
  } finally { medium.dispose(); native.dispose(); }
});

test('a save refuses a changed class even when free scale cancels its geometry', async () => {
  const { source, assets } = await wolf('large'), changed = structuredClone(source), body = changed.rows.species[0]?.body;
  if (body === undefined) throw new Error('Missing changed wolf'); body.size = 'small'; body.scale = 4;
  const sim = createShardfileSim(source, assets, { rapier: await rapier }), restored = prepareShardfileSimRestore(changed, assets, { rapier: await rapier });
  try { expect(() => restored.restore(snapshotSimHost(sim.host))).toThrow('Incompatible simulation snapshot'); }
  finally { sim.dispose(); restored.host.dispose(); }
});
