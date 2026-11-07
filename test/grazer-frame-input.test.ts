import {expect, test} from 'vitest';
import {Vector3} from 'three';
import {AnimalSim} from '../src/shared/engine/entities/AnimalSim';
import {GrazerBrain, type GrazerObservation, type GrazerProfile} from '../src/server/engine/ai/grazer';
import {GrazerBrain as OriginalGrazerBrain} from './fixtures/grazer-herd-original';
import type {StrikeSpec} from '../src/shared/engine/ai/strikes';
import {Rng} from '../src/shared/engine/core/rng';
import {onFault, type Fault} from '../src/shared/engine/core/faults';

function fixture(kind: 'wander-ram' | 'circle-challenge') {
  const actor = new AnimalSim({kind: 'grazer', label: 'Grazer', variant: 'common', rarity: 'common', hp: 30, aggressive: true,
    dims: {bodyY: 1, bodyHalfLen: 1, bodyRadius: .4, headRadius: .3, legLen: 1, feet: [], halfWidth: .4},
    mods: {speed: 1, chargeDist: 1, damageTaken: 1, chargeDamage: 20, relentless: false}},
  1, 1, 'grazer', {heightAt: () => 0, random: () => .5});
  const strike: StrikeSpec = {id: 'test.charge', shape: {kind: 'lane', length: 3, width: 1}, windup: .3, active: .2,
    recover: .4, cooldown: .5, range: 4, damage: 3, tags: [], weight: () => 1};
  const profile: Exclude<GrazerProfile, {pattern: 'herd'}> = kind === 'wander-ram'
    ? {pattern: kind, strike, spec: {grazeSpeed: 1, ramSpeed: 5, noticeRadius: 9, rimMargin: 2, fallDrop: 3,
      levelTolerance: 2, threatSpeed: 1, wanderMinSeconds: 1, wanderMaxSeconds: 3, rampRate: 2}}
    : {pattern: kind, charge: strike, close: {...strike, id: 'test.close', shape: {kind: 'arc', radius: 2, halfAngle: 1}},
      spec: {noticeRadius: 14, chargeRadius: 9, loseRadius: 24, walkSpeed: 1, approachSpeed: 3, homeRadius: 4,
        faceSeconds: 1, circleRate: .5, farPreferenceRadius: 8, farWeight: 2, nearWeight: 1, closeWeight: 3,
        windupField: 'windup', recoveryField: 'recovery'}};
  const rng = new Rng(39), events: unknown[][] = [];
  const shared = {dt: .1, player: new Vector3(0, 0, 2), calm: false,
    reach: () => true, claim: () => true, hurt: (damage: number) => {events.push(['hurt', damage]);}};
  const context: GrazerObservation<AnimalSim> = kind === 'wander-ram'
    ? {...shared, pattern: kind, rng, home: {x: 0, z: 0, r: 20, y: 0}}
    : {...shared, pattern: kind, t: 0, phaseOffset: .2,
      steer: (body, yaw, speed, turn) => {events.push(['steer', yaw, speed, turn]); body.setMotion(yaw, speed, turn);}};
  return {actor, profile, context, rng, events};
}

test.each(['wander-ram', 'circle-challenge'] as const)('%s skips bad clocks without state, strike or RNG changes and keeps later work alive', kind => {
  const f = fixture(kind), reference = fixture(kind), brain = new GrazerBrain(f.actor, f.profile);
  const old = new OriginalGrazerBrain(reference.actor, reference.profile), faults: Fault[] = [];
  const before = brain.snapshot(), body = f.actor.snapshot(), entropy = f.rng.snapshot(), off = onFault(fault => {faults.push(fault);});
  try {
    for (const dt of [Number.NaN, Infinity, -.1, 1.001]) {
      f.context.dt = dt;
      expect(() => {brain.think(f.context); brain.act(f.context);}).not.toThrow();
      expect(brain.snapshot()).toEqual(before); expect(f.actor.snapshot()).toEqual(body);
      expect(f.rng.snapshot()).toEqual(entropy); expect(f.events).toEqual([]);
    }
    expect(faults).toHaveLength(1); expect(faults[0]).toMatchObject({system: 'ai.grazer', verdict: 'retry'});
    f.context.dt = .1; brain.think(f.context); brain.act(f.context); old.think(reference.context); old.act(reference.context);
    expect(brain.snapshot()).toEqual(old.snapshot()); expect(f.actor.snapshot()).toEqual(reference.actor.snapshot());
    expect(f.rng.snapshot()).toEqual(reference.rng.snapshot()); expect(f.events).toEqual(reference.events);
  } finally {off();}
});

test('challenge absolute clock and phase reject before either decision or body state changes', () => {
  const f = fixture('circle-challenge'), brain = new GrazerBrain(f.actor, f.profile), faults: Fault[] = [];
  const before = brain.snapshot(), body = f.actor.snapshot(), off = onFault(fault => {faults.push(fault);});
  if (f.context.pattern !== 'circle-challenge') throw new Error('Missing circle observation');
  try {
    f.context.t = Number.NaN; brain.think(f.context); brain.act(f.context);
    f.context.t = 0; f.context.phaseOffset = Infinity; brain.think(f.context); brain.act(f.context);
    expect(brain.snapshot()).toEqual(before); expect(f.actor.snapshot()).toEqual(body); expect(f.events).toEqual([]);
    expect(faults).toHaveLength(1);
  } finally {off();}
});

test('a mismatched grazer observation is skipped before reading another pattern authority', () => {
  const f = fixture('circle-challenge'), other = fixture('wander-ram'), brain = new GrazerBrain(f.actor, f.profile);
  const before = brain.snapshot(), body = f.actor.snapshot(), faults: Fault[] = [], off = onFault(fault => {faults.push(fault);});
  try {
    expect(() => {brain.think(other.context); brain.act(other.context);}).not.toThrow();
    expect(brain.snapshot()).toEqual(before); expect(f.actor.snapshot()).toEqual(body); expect(other.events).toEqual([]);
    expect(faults).toHaveLength(1); expect(faults[0]).toMatchObject({system: 'ai.grazer', verdict: 'retry'});
  } finally {off();}
});

test.each(['wander-ram', 'circle-challenge'] as const)('%s preserves 120 independent native decision/body frames exactly', kind => {
  const f = fixture(kind), reference = fixture(kind), brain = new GrazerBrain(f.actor, f.profile);
  const old = new OriginalGrazerBrain(reference.actor, reference.profile);
  for (let frame = 0; frame < 120; frame++) {
    for (const item of [f, reference]) {
      item.context.dt = frame % 17 === 0 ? 0 : 1 / 60;
      item.context.player.set(Math.sin(frame / 15) * 4, 0, frame % 11);
      item.context.calm = frame % 23 < 2;
      if (item.context.pattern === 'circle-challenge') item.context.t = frame / 60;
    }
    brain.think(f.context); brain.act(f.context); old.think(reference.context); old.act(reference.context);
    f.actor.step(f.context.dt); reference.actor.step(reference.context.dt);
    expect(brain.snapshot()).toEqual(old.snapshot()); expect(f.actor.snapshot()).toEqual(reference.actor.snapshot());
    expect(f.rng.snapshot()).toEqual(reference.rng.snapshot()); expect(f.events).toEqual(reference.events);
  }
});
