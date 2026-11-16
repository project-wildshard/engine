// oxlint-disable-next-line import/no-nodejs-modules -- Rapier is a shipped binary.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseRows } from '@wildshard/format/rows';
import type { ShardCreatures } from '@wildshard/format/creatures';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { emptyShardfile } from '../src/shared/host/author';
import { createShardfileSim, prepareShardfileSimRestore } from '../src/server/game/plugin/simulation';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { requireHuntTuning } from '../src/shared/engine/ai/huntPattern';
import { speciesHealth } from '../src/shared/engine/entities/species/registry';

function fixture() {
  const base = emptyShardfile({ slug: 'layer-policy', name: 'Layer policy', author: 'Test', revision: 1, seed: 7 });
  const rows = parseRows({ weather: [], days: [], compendiums: [], loot: [], looks: [], strikes: [], species: [{
    id: 'fixture.creature', kind: 'fixture.label', label: 'Fixture', aggressive: true, lockable: true,
    dims: { bodyY: 1, bodyHalfLen: 0.5, bodyRadius: 0.3, headRadius: 0.3, legLen: 0.5, feet: [], halfWidth: 0.4 },
    variants: [{ id: 'plain', label: 'Plain', rarity: 'common', weight: 1, scale: [1, 1], hp: 117,
      mods: { speed: 1, chargeDist: 1, damageTaken: 1, chargeDamage: 12, relentless: false } }],
    temperament: { brain: 'pursue', reaction: 'neutral', leash: 35, assist: 0, home: { speed: 2, stop: 1 },
      tuning: { speed: 1.2, turnRate: 4, thinkDivisor: 3, attackCooldownTicks: 60, wanderRadius: 3, wanderEveryTicks: 420 } },
    senses: { notice: 18 },
  }] });
  const spawn: ShardCreatures['spawns'][number] = { id: 'fixture.actor', species: 'fixture.creature', variant: 'plain', brain: null, strike: null,
    at: [6, 0, 6], seed: 9, scale: 1, yaw: 0 };
  return { ...base, rows, creatures: { brains: [], groups: [], spawns: [spawn] } };
}

const HUNT = { hp: 117, sightRange: 18, sightRangeGraze: 12, sightCone: 1, hearStill: 2, hearCrouch: 4, hearWalk: 8, hearSprint: 16,
  noticeRate: 0.5, forgetRate: 0.2, alertAt: 0.3, boltAt: 1, freezeMin: 1, freezeMax: 2, relaxAfter: 3, panicDist: 5,
  runSpeed: 4, trotSpeed: 2, fleeMinTime: 1, fleeUntil: 20, fleeUntilMax: 30, fleeMaxTime: 8, lookBack: 2,
  waryTime: 10, waryBoost: 1.2, herdAlertRadius: 8, herdBoltDelayMin: 0.2, herdBoltDelayMax: 0.5, impactSpook: 6, impactAlert: 12 };

test.each(['pursue', 'hunt'] as const)('an inline %s policy runs in the real simulation and restores its continuation', async brain => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const shard = fixture(), row = shard.rows.species[0];
  if (brain === 'hunt') {
    if (row?.temperament === undefined) throw new Error('Missing fixture temperament');
    row.temperament.brain = 'hunt'; row.temperament.tuning = HUNT; row.temperament.reaction = 'skittish';
    const spawn = shard.creatures.spawns[0]; if (spawn === undefined) throw new Error('Missing fixture spawn');
    spawn.at = [2, 0, 2];
  }
  const input = JSON.stringify(shard), first = createShardfileSim(shard, new Map(), { rapier });
  const restored = prepareShardfileSimRestore(shard, new Map(), { rapier });
  try {
    const body = first.host.entities.get('fixture.actor');
    if (body === undefined) throw new Error('Missing fixture body');
    const start = body.position.clone();
    for (let i = 0; i < 60; i++) first.host.step();
    expect(body.position.distanceTo(start)).toBeGreaterThan(0.2);
    expect(first.host.adapters.has('brain.fixture.actor')).toBe(true);
    restored.restore(snapshotSimHost(first.host));
    for (let i = 0; i < 60; i++) { first.host.step(); restored.host.step(); }
    expect(restored.host.entities.get(body.entityId)?.snapshot()).toEqual(body.snapshot());
    expect(restored.host.adapters.get('brain.fixture.actor')?.snapshot()).toEqual(first.host.adapters.get('brain.fixture.actor')?.snapshot());
    expect(JSON.stringify(shard)).toBe(input);
  } finally { restored.host.dispose(); first.host.dispose(); }
});

test('hunting numbers and health refuse missing, partial and nonfinite values', () => {
  expect(() => requireHuntTuning(undefined, 'fixture')).toThrow('fixture');
  for (const key of Object.keys(HUNT)) {
    const missing = { ...HUNT }; Reflect.deleteProperty(missing, key);
    expect(() => requireHuntTuning(missing, 'fixture'), key).toThrow('Missing hunting numbers');
    const invalid = { ...HUNT }; Reflect.set(invalid, key, NaN);
    expect(() => requireHuntTuning(invalid, 'fixture'), key).toThrow('Missing hunting numbers');
  }
  expect(requireHuntTuning(HUNT, 'fixture')).toBe(HUNT);
  expect(speciesHealth('fixture', 23, 117)).toBe(23);
  expect(speciesHealth('fixture', undefined, 117)).toBe(117);
  for (const hp of [undefined, NaN, Infinity, 0, -1]) expect(() => speciesHealth('fixture', hp, undefined)).toThrow('fixture');
});
