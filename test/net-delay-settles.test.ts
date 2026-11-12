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
/** `count` stalls of `ms`, one every `every` ms from `from`. */
const stalling = (from: number, count: number, every: number, ms: number): Stall[] => Array.from({ length: count }, (_, index) => ({ at: from + index * every, ms }));
interface Run { readonly clock: NetClock; readonly lerp: Interpolator; readonly delays: readonly number[]; readonly targets: readonly number[]; readonly delayAt: (ms: number) => number; readonly starvedAfter: (ms: number) => number }
/**
 * `seconds` of 30 Hz frames, `jitter(sentMs)` late on the wire, held while the page stalls and then handled one after another
 * (~0.3 ms each); a render frame every 16.7 ms outside the stalls reads the render tick and asks the buffer whether it covers it.
 */
function play(seconds: number, stalls: readonly Stall[], jitter: (sentMs: number) => number, depth = INTERP_SAMPLES): Run {
  const clock = new NetClock(), lerp = new Interpolator(() => undefined, depth), arrivals: { tick: number; at: number }[] = [];
  const stalled = (at: number): Stall | undefined => stalls.find(stall => at >= START + stall.at && at < START + stall.at + stall.ms);
  for (let frame = 0; frame < seconds * 30; frame++) {
    const sent = frame * FRAME_MS, at = START + sent + WIRE_MS + jitter(sent), stall = stalled(at);
    arrivals.push({ tick: frame * 2, at: stall === undefined ? at : START + stall.at + stall.ms });
  }
  arrivals.sort((a, b) => a.at - b.at);
  let last = -Infinity;
  for (const arrival of arrivals) { if (arrival.at <= last) arrival.at = last + 0.3; last = arrival.at; }
  const delays: number[] = [], targets: number[] = [], times: number[] = [], starvedAt: number[] = [];
  let next = 0;
  for (let now = START; now < START + seconds * 1000 + WIRE_MS; now += RENDER_MS) {
    if (stalled(now) !== undefined) continue;
    for (let arrival = arrivals[next]; arrival !== undefined && arrival.at <= now; arrival = arrivals[++next]) { clock.arrival(arrival.tick, arrival.at); lerp.push(frameOf(arrival.tick)); }
    if (!clock.started) continue;
    const { starved } = lerp;
    lerp.cover(clock.renderTick(now));
    if (lerp.starved > starved) starvedAt.push(now - START);
    delays.push(clock.delayMs); targets.push(clock.targetMs); times.push(now - START);
  }
  return { clock, lerp, delays, targets, delayAt: ms => delays[times.findIndex(at => at >= ms)] ?? Number.NaN, starvedAfter: ms => starvedAt.filter(at => at >= ms).length };
}

test('the buffer is deep enough for the deepest delay and two frames more', () => {
  expect((INTERP_SAMPLES - 1) * FRAME_MS).toBeGreaterThanOrEqual(INTERP_MAX_MS + 2 * FRAME_MS);
});

test('after a 1 s boot stall and a 325 ms stall burst, 10 s of clean 30 Hz settles the delay at 120 ms or under', () => {
  const rng = seeded(3), run = play(15, [{ at: 600, ms: 1000 }, { at: 3200, ms: 325 }], sent => sent < 5000 ? rng() * 20 : rng() * 4);
  console.info(`NL2 stalls: delay peak ${Math.max(...run.delays).toFixed(0)} ms, after 10 s clean ${run.clock.delayMs.toFixed(0)} ms, jitter ${run.clock.jitterMs.toFixed(1)} ms, interpHeld ${run.lerp.held}, starved after ${run.starvedAfter(5000)}`);
  expect(run.clock.delayMs).toBeLessThanOrEqual(120);
  expect(run.lerp.held).toBe(0);
  expect(run.starvedAfter(5000)).toBe(0);
});

test('stalls under the snap (200 to 240 ms, three in 4 s) settle too, inside the buffer', () => {
  const rng = seeded(5), run = play(15, [{ at: 1000, ms: 200 }, { at: 2500, ms: 200 }, { at: 4000, ms: 240 }], () => rng() * 20);
  console.info(`NL2 sub-snap stalls: delay peak ${Math.max(...run.delays).toFixed(0)} ms, end ${run.clock.delayMs.toFixed(0)} ms, interpHeld ${run.lerp.held}`);
  expect(run.clock.delayMs).toBeLessThanOrEqual(120);
  expect(run.lerp.held).toBe(0);
});

test('a delay raised to the cap is under 100 ms 6 s after the link calms', () => {
  // At 1 % it is not (158 ms at 6 s, 118 at 10 s): the jitter window takes 3 s to clear, then it falls 10 ms a second.
  const rng = seeded(7), run = play(20, stalling(500, 12, 600, 230), () => rng() * 20), calm = 500 + 12 * 600;
  console.info(`NL2 fall: delay at calm ${run.delayAt(calm).toFixed(0)} ms, 6 s later ${run.delayAt(calm + 6000).toFixed(0)} ms`);
  expect(run.delayAt(calm)).toBeGreaterThanOrEqual(INTERP_MAX_MS - 10);
  expect(run.delayAt(calm + 6000)).toBeLessThanOrEqual(100);
});

test('a page that stalls 240 ms every 0.4 s stops its delay at the cap, and the buffer holds it when the wire then speeds up', () => {
  // At 8 s the path gets 60 ms shorter: frames arrive ahead of a clock that catches up at 1 %, so the render tick sits up to
  // 260 ms behind the newest frame. Ten frames cover that; the old eight (233 ms) did not.
  const faster = (sent: number): number => sent < 8000 ? 60 : 0, run = play(15, stalling(500, 35, 400, 240), faster);
  console.info(`NL2 cap: delay peak ${Math.max(...run.delays).toFixed(0)} ms, target peak ${Math.max(...run.targets).toFixed(0)} ms, interpHeld ${run.lerp.held}`);
  expect(Math.max(...run.targets)).toBe(INTERP_MAX_MS);
  expect(Math.max(...run.delays)).toBeGreaterThan(INTERP_MAX_MS - 1);
  expect(Math.max(...run.delays)).toBeLessThanOrEqual(INTERP_MAX_MS);
  expect(run.lerp.held).toBe(0);
  const shallow = play(15, stalling(500, 35, 400, 240), faster, 8); // the old depth: the delay at its cap outruns it
  console.info(`NL2 cap at 8 frames: interpHeld ${shallow.lerp.held}`);
  expect(shallow.lerp.held).toBeGreaterThan(0);
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

test('a server pause with a bunched pair after it leaves the clock within a frame of true', () => {
  const clock = new NetClock();
  for (let frame = 0; frame < 150; frame++) clock.arrival(frame * 2, 5000 + frame * FRAME_MS);
  const back = 5000 + 150 * FRAME_MS + 2000; // 2 s of nothing, then the server goes on from where it stopped
  clock.arrival(300, back); clock.arrival(302, back + 5); // the second of a pair the wire bunched
  expect(Math.abs(clock.serverTick(back + 5) - 302) * TICK_MS).toBeLessThanOrEqual(FRAME_MS);
});
