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
  row.temperament = { ...row.temperament, brain: 'guardian', reaction, leash: 45, assist: 14,
    tuning: { thinkDivisor: 3, wakeRadius: 14, guardRadius: 45, approachRadius: 30, swingRadius: 2,
      swingDuration: 0.8, speed: 3, holdRadius: 3, sideSpeed: 1, sideFlipSeconds: 1, sinkAfterSeconds: 1,
      cooldownSeconds: 1, hideOffset: -2.3, noticeCue: 'notice' }, ...modifiers };
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
  const { body, player } = actors(sim);
  throw new Error(`Expected guardian behavior was not reached: ${JSON.stringify({ state: body.state, at: body.position, target: player.position, memory: body.mem, policy: sim.host.adapters.get('brain.fixture.actor')?.snapshot() })}`);
}
function hit(sim: Simulation, source = actors(sim).player) {
  const { body } = actors(sim);
  sim.host.combat.hit({ source: source.health, sourceTags: ['test.hit'], target: body.combatActor(), amount: 1,
    point: body.position.clone(), dir: new Vector3() });
}

test.each(['passive', 'skittish'] as const)('plain guardian %s cannot attack before or after real damage', async reaction => {
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

test('plain neutral guardian notices without attacking, then retaliates on the real player', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim = createShardfileSim(fixture('neutral'), new Map(), { rapier });
  try {
    const { body, player } = actors(sim); steps(sim, 180);
    expect(player.health.attributes.health).toBe(100); expect(body.attackPhase).toBe(-1);
    hit(sim); until(sim, () => player.health.attributes.health < 100);
    expect(player.health.attributes.health).toBe(93);
  } finally { sim.host.dispose(); }
});

test('plain guardian cancels an active strike when low health forces flight', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim = createShardfileSim(fixture('aggressive', { flee: 0.2 }), new Map(), { rapier });
  try {
    const { body, player } = actors(sim); until(sim, () => body.attackPhase >= 0 && body.attackPhase < 0.1);
    body.hp = 20; steps(sim, 1); expect(body.state).toBe('flee'); expect(body.attackPhase).toBe(-1);
    steps(sim, 60); expect(player.health.attributes.health).toBe(100);
  } finally { sim.host.dispose(); }
});

test('plain guardian returns from outside 45m, heals and rearms without replaying an old hit', async () => {
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

test('plain guardian territory limits body motion and an actual impulse to 5m', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim = createShardfileSim(fixture('aggressive', { territorial: 5 }), new Map(), { rapier });
  try {
    const { body } = actors(sim); body.impulse(new Vector3(0, 0, 100));
    for (let i = 0; i < 180; i++) { sim.host.step(); expect(Math.hypot(body.position.x, body.position.z)).toBeLessThanOrEqual(5.00001); }
  } finally { sim.host.dispose(); }
});

test.each([14, 20])('plain neutral guardian pack assistance respects actual group and radius %sm', async separation => {
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

test('a dead neutral guardian provoker cannot transfer its active strike to a closer player', async () => {
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

test.each(['pending', 'attack'])('plain guardian %s restores body, target, health and RNG exactly', async phase => {
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

test('plain neutral guardian distinguishes notice from actual crowd provocation', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim = createShardfileSim(fixture('neutral'), new Map(), { rapier });
  try {
    const { body, player } = actors(sim); move(sim, 1.2); steps(sim, 12);
    expect(body.attackPhase).toBe(-1); expect(player.health.attributes.health).toBe(100);
    move(sim, 0.5); until(sim, () => player.health.attributes.health < 100);
    expect(player.health.attributes.health).toBe(93);
  } finally { sim.host.dispose(); }
});

test('plain ambushing guardian stays concealed until notice, then reveals and attacks', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim = createShardfileSim(fixture('aggressive', { ambush: true }), new Map(), { rapier });
  try {
    const { body, player } = actors(sim); move(sim, 20); steps(sim, 60);
    expect(body.state).toBe('hide'); expect(body.attackPhase).toBe(-1);
    move(sim, 8); steps(sim, 6); expect(body.state).not.toBe('hide');
    until(sim, () => player.health.attributes.health < 100); expect(player.health.attributes.health).toBe(93);
  } finally { sim.host.dispose(); }
});

test.each(['rising', 'attack', 'sinking'])('layered guardian %s root/contact continuation remains exact', async phase => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), shard = fixture('aggressive');
  const sim = createShardfileSim(shard, new Map(), { rapier }), resumed = prepareShardfileSimRestore(shard, new Map(), { rapier });
  try {
    const { body } = actors(sim);
    if (phase === 'rising') until(sim, () => (body.mem['rise'] ?? 0) > 0.2 && body.mem['rising'] === 1);
    else {
      until(sim, () => body.mem['rise'] === 1);
      if (phase === 'attack') { move(sim, 1); until(sim, () => body.attackPhase > 0 && body.attackPhase < 0.1); }
      else { move(sim, 35); until(sim, () => body.mem['sinking'] === 1 && (body.mem['rise'] ?? 0) < 0.8); }
    }
    resumed.restore(snapshotSimHost(sim.host));
    steps(sim, 180); steps(resumed, 180);
    expect(actors(resumed).body.snapshot()).toEqual(body.snapshot());
    expect(actors(resumed).player.health.snapshot()).toEqual(actors(sim).player.health.snapshot());
    expect(resumed.host.adapters.get('brain.fixture.actor')?.snapshot()).toEqual(sim.host.adapters.get('brain.fixture.actor')?.snapshot());
    expect(resumed.host.rng.snapshot()).toEqual(sim.host.rng.snapshot());
  } finally { sim.host.dispose(); resumed.host.dispose(); }
});

test('a skittish guardian completes its real rise while the layer owns flight', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim = createShardfileSim(fixture('skittish'), new Map(), { rapier });
  try {
    const { body } = actors(sim); steps(sim, 120);
    expect(body.state).toBe('flee'); expect(body.mem['init']).toBe(1);
    expect(body.mem['rise']).toBe(1); expect(body.yOffset).toBeCloseTo(0);
  } finally { sim.host.dispose(); }
});

test('a buried guardian can finish a home return without treating root lift as leash distance', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim = createShardfileSim(fixture('neutral'), new Map(), { rapier });
  try {
    const { body } = actors(sim); move(sim, 50); steps(sim, 12);
    expect(body.state).toBe('hide'); body.hp = 50;
    body.position.set(0, body.position.y, 47); body.motor?.resetAt?.(body.position);
    until(sim, () => body.hp === body.maxHp, 2400);
    steps(sim, 12); expect(body.state).toBe('hide');
    expect(Math.hypot(body.position.x, body.position.z)).toBeLessThan(1.1);
    expect(body.yOffset).toBeCloseTo(-2.3);
  } finally { sim.host.dispose(); }
});
