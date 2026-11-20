import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { AnimalSim } from '../src/shared/engine/entities/AnimalSim';
import { StalkerBrain } from '../src/shared/engine/ai/stalker';
import { Rng } from '@wildshard/format/seededRng';
import type { HuntGround, HuntHerd } from '../src/shared/engine/ai/huntPattern';
import { FIXTURE_HUNT_TUNING } from './fixtures/hunt-tuning';

// OF23c: a declared body keeps AnimalSim's `herd = 0` and a layer hunt rolls no herds of its own, so its herd comes from
// the `herdOf` port. Pine's den bears ignored it and wandered a random walk out onto the trail.
test('a declared body with herd 0 wanders inside the herd its herdOf port gives', () => {
  const body = new AnimalSim({ kind: 'fixture.bear', label: 'Bear', variant: 'plain', rarity: 'common', hp: 60, aggressive: true,
    dims: { bodyY: 1, bodyHalfLen: 0.5, bodyRadius: 0.3, headRadius: 0.3, legLen: 0.5, feet: [], halfWidth: 0.4 },
    mods: { speed: 1, chargeDist: 1, damageTaken: 1, chargeDamage: 12, relentless: false } },
  1, 1, 'fixture.actor', { heightAt: () => 0, random: () => 0.5 });
  expect(body.herd).toBe(0);
  const herd = { kind: 'fixture.bear', cx: 0, cz: 0, members: [body] } as HuntHerd<AnimalSim>;
  const player = new Vector3(200, 0, 200), rng = new Rng(11);
  const ground: HuntGround = { heightAt: () => 0, normalY: () => 1, inChunk: () => true, trailDistance: () => Infinity,
    cabinMask: () => 0, streamAt: () => null, waterLevel: () => -Infinity, pond: () => null, sea: () => false,
    wetAt: () => false, trees: () => [], treeless: () => true, terrain: () => true, chunkHalf: 250 };
  let asked = 0;
  const brain = new StalkerBrain<AnimalSim>({ pattern: 'hunt', player, sampleTerrain: () => undefined,
    config: { rng, fight: {}, faunaTuning: () => undefined,
      species: () => ({ aggressive: true, tuning: FIXTURE_HUNT_TUNING, chargeWindup: 0, notice: 9, reaction: 'aggressive' }) },
    ports: { ground, nav: () => null, reach: () => true, wanderGoal: () => null, unaware: () => true,
      herdOf: () => { asked++; return herd; },
      now: () => 0, sound: () => undefined, charge: () => undefined } });
  brain.adopt(body, 0, 0);
  const cadence = brain.bindRoster({ limit: 1, order: 'combined', at: () => body, actor: a => a, id: a => a.entityId,
    player, noise: { seen: false, prev: new Vector3(), speed: 0 }, sight: [false], reach: () => true, brainDt: () => 0.1 });
  const memory = brain.memory(body);
  if (memory === undefined) throw new Error('Missing hunt memory');
  let wanders = 0;
  for (let i = 0; i < 4000; i++) {
    brain.beginTick(0.1); cadence.observe(0.1); cadence.decide();
    if (body.state === 'wander') { wanders++; expect(Math.hypot(memory.tx - herd.cx, memory.tz - herd.cz)).toBeLessThanOrEqual(15); }
  }
  expect(asked).toBeGreaterThan(0);
  expect(wanders).toBeGreaterThan(0);
});
