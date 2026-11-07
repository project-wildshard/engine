/** The complete board guest, with the same generated numeric identities in
 * both shadow wrappers. Public board callers, saves and producers stay v1. */
import board from '../../../src/shards/pine-hollow/behaviour/contracts.as?raw';
import rules from '../../../src/shards/pine-hollow/behaviour/contractsRules.as?raw';
import random from '../../../src/shards/pine-hollow/behaviour/contractsRandom.as?raw';
import { CONTRACT_PROGRAM_SCRIPT } from '../../../src/shards/pine-hollow/generators/contractProgram';
import { expect } from 'vitest';
import { projectionPair } from '../script-v2-projection';
import type { DualPortFixture } from '../script-v2-port';

const fields = Object.keys(CONTRACT_PROGRAM_SCRIPT.fields).sort(), stride = fields.length+1;
const channels = Object.keys(CONTRACT_PROGRAM_SCRIPT.channels).sort(), signals = Object.keys(CONTRACT_PROGRAM_SCRIPT.signals).sort();
const ids = (names: readonly string[]): string => names.map((name,i) => `export const ${name}:i32=${i+1};`).join('');
const boundary = `export namespace Signal{${ids(signals)}}export namespace Field{${ids(fields)}}
export namespace Channel{${ids(channels)}}let io:usize=0;export function begin(base:usize):void{io=base;}
export namespace Read{export function field(actor:i32,field:i32):f64{return load<f64>(io+usize(actor*${stride}+field)*8);}}
export namespace Do{export function channel(channel:i32,value:f64):void{store<f64>(io+4096+usize(channel-1)*8,value);}}`;
const sources = { 'generated/pineContracts.ts': boundary };
const legacy = `import {onSignal} from './contracts';import {begin} from './generated/pineContracts';
export function ws_abi():i32{return 1;}export function ws_io():i32{return 16384;}
export function ws_init(lo:i32,hi:i32):void{}
export function ws_handle():i32{begin(16384);onSignal(load<i32>(16384+8000),0,0);return 0;}`;
const candidate = `import {onSignal} from './contracts';import {begin} from './generated/pineContracts';
export function ws_abi():i32{return 2;}export function ws_io():i32{return 1024;}
export function ws_init(lo:i32,hi:i32,fuel:i32):i32{return 0;}
export function ws_project(fuel:i32):i32{begin(1024);onSignal(load<i32>(1024+8000),0,0);return 0;}`;
const input = {
  authored: new Map([['contracts.ts',board],['contractsRules.ts',rules],['contractsRandom.ts',random]]),legacy: { source: legacy,sources },
  candidate: { source: candidate,sources,lane: 'project',ioBytes: 8192 },pages: 1,
} satisfies DualPortFixture['input'];
type Fields = Readonly<Record<string,number>>;

export const port = { input,verify: pair => {
  const compare = projectionPair(pair,{ ioBytes: 8192,output: [{ offset: 5120,count: channels.length,width: 8 }] });
  const visited = new Set<string>();
  const evaluate = (signal: string,actors: readonly Fields[]): Record<string,number> => {
    if (!signals.includes(signal)) throw new Error('Unknown board signal');visited.add(signal);
    return compare((view,base) => {
      new Uint8Array(view.buffer,base,8192).fill(0);
      actors.forEach((actor,i) => { fields.forEach((name,j) => { view.setFloat64(base+(i*stride+j+1)*8,actor[name] ?? 0,true); }); });
      view.setInt32(base+8000,signals.indexOf(signal)+1,true);
      channels.forEach((_,i) => { view.setFloat64(base+4096+i*8,-99,true); });
    },(view,base) => Object.fromEntries(channels.map((name,i) => [name,view.getFloat64(base+4096+i*8,true)])));
  };
  expect(evaluate('random',[{ serial: 42,salt: 7 }])).toEqual(evaluate('random',[{ serial: 42,salt: 7 }]));
  expect(evaluate('tag',[{ kind: 3,variant: 4,label: 5,count: 2,a00: 2,b00: -1,c00: -1,a01: 3,b01: -1,c01: 5 }])).toMatchObject({ value: 1 });
  expect(evaluate('tag',[{ kind: 3,variant: 4,label: 5,count: 1,a00: 3,b00: 6,c00: -1 }])).toMatchObject({ value: 0 });
  expect(evaluate('elite',[{ kind: 3,variant: 4,count: 2,a00: 3,b00: 6,a01: 3,b01: 4 }])).toMatchObject({ index: 1 });
  expect(evaluate('count',[{ match: 0,target: 3,kind: 3,elite: -1 }])).toMatchObject({ value: 1 });
  expect(evaluate('count',[{ match: 0,target: 3,kind: 3,excluded: 1 }])).toMatchObject({ value: 0 });
  expect(evaluate('count',[{ match: 3,rank: 3,targetRank: 2,knownRank: 1,below: 3 }])).toMatchObject({ value: 0 });
  expect(evaluate('progress',[{ have: 1,need: 2,accepted: 1 }])).toMatchObject({ have: 2,moved: 1 });
  expect(evaluate('progress',[{ have: 2,need: 2,accepted: 1 }])).toMatchObject({ have: 2,moved: 0 });
  expect(evaluate('loaded',[{ have: 1.9,need: 3 }])).toMatchObject({ have: 1 });
  expect(evaluate('loaded',[{ have: -1,need: 3 }])).toMatchObject({ have: 0 });
  expect(evaluate('near',[{ x: 3,z: 4,radius: 5 }])).toMatchObject({ value: 0 });
  expect(evaluate('near',[{ x: 3,z: 4,radius: 5.01 }])).toMatchObject({ value: 1 });
  expect(evaluate('draw',[{ first: 2 }])).toMatchObject({ index: 2,band: -1,target: -1 });
  const draw = evaluate('draw',[{ first: -1,count: 1,a00: 1,b00: 4,serial: 42,salt: 7 }]);
  expect(draw).toMatchObject({ index: -1,band: 0 });expect(draw['target']).toBeGreaterThanOrEqual(0);expect(draw['target']).toBeLessThan(4);
  expect(evaluate('draw',[{ first: -1,count: 1,a00: 0,b00: 4 }])).toMatchObject({ index: -1,band: -1,target: -1 });
  expect(evaluate('collision',[{ candidate: 3,count: 2,a00: 1,a01: 3 }])).toMatchObject({ value: 1 });
  expect(evaluate('collision',[{ candidate: 3,count: 2,a00: 1,a01: 2 }])).toMatchObject({ value: 0 });
  expect(evaluate('drawFinish',[{ candidate: 3 }])).toMatchObject({ index: 3,retry: 0 });
  expect(evaluate('drawFinish',[{ excluded: 1,salt: 0,attempts: 2,fallback: 4 }])).toMatchObject({ index: 4,retry: 1,salt: 1 });
  expect(evaluate('drawFinish',[{ excluded: 1,salt: 1,attempts: 2,fallback: 4 }])).toMatchObject({ index: 4,retry: 0,salt: 2 });
  expect(evaluate('claim',[{ valid: 1,have: 1,need: 2 }])).toMatchObject({ status: 0,claimed: -99 });
  expect(evaluate('claim',[{ valid: 1,have: 2,need: 2,claimed: 3,streak: 1,best: 3,next: 8,count: 1,a00: 4 }])).toMatchObject({ status: 1,claimed: 4,streak: 2,best: 3,next: 9,milestone: 0 });
  expect(evaluate('tear',[{ valid: 0,next: 8 }])).toMatchObject({ status: 0,streak: -99,next: -99 });
  expect(evaluate('tear',[{ valid: 1,next: 8 }])).toMatchObject({ status: 1,streak: 0,next: 9 });
  const use = { valid: 1,slots: 3,radius: 2,pointValid: 1 };
  expect(evaluate('use',[{ ...use,value: 0 }])).toMatchObject({ open: 1,operation: 0,slot: -1 });
  expect(evaluate('use',[{ ...use,value: 1,open: 1 }])).toMatchObject({ open: 0,operation: 0 });
  expect(evaluate('use',[{ ...use,value: 11,open: 1 }])).toMatchObject({ operation: 1,slot: 1 });
  expect(evaluate('use',[{ ...use,value: 22,open: 1 }])).toMatchObject({ operation: 2,slot: 2 });
  expect(evaluate('use',[{ ...use,value: 23,open: 1 }])).toMatchObject({ operation: 0,slot: -1 });
  const saved = Array.from({ length: 8 },(_,serial) => ({ serial,have: 1,need: 2,valid: 1 }));
  const snapshot = { count: 8,next: 8,slots: 8,claimed: 0,best: 0,streak: 0 };
  for (let slot = 0; slot < 8; slot++) expect(evaluate('restore',[{ ...snapshot,candidate: slot },...saved])).toMatchObject({ value: 1 });
  expect(evaluate('restore',[{ ...snapshot,candidate: 7 },...saved.slice(0,7),{ serial: 1,have: 1,need: 2,valid: 1 }])).toMatchObject({ value: 0 });
  expect(evaluate('restore',[{ ...snapshot,candidate: 0,best: 1 },...saved])).toMatchObject({ value: 0 });
  expect(evaluate('loadNext',[{ next: 8,serial: 9 }])).toMatchObject({ next: 10 });
  expect([...visited].sort()).toEqual(signals);
  return Promise.resolve();
} } satisfies DualPortFixture;
