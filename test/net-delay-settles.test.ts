import { expect, test } from 'vitest';
import { INTERP_MAX_MS, NetClock } from '../src/client/engine/net/netClock';
import { INTERP_SAMPLES, Interpolator } from '../src/client/engine/net/interpolator';
import type { DecodedFrame } from '../src/shared/engine/net/frame';

// NET-LAG NL2: other players were drawn 140 to 270 ms behind against a 90 to 110 ms target, because a stall on the page bunched
// the frames and the delay never fell back. After a 1 s boot stall and a 325 ms stall burst, 10 s of clean 30 Hz brings the
// delay to 120 ms or under, and no render frame falls outside the interpolation buffer.
const TICK_MS = 1000 / 60, FRAME_MS = 2 * TICK_MS, RENDER_MS = 1000 / 60, WIRE_MS = 80, START = 5000;
/** mulberry32. */
const seeded = (seed: number): (() => number) => { let a = seed; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32; }; };
const frameOf = (tick: number): DecodedFrame => ({ tick, baselineTick: 0, cell: 0, lastSeq: 0, owner: new Float64Array(0), ride: null, rows: new Map(), fresh: new Set() });

interface Stall { readonly at: number; readonly ms: number }
interface Run { readonly clock: NetClock; readonly lerp: Interpolator; readonly delays: readonly number[]; readonly heldAfter: (ms: number) => number; readonly starvedAfter: (ms: number) => number }
/**
 * `seconds` of 30 Hz frames, `jitter(sentMs)` late on the wire, held while the page stalls and then handled one after another
 * (~0.3 ms each); a render frame every 16.7 ms reads the render tick and asks the buffer whether it covers it.
 */
function play(seconds: number, stalls: readonly Stall[], jitter: (sentMs: number) => number): Run {
  const clock = new NetClock(), lerp = new Interpolator(() => undefined), arrivals: { tick: number; at: number }[] = [];
  for (let frame = 0; frame < seconds * 30; frame++) {
    const sent = frame * FRAME_MS;
    let at = START + sent + WIRE_MS + jitter(sent);
    for (const stall of stalls) if (at >= START + stall.at && at < START + stall.at + stall.ms) at = START + stall.at + stall.ms;
    arrivals.push({ tick: frame * 2, at });
  }
  arrivals.sort((a, b) => a.at - b.at);
  let last = -Infinity;
  for (const arrival of arrivals) { if (arrival.at <= last) arrival.at = last + 0.3; last = arrival.at; }
  const delays: number[] = [], heldAt: number[] = [], starvedAt: number[] = [];
  let next = 0;
  for (let now = START; now < START + seconds * 1000 + WIRE_MS; now += RENDER_MS) {
    for (let arrival = arrivals[next]; arrival !== undefined && arrival.at <= now; arrival = arrivals[++next]) { clock.arrival(arrival.tick, arrival.at); lerp.push(frameOf(arrival.tick)); }
    if (!clock.started) continue;
    const { held, starved } = lerp;
    lerp.cover(clock.renderTick(now));
    if (lerp.held > held) heldAt.push(now - START);
    if (lerp.starved > starved) starvedAt.push(now - START);
    delays.push(clock.delayMs);
  }
  return { clock, lerp, delays, heldAfter: ms => heldAt.filter(at => at >= ms).length, starvedAfter: ms => starvedAt.filter(at => at >= ms).length };
}

test('the buffer is deep enough for the deepest delay and two frames more', () => {
  expect((INTERP_SAMPLES - 1) * FRAME_MS).toBeGreaterThanOrEqual(INTERP_MAX_MS + 2 * FRAME_MS);
});

test('after a 1 s boot stall and a 325 ms stall burst, 10 s of clean 30 Hz settles the delay at 120 ms or under', () => {
  const rng = seeded(3), run = play(15, [{ at: 600, ms: 1000 }, { at: 3200, ms: 325 }], sent => sent < 5000 ? rng() * 20 : rng() * 4);
  const peak = Math.max(...run.delays);
  console.info(`NL2 stalls: delay peak ${peak.toFixed(0)} ms, after 10 s clean ${run.clock.delayMs.toFixed(0)} ms, jitter ${run.clock.jitterMs.toFixed(1)} ms, interpHeld ${run.lerp.held}, starved after ${run.starvedAfter(5000)}`);
  expect(run.clock.delayMs).toBeLessThanOrEqual(120);
  expect(run.lerp.held).toBe(0);
  expect(run.starvedAfter(5000)).toBe(0);
  expect(peak).toBeLessThanOrEqual(INTERP_MAX_MS);
});

test('stalls under the snap (200 to 240 ms, three in 4 s) settle too, inside the buffer', () => {
  const rng = seeded(5), run = play(15, [{ at: 1000, ms: 200 }, { at: 2500, ms: 200 }, { at: 4000, ms: 240 }], () => rng() * 20);
  const peak = Math.max(...run.delays);
  console.info(`NL2 sub-snap stalls: delay peak ${peak.toFixed(0)} ms, end ${run.clock.delayMs.toFixed(0)} ms, interpHeld ${run.lerp.held}`);
  expect(run.clock.delayMs).toBeLessThanOrEqual(120);
  expect(run.lerp.held).toBe(0);
  expect(peak).toBeLessThanOrEqual(INTERP_MAX_MS);
});

test('a page that stalls 180 ms every 1.5 s holds its delay under the cap and inside the buffer', () => {
  const rng = seeded(9), run = play(20, Array.from({ length: 13 }, (_, at) => ({ at: 500 + at * 1500, ms: 180 })), () => rng() * 30);
  console.info(`NL2 repeated stalls: delay peak ${Math.max(...run.delays).toFixed(0)} ms, end ${run.clock.delayMs.toFixed(0)} ms, interpHeld ${run.lerp.held}`);
  expect(Math.max(...run.delays)).toBeLessThanOrEqual(INTERP_MAX_MS);
  expect(run.lerp.held).toBe(0);
});

test('the interpolator counts a render tick older than its buffer as held, and one past its run-on as starved', () => {
  const lerp = new Interpolator(() => undefined);
  lerp.cover(0);
  expect(lerp.held + lerp.starved).toBe(0); // nothing heard: nothing to cover
  for (let tick = 0; tick < 2 * INTERP_SAMPLES; tick += 2) lerp.push(frameOf(tick));
  lerp.cover(-1); expect(lerp.held).toBe(0); // before the first frames is boot, not depth
  for (let tick = 2 * INTERP_SAMPLES; tick < 4 * INTERP_SAMPLES; tick += 2) lerp.push(frameOf(tick));
  lerp.cover(2 * INTERP_SAMPLES - 1); expect(lerp.held).toBe(1);
  lerp.cover(4 * INTERP_SAMPLES - 2); expect(lerp.held + lerp.starved).toBe(1);
  lerp.cover(4 * INTERP_SAMPLES + 10); expect(lerp.starved).toBe(1);
  lerp.clear(); lerp.cover(0); expect(lerp.held + lerp.starved).toBe(2);
});
