// @vitest-environment happy-dom
// oxlint-disable-next-line import/no-nodejs-modules -- Drive the pinned Far Reach collision through the real delayed link.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { addBakedPieces } from '../src/server/game/plugin/simulation';
import { NetPlayer } from '../src/client/engine/net/netPlayer';
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
  let shoves = 0;
  const run = wirePlay(R, walk, { seconds: 4, frameMs: () => 1000 / 60, link: link(12), press: (frame, page, host) => {
    if (frame === 0) page.player.keys.add('KeyW');
    if (frame === 90) host.player.knockBack(host.player.position.x, host.player.position.z - 1, 6);
    if (page.player.link instanceof NetPlayer) shoves = page.player.link.predictor.authoritative.shoves;
  } });
  expect(shoves).toBe(1);
  expect(run.corrections).toBe(0);
  expect(run.feetGap).toBeLessThan(.02);
});

// NL13: a constant 180 ms link on a clear, static route is the control for
// Sky Reach's browser misses. This route avoids the course's steps and decks.
test.each([30, 60])('a fixed 180 ms link at %i fps introduces no clear-ground corrections', fps => {
  const clear: MotionScenario = {id: 'fixed-link-clear', start: {x: 20, z: 0, yaw: 0}, ticks: 0, intent: () => ({})};
  const run = wirePlay(R, clear, {seconds: 20, frameMs: () => 1000 / fps,
    link: {latencyMs: 90, jitterMs: 0, lossPct: 0, reorderPct: 0, random: () => 0.5},
    press: (frame, page) => {if (frame === 0) page.player.keys.add('KeyW');}});
  expect(run.steps).toBe(run.sent);
  expect(run.corrections).toBe(0);
  expect(run.feetGap).toBeLessThan(.02);
});

test.each([30, 60])('live device input at %i fps stays aligned across a fixed 180 ms link', fps => {
  const clear: MotionScenario = {id: 'fixed-link-live', start: {x: 20, z: 0, yaw: 0}, ticks: 0, intent: () => ({})};
  const run = wirePlay(R, clear, {seconds: 20, frameMs: () => 1000 / fps, liveDevice: true,
    link: {latencyMs: 90, jitterMs: 0, lossPct: 0, reorderPct: 0, random: () => 0.5},
    press: (frame, page) => {if (frame === 0) page.player.keys.add('KeyW');}});
  expect(run.steps).toBe(run.sent);
  expect(run.corrections).toBe(0);
  expect(run.feetGap).toBeLessThan(.02);
});


// NL13b2: the same walk/sprint window as net-lag-proof, including side presses.
test.each([[30, false], [60, false], [30, true], [60, true]] as const)('static Far Reach stays within B2 at 180 ms and %i fps (reverse order: %s)', (fps, reverse) => {
  const baked = JSON.parse(readFileSync('out/far-reach/sections/sim/runtime-plan.json', 'utf8')) as { baked: { pieces: { readonly colliders: readonly unknown[] }[] } };
  const pieces = baked.baked.pieces;
  const room = reverse ? [...pieces].reverse().map(piece => ({ ...piece, colliders: [...piece.colliders].reverse() })) : pieces;
  let baseline = 0;
  const run = wirePlay(R, { id: 'far-static-foot', start: { x: 0, y: 30.02, z: -5.5, yaw: 0 }, ticks: 0, intent: () => ({}) }, {
    seconds: 47.4, frameMs: () => 1000 / fps, liveDevice: true,
    link: { latencyMs: 90, jitterMs: 0, lossPct: 0, reorderPct: 0, random: () => .5 },
    press: (frame, page, host) => {
      if (frame === 0) { addBakedPieces(page.physics, pieces); addBakedPieces(host.host.physics, room); }
      if (frame === fps * 5) {
        if (!(page.player.link instanceof NetPlayer)) throw new Error('Missing real NetPlayer');
        baseline = page.player.link.predictor.corrections; page.player.keys.add('KeyW');
      }
      const moving = frame / fps - 5, phase = moving < 21.2 ? 0 : 1, elapsed = moving - phase * 21.2;
      if (moving >= 21.2) page.player.keys.add('ShiftLeft');
      const turn = [3, 8.3, 13.6, 18.9].findIndex(start => elapsed >= start && elapsed < start + .3);
      page.player.keys.delete('KeyA'); page.player.keys.delete('KeyD');
      if (moving >= 0 && turn >= 0) page.player.keys.add(turn % 2 === 0 ? 'KeyA' : 'KeyD');
    },
  });
  expect(run.steps).toBe(run.sent);
  expect((run.corrections - baseline) * 60 / 42.4).toBeLessThanOrEqual(2);
  expect(run.offset).toBeLessThanOrEqual(.1);
  expect(run.feetGap).toBeLessThan(.02);
});
