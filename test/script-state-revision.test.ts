import { beforeAll, expect, test } from 'vitest';
import { ScriptHost } from '../src/shared/engine/script/host';
import { ScriptWorld } from '../src/shared/engine/script/effects';
import { compileScript } from '@wildshard/sharddev/compileScript';

// The same ABI regions as the Template's scene hooks; `witness` keeps door.as's tick counter outside them.
const module = (witness: boolean): string => `
let count: i32 = 0;
let ticks: i32 = 0;
export function abi_version(): i32 { return 0; }
export function init(lo: i32, hi: i32): void {}
export function in_ptr(): i32 { return 16384; }
export function in_cap(): i32 { return 4096; }
export function out_ptr(): i32 { return 24576; }
export function out_cap(): i32 { return 1; }
export function out_count(): i32 { return count; }
export function on_tick(): void {
  count = 0;
  if (load<f64>(16384 + 16) === 1) ticks += 1;
  ${witness ? 'ticks += 1; store<i32>(30000, ticks);' : ''}
}`;
let atRest: Uint8Array = new Uint8Array(), counting: Uint8Array = new Uint8Array();
beforeAll(async () => {
  [atRest, counting] = await Promise.all([compileScript(module(false), { maximumPages: 1 }), compileScript(module(true), { maximumPages: 1 })]);
});
function lane(bytes: Uint8Array): { host: ScriptHost; tick: (tick: number, action?: number) => void } {
  const host = new ScriptHost({ world: new ScriptWorld({ fields: {}, archetypes: [], events: [], maxEntities: 1 }, [{ id: 1, name: 'door', position: [0, 0, 0], fields: {}, frozen: false, interactive: true }]), query: () => [] });
  host.install('door', bytes);
  return { host, tick: (tick, action = 0) => { host.beginTick(tick); expect(host.call('door', 1, [tick, 1 / 60, action]).ok).toBe(true); } };
}

test('an at-rest lane keeps its state revision while only the clock and the ABI rows move', () => {
  const { host, tick } = lane(atRest);
  tick(0); const rest = host.stateRevision();
  // Every call rewrites the input row (the tick included) and clears the output row; neither is state.
  for (let t = 1; t <= 600; t++) tick(t);
  expect(host.stateRevision()).toBe(rest);
  // A real change (the action bumps the guest counter) advances it once, then it rests again.
  tick(601, 1); const changed = host.stateRevision();
  expect(changed).toBeGreaterThan(rest);
  for (let t = 602; t <= 900; t++) tick(t);
  expect(host.stateRevision()).toBe(changed);
});

test('a guest that counts ticks (the Template door witness) changes state every tick', () => {
  const { host, tick } = lane(counting);
  tick(0); let last = host.stateRevision();
  for (let t = 1; t <= 5; t++) { tick(t * 300); const next = host.stateRevision(); expect(next).toBeGreaterThan(last); last = next; }
});
