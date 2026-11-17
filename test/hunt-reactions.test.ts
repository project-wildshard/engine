import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { AnimalSim } from '../src/shared/engine/entities/AnimalSim';
import { StalkerBrain } from '../src/shared/engine/ai/stalker';
import { Rng } from '../src/shared/engine/core/rng';
import { huntMemoryCodec, type HuntGround, type HuntTuning } from '../src/shared/engine/ai/huntPattern';
import { FIXTURE_HUNT_TUNING } from './fixtures/hunt-tuning';

function fixture(reaction: 'passive' | 'skittish' | 'neutral' | undefined, stalk: boolean, telegraphed = false) {
  const body = new AnimalSim({ kind: 'fixture.hunter', label: 'Hunter', variant: 'plain', rarity: 'common', hp: 60, aggressive: reaction !== 'neutral',
    dims: { bodyY: 1, bodyHalfLen: 0.5, bodyRadius: 0.3, headRadius: 0.3, legLen: 0.5, feet: [], halfWidth: 0.4 },
    mods: { speed: 1, chargeDist: 1, damageTaken: 1, chargeDamage: 12, relentless: false } },
  1, 1, 'fixture.actor', { heightAt: () => 0, random: () => 0.5 });
  const tuning: HuntTuning = { ...FIXTURE_HUNT_TUNING, freezeMin: 0, freezeMax: 0,
    ...(stalk ? { stalk: { detect: 30, speed: 3, giveUp: 45, rechargeCd: 1, huffMin: 2, huffMax: 3,
      roar: '', fleeBelowHp: 0.2, fleeChance: 0.5 } } : {}) };
  const player = new Vector3(0, 0, 1), hits: number[] = [], rng = new Rng(7);
  const ground: HuntGround = { heightAt: () => 0, normalY: () => 1, inChunk: () => true, trailDistance: () => Infinity,
    cabinMask: () => 0, streamAt: () => null, waterLevel: () => -Infinity, pond: () => null, sea: () => false,
    wetAt: () => false, trees: () => [], treeless: () => true, terrain: () => true, chunkHalf: 250 };
  const brain = new StalkerBrain<AnimalSim>({ pattern: 'hunt', player, sampleTerrain: () => undefined,
    config: { rng, fight: { telegraphed }, faunaTuning: () => undefined,
      species: () => ({ aggressive: reaction !== 'neutral', tuning, chargeWindup: 0, notice: 9, ...(reaction === undefined ? {} : { reaction }) }) },
    ports: { ground, nav: () => null, reach: () => true, wanderGoal: () => null, unaware: () => false,
      now: () => 0, sound: () => undefined, charge: (_body, damage) => { hits.push(damage); } } });
  brain.adopt(body, 0, 0);
  const cadence = brain.bindRoster({ limit: 1, order: 'combined', at: () => body, actor: a => a, id: a => a.entityId,
    player, noise: { seen: false, prev: new Vector3(), speed: 0 }, sight: [true], reach: () => true, brainDt: () => 0.1 });
  const step = (): void => {
    brain.beginTick(0.1); cadence.observe(0.1); cadence.decide();
    if (body.state === 'charge') { brain.advanceCharge(body, 0.1, player); if (telegraphed) brain.chargeContact(body, player); }
  };
  const hit = (): void => { const killed = body.applyFinalDamage(1, body.position, new Vector3(0, 0, -1)); cadence.damaged(body.combatActor(), killed); };
  return { body, brain, player, hits, step, hit, rng };
}

test.each([false, true])('passive never initiates or retaliates, including stalk=%s', stalk => {
  const f = fixture('passive', stalk);
  for (let i = 0; i < 100; i++) { f.step(); expect(f.body.state).not.toBe('charge'); expect(f.body.state).not.toBe('stalk'); }
  f.hit();
  expect(f.body.hp).toBe(59); expect(f.body.state).toBe('flee');
  for (let i = 0; i < 100; i++) f.step();
  expect(f.hits).toEqual([]);
});

test('passive cannot pursue from the alert freeze or contact from a restored charge', () => {
  const f = fixture('passive', true, true), memory = f.brain.memory(f.body);
  if (memory === undefined) throw new Error('Missing hunt memory');
  f.player.z = 8; f.body.state = 'alert'; memory.freeze = 0; memory.awareness = 1;
  f.step(); expect(f.body.state).toBe('flee');
  f.player.z = 1; f.body.state = 'charge'; memory.windup = 0;
  f.brain.chargeContact(f.body, f.player);
  expect(f.hits).toEqual([]); expect(f.body.state).toBe('flee');
});

test.each([false, true])('omitted reaction retains the original hunter contact, stalk=%s', stalk => {
  const f = fixture(undefined, stalk);
  f.step(); expect(f.hits).toEqual([12]);
  expect(f.body.state).toBe(stalk ? 'stalk' : 'flee');
});

test.each([false, true])('skittish bolts at its authored notice radius without striking, stalk=%s', stalk => {
  const f = fixture('skittish', stalk);
  f.player.z = 9.1;
  for (let i = 0; i < 60; i++) { f.step(); expect(f.body.state).not.toBe('flee'); }
  f.player.z = 8.9; f.step(); expect(f.body.state).toBe('flee');
  f.player.z = 1;
  for (let i = 0; i < 100; i++) f.step();
  f.hit(); expect(f.body.state).toBe('flee');
  for (let i = 0; i < 100; i++) f.step();
  expect(f.hits).toEqual([]);
});

test.each([false, true])('neutral notices without attacking, then retaliates after a hit, stalk=%s', stalk => {
  const f = fixture('neutral', stalk);
  f.player.z = 8;
  for (let i = 0; i < 100; i++) { f.step(); expect(f.body.state).not.toBe('charge'); expect(f.body.state).not.toBe('stalk'); }
  expect(f.hits).toEqual([]);
  f.hit(); expect(f.body.hp).toBe(59); expect(f.body.state).toBe('charge');
  f.player.z = 1; f.step(); expect(f.hits).toEqual([12]);
});

test.each([false, true])('neutral retaliates inside its authored crowd distance, stalk=%s', stalk => {
  const f = fixture('neutral', stalk);
  f.player.z = 6.1;
  for (let i = 0; i < 100; i++) f.step();
  expect(f.hits).toEqual([]); expect(f.body.state).not.toBe('stalk');
  f.player.z = 5.9; f.step(); expect(f.body.state).toBe('charge');
  f.player.z = 1; f.step(); expect(f.hits).toEqual([12]);
});

test('neutral provocation survives its owned continuation without extending legacy memory', () => {
  const f = fixture('neutral', true), legacy = fixture(undefined, true), resumed = fixture('neutral', true);
  f.player.z = 8; f.hit();
  const memory = f.brain.memory(f.body), old = legacy.brain.memory(legacy.body), restored = resumed.brain.memory(resumed.body);
  if (memory === undefined || old === undefined || restored === undefined) throw new Error('Missing hunt memory');
  const saved = huntMemoryCodec.save(memory);
  expect(saved['provoked']).toBe(true); expect(Object.hasOwn(huntMemoryCodec.save(old), 'provoked')).toBe(false);
  huntMemoryCodec.restore(restored, saved); resumed.body.restore(f.body.snapshot()); resumed.rng.restore(f.rng.snapshot());
  resumed.player.copy(f.player);
  for (let i = 0; i < 30; i++) { f.step(); resumed.step(); }
  expect(resumed.body.snapshot()).toEqual(f.body.snapshot());
  expect(huntMemoryCodec.save(restored)).toEqual(huntMemoryCodec.save(memory));
  expect(resumed.rng.snapshot()).toEqual(f.rng.snapshot());
});
