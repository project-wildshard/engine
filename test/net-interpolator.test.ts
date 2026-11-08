import { expect, test } from 'vitest';
import { BitWriter, floatToBits } from '../src/shared/engine/net/bits';
import { Interpolator, EXTRAPOLATE_TICKS, INTERP_SAMPLES } from '../src/client/engine/net/interpolator';
import { ANIMAL_CLASS, PLAYER_CLASS } from '../src/shared/engine/net/netSchemas';
import { compileSchema, netSchema, type NetClass } from '../src/shared/engine/net/schema';
import { decodeFrame, encodeFrame, WorldFrame, type DecodedFrame, type FrameTable } from '../src/shared/engine/net/frame';

// P1-E5.3-F2: rows are drawn in the past, between frames that were really sent.
interface Body { x: number; y: number; z: number; yaw: number; state: string; flinch: number }
const COMPILED = compileSchema(netSchema<Body>({ cls: 'body', relevance: { radius: 100 }, fields: {
  x: { kind: 'f32q', min: -260, max: 260, bits: 16, read: b => b.x },
  y: { kind: 'f32q', min: -260, max: 260, bits: 16, read: b => b.y },
  z: { kind: 'f32q', min: -260, max: 260, bits: 16, read: b => b.z },
  yaw: { kind: 'angle', bits: 10, read: b => b.yaw },
  state: { kind: 'enum', values: ['idle', 'run'], read: b => b.state },
  flinch: { kind: 'f32q', min: 0, max: 1, bits: 6, read: b => b.flinch },
} }), 9);
const BODY: NetClass<never> = COMPILED, ANIMAL: NetClass<never> = ANIMAL_CLASS, OWNER: NetClass<never> = PLAYER_CLASS;
const STEP = BODY.row[0]?.step ?? 0;
const quantise = (body: Body): Uint32Array => Uint32Array.from(COMPILED.row.map(column => column.sample(body, () => 0)));
const frameOf = (tick: number, rows: Record<number, Body>, fresh: readonly number[] = Object.keys(rows).map(Number)): DecodedFrame =>
  ({ tick, baselineTick: 0, cell: 0, lastSeq: 0, owner: new Float64Array(0), ride: null, rows: new Map(Object.entries(rows).map(([handle, body]) => [Number(handle), quantise(body)])), fresh: new Set(fresh) });
const still = (over: Partial<Body>): Body => ({ x: 0, y: 0, z: 0, yaw: 0, state: 'idle', flinch: 0, ...over });
const stack = (): Interpolator => new Interpolator(() => BODY);
const read = (lerp: Interpolator, handle: number, tick: number): Float64Array => { const out = new Float64Array(BODY.row.length); expect(lerp.sample(handle, tick, out)).toBe(true); return out; };
const X = 0, YAW = 3, STATE = 4, FLINCH = 5;

test('an authoritative strike keeps its whole duration between actual wire frames', () => {
  const index = ANIMAL.row.findIndex(column => column.name === 'attackDur'), duration = ANIMAL.row[index];
  if (duration === undefined) throw new Error('Missing animal strike duration');
  const lerp = new Interpolator(() => ANIMAL), out = new Float64Array(ANIMAL.row.length);
  const wire = (tick: number, seconds: number): DecodedFrame => {
    const row = new Uint32Array(ANIMAL.row.length);
    row[index] = duration.kind === 'f32' ? floatToBits(seconds) : Math.round(seconds * 1000);
    const frame = new WorldFrame(); frame.reset(tick);
    const at = frame.claim(7, row.length); frame.data.set(row, at);
    const decoded = decodeFrame(new Uint8Array(encodeFrame(new BitWriter(), { frame, cell: 1, lastSeq: 0, ownerClass: ANIMAL,
      owner: new Float64Array(ANIMAL.owner.length), visible: new Set([7]), baseline: null, classOf: () => ANIMAL })),
    { ownerClass: ANIMAL, classOf: () => ANIMAL, baseline: () => null });
    if (decoded === null) throw new Error('Strike frame did not round-trip');
    return decoded;
  };
  lerp.push(wire(10, .4)); lerp.push(wire(14, 1.2));
  expect(lerp.sample(7, 12, out)).toBe(true);
  const seconds = duration.kind === 'f32' ? out[index] : (out[index] ?? 0) / 1000;
  expect(seconds).toBeCloseTo(.4, 6);
});

test('a moving body sits within a quantisation step of its history, and the bound past the newest frame', () => {
  const path = (tick: number): number => 40 * Math.sin(tick / 90), speed = 40 / 90; // the fastest it moves, m a tick
  const lerp = stack();
  let worst = 0;
  for (let tick = 0; tick < 600; tick += 2) {
    lerp.push(frameOf(tick, { 7: still({ x: path(tick) }) }));
    if (tick < 2) continue;
    for (let at = tick - 2; at <= tick; at += 0.25) worst = Math.max(worst, Math.abs((read(lerp, 7, at)[X] ?? 0) - path(at)));
  }
  // two ticks of a curve are all but straight: the error left is the wire's
  expect(worst).toBeLessThanOrEqual(STEP + 0.0015);
  const newest = 598, past = read(lerp, 7, newest + 100)[X] ?? 0;
  expect(Math.abs(past - path(newest))).toBeLessThanOrEqual(speed * EXTRAPOLATE_TICKS + STEP * 2);
});

test('a held row is no sample: a far body keeps its speed across frames it was left out of', () => {
  const lerp = stack();
  lerp.push(frameOf(0, { 1: still({ x: 0 }) }));
  lerp.push(frameOf(2, { 1: still({ x: 0 }) }, []));
  lerp.push(frameOf(4, { 1: still({ x: 0 }) }, []));
  lerp.push(frameOf(6, { 1: still({ x: 6 }) }));
  expect(read(lerp, 1, 3)[X]).toBeCloseTo(3, 1); // a held copy at tick 4 would pin it at 0 until there
});
test('a row that stands still is a sample: it does not run on past its stop', () => {
  const lerp = stack();
  lerp.push(frameOf(0, { 1: still({ x: 0 }) })); lerp.push(frameOf(2, { 1: still({ x: 2 }) })); lerp.push(frameOf(4, { 1: still({ x: 2 }) }));
  expect(read(lerp, 1, 7)[X]).toBeCloseTo(2, 1);
});
test('angles take the short way, enums switch at the later frame, pose scalars lerp and hold', () => {
  const lerp = stack();
  lerp.push(frameOf(0, { 1: still({ yaw: 6.2, flinch: 0 }) })); lerp.push(frameOf(4, { 1: still({ yaw: 0.1, state: 'run', flinch: 1 }) }));
  const mid = read(lerp, 1, 2), yaw = mid[YAW] ?? 0;
  expect(Math.abs(Math.sin(yaw) - Math.sin((6.2 + 0.1 + Math.PI * 2) / 2))).toBeLessThan(0.02);
  expect(mid[STATE]).toBe(0); expect(read(lerp, 1, 3.99)[STATE]).toBe(0); expect(read(lerp, 1, 4)[STATE]).toBe(1);
  expect(mid[FLINCH]).toBeCloseTo(0.5, 1);
  expect(read(lerp, 1, 7)[FLINCH]).toBeCloseTo(1, 5);
});
test('a late frame sorts in; a full buffer drops the oldest', () => {
  const lerp = stack();
  lerp.push(frameOf(0, { 1: still({ x: 0 }) })); lerp.push(frameOf(4, { 1: still({ x: 4 }) })); lerp.push(frameOf(2, { 1: still({ x: 8 }) }));
  expect(read(lerp, 1, 2)[X]).toBeCloseTo(8, 1);
  for (let tick = 6; tick < 6 + INTERP_SAMPLES * 2; tick += 2) lerp.push(frameOf(tick, { 1: still({ x: tick }) }));
  lerp.push(frameOf(0, { 1: still({ x: 100 }) }));
  expect(read(lerp, 1, 0)[X]).toBeCloseTo(6 + INTERP_SAMPLES * 2 - 2 * INTERP_SAMPLES, 1); // too old for a full buffer: ignored
});
test('the own character is never buffered, and a row that leaves is forgotten', () => {
  const lerp = stack();
  lerp.own = 1;
  lerp.push(frameOf(0, { 1: still({}), 2: still({}) }));
  expect([...lerp.handles()]).toEqual([2]);
  lerp.push(frameOf(2, {}));
  expect([...lerp.handles()]).toEqual([]);
});

test('a real encoded frame: a tiered row left out arrives as no sample', () => {
  const frame = new WorldFrame(), base = new WorldFrame(), writer = new BitWriter(4096);
  let first: DecodedFrame | null = null;
  const table: FrameTable = { ownerClass: OWNER, classOf: () => ANIMAL, baseline: () => first };
  const write = (world: WorldFrame, tick: number, x: number): void => { world.reset(tick); const at = world.claim(1, ANIMAL_CLASS.row.length); world.data.fill(0, at, at + ANIMAL_CLASS.row.length); world.data[at] = x; };
  write(base, 2, 100); write(frame, 4, 200);
  const input = { cell: 0, lastSeq: 0, ownerClass: OWNER, owner: new Float64Array(OWNER.owner.length), visible: new Set([1]), classOf: () => ANIMAL };
  first = decodeFrame(new Uint8Array(encodeFrame(writer, { ...input, frame: base, baseline: null })), table);
  const held = decodeFrame(new Uint8Array(encodeFrame(writer, { ...input, frame, baseline: { frame: base, visible: new Set([1]) }, due: () => false })), table);
  if (first === null || held === null) throw new Error('Frame did not decode');
  const lerp = new Interpolator(() => ANIMAL);
  lerp.push(first); lerp.push(held);
  const out = new Float64Array(ANIMAL_CLASS.row.length);
  lerp.sample(1, 4, out);
  expect(out[0]).toBeCloseTo(Number(ANIMAL.row[0]?.value(100)), 5); // the held copy never entered: tick 4 is a hold of tick 2
});

test('a body under a predicted player runs on past its newest row, and a row the frames left out has stopped', () => {
  const lerp = stack(), speed = 0.05;
  for (let tick = 0; tick <= 20; tick += 2) lerp.push(frameOf(tick, { 7: still({ x: tick * speed }) }));
  const at = (tick: number, reach: number): number => { const out = new Float64Array(BODY.row.length); expect(lerp.project(7, tick, out, reach)).toBe(true); return out[X] ?? 0; };
  expect(at(10, 30)).toBeCloseTo(0.5, 2); // inside its history it is `sample`
  expect(at(32, 30)).toBeCloseTo(32 * speed, 1); // past `sample`'s 50 ms, where a deck under a rider has to be
  expect(at(100, 30)).toBeCloseTo(50 * speed, 0); // as far as its reach
  expect(read(lerp, 7, 32)[X]).toBeLessThan(at(32, 30)); // which `sample` is not
  lerp.push(frameOf(22, { 7: still({ x: 20 * speed }) }, []));
  expect(at(32, 30)).toBe(read(lerp, 7, 20)[X]); // it stopped, where it stopped
});
