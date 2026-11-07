import { beforeAll, expect, test } from 'vitest';
import { compileScript } from '@wildshard/sharddev/compileScript';
import { createShardfileClientScripts as current, captureClientScriptPosition, type ShardfileClientScriptPorts } from '../src/client/game/shardfile/clientScripts';
import { createShardfileClientScripts as before } from './fixtures/client-script-bridge-before';
import { DeclaredScriptWorld } from '../src/shared/engine/script/state';
import type { ClientScriptContent } from '@wildshard/format/clientScripts';

let bytes: Uint8Array = new Uint8Array();
const moduleId = 'a'.repeat(64);
beforeAll(async () => {
  bytes = await compileScript(`
export function abi_version():i32{return 0;}
export function init(lo:i32,hi:i32):void{}
export function in_ptr():i32{return 16384;}
export function in_cap():i32{return 4096;}
export function out_ptr():i32{return 24576;}
export function out_cap():i32{return 32;}
export function out_count():i32{return 2;}
export function on_tick():void{
  let count=i32(load<f64>(16440));
  store<f64>(24576,101);store<f64>(24584,count==0?0:load<f64>(16448));
  store<f64>(24616,102);store<f64>(24624,load<f64>(16416)/10);
}`, { maximumPages: 1 });
});

function fixture(make: typeof current, count = 2, divisor = 1): {
  bridge: ReturnType<typeof current>; ports: ShardfileClientScriptPorts; state: DeclaredScriptWorld; log: string[];
} {
  const fields = Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `field.${String(i + 1)}`, type: 'f64' as const,
    privacy: 'public' as const, default: (i + 1) / 32, min: -2, max: 2 }));
  const state = new DeclaredScriptWorld({ fields: {}, archetypes: [], events: [], maxEntities: 1 },
    [{ id: 1, name: 'owner', position: [0, 0, 0], fields: {}, frozen: false, interactive: false }],
    { shared: fields, player: [] }, new Map([[1, 'owner']]));
  const source: ClientScriptContent = { identity: { seed: 4294967297 }, state: { shared: fields, player: [] }, sim: { scripts: [] },
    files: [{ hash: moduleId, kind: 'wasm', dependencies: [] }], library: [moduleId], creatures: { spawns: [] },
    props: { panels: [], models: [{ id: 'one' }, { id: 'two' }] }, clientScripts: { divisor,
      bindings: [2, 1].map((entity) => ({ module: moduleId, entity, name: `visual.${String(entity)}`,
        target: { kind: 'prop', id: entity === 2 ? 'two' : 'one' }, reads: fields.map((field) => ({ scope: 'shared', id: field.id })),
        parameters: [], pose: true, maxOffset: 2, minScale: 1, maxScale: 1, emitters: [] })) } };
  const log: string[] = [], nativeView = state.viewField.bind(state);
  state.viewField = function viewField(actor, scope, name): number | undefined { log.push(`read:${name}`); return nativeView(actor, scope, name); };
  const ports: ShardfileClientScriptPorts = { actorId: 'owner', state, observe(target) {
    log.push(`observe:${target.id}`);
    return { get position(): [number, number, number] { log.push(`position:${target.id}`); return [target.id === 'one' ? 1 : 2, 0, 0]; },
      get frozen() { log.push(`frozen:${target.id}`); return true; } };
  } };
  return { bridge: make(source, new Map([[moduleId, bytes]]), ports), ports, state, log };
}

test('the real guest retains every observation, restore byte and getter order from zero through 24 fields', () => {
  for (const count of [0, 1, 2, 24]) {
    const old = fixture(before, count, 2), now = fixture(current, count, 2);
    try {
      for (const tick of [0, 1, 2]) {
        old.bridge.step(tick); now.bridge.step(tick);
        expect(now.bridge.lane.snapshot()).toBe(old.bridge.lane.snapshot());
        expect(now.log).toEqual(old.log);
      }
      const saved = now.bridge.lane.snapshot(), detached = now.bridge.lane.frames();
      for (const frame of detached) Reflect.set(frame.offset, 0, 99);
      now.bridge.step(4); const next = now.bridge.lane.snapshot();
      now.bridge.lane.restore(saved); now.bridge.step(4);
      expect(now.bridge.lane.snapshot()).toBe(next);
      expect(now.bridge.lane.frames().every(frame => frame.offset[0] !== 99)).toBe(true);
    } finally { old.bridge.dispose(); now.bridge.dispose(); }
  }
});

test('later observers and custom position iterators cannot overwrite completed rows', () => {
  const run = (make: typeof current): { snapshot: string; log: string[] } => {
    const f = fixture(make), position: [number, number, number] = [2, 0, 0];
    f.ports.observe = (target) => {
      if (target.id === 'one') position[0] = 9;
      const value: [number, number, number] = target.id === 'one' ? [1, 0, 0] : position;
      function* coordinates(): Generator<number> { f.log.push(`iterate:${target.id}`); yield value[0]; yield value[1]; yield value[2]; }
      Object.defineProperty(value, Symbol.iterator, { value: coordinates });
      return { get position() { f.log.push(`position:${target.id}`); return value; }, get frozen() { f.log.push(`frozen:${target.id}`); return false; } };
    };
    try { f.bridge.step(0); return { snapshot: f.bridge.lane.snapshot(), log: f.log }; }
    finally { f.bridge.dispose(); }
  };
  expect(run(current)).toEqual(run(before));
});

test('nested ticks and a throwing observer keep outer observations and subsequent ticks independent', () => {
  const run = (make: typeof current): { snapshots: string[]; log: string[] } => {
    const f = fixture(make), observe = f.ports.observe, snapshots: string[] = [];
    let nested = false, fail = false, nestedTick = 1;
    f.ports.observe = (target) => {
      if (!nested && target.id === 'one') {
        nested = true; f.bridge.step(nestedTick); nestedTick += 2; snapshots.push(f.bridge.lane.snapshot()); nested = false;
        if (fail) throw new Error('original observation refusal');
      }
      const observed = observe(target);
      return { position: [nested ? 3 : observed.position[0], 0, 0], frozen: observed.frozen };
    };
    try {
      f.bridge.step(2); snapshots.push(f.bridge.lane.snapshot());
      fail = true; expect(() => f.bridge.step(4)).toThrow('original observation refusal');
      fail = false; f.bridge.step(6); snapshots.push(f.bridge.lane.snapshot());
      return { snapshots, log: f.log };
    } finally { f.bridge.dispose(); }
  };
  expect(run(current)).toEqual(run(before));
});

test('late missing/private fields refuse before guest publication and scratch is safe to reuse', () => {
  const run = (make: typeof current): { snapshots: string[]; log: string[] } => {
    const f = fixture(make), view = f.state.viewField.bind(f.state), snapshots: string[] = [];
    try {
      f.bridge.step(0); const saved = f.bridge.lane.snapshot();
      let reads = 0;
      f.state.viewField = function viewField(actor, scope, name): number | undefined { return ++reads === 4 ? undefined : view(actor, scope, name); };
      expect(() => f.bridge.step(1)).toThrow('Private or missing client state field');
      expect(f.bridge.lane.snapshot()).toBe(saved);
      f.state.viewField = view; f.bridge.step(1); snapshots.push(f.bridge.lane.snapshot());
      f.bridge.dispose(); expect(() => f.bridge.step(2)).toThrow('Disposed client script lane');
      return { snapshots, log: f.log };
    } finally { f.bridge.dispose(); }
  };
  expect(run(current)).toEqual(run(before));
});

test('the real point-capture producer preserves original guest bytes across nested field reads', () => {
  const run = (make: typeof current): { snapshots: string[]; captures: number } => {
    const f = fixture(make), point = { x: .25, y: .5, z: .75 }, snapshots: string[] = [], captures = new Set<object>();
    const view = f.state.viewField.bind(f.state);
    let inner = false, nestedTick = 0, nest = false;
    f.ports.observe = target => captureClientScriptPosition(target.id === 'one' ? point : undefined, !inner);
    f.ports.observeInto = function observeInto(this: ShardfileClientScriptPorts, target, capture) {
      expect(this).toBe(f.ports); captures.add(capture);
      captureClientScriptPosition(target.id === 'one' ? point : undefined, !inner, capture); return undefined;
    };
    f.state.viewField = (actor, scope, name) => {
      if (nest && !inner) {
        nest = false; inner = true;
        try { f.bridge.step(nestedTick); snapshots.push(f.bridge.lane.snapshot()); }
        finally { inner = false; }
        // The earlier point snapshot must survive both a nested producer call
        // and a later change to the live point during state observation.
        point.x = -.5; point.y = -.25; point.z = .125;
      }
      return view(actor, scope, name);
    };
    try {
      for (let tick = 0; tick < 64; tick++) {
        point.x = tick / 256; point.y = tick / 512; point.z = tick / 1024;
        nestedTick = tick * 2; nest = true;
        f.bridge.step(tick * 2 + 1); snapshots.push(f.bridge.lane.snapshot());
      }
      const accepted = f.bridge.lane.snapshot(); nest = false;
      for (const invalid of [Number.NaN, Infinity, 251, undefined, null]) {
        Reflect.set(point, 'x', invalid);
        expect(() => f.bridge.step(128)).toThrow('Invalid read-only client observation');
        expect(f.bridge.lane.snapshot()).toBe(accepted);
      }
      point.x = .25; f.bridge.step(128); snapshots.push(f.bridge.lane.snapshot());
      const capturesBeforeDispose = captures.size;
      f.bridge.dispose(); expect(() => f.bridge.step(200)).toThrow('Disposed client script lane');
      expect(captures.size).toBe(capturesBeforeDispose);
      return { snapshots, captures: capturesBeforeDispose };
    } finally { f.bridge.dispose(); }
  };
  const old = run(before), now = run(current);
  expect(now.snapshots).toEqual(old.snapshots);
  expect(old.captures).toBe(0); expect(now.captures).toBe(4);
});

test('an iterable returned by the capture port retains its live alias and exact copy order', () => {
  const run = (make: typeof current): { snapshot: string; log: string[] } => {
    const f = fixture(make), position: [number, number, number] = [0, 0, 0], view = f.state.viewField.bind(f.state);
    function* coordinates(): Generator<number> { f.log.push('iterator'); yield position[0]; yield position[1]; yield position[2]; }
    Object.defineProperty(position, Symbol.iterator, { value: coordinates });
    f.ports.observe = target => ({ get position() { f.log.push(`position:${target.id}`); return position; }, frozen: false });
    f.ports.observeInto = target => f.ports.observe(target);
    f.state.viewField = (actor, scope, name) => { position[0] += .125; return view(actor, scope, name); };
    try {
      for (let tick = 0; tick < 8; tick++) f.bridge.step(tick);
      return { snapshot: f.bridge.lane.snapshot(), log: f.log };
    } finally { f.bridge.dispose(); }
  };
  expect(run(current)).toEqual(run(before));
});

test('a malformed legacy observation cannot select the numeric capture path or publish', () => {
  const run = (make: typeof current): { snapshot: string; log: string[] } => {
    const f = fixture(make), observe = f.ports.observe;
    try {
      const saved = f.bridge.lane.snapshot();
      Reflect.set(f.ports, 'observe', () => undefined);
      expect(() => f.bridge.step(0)).toThrow(TypeError);
      expect(f.bridge.lane.snapshot()).toBe(saved);
      f.ports.observe = observe; f.bridge.step(0);
      return { snapshot: f.bridge.lane.snapshot(), log: f.log };
    } finally { f.bridge.dispose(); }
  };
  expect(run(current)).toEqual(run(before));
});
