/** Real captain AS behind two shadow ABIs. Commands stay buffered: reads see
 * the supplied actor snapshot, while pending reset columns update immediately. */
import captain from '../../../src/shards/driftwood-isle/behaviour/captain.as?raw';
import { CAPTAIN_FIELDS } from '../../../src/shards/driftwood-isle/generators/captainFields';
import { SCRIPT_V1_COMMANDS } from '@wildshard/format/scriptAbiV1';
import { expect } from 'vitest';
import { simulationPair } from '../script-v2-projection';
import type { DualPortFixture } from '../script-v2-port';

const alias = (name: string): string => name.replaceAll(/-([a-z])/gu,(_match,letter: string) => letter.toUpperCase());
const fields = CAPTAIN_FIELDS.map(row => alias(row.name));
const moves = ['rise','sink','relocate','home','homeFast','homeRage','stalk','stalkFast','stalkRage'] as const;
const strikes = ['swing','fast','rage','second','burst'] as const;
const samples = ['event','dt','hp','target','x','z','playerX','playerZ','distance','move'] as const;
const ids = (names: readonly string[]): string => names.map((name,i) => `export const ${name}:i32=${i+1};`).join('');
const boundary = `let io:usize=0;export function begin(base:usize):void{io=base;}
export namespace Actor{export const captain:i32=1;}
export namespace Field{${ids(fields)}}export namespace Move{${ids(moves)}}export namespace Strike{${ids(strikes)}}
export class State{
 static get resetCd():f64{return load<f64>(io+256);}static set resetCd(value:f64){store<f64>(io+256,value);}
 static get resetSubt():bool{return load<f64>(io+264)!=0;}static set resetSubt(value:bool){store<f64>(io+264,value?1.0:0.0);}
}
@inline function self(id:i32):void{if(id!=Actor.captain)unreachable();}
export namespace Read{
 export function field(actor:i32,field:i32):f64{self(actor);if(field<1||field>${fields.length})unreachable();return load<f64>(io+512+usize(field)*8);}
 export function hpShare(actor:i32):f64{self(actor);return load<f64>(io+16);}
 export function nearestPlayer(actor:i32):i32{self(actor);return i32(load<f64>(io+24));}
 export function x(actor:i32):f64{if(actor!=1&&actor!=2)unreachable();return load<f64>(io+(actor==1?32:48));}
 export function z(actor:i32):f64{if(actor!=1&&actor!=2)unreachable();return load<f64>(io+(actor==1?40:56));}
 export function distance(actor:i32,target:i32):f64{self(actor);if(target!=2)unreachable();return load<f64>(io+64);}
 export function random():f64{const n=i32(load<f64>(io+272));if(n>=2)unreachable();store<f64>(io+272,f64(n+1));return load<f64>(io+128+usize(n)*8);}
}
@inline function emit(op:i32,a:i32,b:i32=0,c:f64=0,d:f64=0):void{
 const n=i32(load<f64>(io+1024));if(n>=32)unreachable();const at=io+2048+usize(n)*40;
 store<f64>(at,f64(op));store<f64>(at+8,f64(a));store<f64>(at+16,f64(b));store<f64>(at+24,c);store<f64>(at+32,d);store<f64>(io+1024,f64(n+1));
}
export namespace Do{
 export function field(actor:i32,field:i32,value:f64):void{self(actor);emit(${SCRIPT_V1_COMMANDS.field},actor,field,value);}
 export function move(actor:i32,move:i32,target:i32=0):void{self(actor);emit(${SCRIPT_V1_COMMANDS.move},actor,move,f64(target));}
 export function strike(actor:i32,strike:i32,target:i32=0):void{self(actor);emit(${SCRIPT_V1_COMMANDS.strike},actor,strike,f64(target));}
 export function stop(actor:i32):void{self(actor);emit(${SCRIPT_V1_COMMANDS.stop},actor);}
}`;
const adapter = `import {onStart,onTick,onStrikeDone,onMoveDone,onStop,onDeath} from './captain';
import {begin,Move} from './generated/driftwoodCaptainDecision';
export function handle(io:usize):void{
 begin(io);const event=i32(load<f64>(io)),dt=load<f64>(io+8);
 if(event==0)onStart();else if(event==1)onTick(dt);else if(event==2)onStrikeDone(0,true);
 else if(event==3)onMoveDone(i32(load<f64>(io+72)),true);else if(event==4)onStop();else if(event==5)onDeath(2);
 else if(event==6){onMoveDone(Move.rise,true);onTick(dt);}else unreachable();
}`;
const sources = { 'generated/driftwoodCaptainDecision.ts': boundary,'adapter.ts': adapter };
const legacy = `import {handle} from './adapter';
export function ws_abi():i32{return 1;}export function ws_io():i32{return 16384;}
export function ws_init(lo:i32,hi:i32):void{}
export function ws_handle():i32{handle(16384);return 0;}`;
const candidate = `import {handle} from './adapter';
export function ws_abi():i32{return 2;}export function ws_io():i32{return 1024;}
export function ws_init(lo:i32,hi:i32,fuel:i32):i32{return 0;}
export function ws_step(tick:i32,fuel:i32):i32{handle(1024);return 0;}`;
const input = {
  authored: new Map([['captain.ts',captain]]),legacy: { source: legacy,sources },
  candidate: { source: candidate,sources,lane: 'sim',ioBytes: 4096 },pages: 1,
} satisfies DualPortFixture['input'];

export const port = { input,verify: pair => {
  const compare = simulationPair(pair,{ ioBytes: 4096,output: [
    { offset: 1280,count: 3,width: 8 },{ offset: 2048,count: 1,width: 8 },{ offset: 3072,count: 160,width: 8 },
  ] });
  const defaults = new Map(CAPTAIN_FIELDS.map(row => [alias(row.name),row.default] as const));
  const evaluate = (event: number,actor: Readonly<Record<string,number>> = {},observations: Partial<Record<typeof samples[number],number>> = {},pending: readonly number[] = [-1,0]) => compare(6,(view,base) => {
    new Uint8Array(view.buffer,base,4096).fill(0);
    const frame = { event,dt: 0.1,hp: 1,target: 2,x: 0,z: 0,playerX: 0,playerZ: 0,distance: 4,move: 0,...observations };
    samples.forEach((name,i) => { view.setFloat64(base+i*8,frame[name],true); });
    fields.forEach((name,i) => { view.setFloat64(base+512+(i+1)*8,actor[name] ?? defaults.get(name) ?? 0,true); });
    view.setFloat64(base+256,pending[0] ?? -1,true);view.setFloat64(base+264,pending[1] ?? 0,true);
    view.setFloat64(base+128,0.25,true);view.setFloat64(base+136,0.5,true);
  },(view,base) => {
    const count = view.getFloat64(base+1024,true);if (!Number.isInteger(count) || count < 0 || count > 32) throw new Error('Invalid captain command count');
    return { pending: [view.getFloat64(base+256,true),view.getFloat64(base+264,true)],draws: view.getFloat64(base+272,true),
      commands: Array.from({ length: count },(_,i) => Array.from({ length: 5 },(_unused,j) => view.getFloat64(base+2048+i*40+j*8,true))) };
  });
  type Answer = ReturnType<typeof evaluate>;
  const field = (answer: Answer,name: string): number | undefined => {
    const id = fields.indexOf(name)+1;if (id === 0) throw new Error('Unknown captain field');
    for (let i = answer.commands.length-1; i >= 0; i--) {
      const row = answer.commands[i];if (row?.[0] === SCRIPT_V1_COMMANDS.field && row[2] === id) return row[3];
    }
    return undefined;
  };
  const move = (answer: Answer,name: typeof moves[number]): void => {
    expect(answer.commands.some(row => row[0] === SCRIPT_V1_COMMANDS.move && row[2] === moves.indexOf(name)+1)).toBe(true);
  };
  const strike = (answer: Answer,name: typeof strikes[number]): void => {
    expect(answer.commands.some(row => row[0] === SCRIPT_V1_COMMANDS.strike && row[2] === strikes.indexOf(name)+1)).toBe(true);
  };
  const start = evaluate(0,{}, { x: 10,z: 11 });move(start,'rise');expect(field(start,'init')).toBe(1);expect(field(start,'poolX')).toBe(10);expect(start.pending).toEqual([1,0]);
  for (const [hp,phase,stalk,home,swing] of [[1,1,'stalk','home','swing'],[0.66,2,'stalkFast','homeFast','fast'],[0.33,3,'stalkRage','homeRage','rage']] as const) {
    move(evaluate(0,{ init: 1,st: 2 },{ hp }),stalk);
    const outside = evaluate(1,{ st: 2,arena: 22 },{ hp,playerX: 22 });move(outside,home);expect(field(outside,'phase')).toBe(phase);
    const attack = evaluate(1,{ st: 2 },{ hp,distance: 2.299 });strike(attack,swing);expect(field(attack,'st')).toBe(3);
  }
  expect(evaluate(1,{ st: 2 },{ target: 0 }).commands.every(row => row[0] === SCRIPT_V1_COMMANDS.field)).toBe(true);
  const edge = evaluate(1,{ st: 2 },{ distance: 2.3 });move(edge,'stalk');expect(field(edge,'st')).toBeUndefined();
  for (const [hp,subt] of [[0.5,7.1],[0.3,5.1]] as const) {
    const sink = evaluate(1,{ st: 2,subt },{ hp });move(sink,'sink');expect(field(sink,'st')).toBe(4);
  }
  move(evaluate(0,{ init: 1,st: 4 }),'sink');
  strike(evaluate(0,{ init: 1,st: 3 },{ hp: 0.3 }),'second');
  const second = evaluate(2,{ st: 3 },{ hp: 0.3 });strike(second,'second');expect(field(second,'combo')).toBe(1);
  const finished = evaluate(2,{ st: 3,combo: 1 },{ hp: 0.3 });expect(field(finished,'combo')).toBe(0);expect(field(finished,'cd')).toBe(0.8);move(finished,'stalkRage');
  const sameStep = evaluate(6,{ st: 1,cd: 4,subt: 9 });expect(field(sameStep,'cd')).toBe(0.5);expect(field(sameStep,'subt')).toBe(0.1);expect(sameStep.pending).toEqual([-1,0]);
  const risen = evaluate(3,{ st: 1 },{ move: moves.indexOf('rise')+1 });expect(field(risen,'st')).toBe(2);expect(risen.pending).toEqual([0.6,1]);
  const burst = evaluate(3,{ st: 4,arena: 22 },{ move: moves.indexOf('sink')+1,playerX: 100 });expect(burst.draws).toBe(2);expect(field(burst,'st')).toBe(5);
  const bx = field(burst,'burstX'), bz = field(burst,'burstZ');if (bx === undefined || bz === undefined) throw new Error('Missing burst location');
  expect(Math.hypot(bx,bz)).toBeCloseTo(20,12);
  expect(evaluate(3,{ st: 4 },{ move: moves.indexOf('sink')+1,target: 0 }).draws).toBe(0);
  move(evaluate(1,{ st: 5,subt: 1.1 },{ dt: 0.1 }),'relocate');
  expect(field(evaluate(1,{ st: 5,subt: 1.1 },{ dt: 0 }),'st')).toBeUndefined();
  const relocated = evaluate(3,{ st: 1 },{ move: moves.indexOf('relocate')+1 });strike(relocated,'burst');move(relocated,'rise');
  for (const event of [4,5]) expect(evaluate(event).commands).toEqual([[SCRIPT_V1_COMMANDS.stop,1,0,0,0]]);
  // The host publishes field commands only after the entry, then lends that
  // snapshot and the pending reset columns to the next step of the fight.
  const actor: Record<string,number> = {};let pending = [-1,0];
  const run = (event: number,observations: Partial<Record<typeof samples[number],number>> = {}): Answer => {
    const answer = evaluate(event,actor,{ hp: 0.3,...observations },pending);pending = answer.pending;
    for (const command of answer.commands) if (command[0] === SCRIPT_V1_COMMANDS.field) {
      const name = fields[(command[2] ?? 0)-1], value = command[3];
      if (name === undefined || value === undefined) throw new Error('Invalid captain field command');actor[name] = value;
    }
    return answer;
  };
  run(0);expect(actor['st']).toBe(1);
  run(3,{ move: moves.indexOf('rise')+1 });expect(actor['st']).toBe(2);
  strike(run(1,{ distance: 2,dt: 1 }),'rage');expect(actor['st']).toBe(3);
  strike(run(2),'second');expect(actor['combo']).toBe(1);
  move(run(2),'stalkRage');expect(actor['combo']).toBe(0);expect(actor['st']).toBe(2);
  move(run(1,{ dt: 6 }),'sink');expect(actor['st']).toBe(4);
  run(3,{ move: moves.indexOf('sink')+1,playerX: 100 });expect(actor['st']).toBe(5);
  move(run(1,{ dt: 1.2 }),'relocate');expect(actor['st']).toBe(1);
  strike(run(3,{ move: moves.indexOf('relocate')+1 }),'burst');
  run(3,{ move: moves.indexOf('rise')+1 });expect(actor['st']).toBe(2);expect(pending).toEqual([0.6,1]);
  return Promise.resolve();
} } satisfies DualPortFixture;
