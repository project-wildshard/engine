import { beforeAll, expect, test } from 'vitest';
import { ScriptHost, type ScriptHostState } from '../src/shared/engine/script/host';
import { ScriptWorld } from '../src/shared/engine/script/effects';
import { compileScript } from '@wildshard/sharddev/compileScript';

let bytes: Uint8Array = new Uint8Array();
beforeAll(async () => {
  bytes = await compileScript(`
let counter:i32=0;
let wide:i64=0;
export function abi_version():i32{return 0;}
export function init(lo:i32,hi:i32):void{counter=lo;wide=i64(hi);store<u8>(32768,u8(lo));store<u8>(65535,255);}
export function in_ptr():i32{return 16384;}
export function in_cap():i32{return 4096;}
export function out_ptr():i32{return 24576;}
export function out_cap():i32{return 32;}
export function out_count():i32{return 0;}
export function on_tick():void{counter++;wide+=3;store<u8>(32768,u8(counter));store<i64>(32776,wide);}
`, { maximumPages: 1 });
});
function fixture(): ScriptHost {
  const world = new ScriptWorld({ fields: {}, archetypes: [], events: [9], maxEntities: 1 },
    [{ id: 1, name: 'checkpoint', position: [0, 0, 0], fields: {}, frozen: false, interactive: true }]);
  const host = new ScriptHost({ world, query: () => [] });
  host.install('z-first', bytes, 13, 17); host.install('a-second', bytes, 29, 31);
  host.beginTick(7); host.enqueue({ type: 9, target: 1, value: -0 });
  return host;
}
/** Frozen original byte/global conversion, applied to detached public snapshots. */
function originalModules(host: ScriptHost): ScriptHostState['modules'] {
  return ['z-first', 'a-second'].map(name => {
    const state = host.snapshot(name);
    return { name, memory: Array.from(state.memory), globals: [...state.globals].map(([key, value]) => ({
      name: key, type: typeof value === 'bigint' ? 'bigint' as const : 'number' as const, value: String(value),
    })), failures: 0, disabled: false };
  });
}

test('checkpoint JSON preserves every byte, globals and insertion order', () => {
  const host = fixture(), checkpoint = host.checkpoint();
  expect(checkpoint.modules).toEqual(originalModules(host));
  expect(host.checkpointText()).toBe(JSON.stringify(checkpoint));
  expect(JSON.stringify(checkpoint)).toBe(JSON.stringify({ tick: 7,
    used: { effects: 0, spawns: 0, events: 0, queries: 0, fuel: 0 },
    pending: [{ type: 9, target: 1, value: -0 }], modules: originalModules(host) }));
  expect(checkpoint.modules.map(row => row.name)).toEqual(['z-first', 'a-second']);
  expect(checkpoint.modules[0]?.memory[32768]).toBe(13);
  expect(checkpoint.modules[0]?.memory[65535]).toBe(255);
  expect(checkpoint.modules[0]?.globals.some(row => row.type === 'bigint')).toBe(true);
});

test('retained checkpoint arrays never alias another checkpoint or the guest', () => {
  const host = fixture(), first = host.checkpoint(), second = host.checkpoint();
  const module = first.modules[0], other = second.modules[0];
  if (module === undefined || other === undefined) throw new Error('Missing checkpoint module');
  expect(module.memory).not.toBe(other.memory);
  Reflect.set(module.memory, 32768, 200);
  expect(other.memory[32768]).toBe(13);
  expect(host.snapshot(module.name).memory[32768]).toBe(13);
  host.beginTick(8); expect(host.call(module.name, 1, [8]).ok).toBe(true);
  expect(host.snapshot(module.name).memory[32768]).toBe(14);
  expect(module.memory[32768]).toBe(200); expect(other.memory[32768]).toBe(13);
});

test('saved replay and invalid suffix restores retain exact continuation', () => {
  const host = fixture(), saved = host.checkpoint();
  host.beginTick(8); expect(host.call('z-first', 1, [8]).ok).toBe(true);
  const next = host.checkpoint(), before = JSON.stringify(next);
  const suffix = saved.modules[1]; if (suffix === undefined) throw new Error('Missing suffix');
  const bad = structuredClone(saved), badSuffix = bad.modules[1];
  if (badSuffix === undefined) throw new Error('Missing bad suffix');
  Reflect.set(badSuffix.memory, 65535, 256);
  expect(() => host.restoreState(bad)).toThrow('Invalid module checkpoint');
  expect(JSON.stringify(host.checkpoint())).toBe(before);
  host.restoreState(saved);
  expect(JSON.stringify(host.checkpoint())).toBe(JSON.stringify(saved));
  host.beginTick(8); expect(host.call('z-first', 1, [8]).ok).toBe(true);
  expect(host.checkpoint()).toEqual(next);
});


test('reused private rollback buffers never alias retained public checkpoints', () => {
  const host = fixture(), retained = host.checkpoint(), wire = JSON.stringify(retained);
  for (let tick = 8; tick < 16; tick++) {
    host.beginTick(tick); expect(host.call('z-first', 1, [tick]).ok).toBe(true);
    expect(JSON.stringify(retained)).toBe(wire);
  }
  host.restoreState(retained);
  expect(host.checkpointText()).toBe(wire);
});
