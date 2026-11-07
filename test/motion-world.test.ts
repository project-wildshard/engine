// @vitest-environment happy-dom
import { beforeAll, expect, test } from 'vitest';
import type { PredictedRow } from '../src/client/engine/net/predictionWorld';
import type { Rapier } from '../src/shared/engine/physics/rapier';
import { linkedPlayer } from './fixtures/motion-trace/link';
import { GATE_Z, loadCourseRapier, LOW_DECK } from './fixtures/motion-trace/parity';

// P1-E5.3-C5: what the client predicts against beyond its static collision, on the real Player against the real PlayerSim.

let R: Rapier;
beforeAll(async () => { R = await loadCourseRapier(); });
const DELAY = 3, EAST = -Math.PI / 2, NORTH = Math.PI;

test('walking onto a moving deck is never corrected', () => {
  const link = linkedPlayer(R, { id: 'deck', start: { x: LOW_DECK.x - 12, z: LOW_DECK.z, yaw: EAST }, ticks: 0, intent: () => ({}) }, DELAY);
  try {
    let corrections = 0, onDeck = 0;
    for (let at = 0; at < 300; at++) {
      if (link.run().corrected) corrections++;
      if (link.player.motor.result.groundCollider?.parent()?.isKinematic() === true) onDeck++;
      if (onDeck > 60) break;
    }
    expect(onDeck).toBeGreaterThan(60); // it really stood there, carried
    expect(corrections).toBe(0);
  } finally { link.dispose(); }
});

test('a replay meets the deck where the command will', () => {
  const link = linkedPlayer(R, { id: 'deck', start: { x: LOW_DECK.x, y: LOW_DECK.top, z: LOW_DECK.z, yaw: EAST }, ticks: 0, intent: () => ({}) }, DELAY), still = { keyX: 0, keyY: 0, stickX: 0, stickY: 0 };
  try {
    for (let at = 0; at < 60; at++) link.run({ steer: still });
    link.host.player.knockBack(link.host.player.position.x, link.host.player.position.z - 1, 5); // the correction replays on the moving deck
    const corrected = link.run({ steer: still }).corrected;
    let corrections = Number(corrected);
    for (let at = 0; at < 30; at++) if (link.run({ steer: still }).corrected) corrections++;
    expect(corrections).toBeGreaterThanOrEqual(1);
    expect(corrections).toBeLessThanOrEqual(12); // it settles: no fight with the deck
    expect(Math.abs(link.player.position.x - link.host.player.position.x)).toBeLessThan(.25);
  } finally { link.dispose(); }
});

/** Walk at a body the server holds still. `lag`: how far behind its row shows it; null: the client has no row. */
const blocked = (lag: number | null): { corrections: number; glide: number } => {
  const at = { x: -10, z: 12 }, link = linkedPlayer(R, { id: 'blocked', start: { x: at.x - 5, z: at.z, yaw: EAST }, ticks: 0, intent: () => ({}), bodyAt: at }, DELAY);
  const row: PredictedRow = { handle: 7, x: at.x + (lag ?? 0), z: at.z, y: 0, alive: true, driven: false, radius: .35, height: 1.2 };
  try {
    let corrections = 0, glide = 0;
    if (lag !== null) link.world.syncRows([row], link.player.position);
    link.page.stepWorld();
    for (let tick = 0; tick < 180; tick++) {
      if (link.run().corrected) corrections++;
      glide = Math.max(glide, link.player.renderOffset.length());
      link.predictor.update(1 / 60);
    }
    return { corrections, glide };
  } finally { link.dispose(); }
};

test('a creature in the way: its capsule stops the feet, and what is left is corrected and smoothed', () => {
  const exact = blocked(0), stale = blocked(.25), blind = blocked(null);
  expect(exact.corrections).toBe(0);
  expect(stale.corrections).toBeGreaterThan(0); // a row 100 ms behind stops the feet in the wrong place,
  expect(stale.glide).toBeLessThan(blind.glide); // and the camera never sees more than a small glide
  expect(blind.corrections).toBeGreaterThan(20); // with no row at all it walks in and is put back, tick after tick
});

test('rows keep a capsule inside the physics LOD, and drop it past it or dead', () => {
  const link = linkedPlayer(R, { id: 'rows', start: { x: -10, z: 0, yaw: EAST }, ticks: 0, intent: () => ({}) }, DELAY), feet = { x: 0, z: 0 };
  try {
    const row = (x: number, alive = true, driven = false): PredictedRow => ({ handle: 1, x, y: 0, z: 0, alive, driven, radius: .35, height: 1.2 });
    link.world.syncRows([row(46)], feet); expect(link.world.capsuleCount).toBe(0);
    link.world.syncRows([row(44)], feet); expect(link.world.capsuleCount).toBe(1);
    link.world.syncRows([row(50)], feet); expect(link.world.capsuleCount).toBe(1);
    link.world.syncRows([row(56)], feet); expect(link.world.capsuleCount).toBe(0);
    link.world.syncRows([row(10)], feet); expect(link.world.capsuleCount).toBe(1);
    link.world.syncRows([row(10, false)], feet); expect(link.world.capsuleCount).toBe(0);
    link.world.syncRows([row(10)], feet); link.world.syncRows([row(10, true, true)], feet); expect(link.world.capsuleCount).toBe(0);
    link.world.syncRows([row(10)], feet); link.world.syncRows([], feet); expect(link.world.capsuleCount).toBe(0);
  } finally { link.dispose(); }
});

test('a gate this player opened is open on both sides, and only for that capsule', () => {
  const link = linkedPlayer(R, { id: 'gate', start: { x: -32, z: GATE_Z - 3, yaw: NORTH }, ticks: 0, intent: () => ({}) }, DELAY);
  try {
    link.world.phase(link.player.motor, [link.page.course.gate]);
    link.host.player.motor.phased.add(link.host.course.gate);
    let corrections = 0;
    for (let at = 0; at < 120; at++) if (link.run().corrected) corrections++;
    expect(link.player.position.z).toBeGreaterThan(GATE_Z + 1);
    expect(corrections).toBe(0);
    link.world.phase(link.player.motor, []);
    expect(link.player.motor.phased.size).toBe(0);
  } finally { link.dispose(); }
});

test('a command is met at the tick the server will reach it, across the seq wrap', () => {
  const link = linkedPlayer(R, { id: 'tick', start: { x: -10, z: 0, yaw: EAST }, ticks: 0, intent: () => ({}) }, DELAY);
  try {
    link.world.frame(1000, 0xfffe);
    expect(link.world.tickOf(0xffff)).toBe(1001);
    expect(link.world.tickOf(2)).toBe(1004);
    expect(link.world.tickOf(0xfffd)).toBe(999);
  } finally { link.dispose(); }
});
