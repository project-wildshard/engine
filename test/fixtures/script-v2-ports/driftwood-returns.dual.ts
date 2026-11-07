/** The real return rules with identical sampled numeric authorities behind
 * both shadow adapters. No public generator or shipped script is replaced. */
import returns from '../../../src/shards/driftwood-isle/behaviour/returns.as?raw';
import { expect } from 'vitest';
import { ScriptModuleV2 } from '../../../src/shared/engine/script/moduleV2';
import type { DualPortFixture } from '../script-v2-port';

const fields = ['candidates','away','draw','due','fixed','maximum','minimum','night','nocturnal','now','playerX','playerZ','water','x','z',
  'ground','awayDistance','distance','occupied','y','dead','alive','deadDt','delay','hidden'] as const;
const channels = ['due','eligible','retry','x','z','index','score','perchH','dead','action'] as const;
const signals = ['eligible','place','schedule','perchScore','perchHeight','practice'] as const;
const ids = (names: readonly string[]): string => names.map((name,i) => `export const ${name}:i32=${i};`).join('');
const boundary = `export namespace Signal{${ids(signals)}}
export namespace Field{${ids(fields)}}export namespace Channel{${ids(channels)}}
let io:usize=0,draws:i32=0,grounds:i32=0;
export function begin(base:usize):void{io=base;draws=0;grounds=0;}
export function finish():void{store<f64>(io+2128,f64(draws));store<f64>(io+2136,f64(grounds));}
export namespace List{export function at(i:i32):f64{return load<f64>(io+1800+usize(i)*8);}}
export namespace Read{
 export function field(actor:i32,field:i32):f64{return load<f64>(io+usize(actor*${fields.length}+field)*8);}
 export function random():f64{return load<f64>(io+1536+usize(draws++)*8);}
 export function groundHeight(x:f64,z:f64):i32{
  store<f64>(io+2304+usize(grounds)*16,x);store<f64>(io+2312+usize(grounds)*16,z);
  store<f64>(io+1800,load<f64>(io+1664+usize(grounds++)*8));return 1;
 }
 export function radial(angle:f64,radius:f64):i32{
  store<f64>(io+1800,Math.sin(angle)*radius);store<f64>(io+1808,Math.cos(angle)*radius);return 2;
 }
}
export namespace Do{export function channel(channel:i32,value:f64):void{store<f64>(io+2048+usize(channel)*8,value);}}`;
const sources = { 'generated/driftwoodReturns.ts': boundary };
const legacy = `import {onSignal} from './returns';import {begin,finish} from './generated/driftwoodReturns';
export function ws_abi():i32{return 1;}export function ws_io():i32{return 16384;}
export function ws_init(lo:i32,hi:i32):void{}
export function ws_handle():i32{begin(16384);onSignal(load<i32>(16384+1792),0,0);finish();return 0;}`;
const candidate = `import {onSignal} from './returns';import {begin,finish} from './generated/driftwoodReturns';
export function ws_abi():i32{return 2;}export function ws_io():i32{return 1024;}
export function ws_init(lo:i32,hi:i32,fuel:i32):i32{return 0;}
export function ws_project(fuel:i32):i32{begin(1024);onSignal(load<i32>(1024+1792),0,0);finish();return 0;}`;
const input = {
  authored: new Map([['returns.ts',returns]]),legacy: { source: legacy,sources },
  candidate: { source: candidate,sources,lane: 'project',ioBytes: 4096 },pages: 1,
} satisfies DualPortFixture['input'];
type Fields = Partial<Record<typeof fields[number],number>>;
const callable = (value: unknown): value is (...args: number[]) => unknown => typeof value === 'function';
function finite(value: number): number { if (!Number.isFinite(value)) throw new Error('Non-finite legacy output');return value; }

export const port = { input,verify: pair => {
  const memory = new WebAssembly.Memory({ initial: 1,maximum: 1 });let fuel = 0, depth = 0;
  const instance = new WebAssembly.Instance(new WebAssembly.Module(Uint8Array.from(pair.legacy.bytes)),{ env: {
    memory,enter: () => { if (++depth > 64) throw new Error('Legacy stack exhausted'); },leave: () => { depth--; },
    fuel: (amount: number) => { fuel -= amount;if (fuel < 0) throw new Error('Legacy fuel exhausted'); },
    finite32: finite,finite64: finite,abort: () => { throw new Error('Legacy abort'); },
  } });
  const invoke = (name: string,...args: number[]): void => {
    const method = instance.exports[name];if (!callable(method)) throw new Error('Missing admitted legacy entry');method(...args);
  };
  fuel = 1_000_000_000;if (instance.exports['__start'] !== undefined) invoke('__start');invoke('ws_init',0,0);
  const module = new ScriptModuleV2(pair.candidate.bytes,{ seed: [0,0],initFuel: 1_000_000,ioBytes: 4096,
    output: [{ offset: 3072,count: 12,width: 8 },{ offset: 3328,count: 14,width: 8 }] });
  const evaluate = (signal: typeof signals[number],actors: readonly Fields[],ground: readonly number[] = [1],random: readonly number[] = [0.25]): number[] => {
    const write = (view: DataView,base: number): void => {
      new Uint8Array(view.buffer,base,4096).fill(0);
      actors.forEach((actor,i) => { fields.forEach((name,j) => { view.setFloat64(base+(i*fields.length+j)*8,actor[name] ?? 0,true); }); });
      random.forEach((value,i) => { view.setFloat64(base+1536+i*8,value,true); });
      ground.forEach((value,i) => { view.setFloat64(base+1664+i*8,value,true); });
      view.setInt32(base+1792,signals.indexOf(signal),true);
      channels.forEach((_,i) => { view.setFloat64(base+2048+i*8,-99,true); });
    };
    const read = (view: DataView,base: number): number[] => [
      ...Array.from({ length: 12 },(_,i) => view.getFloat64(base+2048+i*8,true)),
      ...Array.from({ length: 14 },(_,i) => view.getFloat64(base+2304+i*8,true)),
    ];
    const oldView = new DataView(memory.buffer);write(oldView,16384);fuel = 1_000_000_000;invoke('ws_handle');
    const actual = module.project(1_000_000,view => { write(view,module.io); },view => read(view,module.io)).value;
    expect(actual).toEqual(read(oldView,16384));expect(depth).toBe(0);return actual;
  };
  const output = (answer: readonly number[],name: typeof channels[number]): number | undefined => answer[channels.indexOf(name)];
  expect(output(evaluate('schedule',[{ now: 10,minimum: 2,maximum: 6,draw: 0.25 }]),'due')).toBe(13);
  for (const [now,night,nocturnal,eligible] of [[9,1,0,0],[10,0.5,1,1],[10,0.499,1,0],[10,0,0,1]] as const) {
    expect(output(evaluate('eligible',[{ now,night,nocturnal,due: 10,x: 3,z: 4,away: 5 }]),'eligible')).toBe(eligible);
  }
  for (const [alive,dead,hidden,action] of [[1,10,0,0],[0,1,0,0],[0,10,0,1],[0,10,1,2]] as const) {
    expect(output(evaluate('practice',[{ alive,dead,hidden,deadDt: 0.1,delay: 2,distance: 10,away: 5 }]),'action')).toBe(action);
  }
  expect(output(evaluate('perchHeight',[{ y: 5,ground: 2 }]),'perchH')).toBe(3.05);
  expect(output(evaluate('perchHeight',[{ y: 0,ground: 2 }]),'perchH')).toBe(0.5);
  expect(output(evaluate('perchScore',[{ candidates: 0 }]),'index')).toBe(-1);
  const score = evaluate('perchScore',[{ candidates: 3 },{ awayDistance: 20,distance: 2 },{ awayDistance: 20,distance: 2 },{ awayDistance: 50,occupied: 1 }],[],[0,0.5,1]);
  expect(output(score,'index')).toBe(1);expect(score[10]).toBe(3);
  const fixed = evaluate('place',[{ fixed: 1,x: 4,z: 8,now: 10,water: 0 }]);
  expect(output(fixed,'x')).toBe(4);expect(output(fixed,'z')).toBe(8);expect(fixed.slice(10,12)).toEqual([0,1]);
  const landed = evaluate('place',[{ x: 4,z: 8,now: 10,water: 0 }],[1,1],[0.25,0.5]);
  expect(output(landed,'retry')).toBe(0);expect(landed.slice(10,12)).toEqual([2,2]);
  expect(output(landed,'x')).toBeCloseTo(4,12);expect(output(landed,'z')).toBeCloseTo(11,12);
  expect(landed.slice(12,16)).toEqual([4,11,4,11]);
  const flooded = evaluate('place',[{ x: 4,z: 8,now: 10,water: 0 }],Array.from({ length: 7 },() => 0),Array.from({ length: 12 },(_,i) => i/12));
  expect(output(flooded,'retry')).toBe(70);expect(output(flooded,'x')).toBe(4);expect(output(flooded,'z')).toBe(8);
  expect(flooded.slice(10,12)).toEqual([12,7]);
  return Promise.resolve();
} } satisfies DualPortFixture;
