/** Shadow adapters around the actual authored lead; public Pine producers and
 * their module hashes stay untouched until the later H13 cutover. */
import stag from '../../../src/shards/pine-hollow/behaviour/stag.as?raw';
import rows from '../../../src/shards/pine-hollow/data/questLead.json' with { type: 'json' };
import { expect } from 'vitest';
import { ScriptModuleV2 } from '../../../src/shared/engine/script/moduleV2';
import type { DualPortFixture } from '../script-v2-port';

const fields = ['i','mode','elapsed','begin','dt','leadStep','night','playerX','playerZ','atX','atZ'] as const;
const channels = ['i','mode','elapsed','event','leadAppear','leadDone'] as const;
const first = rows.path.at(0), last = rows.path.at(-1);
if (first === undefined || last === undefined) throw new Error('Missing authored stag path');
const params = { firstX: first[0],firstZ: first[1],lastX: last[0],lastZ: last[1],length: rows.path.length,
  first: rows.first,near: rows.near,past: rows.past,trot: rows.trot,gone: rows.gone,nightAbove: rows.nightAbove };
const constants = (names: readonly string[]): string => names.map((name,i) => `export const ${name}:i32=${i};`).join('');
// This replaces only the generated host IO boundary, identically for both
// adapters. Authored stag.as is captured without rewriting any of its body.
const boundary = `export namespace Field{${constants(fields)}}
export namespace Channel{${constants(channels)}}
export namespace Params{${Object.entries(params).map(([name,value]) => `export const ${name}:f64=${String(value)};`).join('')}}
let io:usize=0;export function setIO(base:usize):void{io=base;}
export namespace Read{export function field(actor:i32,field:i32):f64{return load<f64>(io+usize(field)*8);}}
export namespace Do{export function channel(channel:i32,value:f64):void{store<f64>(io+256+usize(channel)*8,value);}}`;
const sources = { 'generated/pineLife.ts': boundary };
const legacy = `import {lead} from './stag';import {setIO} from './generated/pineLife';
export function ws_abi():i32{return 1;}export function ws_io():i32{return 16384;}
export function ws_init(lo:i32,hi:i32):void{}
export function ws_handle():i32{setIO(16384);lead();return 0;}`;
const candidate = `import {lead} from './stag';import {setIO} from './generated/pineLife';
export function ws_abi():i32{return 2;}export function ws_io():i32{return 1024;}
export function ws_init(lo:i32,hi:i32,fuel:i32):i32{return 0;}
export function ws_project(fuel:i32):i32{setIO(1024);lead();return 0;}`;
const input = {
  authored: new Map([['stag.ts',stag]]),legacy: { source: legacy,sources },
  candidate: { source: candidate,sources,lane: 'project',ioBytes: 656 },pages: 1,
} satisfies DualPortFixture['input'];
type Frame = Record<typeof fields[number],number>;
const callable = (value: unknown): value is (...args: number[]) => unknown => typeof value === 'function';
function finite(value: number): number { if (!Number.isFinite(value)) throw new Error('Non-finite legacy output');return value; }

export const port = { input,verify: pair => {
  const memory = new WebAssembly.Memory({ initial: 1,maximum: 1 });
  let fuel = 0, depth = 0;
  const instance = new WebAssembly.Instance(new WebAssembly.Module(Uint8Array.from(pair.legacy.bytes)),{ env: {
    memory,enter: () => { if (++depth > 64) throw new Error('Legacy stack exhausted'); },leave: () => { depth--; },
    fuel: (amount: number) => { fuel -= amount;if (fuel < 0) throw new Error('Legacy fuel exhausted'); },
    finite32: finite,finite64: finite,abort: () => { throw new Error('Legacy abort'); },
  } });
  const invoke = (name: string,...args: number[]): void => {
    const method = instance.exports[name];if (!callable(method)) throw new Error('Missing admitted legacy entry');method(...args);
  };
  fuel = 1_000_000_000;
  if (instance.exports['__start'] !== undefined) invoke('__start');invoke('ws_init',0,0);
  const module = new ScriptModuleV2(pair.candidate.bytes,{ seed: [0,0],initFuel: 1_000_000,ioBytes: 656,output: [{ offset: 1280,count: channels.length,width: 8 }] });
  const events = new Set<number>();
  const evaluate = (frame: Frame): number[] => {
    const write = (view: DataView,base: number): void => {
      fields.forEach((name,i) => { view.setFloat64(base+i*8,frame[name],true); });
      channels.forEach((_,i) => { view.setFloat64(base+256+i*8,-99,true); });
    };
    const read = (view: DataView,base: number): number[] => channels.map((_,i) => view.getFloat64(base+256+i*8,true));
    const oldView = new DataView(memory.buffer);write(oldView,16384);fuel = 1_000_000_000;invoke('ws_handle');
    const actual = module.project(1_000_000,view => { write(view,module.io); },view => read(view,module.io)).value;
    expect(actual).toEqual(read(oldView,16384));expect(depth).toBe(0);
    const event = actual[3];if (event === undefined) throw new Error('Missing lead event');events.add(event);
    expect(actual[4]).toBe(Number(event === 1));expect(actual[5]).toBe(Number(event === 5));
    return actual;
  };
  const base: Frame = { i: 0,mode: 0,elapsed: 0,begin: 0,dt: 0.1,leadStep: 1,night: 1,
    playerX: first[0] ?? 0,playerZ: first[1] ?? 0,atX: first[0] ?? 0,atZ: first[1] ?? 0 };
  // All six authored events, each side of its strict thresholds, the begin
  // gate, and both ways of closing the step/night gate.
  for (const patch of [
    {},{ leadStep: 0 },{ night: rows.nightAbove },
    { mode: 1,leadStep: 0 },{ mode: 1,night: rows.nightAbove },
    { mode: 2,elapsed: rows.trot,dt: 0 },{ mode: 2,elapsed: rows.trot+0.01 },
    { mode: 2,i: rows.path.length-1,elapsed: rows.trot+0.01 },
    { mode: 3,elapsed: rows.gone,dt: 0 },{ mode: 3,elapsed: rows.gone+0.01 },
    { mode: 3,elapsed: rows.gone+0.01,begin: 1 },
  ]) evaluate({ ...base,...patch });
  expect([...events].sort((a,b) => a-b)).toEqual([0,1,2,3,4,5]);
  let continuation = { i: 0,mode: 0,elapsed: 0 }, completed = 0;
  for (let tick = 0; tick < 1200; tick++) {
    const bend = rows.path[continuation.i];if (bend === undefined) throw new Error('Lead left authored path');
    const answer = evaluate({ ...base,...continuation,atX: bend[0] ?? 0,atZ: bend[1] ?? 0,
      playerX: bend[0] ?? 0,playerZ: bend[1] ?? 0,leadStep: Number(tick%600 >= 10),night: tick%500 < 5 ? 0.5 : 1 });
    const [i,mode,elapsed,event] = answer;
    if (i === undefined || mode === undefined || elapsed === undefined) throw new Error('Missing saved lead continuation');
    continuation = { i,mode,elapsed };if (event === 5) completed++;
  }
  expect(completed).toBeGreaterThan(0);
  return Promise.resolve();
} } satisfies DualPortFixture;
