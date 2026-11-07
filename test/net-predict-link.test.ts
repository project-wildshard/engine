// @vitest-environment happy-dom
import { beforeAll, expect, test } from 'vitest';
import type { Rapier } from '../src/shared/engine/physics/rapier';
import { loadCourseRapier, type MotionScenario } from './fixtures/motion-trace/parity';
import { wirePlay } from './fixtures/motion-trace/wirePlay';

// P1-E5.3-I3: a bad link, E5-REPLICATION §9: 150 ms RTT, ±30 ms, 2 % loss, 1 % reorder. A wrapper is one way, so each end takes half.
let R: Rapier;
beforeAll(async () => { R = await loadCourseRapier(); });

const EAST = -Math.PI / 2;
const seeded = (seed: number): (() => number) => { let a = seed; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const link = (seed: number) => ({ latencyMs: 75, jitterMs: 15, lossPct: 2, reorderPct: 1, random: seeded(seed) });
const walk: MotionScenario = { id: 'link-walk', start: { x: -10, z: 0, yaw: EAST }, ticks: 0, intent: () => ({}) };

test('a walk over a bad link: lost commands cost nothing, the feet agree', () => {
  const run = wirePlay(R, walk, { seconds: 8, frameMs: () => 1000 / 30, link: link(11), press: (frame, page) => {
    if (frame === 0) page.player.keys.add('KeyW');
    if (frame % 60 === 30) page.player.touchJump = true;
  } });
  expect(run.steps).toBe(run.sent); // a bundle carries four older commands: 2 % loss reaches no command
  expect(run.corrections).toBeLessThan(4);
  expect(run.feetGap).toBeLessThan(.02);
});

test('a server shove reconverges inside the glide', () => {
  const run = wirePlay(R, walk, { seconds: 4, frameMs: () => 1000 / 60, link: link(12), press: (frame, page, host) => {
    if (frame === 0) page.player.keys.add('KeyW');
    if (frame === 90) host.player.knockBack(host.player.position.x, host.player.position.z - 1, 6);
  } });
  expect(run.corrections).toBeGreaterThanOrEqual(1);
  expect(run.corrections).toBeLessThan(40);
  expect(run.feetGap).toBeLessThan(.02);
});
