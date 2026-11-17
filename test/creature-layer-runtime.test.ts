// oxlint-disable-next-line import/no-nodejs-modules -- Rapier is a shipped binary.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseRows } from '@wildshard/format/rows';
import { CreaturesSchema, type ShardCreatures } from '@wildshard/format/creatures';
import { parse } from 'valibot';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { emptyShardfile } from '../src/shared/host/author';
import { createShardfileSim, prepareShardfileSimRestore } from '../src/server/game/plugin/simulation';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { requireHuntTuning } from '../src/shared/engine/ai/huntPattern';
import { speciesHealth } from '../src/shared/engine/entities/species/registry';
import { Vector3 } from 'three';
import { bindCreatureTemperament } from '../src/server/game/shardfile/creatureTemperament';

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

function hunting(reaction: 'passive' | 'skittish' | 'neutral' | 'aggressive', distance = 8) {
  const shard = fixture(), row = shard.rows.species[0], spawn = shard.creatures.spawns[0];
  if (row?.temperament === undefined || spawn === undefined) throw new Error('Missing fixture species');
  shard.spawn = { x: 0, y: 0, z: 0, yaw: 0 }; spawn.at = [0, 0, distance]; spawn.yaw = Math.PI;
  row.temperament.brain = 'hunt'; row.temperament.reaction = reaction;
  row.temperament.tuning = { ...HUNT, stalk: { detect: 20, speed: 3, giveUp: 45, rechargeCd: 1,
    huffMin: 2, huffMax: 3, roar: '', fleeBelowHp: 0.2, fleeChance: 0.5 } };
  row.senses = { notice: 9 };
  shard.rows = parseRows(shard.rows);
  return shard;
}

function pursuing(distance = 8) {
  const shard = fixture(), row = shard.rows.species[0], spawn = shard.creatures.spawns[0];
  if (row?.temperament === undefined || spawn === undefined) throw new Error('Missing fixture species');
  shard.spawn = { x: 0, y: 0, z: distance, yaw: Math.PI }; spawn.at = [0, 0, 0];
  row.temperament.reaction = 'aggressive'; row.temperament.leash = 45; row.temperament.home = { speed: 6, stop: 0.5 };
  row.temperament.tuning = { speed: 6, turnRate: 8, thinkDivisor: 3, attackCooldownTicks: 60, wanderRadius: 0, wanderEveryTicks: 420 };
  row.senses = { notice: 24 }; shard.rows = parseRows(shard.rows);
  return shard;
}

function packing() {
  const shard = pursuing(30), row = shard.rows.species[0], spawn = shard.creatures.spawns[0];
  if (row?.temperament === undefined || spawn === undefined) throw new Error('Missing fixture species');
  row.temperament.reaction = 'neutral'; row.temperament.pack = true; row.temperament.assist = 14; row.senses = { notice: 4 };
  const members = [
    { id: 'fixture.actor', group: 'fixture.pack', at: [0, 0, 0] },
    { id: 'fixture.near1', group: 'fixture.pack', at: [10, 0, 0] },
    { id: 'fixture.near2', group: 'fixture.pack', at: [0, 0, 13] },
    { id: 'fixture.far', group: 'fixture.pack', at: [20, 0, 0] },
    { id: 'fixture.other', group: 'fixture.other-pack', at: [6, 0, 6] },
  ];
  return { ...shard, rows: parseRows(shard.rows), creatures: parse(CreaturesSchema, {
    brains: [], groups: [], spawns: members.map(member => ({ ...spawn, ...member })),
  }) };
}

test('a real hit assists only the authored pack members inside 14m', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim = createShardfileSim(packing(), new Map(), { rapier });
  try {
    const body = sim.host.entities.get('fixture.actor');
    if (body === undefined) throw new Error('Missing fixture body');
    const player = sim.host.nearestPlayer(body.position);
    for (let i = 0; i < 12; i++) sim.host.step();
    for (const actor of sim.host.entities.values()) expect(actor.state).toBe('idle');
    sim.host.combat.hit({ source: player.health, sourceTags: player.health.tags, target: body.combatActor(), amount: 1,
      point: body.position.clone(), dir: new Vector3(0, 0, -1) });
    for (let i = 0; i < 6; i++) sim.host.step();
    for (const id of ['fixture.near1', 'fixture.near2', 'fixture.actor']) expect(sim.host.entities.get(id)?.state, id).toBe('stalk');
    for (const id of ['fixture.far', 'fixture.other']) expect(sim.host.entities.get(id)?.state, id).toBe('idle');
  } finally { sim.host.dispose(); }
});

test('a restored assisted pack keeps its actual targets and shared RNG', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), shard = packing();
  const first = createShardfileSim(shard, new Map(), { rapier }), resumed = prepareShardfileSimRestore(shard, new Map(), { rapier });
  try {
    const body = first.host.entities.get('fixture.actor');
    if (body === undefined) throw new Error('Missing fixture body');
    const player = first.host.nearestPlayer(body.position);
    first.host.combat.hit({ source: player.health, sourceTags: player.health.tags, target: body.combatActor(), amount: 1,
      point: body.position.clone(), dir: new Vector3(0, 0, -1) });
    for (let i = 0; i < 6; i++) first.host.step();
    expect(first.host.entities.get('fixture.near1')?.state).toBe('stalk');
    resumed.restore(snapshotSimHost(first.host));
    for (let i = 0; i < 120; i++) { first.host.step(); resumed.host.step(); }
    for (const [id, actor] of first.host.entities) {
      expect(resumed.host.entities.get(id)?.snapshot(), id).toEqual(actor.snapshot());
      expect(resumed.host.adapters.get(`brain.${id}`)?.snapshot(), id).toEqual(first.host.adapters.get(`brain.${id}`)?.snapshot());
    }
    expect(resumed.host.rng.snapshot()).toEqual(first.host.rng.snapshot());
  } finally { resumed.host.dispose(); first.host.dispose(); }
});

test('an aggressive layer returns home across its 45m leash, heals and starts a fresh pursuit', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim = createShardfileSim(pursuing(), new Map(), { rapier });
  try {
    const body = sim.host.entities.get('fixture.actor');
    if (body === undefined) throw new Error('Missing fixture body');
    const player = sim.host.nearestPlayer(body.position);
    for (let i = 0; i < 60; i++) sim.host.step();
    expect(body.position.z).toBeGreaterThan(1);
    sim.host.combat.hit({ source: player.health, sourceTags: player.health.tags, target: body.combatActor(), amount: 30,
      point: body.position.clone(), dir: new Vector3(0, 0, -1) });
    expect(body.hp).toBe(87);
    player.position.set(0, 0, 46); player.motor?.resetAt(player.position);
    for (let i = 0; i < 180; i++) sim.host.step();
    expect(Math.hypot(body.position.x, body.position.z)).toBeLessThan(0.7);
    expect(body.hp).toBe(117); expect(body.state).toBe('idle');
    player.position.set(0, 0, 8); player.motor?.resetAt(player.position);
    for (let i = 0; i < 60; i++) sim.host.step();
    expect(body.position.z).toBeGreaterThan(1); expect(body.state).toBe('stalk');
  } finally { sim.host.dispose(); }
});

test('an aggressive return restores the exact controller and body continuation', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), shard = pursuing(20);
  const first = createShardfileSim(shard, new Map(), { rapier }), resumed = prepareShardfileSimRestore(shard, new Map(), { rapier });
  try {
    const body = first.host.entities.get('fixture.actor');
    if (body === undefined) throw new Error('Missing fixture body');
    const player = first.host.nearestPlayer(body.position);
    for (let i = 0; i < 60; i++) first.host.step();
    first.host.combat.hit({ source: player.health, sourceTags: player.health.tags, target: body.combatActor(), amount: 30,
      point: body.position.clone(), dir: new Vector3(0, 0, -1) });
    player.position.set(0, 0, 46); player.motor?.resetAt(player.position);
    for (let i = 0; i < 12; i++) first.host.step();
    expect(body.hp).toBe(87); expect(body.position.z).toBeGreaterThan(1);
    resumed.restore(snapshotSimHost(first.host));
    for (let i = 0; i < 120; i++) { first.host.step(); resumed.host.step(); }
    expect(body.hp).toBe(117);
    expect(resumed.host.entities.get(body.entityId)?.snapshot()).toEqual(body.snapshot());
    expect(resumed.host.adapters.get('brain.fixture.actor')?.snapshot()).toEqual(first.host.adapters.get('brain.fixture.actor')?.snapshot());
    expect(resumed.host.rng.snapshot()).toEqual(first.host.rng.snapshot());
  } finally { resumed.host.dispose(); first.host.dispose(); }
});

test('a territorial layer never crosses its radius while a player moves across its edge', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), shard = pursuing(8);
  const row = shard.rows.species[0];
  if (row?.temperament === undefined) throw new Error('Missing fixture temperament');
  row.temperament.territorial = 5;
  const sim = createShardfileSim(shard, new Map(), { rapier });
  try {
    const body = sim.host.entities.get('fixture.actor');
    if (body === undefined) throw new Error('Missing fixture body');
    const player = sim.host.nearestPlayer(body.position);
    for (let i = 0; i < 240; i++) {
      sim.host.step(); expect(Math.hypot(body.position.x, body.position.z)).toBeLessThanOrEqual(5.001);
    }
    player.position.set(0, 0, 4); player.motor?.resetAt(player.position);
    for (let i = 0; i < 60; i++) sim.host.step();
    expect(body.position.z).toBeGreaterThan(1);
    player.position.set(0, 0, 5.1); player.motor?.resetAt(player.position);
    for (let i = 0; i < 240; i++) {
      sim.host.step(); expect(Math.hypot(body.position.x, body.position.z)).toBeLessThanOrEqual(5.001);
    }
  } finally { sim.host.dispose(); }
});

test('the territorial body constraint includes native impulses', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), shard = pursuing(8);
  const row = shard.rows.species[0];
  if (row?.temperament === undefined) throw new Error('Missing fixture temperament');
  row.temperament.territorial = 5;
  const sim = createShardfileSim(shard, new Map(), { rapier });
  try {
    const body = sim.host.entities.get('fixture.actor');
    if (body === undefined) throw new Error('Missing fixture body');
    body.impulse(new Vector3(0, 0, 30));
    for (let i = 0; i < 120; i++) {
      sim.host.step(); expect(Math.hypot(body.position.x, body.position.z)).toBeLessThanOrEqual(5.001);
    }
  } finally { sim.host.dispose(); }
});

test('a territorial constraint retains and restores the previous world constraint', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), shard = pursuing(8);
  const sim = createShardfileSim(shard, new Map(), { rapier }), body = sim.host.entities.get('fixture.actor');
  const temperament = shard.rows.species[0]?.temperament;
  if (body === undefined || temperament === undefined) { sim.host.dispose(); throw new Error('Missing fixture body'); }
  let sampled = 0;
  const previous: NonNullable<typeof body.motionConstraint> = (_from, to) => { sampled++; to.x = Math.min(to.x, 0); };
  body.motionConstraint = previous;
  try {
    const policy = bindCreatureTemperament(sim.host, body, [0, 0, 0], { ...temperament, territorial: 5 },
      { run: () => undefined, adapter: { snapshot: () => null, restore: () => undefined } }, () => undefined);
    expect(body.motionConstraint).toBe(previous);
    policy.install?.(); expect(body.motionConstraint).not.toBe(previous);
    body.impulse(new Vector3(30, 0, 30));
    for (let i = 0; i < 120; i++) {
      sim.host.step(); expect(body.position.x).toBeLessThanOrEqual(0.001);
      expect(Math.hypot(body.position.x, body.position.z)).toBeLessThanOrEqual(5.001);
    }
    expect(sampled).toBeGreaterThan(0);
  } finally { sim.host.dispose(); }
  expect(body.motionConstraint).toBe(previous);
});

test.each(['passive', 'skittish', 'neutral'] as const)('an admitted %s hunt reacts to actual server damage', async reaction => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim = createShardfileSim(hunting(reaction), new Map(), { rapier });
  try {
    const body = sim.host.entities.get('fixture.actor');
    if (body === undefined) throw new Error('Missing fixture body');
    const player = sim.host.nearestPlayer(body.position);
    for (let i = 0; i < 180; i++) sim.host.step();
    expect(player.health.attributes.health).toBe(100);
    sim.host.combat.hit({ source: player.health, sourceTags: player.health.tags, target: body.combatActor(), amount: 1,
      point: body.position.clone(), dir: new Vector3(0, 0, 1) });
    sim.host.step(); // Damage notifications drain on the host's normal phase boundary.
    expect(body.hp).toBe(116);
    expect(body.state).toBe(reaction === 'neutral' ? 'charge' : 'flee');
    for (let i = 0; i < 240; i++) sim.host.step();
    if (reaction === 'neutral') expect(player.health.attributes.health).toBeLessThan(100);
    else expect(player.health.attributes.health).toBe(100);
  } finally { sim.host.dispose(); }
});

test('an admitted aggressive hunt reaches actual player damage and a neutral crowd can retaliate', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  for (const reaction of ['aggressive', 'neutral'] as const) {
    const sim = createShardfileSim(hunting(reaction, 4), new Map(), { rapier });
    try {
      const body = sim.host.entities.get('fixture.actor');
      if (body === undefined) throw new Error('Missing fixture body');
      const player = sim.host.nearestPlayer(body.position);
      for (let i = 0; i < 180; i++) sim.host.step();
      expect(player.health.attributes.health, reaction).toBeLessThan(100);
    } finally { sim.host.dispose(); }
  }
});

test('actual neutral server continuation resumes a provoked hunt exactly', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), shard = hunting('neutral');
  const first = createShardfileSim(shard, new Map(), { rapier }), resumed = prepareShardfileSimRestore(shard, new Map(), { rapier });
  try {
    const body = first.host.entities.get('fixture.actor');
    if (body === undefined) throw new Error('Missing fixture body');
    const player = first.host.nearestPlayer(body.position);
    first.host.combat.hit({ source: player.health, sourceTags: player.health.tags, target: body.combatActor(), amount: 1,
      point: body.position.clone(), dir: new Vector3(0, 0, 1) });
    for (let i = 0; i < 12; i++) first.host.step();
    resumed.restore(snapshotSimHost(first.host));
    for (let i = 0; i < 240; i++) { first.host.step(); resumed.host.step(); }
    expect(resumed.host.entities.get(body.entityId)?.snapshot()).toEqual(body.snapshot());
    expect(resumed.host.adapters.get('brain.fixture.actor')?.snapshot()).toEqual(first.host.adapters.get('brain.fixture.actor')?.snapshot());
    expect(resumed.host.rng.snapshot()).toEqual(first.host.rng.snapshot());
    expect(resumed.host.nearestPlayer(body.position).health.snapshot()).toEqual(player.health.snapshot());
    expect(player.health.attributes.health).toBeLessThan(100);
  } finally { resumed.host.dispose(); first.host.dispose(); }
});

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
  expect(speciesHealth('fixture', 23, 117, false)).toBe(23);
  expect(speciesHealth('fixture', undefined, 117, false)).toBe(117);
  for (const hp of [NaN, Infinity, 0, -1]) expect(() => speciesHealth('fixture', hp, undefined, false)).toThrow('fixture');
});
