import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import { parseRows } from '@wildshard/format/rows';
import { CreaturesSchema } from '@wildshard/format/creatures';
import { parse } from 'valibot';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { createShardfileSim, prepareShardfileSimRestore } from '../src/server/game/plugin/simulation';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { groundFixture } from './fixtures/plain-ground';

type Reaction = 'passive' | 'skittish' | 'neutral' | 'aggressive';
function fixture(reaction: Reaction, modifiers: Record<string, unknown> = {}) {
  const shard = groundFixture(true), row = shard.rows.species[0];
  if (row?.temperament === undefined) throw new Error('Missing actual temperament');
  row.temperament = { ...row.temperament, reaction, leash: 45, assist: 14, ...modifiers };
  shard.rows = parseRows(shard.rows);
  const spawn = shard.creatures.spawns[0];
  if (spawn === undefined) throw new Error('Missing actual spawn');
  spawn.at = [0, 0, 0]; spawn.yaw = 0; shard.spawn.z = 8;
  return shard;
}
type Simulation = { host: ReturnType<typeof createShardfileSim>['host'] };
function actors(sim: Simulation) {
  const body = sim.host.entities.get('fixture.actor');
  if (body === undefined) throw new Error('Missing actual actor');
  return { body, player: sim.host.nearestPlayer(body.position) };
}
function move(sim: Simulation, z: number) { const { player } = actors(sim); player.position.set(0, 0, z); player.motor?.resetAt(player.position); }
function steps(sim: Simulation, count: number) { for (let i = 0; i < count; i++) sim.host.step(); }
function until(sim: Simulation, done: () => boolean, count = 1200) {
  for (let i = 0; i < count; i++) { sim.host.step(); if (done()) return; }
  throw new Error('Expected actual creature behavior was not reached');
}
function hit(sim: Simulation, source = actors(sim).player) {
  const { body } = actors(sim);
  sim.host.combat.hit({ source: source.health, sourceTags: ['test.hit'], target: body.combatActor(), amount: 1,
    point: body.position.clone(), dir: new Vector3() });
}

test.each(['passive', 'skittish'] as const)('plain skirmisher %s cannot attack before or after real damage', async reaction => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim = createShardfileSim(fixture(reaction), new Map(), { rapier });
  try {
    const { body, player } = actors(sim); steps(sim, 180);
    expect(player.health.attributes.health).toBe(100);
    if (reaction === 'skittish') expect(body.state).toBe('flee');
    hit(sim); steps(sim, 6); expect(body.state).toBe('flee');
    steps(sim, 300); expect(player.health.attributes.health).toBe(100); expect(body.attackPhase).toBe(-1);
  } finally { sim.host.dispose(); }
});

test('plain neutral skirmisher notices without attacking, then retaliates on the real player', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim = createShardfileSim(fixture('neutral'), new Map(), { rapier });
  try {
    const { body, player } = actors(sim); steps(sim, 180);
    expect(player.health.attributes.health).toBe(100); expect(body.attackPhase).toBe(-1);
    hit(sim); until(sim, () => player.health.attributes.health < 100);
    expect(player.health.attributes.health).toBe(93);
  } finally { sim.host.dispose(); }
});

test('plain skirmisher cancels an active strike when low health forces flight', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim = createShardfileSim(fixture('aggressive', { flee: 0.2 }), new Map(), { rapier });
  try {
    const { body, player } = actors(sim); until(sim, () => body.attackPhase >= 0 && body.attackPhase < 0.1);
    body.hp = 20; steps(sim, 1); expect(body.state).toBe('flee'); expect(body.attackPhase).toBe(-1);
    steps(sim, 60); expect(player.health.attributes.health).toBe(100);
  } finally { sim.host.dispose(); }
});

test('plain skirmisher returns from outside 45m, heals and rearms without replaying an old hit', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim = createShardfileSim(fixture('neutral'), new Map(), { rapier });
  try {
    const { body, player } = actors(sim); steps(sim, 12); hit(sim); steps(sim, 6);
    const oldHit = body.lastHitT; body.mem['foreign.pose'] = 17;
    body.position.set(0, 0, 47); body.motor?.resetAt?.(body.position); move(sim, 50);
    until(sim, () => body.hp === body.maxHp, 2400);
    expect(Math.hypot(body.position.x, body.position.z)).toBeLessThan(1.1);
    expect(body.lastHitT).toBe(oldHit); expect(body.mem['foreign.pose']).toBe(17);
    move(sim, 8); steps(sim, 180); expect(body.attackPhase).toBe(-1); expect(player.health.attributes.health).toBe(100);
    hit(sim); until(sim, () => player.health.attributes.health < 100);
  } finally { sim.host.dispose(); }
});

test('plain skirmisher territory limits body motion and an actual impulse to 5m', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim = createShardfileSim(fixture('aggressive', { territorial: 5 }), new Map(), { rapier });
  try {
    const { body } = actors(sim); body.impulse(new Vector3(0, 0, 100));
    for (let i = 0; i < 180; i++) { sim.host.step(); expect(Math.hypot(body.position.x, body.position.z)).toBeLessThanOrEqual(5.00001); }
  } finally { sim.host.dispose(); }
});

test.each([14, 20])('plain neutral skirmisher pack assistance respects actual group and radius %sm', async separation => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), shard = fixture('neutral', { pack: true });
  const spawn = shard.creatures.spawns[0];
  if (spawn === undefined) throw new Error('Missing actual spawn');
  spawn.group = 'crew';
  shard.creatures = parse(CreaturesSchema, { ...shard.creatures, spawns: [spawn,
    { ...spawn, id: 'fixture.friend', at: [separation, 0, 0] }, { ...spawn, id: 'fixture.other', group: 'other', at: [1, 0, 0] }] });
  const sim = createShardfileSim(shard, new Map(), { rapier });
  try {
    const { body, player } = actors(sim), friend = sim.host.entities.get('fixture.friend'), other = sim.host.entities.get('fixture.other');
    if (friend === undefined || other === undefined) throw new Error('Missing actual group bodies');
    steps(sim, 12); hit(sim); steps(sim, 3);
    expect(body.mem['st']).not.toBe(0);
    if (separation === 14) expect(friend.mem['st']).not.toBe(0); else expect(friend.mem['st']).toBe(0);
    expect(other.mem['st']).toBe(0); expect(player.health.attributes.health).toBe(100);
  } finally { sim.host.dispose(); }
});

test('a dead neutral skirmisher provoker cannot transfer its active strike to a closer player', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim = createShardfileSim(fixture('neutral'), new Map(), { rapier });
  try {
    const { body, player } = actors(sim); steps(sim, 12); hit(sim);
    until(sim, () => body.attackPhase >= 0 && body.attackPhase < 0.1);
    const peer = sim.host.addPlayer('peer', { x: body.position.x, y: body.position.y, z: body.position.z + 1.5 });
    player.health.attributes.health = 0;
    steps(sim, 18); expect(peer.health.attributes.health).toBe(100); expect(body.attackPhase).toBe(-1);
  } finally { sim.host.dispose(); }
});

test.each(['pending', 'attack'])('plain skirmisher %s restores body, target, health and RNG exactly', async phase => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), shard = fixture('neutral');
  const sim = createShardfileSim(shard, new Map(), { rapier }), resumed = prepareShardfileSimRestore(shard, new Map(), { rapier });
  try {
    steps(sim, 12); hit(sim);
    if (phase === 'attack') until(sim, () => actors(sim).body.attackPhase > 0 && actors(sim).body.attackPhase < 0.1);
    const saved = snapshotSimHost(sim.host);
    resumed.restore(saved);
    steps(sim, 420); steps(resumed, 420);
    expect(actors(resumed).body.snapshot()).toEqual(actors(sim).body.snapshot());
    expect(actors(resumed).player.health.snapshot()).toEqual(actors(sim).player.health.snapshot());
    expect(resumed.host.adapters.get('brain.fixture.actor')?.snapshot()).toEqual(sim.host.adapters.get('brain.fixture.actor')?.snapshot());
    expect(resumed.host.rng.snapshot()).toEqual(sim.host.rng.snapshot());
  } finally { sim.host.dispose(); resumed.host.dispose(); }
});

test('plain neutral skirmisher distinguishes notice from actual crowd provocation', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim = createShardfileSim(fixture('neutral'), new Map(), { rapier });
  try {
    const { body, player } = actors(sim); move(sim, 1.2); steps(sim, 12);
    expect(body.attackPhase).toBe(-1); expect(player.health.attributes.health).toBe(100);
    move(sim, 0.5); until(sim, () => player.health.attributes.health < 100);
    expect(player.health.attributes.health).toBe(93);
  } finally { sim.host.dispose(); }
});

test('plain ambushing skirmisher stays concealed until notice, then reveals and attacks', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim = createShardfileSim(fixture('aggressive', { ambush: true }), new Map(), { rapier });
  try {
    const { body, player } = actors(sim); move(sim, 20); steps(sim, 60);
    expect(body.state).toBe('hide'); expect(body.attackPhase).toBe(-1);
    move(sim, 8); steps(sim, 6); expect(body.state).not.toBe('hide');
    until(sim, () => player.health.attributes.health < 100); expect(player.health.attributes.health).toBe(93);
  } finally { sim.host.dispose(); }
});
