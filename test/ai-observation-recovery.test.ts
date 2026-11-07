import {expect, test} from 'vitest';
import {Vector3} from 'three';
import {AnimalSim} from '../src/shared/engine/entities/AnimalSim';
import {GuardianPolicy, type GuardianProfile, type GuardianObservation} from '../src/server/engine/ai/guardianPolicy';
import {DiverBrain, type DiverProfile, type DiverObservation} from '../src/shared/engine/ai/diver';
import type {StrikeSpec} from '../src/shared/engine/ai/strikes';
import {Rng} from '../src/shared/engine/core/rng';
import {onFault, type Fault} from '../src/shared/engine/core/faults';

function owner() {
  const actor = new AnimalSim({kind: 'native', label: 'Native', variant: 'common', rarity: 'common', hp: 30, aggressive: true,
    dims: {bodyY: 1, bodyHalfLen: 1, bodyRadius: .4, headRadius: .3, legLen: 1, feet: [], halfWidth: .4},
    mods: {speed: 1, chargeDist: 1, damageTaken: 1, chargeDamage: 20, relentless: false}},
  1, 1, 'native', {heightAt: () => 0, random: () => .5});
  const effects: unknown[][] = [];
  return {actor, rng: new Rng(39), player: new Vector3(0, 0, 2), effects};
}
function guardian(kind: GuardianProfile['pattern']) {
  const f = owner(), profile: GuardianProfile = kind === 'interior'
    ? {pattern: kind, spec: {wakeRadius: 12, guardRadius: 20, approachRadius: 5, swingRadius: 2, swingDuration: 1,
      speed: 2, holdRadius: 4, sideSpeed: 1, sideFlipSeconds: 1, sinkAfterSeconds: 3, cooldownSeconds: 1,
      hideOffset: 1, noticeCue: 'notice'}}
    : {pattern: kind, spec: {throwRadius: 12, throwDuration: 1, biteRadius: 2, biteDuration: 1, underRadius: 3,
      underSeconds: 1, holdRadius: 4, runSpeed: 3, activeGroundSeconds: 4, biteCooldown: 1, throwCooldownMin: 1,
      throwCooldownMax: 3, alertCue: 'alert', noticeCue: 'notice'}};
  const shared = {dt: .1, player: f.player, calm: false, rng: f.rng, reach: () => true, claim: () => true,
    mayAttack: () => true, sound: (cue: string) => {f.effects.push(['sound', cue]);}};
  const context: GuardianObservation<AnimalSim> = kind === 'interior'
    ? {...shared, pattern: kind, world: {}, heightAt: () => 0}
    : {...shared, pattern: kind, attackRandom: f.rng, herd: null,
      steer: (_body, yaw, speed, turn) => {f.effects.push(['steer', yaw, speed, turn]);},
      confine: () => {f.effects.push(['confine']);}, pickPerch: () => 0,
      setPerch: (_body, index) => {f.effects.push(['perch', index]);}};
  return {...f, context, brain: new GuardianPolicy(f.actor, profile)};
}
function diver(kind: 'orbit' | 'patrol' | 'burst') {
  const f = owner(), home = {x: 0, z: 0, r: 8, y: 6};
  const strike: StrikeSpec = {id: 'native.strike', shape: {kind: 'sphere', radius: 2}, windup: .2, active: .2,
    recover: .3, cooldown: .4, range: 4, damage: 2, tags: [], weight: () => 1};
  const profile: Exclude<DiverProfile, {pattern: 'wind'}> = kind === 'burst'
    ? {pattern: kind, home, strike, spec: {circleSpeed: 3, dartSpeed: 8, noticeRadius: 12, shoveSpeed: 2, liftSpeed: 1, targetHeight: 1}}
    : kind === 'orbit'
      ? {pattern: kind, home, strike, spec: {circleSpeed: 3, hangAltitude: 6, stalkSpeed: 4, diveSpeed: 8, restSeconds: 1,
        noticeRadius: 12, giveUpRadius: 24, initialRestSeconds: .2, stalkMaxSeconds: 2, riseMargin: 1, targetHeight: 1,
        alignRadius: 3, alignTolerance: 1}}
      : {pattern: kind, home, strike, spec: {glideAltitude: 6, glideSpeed: 3, circleRadius: 8, patrolRadius: 8, patrolAltitude: 6,
        noticeRadius: 12, diveFrom: 8, diveSpeed: 8, climbAltitude: 6, climbSeconds: 1, diveMaxSeconds: 2,
        restSeconds: 1, targetHeight: 1, diveSlope: .5, climbSpeedBonus: 1, orbitLead: .2, heldField: 'held'}};
  const context: Exclude<DiverObservation<AnimalSim>, {pattern: 'wind'}> = {pattern: kind, dt: .1, player: f.player, calm: false, reach: () => true,
    claim: () => true, mayAttack: () => true, hurt: damage => {f.effects.push(['hurt', damage]);},
    shove: (yaw, speed, lift) => {f.effects.push(['shove', yaw, speed, lift]);},
    flight: {steer: (_body, yaw, speed, altitude, turn) => {f.effects.push(['flight', yaw, speed, altitude, turn]);}}};
  return {...f, context, brain: new DiverBrain(f.actor, profile)};
}

test.each(['interior', 'perch'] as const)('%s rejects bad observations locally and resumes as an untouched controller', kind => {
  const f = guardian(kind), control = guardian(kind), before = f.actor.snapshot(), entropy = f.rng.snapshot();
  const faults: Fault[] = [], off = onFault(fault => {faults.push(fault);});
  try {
    for (const dt of [Number.NaN, Infinity, -.1, 1.1]) {
      f.context.dt = dt; expect(() => f.brain.think(f.context)).not.toThrow();
      expect(f.actor.snapshot()).toEqual(before); expect(f.rng.snapshot()).toEqual(entropy); expect(f.effects).toEqual([]);
    }
    expect(faults).toHaveLength(1); expect(faults[0]).toMatchObject({system: 'ai.guardian', verdict: 'retry'});
    f.context.dt = .1; f.brain.think(f.context); control.brain.think(control.context);
    expect(f.actor.snapshot()).toEqual(control.actor.snapshot()); expect(f.rng.snapshot()).toEqual(control.rng.snapshot());
    expect(f.effects).toEqual(control.effects); expect(f.effects.length).toBeGreaterThan(0);
  } finally {off();}
});
test.each(['orbit', 'patrol', 'burst'] as const)('%s bad decisions/body frames preserve clocks and keep an independent actor running', kind => {
  const f = diver(kind), control = diver(kind), before = f.brain.snapshot(), actor = f.actor.snapshot();
  const faults: Fault[] = [], off = onFault(fault => {faults.push(fault);});
  try {
    for (const dt of [Number.NaN, Infinity, -.1, 1.1]) {
      f.context.dt = dt; expect(() => {f.brain.think(f.context); f.brain.act(f.context);}).not.toThrow();
      expect(f.brain.snapshot()).toEqual(before); expect(f.actor.snapshot()).toEqual(actor); expect(f.effects).toEqual([]);
    }
    expect(faults).toHaveLength(1); expect(faults[0]).toMatchObject({system: 'ai.diver', verdict: 'retry'});
    f.context.dt = .1; f.brain.think(f.context); f.brain.act(f.context);
    control.brain.think(control.context); control.brain.act(control.context);
    expect(f.brain.snapshot()).toEqual(control.brain.snapshot()); expect(f.actor.snapshot()).toEqual(control.actor.snapshot());
    expect(f.effects).toEqual(control.effects); expect(f.effects.some(effect => effect[0] === 'flight')).toBe(true);
  } finally {off();}
});
test('foreign guardian and diver observation families cannot read or mutate the wrong authority', () => {
  const g = guardian('interior'), other = guardian('perch'), d = diver('burst'), otherDiver = diver('patrol');
  const gb = g.actor.snapshot(), db = d.brain.snapshot(), faults: Fault[] = [], off = onFault(fault => {faults.push(fault);});
  try {
    g.brain.think(other.context); d.brain.think(otherDiver.context); d.brain.act(otherDiver.context);
    expect(g.actor.snapshot()).toEqual(gb); expect(d.brain.snapshot()).toEqual(db);
    expect([...g.effects, ...d.effects, ...other.effects, ...otherDiver.effects]).toEqual([]);
    expect(faults).toHaveLength(2); expect(faults.every(fault => fault.verdict === 'retry')).toBe(true);
  } finally {off();}
});
