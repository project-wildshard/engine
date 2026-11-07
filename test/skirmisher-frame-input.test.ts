import {expect, test} from 'vitest';
import {AnimalSim} from '../src/shared/engine/entities/AnimalSim';
import {SkirmisherBrain, type SkirmisherPorts, type SkirmisherSpec} from '../src/server/engine/ai/skirmisher';
import {CapturedSkirmisherBrain} from './fixtures/stalker-oracle/skirmisher';
import {Rng} from '../src/shared/engine/core/rng';
import {onFault, type Fault} from '../src/shared/engine/core/faults';

const spec: SkirmisherSpec = {awareRadius: 14, shyRadius: 8, disengageRadius: 24, holdRadius: 3,
  attackRadius: 2, attackDuration: .8, attackCooldown: 1.2, alertCooldown: .3, fleeSpeed: 5,
  subordinateVariant: 'small', leaderVariant: 'leader', noticeCue: 'notice'};
function fixture() {
  const actor = new AnimalSim({kind: 'hunter', label: 'Hunter', variant: 'common', rarity: 'common', hp: 30, aggressive: true,
    dims: {bodyY: 1, bodyHalfLen: 1, bodyRadius: .4, headRadius: .3, legLen: 1, feet: [], halfWidth: .4},
    mods: {speed: 1, chargeDist: 1, damageTaken: 1, chargeDamage: 20, relentless: false}},
  1, 1, 'hunter', {heightAt: () => 0, random: () => .5});
  const rng = new Rng(39), events: unknown[][] = [];
  const context: SkirmisherPorts<AnimalSim> = {dt: .1, player: {x: 0, y: 0, z: 2}, calm: false, rng, herd: null,
    sound: cue => {events.push(['sound', cue]);},
    steer: (body, yaw, speed, turnRate) => {events.push(['steer', yaw, speed, turnRate]); body.setMotion(yaw, speed, turnRate);},
    confine: () => {events.push(['confine']);}, claim: () => true, mayAttack: () => true};
  return {actor, rng, events, context};
}

test('invalid skirmish observations skip only that actor without mutation or entropy and report once', () => {
  const f = fixture(), reference = fixture(), faults: Fault[] = [], off = onFault(fault => {faults.push(fault);});
  const brain = new SkirmisherBrain(f.actor, spec), old = new CapturedSkirmisherBrain(reference.actor, spec);
  const before = f.actor.snapshot(), entropy = f.rng.snapshot();
  try {
    for (const dt of [Number.NaN, Infinity, -.1, 1.001]) {
      f.context.dt = dt;
      expect(() => brain.think(f.context)).not.toThrow();
      expect(f.actor.snapshot()).toEqual(before); expect(f.rng.snapshot()).toEqual(entropy); expect(f.events).toEqual([]);
    }
    expect(faults).toHaveLength(1); expect(faults[0]).toMatchObject({system: 'ai.skirmisher', verdict: 'retry'});
    f.context.dt = .1; brain.think(f.context); old.think(reference.context);
    expect(f.actor.snapshot()).toEqual(reference.actor.snapshot()); expect(f.rng.snapshot()).toEqual(reference.rng.snapshot());
    expect(f.events).toEqual(reference.events);
    expect(() => new SkirmisherBrain(f.actor, {...spec, attackDuration: 0})).toThrow('parameters');
  } finally {off();}
});

test('healthy observations retain every captured native actor, callback and RNG result', () => {
  const f = fixture(), reference = fixture();
  const brain = new SkirmisherBrain(f.actor, spec), old = new CapturedSkirmisherBrain(reference.actor, spec);
  const steps = [0, 1 / 60, .03, .5, 1];
  for (let frame = 0; frame < 120; frame++) {
    const dt = steps[frame % steps.length]; if (dt === undefined) throw new Error('Missing native frame');
    for (const item of [f, reference]) {
      item.context.dt = dt; item.context.calm = frame % 17 < 3;
      item.context.player.x = frame % 23; item.context.player.z = frame % 11;
    }
    brain.think(f.context); old.think(reference.context);
    f.actor.step(dt); reference.actor.step(dt);
    expect(f.actor.snapshot()).toEqual(reference.actor.snapshot());
    expect(f.rng.snapshot()).toEqual(reference.rng.snapshot()); expect(f.events).toEqual(reference.events);
  }
});
