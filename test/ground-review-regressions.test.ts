import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import { parseRows } from '@wildshard/format/rows';
import { CreaturesSchema } from '@wildshard/format/creatures';
import { parse } from 'valibot';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { groundFixture } from './fixtures/plain-ground';

type Family = 'skirmisher' | 'guardian';
function fixture(family: Family, neutral = false, pack = false) {
  const shard = groundFixture(true), row = shard.rows.species[0], spawn = shard.creatures.spawns[0];
  if (row?.temperament === undefined || spawn === undefined) throw new Error('Missing actual fixture');
  row.temperament = { ...row.temperament, brain: family, reaction: neutral ? 'neutral' : 'aggressive', pack, assist: 14,
    ...(family === 'guardian' ? { tuning: { thinkDivisor: 3, wakeRadius: 14, guardRadius: 45, approachRadius: 30, swingRadius: 2,
      swingDuration: 0.8, speed: 3, holdRadius: 3, sideSpeed: 1, sideFlipSeconds: 1, sinkAfterSeconds: 1,
      cooldownSeconds: 1, hideOffset: -2.3, noticeCue: 'notice' } } : {}) };
  spawn.at = [0, 0, 0]; spawn.yaw = 0; spawn.respawn = 1; spawn.group = 'crew'; shard.spawn.z = 8;
  shard.rows = parseRows(shard.rows);
  if (pack) shard.creatures = parse(CreaturesSchema, { ...shard.creatures, spawns: [spawn, { ...spawn, id: 'friend', at: [10, 0, 0] }] });
  return shard;
}
type Simulation = ReturnType<typeof createShardfileSim>;
function actors(sim: Simulation) {
  const body = sim.host.entities.get('fixture.actor');
  if (body === undefined) throw new Error('Missing actual actor');
  return { body, player: sim.host.nearestPlayer(body.position) };
}
function steps(sim: Simulation, count: number) { for (let i = 0; i < count; i++) sim.host.step(); }
function until(sim: Simulation, done: () => boolean, limit = 1200) {
  for (let i = 0; i < limit; i++) { sim.host.step(); if (done()) return; }
  throw new Error('Expected actual review control was not reached');
}
function hit(sim: Simulation, target = actors(sim).body, amount = 1) {
  sim.host.combat.hit({ source: actors(sim).player.health, sourceTags: ['test.hit'], target: target.combatActor(), amount,
    point: target.position.clone(), dir: new Vector3() });
}

test('same-player hits preserve an already active native guardian swing', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim = createShardfileSim(fixture('guardian'), new Map(), { rapier });
  try {
    const { body, player } = actors(sim); until(sim, () => body.attackPhase > 0 && body.attackPhase < 0.1);
    let phase = body.attackPhase; hit(sim);
    for (let i = 0; i < 12; i++) { steps(sim, 1); expect(body.attackPhase).toBeGreaterThan(phase); phase = body.attackPhase; }
    until(sim, () => player.health.attributes.health < 100, 60); expect(player.health.attributes.health).toBe(93);
  } finally { sim.host.dispose(); }
});

test.each(['skirmisher', 'guardian'] as const)('%s same-target pack assistance preserves an active swing', async family => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim = createShardfileSim(fixture(family, false, true), new Map(), { rapier });
  try {
    const { body, player } = actors(sim), friend = sim.host.entities.get('friend');
    if (friend === undefined) throw new Error('Missing actual packmate');
    sim.host.events.answer('ai.claim', candidate => candidate === body, sim.host.scope);
    sim.host.events.answer('ai.mayAttack', candidate => candidate === body, sim.host.scope);
    until(sim, () => body.attackPhase > 0 && body.attackPhase < 0.1);
    let phase = body.attackPhase; hit(sim, friend);
    for (let i = 0; i < 12; i++) { steps(sim, 1); expect(body.attackPhase).toBeGreaterThan(phase); phase = body.attackPhase; }
    until(sim, () => player.health.attributes.health < 100, 60); expect(player.health.attributes.health).toBe(93);
  } finally { sim.host.dispose(); }
});

test.each([['skirmisher', 'pending'], ['guardian', 'pending'], ['skirmisher', 'active'], ['guardian', 'active']] as const)('%s neutral %s provocation clears on respawn', async (family, phase) => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim = createShardfileSim(fixture(family, true), new Map(), { rapier });
  try {
    const { body, player } = actors(sim); steps(sim, 12); hit(sim); steps(sim, 1);
    if (phase === 'active') until(sim, () => body.attackPhase > 0 && body.attackPhase < 0.1);
    hit(sim, body, body.maxHp + 1);
    expect(body.alive).toBe(false); until(sim, () => body.alive, 120);
    steps(sim, 600); expect(player.health.attributes.health).toBe(100); expect(body.attackPhase).toBe(-1);
    hit(sim); until(sim, () => player.health.attributes.health < 100);
    expect(player.health.attributes.health).toBe(93);
  } finally { sim.host.dispose(); }
});

test.each(['skirmisher', 'guardian'] as const)('%s true retarget cancels a swing and keeps native recovery', async family => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim = createShardfileSim(fixture(family, true), new Map(), { rapier });
  try {
    const { body, player } = actors(sim); steps(sim, 12); hit(sim);
    until(sim, () => body.attackPhase > 0 && body.attackPhase < 0.1);
    const peer = sim.host.addPlayer('new.provoker', { x: body.position.x, y: 0, z: body.position.z + 1.5 });
    sim.host.combat.hit({ source: peer.health, sourceTags: ['test.hit'], target: body.combatActor(), amount: 1,
      point: body.position.clone(), dir: new Vector3() });
    steps(sim, 3); expect(body.attackPhase).toBe(-1);
    steps(sim, 40); expect(body.attackPhase).toBe(-1); expect(player.health.attributes.health).toBe(100);
    expect(peer.health.attributes.health).toBe(100);
    until(sim, () => peer.health.attributes.health < 100, 300); expect(peer.health.attributes.health).toBe(93);
  } finally { sim.host.dispose(); }
});
