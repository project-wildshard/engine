import { beforeAll, expect, test } from 'vitest';
import { ClientScriptLane, type ClientScriptObservation } from '../src/client/engine/script/client';
import { ScriptWorld } from '../src/shared/engine/script/effects';
import { compileScript } from '@wildshard/sharddev/compileScript';

let bytes: Uint8Array = new Uint8Array();
beforeAll(async () => {
  bytes = await compileScript(`
let calls:i32=0;
export function abi_version():i32{return 0;}
export function init(lo:i32,hi:i32):void{calls=lo;}
export function in_ptr():i32{return 16384;}
export function in_cap():i32{return 4096;}
export function out_ptr():i32{return 24576;}
export function out_cap():i32{return 32;}
export function out_count():i32{return 3;}
export function on_tick():void{
  calls++; let count=i32(load<f64>(16440));
  let offset=count==0?0:load<f64>(16448);
  let scale=count==0?1:load<f64>(16384+(7+count)*8);
  store<f64>(24576,101);store<f64>(24584,offset);
  store<f64>(24616,102);store<f64>(24624,load<f64>(16416)/10);
  store<f64>(24656,103);store<f64>(24664,scale);store<f64>(24672,1);store<f64>(24680,1);
}
`, { maximumPages: 1 });
});
function fixture(readCount = 2, divisor = 1): ClientScriptLane {
  return new ClientScriptLane({ divisor, modules: [{ name: 'visual', bytes, seedLo: 3, seedHi: 5 }],
    bindings: [2, 1].map(entity => ({ module: 'visual', entity, name: `visual.${String(entity)}`, readCount, parameters: [],
      pose: true, maxOffset: 2, minScale: 0.5, maxScale: 2, emitters: [] })) });
}
function observations(values = [0.25, 1.25]): Map<number, ClientScriptObservation> {
  return new Map([1, 2].map(entity => [entity, { position: [entity, 0, 0], frozen: false, values }]));
}

test('ordered observation/input copies retain zero through maximum field counts', () => {
  for (const count of [0, 1, 2, 24]) {
    const lane = fixture(count), values = Array.from({ length: count }, (_, i) => i === count - 1 ? 1.5 : 0.75);
    try {
      expect(lane.step(0, observations(values)).every(call => call.ok)).toBe(true);
      expect(lane.frames()).toEqual([1, 2].map(entity => ({ entity, tick: 0, offset: [count === 0 ? 0 : values[0], 0, 0],
        rotation: [entity / 10, 0, 0], scale: [count === 0 ? 1 : 1.5, 1, 1], particles: [] })));
    } finally { lane.dispose(); }
  }
});

test('an invalid final observation refuses before any host or visual tick', () => {
  const lane = fixture();
  try {
    lane.step(0, observations()); const saved = lane.snapshot(), bad = observations();
    bad.set(2, { position: [2, 0, 0], frozen: false, values: [Number.NaN, 1] });
    expect(() => lane.step(1, bad)).toThrow(); expect(lane.snapshot() === saved).toBe(true);
    bad.set(2, { position: [2, 0, 0], frozen: false, values: [1] });
    expect(() => lane.step(1, bad)).toThrow('Invalid read-only client observation');
    expect(lane.snapshot() === saved).toBe(true);
  } finally { lane.dispose(); }
});

test('later observation getters cannot retarget an already admitted input copy', () => {
  const lane = fixture(), values = [0.25, 1.25], bank = observations(values);
  bank.set(2, { position: [2, 0, 0], frozen: false, get values() { values[0] = 99; return [0.75, 1.5]; } });
  try {
    expect(lane.step(0, bank).every(call => call.ok)).toBe(true);
    expect(lane.frames().map(frame => frame.offset[0])).toEqual([0.25, 0.75]);
  } finally { lane.dispose(); }
});

test('invalid effect suffixes preserve the last visual pose and native refusal', () => {
  const lane = fixture();
  try {
    lane.step(0, observations());
    const calls = lane.step(1, observations([0.75, 3]));
    expect(calls.every(call => !call.ok && call.reason === 'Client pose outside declared range')).toBe(true);
    expect(lane.frames().map(frame => ({ offset: frame.offset, scale: frame.scale }))).toEqual([
      { offset: [0.25, 0, 0], scale: [1.25, 1, 1] }, { offset: [0.25, 0, 0], scale: [1.25, 1, 1] },
    ]);
  } finally { lane.dispose(); }
});

test('prepared visual transactions keep stale and non-finite refusals', () => {
  const lane = fixture();
  try {
    const world: unknown = Reflect.get(lane, 'world');
    if (!(world instanceof ScriptWorld)) throw new Error('Missing actual presentation world');
    const first = world.prepare([{ op: 101, a: 0.5, b: 0, c: 0, d: 0 }], 1, 0, 0);
    const suffix = world.prepare([{ op: 101, a: 0.75, b: 0, c: 0, d: 0 }], 2, 0, 0);
    first.commit(); expect(() => suffix.commit()).toThrow('Stale client transaction');
    const saved = lane.snapshot();
    expect(() => world.prepare([{ op: 101, a: 1, b: 0, c: 0, d: 0 }, { op: 102, a: 0, b: 0, c: Number.NaN, d: 0 }], 1, 0, 0)).toThrow('Non-finite client effect');
    expect(lane.snapshot() === saved).toBe(true);
  } finally { lane.dispose(); }
});

test('detached outputs and saved continuation retain exact replay bytes', () => {
  const lane = fixture();
  try {
    lane.step(0, observations()); const saved = lane.snapshot(), outputs = lane.frames();
    const first = outputs[0]; if (first === undefined) throw new Error('Missing output');
    Reflect.set(first.offset, 0, 99); expect(lane.frames()[0]?.offset[0]).toBe(0.25);
    lane.step(1, observations([0.75, 1.5])); const next = lane.snapshot();
    lane.restore(saved); lane.step(1, observations([0.75, 1.5]));
    expect(lane.snapshot() === next).toBe(true);
  } finally { lane.dispose(); }
});


test('frame-only steps retain complete guest state through failure, resume, restore and skipped ticks', () => {
  const kept = fixture(), dropped = fixture();
  let saved = '';
  try {
    for (let tick = 0; tick < 128; tick++) {
      const values = observations();
      if (tick === 19 || tick === 39 || tick === 59) values.set(1, { position: [1, 0, 0], frozen: false, values: [.75, 3] });
      kept.step(tick, values); dropped.stepWithoutResults(tick, values);
      expect(dropped.snapshot()).toBe(kept.snapshot()); expect(dropped.frames()).toEqual(kept.frames());
      if (tick === 10) saved = kept.snapshot();
      if (tick === 19 || tick === 39) { kept.resume(1); dropped.resume(1); }
      if (tick === 64) { kept.restore(saved); dropped.restore(saved); }
    }
  } finally { kept.dispose(); dropped.dispose(); }
  expect(() => dropped.stepWithoutResults(129, observations())).toThrow('Disposed client script lane');
  const slow = fixture(2, 2);
  try {
    slow.stepWithoutResults(0, observations()); const skipped = slow.snapshot();
    slow.stepWithoutResults(1, new Map()); expect(slow.snapshot()).toBe(skipped);
    expect(() => slow.stepWithoutResults(-1, observations())).toThrow('Invalid client script tick');
  } finally { slow.dispose(); }
});
