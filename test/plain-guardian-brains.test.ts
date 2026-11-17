// Exercise the default plain guardian host with real native clocks and damage.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseRows } from '@wildshard/format/rows';
import { CreaturesSchema } from '@wildshard/format/creatures';
import { parse } from 'valibot';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { emptyShardfile } from '../src/shared/host/author';
import { createShardfileSim, prepareShardfileSimRestore } from '../src/server/game/plugin/simulation';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';

const tuning = { thinkDivisor: 3, wakeRadius: 9, guardRadius: 24, approachRadius: 16, swingRadius: 2,
  swingDuration: 0.8, speed: 3, holdRadius: 3, sideSpeed: 1, sideFlipSeconds: 1, sinkAfterSeconds: 1,
  cooldownSeconds: 1, hideOffset: -2.3, noticeCue: 'notice' };
function fixture() {
  const base = emptyShardfile({ slug: 'plain-guardian', name: 'Plain guardian', author: 'Test', revision: 1, seed: 39 });
  const rows = parseRows({ weather: [], days: [], compendiums: [], loot: [], looks: [],
    strikes: [{ id: 'fixture.bite', shape: { kind: 'sphere', radius: 2 }, windup: 0.2, active: 0.1, recover: 0.5,
      cooldown: 1.2, range: 2, damage: 7, tags: ['creature.fixture'], weight: 1, speed: 0 }],
    species: [{ id: 'fixture.creature', kind: 'fixture.label', label: 'Fixture', aggressive: true, lockable: true,
      dims: { bodyY: 1, bodyHalfLen: 0.5, bodyRadius: 0.3, headRadius: 0.3, legLen: 0.5, feet: [], halfWidth: 0.4 },
      variants: [{ id: 'plain', label: 'Plain', rarity: 'common', weight: 1, scale: [1, 1], hp: 117,
        mods: { speed: 1, chargeDist: 1, damageTaken: 1, chargeDamage: 12, relentless: false } }] }] });
  const creatures = parse(CreaturesSchema, { brains: [{ id: 'fixture.brain', kind: 'guardian', ...tuning }], groups: [],
    spawns: [{ id: 'fixture.actor', species: 'fixture.creature', variant: 'plain', brain: 'fixture.brain',
      strike: 'fixture.bite', at: [0, 0, 0], seed: 9, scale: 1, yaw: 0 }] });
  return { ...base, spawn: { x: 0, y: 0, z: 20, yaw: Math.PI }, rows, creatures };
}
type Simulation = ReturnType<typeof createShardfileSim>;
function move(sim: Simulation, z: number) {
  const actor = sim.host.entities.get('fixture.actor');
  if (actor === undefined) throw new Error('Missing actual guardian');
  const player = sim.host.nearestPlayer(actor.position); player.position.set(0, 0, z); player.motor?.resetAt(player.position);
}
function until(sim: Simulation, predicate: () => boolean, limit = 600) {
  for (let i = 0; i < limit; i++) { sim.host.step(); if (predicate()) return; }
  throw new Error('Guardian phase was not reached');
}

test('guardian native root hides, rises, deals admitted damage and returns/sinks', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), shard = fixture();
  const sim = createShardfileSim(shard, new Map(), { rapier });
  try {
    const actor = sim.host.entities.get('fixture.actor');
    if (actor === undefined) throw new Error('Missing actual guardian');
    const player = sim.host.nearestPlayer(actor.position);
    for (let i = 0; i < 120; i++) sim.host.step();
    expect(actor.state).toBe('hide'); expect(actor.yOffset).toBeCloseTo(-2.3); expect(actor.mem['rise']).toBe(0);
    move(sim, 8); until(sim, () => actor.mem['rise'] === 1 && actor.mem['rising'] === 0);
    expect(actor.yOffset).toBeCloseTo(0); move(sim, 1);
    until(sim, () => player.health.attributes.health < 100);
    expect(player.health.attributes.health).toBe(93); expect(actor.mem['hit']).toBe(1);
    move(sim, 50); until(sim, () => actor.state === 'hide' && actor.mem['rise'] === 0);
    expect(actor.yOffset).toBeCloseTo(-2.3); expect(Math.hypot(actor.position.x, actor.position.z)).toBeLessThan(0.7);
  } finally { sim.host.dispose(); }
});

test.each(['rising', 'attack', 'sinking'])('guardian %s phase restores exact native body/controller/RNG', async phase => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), shard = fixture();
  const first = createShardfileSim(shard, new Map(), { rapier });
  const resumed = prepareShardfileSimRestore(shard, new Map(), { rapier });
  try {
    const actor = first.host.entities.get('fixture.actor');
    if (actor === undefined) throw new Error('Missing actual guardian');
    for (let i = 0; i < 12; i++) first.host.step();
    move(first, 8);
    if (phase === 'rising') until(first, () => (actor.mem['rise'] ?? 0) > 0.2 && actor.mem['rising'] === 1);
    else {
      until(first, () => actor.mem['rise'] === 1 && actor.mem['rising'] === 0);
      if (phase === 'attack') { move(first, 1); until(first, () => actor.attackPhase > 0 && actor.attackPhase < 0.2); }
      else { move(first, 50); until(first, () => actor.mem['sinking'] === 1 && (actor.mem['rise'] ?? 1) < 0.8); }
    }
    resumed.restore(snapshotSimHost(first.host));
    for (let i = 0; i < 180; i++) { first.host.step(); resumed.host.step(); }
    expect(resumed.host.entities.get(actor.entityId)?.snapshot()).toEqual(actor.snapshot());
    expect(resumed.host.adapters.get('brain.fixture.actor')?.snapshot()).toEqual(first.host.adapters.get('brain.fixture.actor')?.snapshot());
    expect(resumed.host.rng.snapshot()).toEqual(first.host.rng.snapshot());
    expect(resumed.host.nearestPlayer(actor.position).health.snapshot()).toEqual(first.host.nearestPlayer(actor.position).health.snapshot());
  } finally { resumed.host.dispose(); first.host.dispose(); }
});

test.each(['inline', 'interior-alias'] as const)('a guardian %s uses the same admitted body recipe', async form => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), shard = fixture();
  if (form === 'inline') {
    const row = shard.rows.species[0], spawn = shard.creatures.spawns[0];
    if (row === undefined || spawn === undefined) throw new Error('Missing authored guardian');
    row.temperament = { brain: 'guardian', reaction: 'aggressive', leash: 45, assist: 0,
      home: { speed: 2, stop: 0.6 }, tuning };
    shard.creatures.brains = []; spawn.brain = null; shard.rows = parseRows(shard.rows);
  } else {
    const brain = shard.creatures.brains[0];
    if (brain === undefined) throw new Error('Missing original guardian');
    shard.creatures = parse(CreaturesSchema, { ...shard.creatures, brains: [{ ...brain, pattern: 'interior' }] });
  }
  const sim = createShardfileSim(shard, new Map(), { rapier });
  try {
    const actor = sim.host.entities.get('fixture.actor');
    if (actor === undefined) throw new Error('Missing actual guardian');
    const player = sim.host.nearestPlayer(actor.position); move(sim, 1);
    until(sim, () => player.health.attributes.health < 100);
    expect(player.health.attributes.health).toBe(93);
  } finally { sim.host.dispose(); }
});
