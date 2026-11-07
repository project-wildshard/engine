import { beforeAll, expect, test } from 'vitest';
import { compileScript } from '@wildshard/sharddev/compileScript';
import { ScriptLane, installScriptLane, type ScriptLanePort } from '../src/server/engine/script/lane';
import { DeclaredScriptWorld } from '../src/shared/engine/script/state';
import type { SimHost, SimStateAdapter } from '../src/server/engine/sim';

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
export function out_count():i32{return 2;}
export function on_tick():void{
 calls++;let value=load<f64>(16400);if(value==99)unreachable();
 store<f64>(24576,1);store<f64>(24584,1);store<f64>(24592,value);
 store<f64>(24616,3);store<f64>(24624,9);store<f64>(24632,1);store<f64>(24640,load<f64>(16384));
}`, { maximumPages: 1 });
});
function fixture(divisor = 1): ScriptLane {
  const world = new DeclaredScriptWorld({ fields: { 1: [-10, 10] }, archetypes: [], events: [9], maxEntities: 1 },
    [{ id: 1, name: 'real owner', position: [0, 0, 0], fields: { 1: 0 }, frozen: false, interactive: true }],
    { shared: [], player: [] }, new Map([[1, 'owner']]));
  return new ScriptLane({ world, query: () => [], divisor, modules: [{ name: 'real', bytes, seedLo: 3, seedHi: 5 }],
    bindings: [{ module: 'real', entity: 1, actorId: 'owner', kind: 'server' }] });
}

test('authoritative no-result ticks preserve complete events, command inputs, failure, restore and state revisions', () => {
  const kept = fixture(), dropped = fixture(), commands = new Map([['owner', 0]]);
  let saved = '';
  for (let tick = 0; tick < 128; tick++) {
    commands.set('owner', tick === 19 || tick === 59 ? 20 : tick === 39 ? 99 : tick % 10);
    if (tick === 11) for (const lane of [kept, dropped]) lane.enqueue({ type: 9, target: 1, value: .25 });
    const results = kept.step(tick, commands); dropped.stepWithoutResults(tick, commands);
    expect(dropped.snapshot()).toBe(kept.snapshot()); expect(dropped.world.checkpoint()).toEqual(kept.world.checkpoint());
    expect(dropped.stateRevision()).toBe(kept.stateRevision());
    if (tick === 10) saved = kept.snapshot();
    if (tick === 19 || tick === 39) {
      expect(results[0]?.ok).toBe(false); kept.host.resume('real', 1); dropped.host.resume('real', 1);
    }
    if (tick === 64) { kept.restore(saved); dropped.restore(saved); }
  }
  const slow = fixture(2); slow.stepWithoutResults(0); const before = slow.snapshot();
  slow.stepWithoutResults(1); expect(slow.snapshot()).toBe(before);
  expect(() => slow.stepWithoutResults(-1)).toThrow('Invalid script lane tick');
});

for (const explicit of [false, true]) test(`fixed adapter executes real ${explicit ? 'no-result' : 'compatible full-result'} work and keeps restore/removal`, () => {
  const lane = fixture(), commands = new Map([['owner', 3]]);
  let calls = 0, callback: Parameters<SimHost['onStep']>[1] | undefined, adapter: SimStateAdapter | undefined;
  const sim: Pick<SimHost, 'onStep' | 'state'> = { state: { tick: 0, accumulator: 0, timers: {} },
    onStep(id, run, saved) { expect(id).toBe('actual-lane'); callback = run; adapter = saved; return () => { callback = undefined; adapter = undefined; }; } };
  const facade: ScriptLanePort = { host: lane.host, world: lane.world, divisor: lane.divisor,
    step(tick, input) { expect(this).toBe(facade); calls++; return lane.step(tick, input); },
    enqueue: event => { lane.enqueue(event); }, snapshot: () => lane.snapshot(), restore: text => { lane.restore(text); } };
  if (explicit) facade.stepWithoutResults = function stepWithoutResults(tick, input): void { expect(this).toBe(facade); calls++; lane.stepWithoutResults(tick, input); };
  let commandReads = 0;
  const remove = installScriptLane(sim, 'actual-lane', facade, () => { commandReads++; return commands; });
  if (callback === undefined || adapter === undefined) throw new Error('Missing actual adapter registration');
  const activeAdapter = adapter;
  Reflect.apply(callback, undefined, []); expect(lane.world.entity(1)?.fields[1]).toBe(3);
  const saved = adapter.snapshot(); sim.state.tick = 1; commands.set('owner', 4); Reflect.apply(callback, undefined, []);
  expect(lane.world.entity(1)?.fields[1]).toBe(4); expect(calls).toBe(2); expect(commandReads).toBe(2);
  adapter.restore(saved); expect(adapter.snapshot()).toBe(saved);
  expect(() => activeAdapter.restore(123)).toThrow('Invalid script adapter snapshot');
  remove(); expect(callback).toBeUndefined(); expect(adapter).toBeUndefined();
});
