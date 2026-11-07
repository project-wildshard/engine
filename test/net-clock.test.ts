import { expect, test } from 'vitest';
import { INTERP_FLOOR_MS, INTERP_START_MS, NetClock } from '../src/client/engine/net/netClock';

// P1-E5.3-F3: the delay rows are drawn behind the server, at Low Power Mode's frame rate.
const TICK_MS = 1000 / 60;
/** Frames at 30 Hz with their own jitter, stamped as they arrive: `late` ms past due. */
function run(clock: NetClock, seconds: number, late: (frame: number) => number, rate = 1): void {
  for (let frame = 0; frame < seconds * 30; frame++) clock.arrival(frame * 2, 5000 + (frame * 2 * TICK_MS) / rate + late(frame));
}
/** mulberry32. */
const seeded = (seed: number): (() => number) => { let a = seed; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32; }; };

test('a session starts on 100 ms', () => { expect(new NetClock().delayMs).toBe(INTERP_START_MS); });

test('at 24.3 frames/s on loopback the delay settles under 90 ms', () => {
  // The worker's timer lands a frame within a few ms of due. The stamp is onmessage's, so the render rate adds nothing to it:
  // the same run stamped at the next 41 ms render frame is what the row warns of, and it cannot settle under 90.
  const rng = seeded(7), clock = new NetClock();
  run(clock, 30, () => rng() * 6);
  expect(clock.delayMs).toBeLessThan(90);
  expect(clock.delayMs).toBeGreaterThanOrEqual(INTERP_FLOOR_MS);
  console.info(`settled delay ${clock.delayMs.toFixed(1)} ms, jitter p95 ${clock.jitterMs.toFixed(1)} ms`);
  const rendered = new NetClock(), frame = 1000 / 24.3;
  run(rendered, 30, at => { const due = 5000 + at * 2 * TICK_MS; return Math.ceil(due / frame) * frame - due; });
  expect(rendered.delayMs).toBeGreaterThan(clock.delayMs);
});

test('a clean link rests on the floor', () => {
  const clock = new NetClock();
  run(clock, 15, () => 0);
  expect(clock.delayMs).toBeLessThan(INTERP_FLOOR_MS + 1);
});

test('the clock tracks the server and never runs more than 1 % off', () => {
  const clock = new NetClock();
  clock.arrival(0, 0); clock.arrival(2, 2 * TICK_MS + 40); // a late frame: 40 ms of error
  const a = clock.serverTick(1000), b = clock.serverTick(2000);
  expect((b - a) * TICK_MS / 1000).toBeLessThanOrEqual(1.01);
  expect((b - a) * TICK_MS / 1000).toBeGreaterThanOrEqual(0.99);
  const drift = new NetClock();
  run(drift, 60, () => 0, 1.003); // the server's clock runs 0.3 % fast
  expect(Math.abs(drift.serverTick(5000 + 1798 * TICK_MS / 1.003) - 1798) * TICK_MS).toBeLessThan(6);
});

test('a jittery link raises the delay, and it falls back when the link calms', () => {
  const rng = seeded(11), clock = new NetClock();
  run(clock, 30, () => rng() * 60);
  const raised = clock.delayMs;
  expect(raised).toBeGreaterThan(90);
  for (let frame = 900; frame < 1800; frame++) clock.arrival(frame * 2, 5000 + frame * 2 * TICK_MS);
  expect(clock.delayMs).toBeLessThan(raised);
  expect(clock.delayMs).toBeLessThan(75);
});

test('a pause snaps the clock rather than chasing it at 1 %', () => {
  const clock = new NetClock();
  run(clock, 5, () => 0);
  clock.arrival(300, 200_000);
  expect(clock.serverTick(200_000)).toBeCloseTo(300, 5);
  clock.arrival(302, 200_000 + 2 * TICK_MS);
  expect(clock.renderTick(200_000 + 2 * TICK_MS)).toBeGreaterThan(290);
});

test('viewTick is the drawn tick, on the wire\'s 16 bits, and 0 until a frame', () => {
  const clock = new NetClock();
  expect(clock.viewTick(0)).toBe(0);
  clock.arrival(0x10010, 1000);
  expect(clock.viewTick(1000 + 100)).toBe(0x10010 - 0x10000);
  expect(clock.viewTick(2000)).toBe((Math.round(clock.renderTick(2000))) & 0xffff);
});
