/** The real shelter decision body is identical in both shadow compilations. */
import shelter from '../../../src/shards/pine-hollow/behaviour/shelter.as?raw';
import { expect } from 'vitest';
import { projectionPair } from '../script-v2-projection';
import type { DualPortFixture } from '../script-v2-port';

const fields = ['candidates','heightBias','coverBias','distance','height','cover','radius','clear','x','z','homeX','homeZ',
  'present','rain','wet','hold','homeHold','dry','dt','spot','spotX','spotZ','spotR','homeR'] as const;
const channels = ['index','score','x','z','create','keep','apply','hold','accept','r'] as const;
const signals = ['shelterScore','shelterPlace','shelterStep','shelterGoal'] as const;
const ids = (names: readonly string[]): string => names.map((name,i) => `export const ${name}:i32=${i};`).join('');
const boundary = `export namespace Signal{${ids(signals)}}export namespace Field{${ids(fields)}}
export namespace Channel{${ids(channels)}}let io:usize=0;
export function begin(base:usize):void{io=base;}
export namespace Read{export function field(actor:i32,field:i32):f64{return load<f64>(io+usize(actor*${fields.length}+field)*8);}}
export namespace Do{export function channel(channel:i32,value:f64):void{store<f64>(io+1024+usize(channel)*8,value);}}`;
const sources = { 'generated/pineShelter.ts': boundary };
const legacy = `import {onSignal} from './shelter';import {begin} from './generated/pineShelter';
export function ws_abi():i32{return 1;}export function ws_io():i32{return 16384;}
export function ws_init(lo:i32,hi:i32):void{}
export function ws_handle():i32{begin(16384);onSignal(load<i32>(16384+1000),0,0);return 0;}`;
const candidate = `import {onSignal} from './shelter';import {begin} from './generated/pineShelter';
export function ws_abi():i32{return 2;}export function ws_io():i32{return 1024;}
export function ws_init(lo:i32,hi:i32,fuel:i32):i32{return 0;}
export function ws_project(fuel:i32):i32{begin(1024);onSignal(load<i32>(1024+1000),0,0);return 0;}`;
const input = {
  authored: new Map([['shelter.ts',shelter]]),legacy: { source: legacy,sources },
  candidate: { source: candidate,sources,lane: 'project',ioBytes: 2048 },pages: 1,
} satisfies DualPortFixture['input'];
type Fields = Partial<Record<typeof fields[number],number>>;

export const port = { input,verify: pair => {
  const compare = projectionPair(pair,{ ioBytes: 2048,output: [{ offset: 2048,count: channels.length,width: 8 }] });
  const evaluate = (signal: typeof signals[number],actors: readonly Fields[]): Record<string,number> => compare((view,base) => {
    new Uint8Array(view.buffer,base,2048).fill(0);
    actors.forEach((actor,i) => { fields.forEach((name,j) => { view.setFloat64(base+(i*fields.length+j)*8,actor[name] ?? 0,true); }); });
    view.setInt32(base+1000,signals.indexOf(signal),true);
    channels.forEach((_,i) => { view.setFloat64(base+1024+i*8,-99,true); });
  },(view,base) => Object.fromEntries(channels.map((name,i) => [name,view.getFloat64(base+1024+i*8,true)])));
  expect(evaluate('shelterScore',[{ candidates: 0 }])).toMatchObject({ index: -1,score: 0 });
  expect(evaluate('shelterScore',[{ candidates: 3,heightBias: 2,coverBias: 3 },
    { distance: 10,height: 1,cover: 1 },{ distance: 8,height: 3,cover: 2 },{ distance: 8,height: 3,cover: 2 }])).toMatchObject({ index: 1,score: 4 });
  expect(evaluate('shelterPlace',[{ distance: 5,radius: 2,clear: 1,x: 1,z: 2,homeX: 4,homeZ: 6 }])).toMatchObject({ x: 2.8,z: 4.4 });
  const climate = { wet: 0.7,dry: 0.3,homeHold: 4,hold: 1,dt: 0.5 };
  for (const [present,rain,create,keep,apply,hold] of [
    [0,0.71,1,1,1,4],[1,0.71,0,1,1,4],
    [0,0.7,0,0,0,1],[1,0.7,0,1,0,1],
    [1,0.3,0,1,0,1],[1,0.29,0,1,0,0.5],
  ] as const) expect(evaluate('shelterStep',[{ ...climate,present,rain }])).toMatchObject({ create,keep,apply,hold });
  expect(evaluate('shelterStep',[{ ...climate,present: 1,rain: 0,dt: 1 }])).toMatchObject({ keep: 0,hold: 0 });
  expect(evaluate('shelterStep',[{ ...climate,present: 1,rain: 0,dt: 2 }])).toMatchObject({ keep: 0,hold: 0 });
  expect(evaluate('shelterGoal',[{ present: 0 }])).toMatchObject({ accept: 0,x: -99,z: -99,r: -99 });
  const goal = { present: 1,wet: 0.7,spotX: 4,spotZ: 5,spotR: 6,homeX: 1,homeZ: 2,homeR: 3 };
  expect(evaluate('shelterGoal',[{ ...goal,rain: 0.71 }])).toMatchObject({ accept: 0,x: -99,z: -99,r: -99 });
  expect(evaluate('shelterGoal',[{ ...goal,rain: 0.71,spot: 1 }])).toMatchObject({ accept: 1,x: 4,z: 5,r: 6 });
  expect(evaluate('shelterGoal',[{ ...goal,rain: 0.7,spot: 1 }])).toMatchObject({ accept: 1,x: 1,z: 2,r: 3 });
  return Promise.resolve();
} } satisfies DualPortFixture;
