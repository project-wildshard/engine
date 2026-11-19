import { readFileSync } from 'node:fs';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { dataGroundBrains } from '../src/server/game/shardfile/dataGroundBrains';
import { bindGroundTemperament } from '../src/server/game/shardfile/groundTemperament';
import { groundFixture, skirmisherTuning } from './fixtures/plain-ground';
import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { AnimalSim } from '../src/shared/engine/entities/AnimalSim';
import { Rng } from '@wildshard/format/seededRng';
import { SkirmisherBrain, type SkirmisherPorts } from '../src/server/engine/ai/skirmisher';
import { GuardianBrain, type GuardianPorts } from '../src/server/engine/ai/guardian';

function actor() {
  return new AnimalSim({ kind: 'fixture', label: 'Fixture', variant: 'plain', rarity: 'common', hp: 30, aggressive: true,
    dims: { bodyY: 1, bodyHalfLen: 0.5, bodyRadius: 0.3, headRadius: 0.3, legLen: 0.5, feet: [], halfWidth: 0.4 },
    mods: { speed: 1, chargeDist: 1, damageTaken: 1, chargeDamage: 12, relentless: false } },
  1, 9, 'fixture.actor', { heightAt: () => 0, random: () => 0.5 });
}
function owner(family: 'skirmisher' | 'guardian') {
  const body = actor(), rng = new Rng(39), common = { dt: 0.1, player: new Vector3(0, 0, 8), calm: true, rng,
    sound: () => undefined, claim: () => true, mayAttack: () => true };
  if (family === 'skirmisher') {
    const brain = new SkirmisherBrain(body, { awareRadius: 14, shyRadius: 8, disengageRadius: 45, holdRadius: 3,
      attackRadius: 2, attackDuration: 0.8, attackCooldown: 1.2, alertCooldown: 0.3, fleeSpeed: 5,
      subordinateVariant: 'small', leaderVariant: 'leader', noticeCue: 'notice' });
    const ports: SkirmisherPorts<AnimalSim> = { ...common, herd: null, confine: () => undefined,
      steer: (a, yaw, speed, turn) => { a.setMotion(yaw, speed, turn); } };
    return { body, rng, brain, think: () => { brain.think(ports); }, engage: () => { ports.calm = false; }, idle: 'idle', active: 'sidestep' };
  }
  const brain = new GuardianBrain(body, { wakeRadius: 14, guardRadius: 45, approachRadius: 30, swingRadius: 2,
    swingDuration: 0.8, speed: 3, holdRadius: 3, sideSpeed: 1, sideFlipSeconds: 1, sinkAfterSeconds: 1,
    cooldownSeconds: 1, hideOffset: -2.3, noticeCue: 'notice' });
  const ports: GuardianPorts<AnimalSim> = { ...common, world: {}, heightAt: () => 0, reach: () => true };
  return { body, rng, brain, think: () => { brain.think(ports); }, engage: () => { ports.calm = false; }, idle: 'hide', active: 'rise' };
}

test.each(['skirmisher', 'guardian'] as const)('%s reset preserves foreign memory and acknowledges old damage', family => {
  const f = owner(family); f.think();
  f.body.lastHitT = 0.5; f.think(); f.body.mem['foreign.pose'] = 17;
  const contract = f.brain.snapshot(), entropy = f.rng.snapshot(), hit = f.body.lastHitT;
  f.brain.reset();
  expect(f.body.lastHitT).toBe(hit); expect(f.rng.snapshot()).toEqual(entropy);
  expect(f.body.mem['foreign.pose']).toBe(17); expect(f.brain.snapshot()).toEqual(contract);
  f.think();
  expect(f.body.state).toBe(f.idle); expect(f.body.mem['foreign.pose']).toBe(17);
  f.engage(); expect(f.brain.provoke()).toBe(true); expect(f.body.state).toBe(f.active);
  expect(f.body.lastHitT).toBe(hit); expect(f.brain.snapshot()).toEqual(contract);
});

test.each(['skirmisher', 'guardian'] as const)('%s cannot execute an uninitialized provocation', family => {
  const f = owner(family), before = f.body.snapshot(), entropy = f.rng.snapshot();
  expect(f.brain.provoke()).toBe(false);
  expect(f.body.snapshot()).toEqual(before); expect(f.rng.snapshot()).toEqual(entropy);
});

test('pending native provocation restores without executing observation, body or RNG', async () => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim = createShardfileSim(groundFixture(), new Map(), { rapier });
  try {
    const body = sim.host.entities.get('fixture.actor');
    if (body === undefined) throw new Error('Missing actual actor');
    const player = sim.host.nearestPlayer(body.position);
    let observations = 0, bodies = 0;
    const brain = new SkirmisherBrain(body, skirmisherTuning);
    const recipe = dataGroundBrains(sim.host, groundFixture().rows, groundFixture().creatures.spawns).skirmisher?.(body, sim.host, { id: 'fixture.brain', kind: 'skirmisher', ...skirmisherTuning });
    if (recipe === undefined) throw new Error('Missing stock recipe');
    const source = bindGroundTemperament(sim.host, body, 3, brain, {
      ...recipe, observe: dt => { observations++; return recipe.observe(dt); }, body: dt => { bodies++; recipe.body(dt); }
    });
    source.provoke?.(player.id);
    const save = source.adapter.snapshot(), before = body.snapshot(), entropy = sim.host.rng.snapshot();
    source.adapter.restore(save);
    expect(body.snapshot()).toEqual(before); expect(sim.host.rng.snapshot()).toEqual(entropy);
    expect(observations).toBe(0); expect(bodies).toBe(0);
    expect(source.target()).toBe(player);
    source.run(1 / 60);
    expect(body.state).toBe('sidestep'); expect(observations).toBeGreaterThan(0); expect(bodies).toBe(0);
    expect(source.adapter.snapshot()).not.toEqual(save);
  } finally { sim.host.dispose(); }
});

test.each(['skirmisher', 'guardian'] as const)('%s stock observation and contact share the bound player', async family => {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), shard = groundFixture();
  const sim = createShardfileSim(shard, new Map(), { rapier });
  try {
    const body = sim.host.entities.get('fixture.actor');
    if (body === undefined) throw new Error('Missing actual actor');
    body.position.set(0, 0, 0); body.yaw = 0; body.mem['rise'] = 1;
    const near = sim.host.nearestPlayer(body.position), selected = sim.host.addPlayer('chosen', { x: 0, y: 0, z: 1.5 });
    near.position.set(0, 0, 0.5);
    const ports = dataGroundBrains(sim.host, shard.rows, shard.creatures.spawns);
    const recipe = family === 'skirmisher' ? ports.skirmisher?.(body, sim.host, { id: 'fixture.brain', kind: 'skirmisher', ...skirmisherTuning })
      : ports.guardian?.(body, sim.host, { id: 'fixture.brain', kind: 'guardian', thinkDivisor: 3, wakeRadius: 14, guardRadius: 45, approachRadius: 30,
        swingRadius: 2, swingDuration: 0.8, speed: 3, holdRadius: 3, sideSpeed: 1, sideFlipSeconds: 1, sinkAfterSeconds: 1, cooldownSeconds: 1, hideOffset: -2.3, noticeCue: 'notice' });
    if (recipe?.bindTarget === undefined) throw new Error('Missing target authority');
    let target: typeof selected | undefined = selected;
    recipe.bindTarget(() => target);
    expect(recipe.observe(0).player).toBe(selected.position);
    const strike = () => { body.mem['st'] = 2; body.mem['hit'] = 0; body.startAttack(0.8); body.step(0.3); recipe.body(1 / 60); };
    strike(); expect(selected.health.attributes.health).toBe(93); expect(near.health.attributes.health).toBe(100);
    target = undefined;
    expect(recipe.observe(0).calm).toBe(true);
    strike(); expect(near.health.attributes.health).toBe(100); expect(selected.health.attributes.health).toBe(93);
    target = selected; selected.health.attributes.health = 0;
    strike(); expect(near.health.attributes.health).toBe(100);
  } finally { sim.host.dispose(); }
});

test.each(['skirmisher', 'guardian'] as const)('%s unhit reset keeps serializable native memory', family => {
  const f = owner(family); f.brain.reset();
  expect(Object.values(f.body.mem).every(Number.isFinite)).toBe(true);
  f.think(); expect(f.body.state).toBe(f.idle);
});
