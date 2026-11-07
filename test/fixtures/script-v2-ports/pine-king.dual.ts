/** Actual King AS with explicit binding continuation and buffered field
 * commands. Arena, collision, summons, lanes and saves keep their native owners. */
import king from '../../../src/shards/pine-hollow/behaviour/king.as?raw';
import { KING_FIELDS, KING_DECISION } from '../../../src/shards/pine-hollow/generators/kingDecision';
import { SCRIPT_V1_COMMANDS } from '@wildshard/format/scriptAbiV1';
import { expect } from 'vitest';
import { simulationPair } from '../script-v2-projection';
import type { DualPortFixture } from '../script-v2-port';

const alias = (name: string): string => name.replaceAll(/-([a-z])/gu,(_match,letter: string) => letter.toUpperCase());
const fields = KING_FIELDS.map(row => ({ id: row.id,default: row.default,alias: alias(row.name.slice(5)) }));
const moves = Object.keys(KING_DECISION[0].moves);
const states = ['wasLane','mode','modeT','strikeCd','burstCd','summonCd','chain'] as const;
const samples = ['event','dt','target','distance','moving','argument'] as const;
const boundary = `let io:usize=0;export function begin(base:usize):void{io=base;}
export namespace Actor{export const king:i32=1;}
export namespace Field{${fields.map(row => `export const ${row.alias}:i32=${row.id};`).join('')}}
export namespace Move{${moves.map((name,i) => `export const ${name}:i32=${i+1};`).join('')}}
export class State{${states.map((name,i) => name === 'wasLane'
  ? `static get ${name}():bool{return load<f64>(io+${256+i*8})!=0;}static set ${name}(v:bool){store<f64>(io+${256+i*8},v?1.0:0.0);}`
  : `static get ${name}():f64{return load<f64>(io+${256+i*8});}static set ${name}(v:f64){store<f64>(io+${256+i*8},v);}`).join('')}}
@inline function self(id:i32):void{if(id!=Actor.king)unreachable();}
export namespace Read{
 export function field(actor:i32,field:i32):f64{self(actor);if(field<100||field>=${100+fields.length})unreachable();return load<f64>(io+512+usize(field)*8);}
 export function nearestPlayer(actor:i32):i32{self(actor);return i32(load<f64>(io+16));}
 export function distance(actor:i32,target:i32):f64{self(actor);if(target!=2)unreachable();return load<f64>(io+24);}
 export function moving(actor:i32):bool{self(actor);return load<f64>(io+32)!=0;}
}
@inline function emit(op:i32,actor:i32,b:i32=0,c:f64=0):void{
 self(actor);const n=i32(load<f64>(io+1024));if(n>=32)unreachable();const at=io+2048+usize(n)*40;
 store<f64>(at,f64(op));store<f64>(at+8,f64(actor));store<f64>(at+16,f64(b));store<f64>(at+24,c);store<f64>(at+32,0);store<f64>(io+1024,f64(n+1));
}
export namespace Do{
 export function field(actor:i32,field:i32,value:f64):void{emit(${SCRIPT_V1_COMMANDS.field},actor,field,value);}
 export function move(actor:i32,move:i32,target:i32=0):void{emit(${SCRIPT_V1_COMMANDS.move},actor,move,f64(target));}
 export function stop(actor:i32):void{emit(${SCRIPT_V1_COMMANDS.stop},actor);}
}`;
const adapter = `import {onStart,onTick,onMoveDone,onThreshold,onStop,onDeath} from './king';
import {begin} from './generated/pineKingDecision';
export function handle(io:usize):void{
 begin(io);const event=i32(load<f64>(io)),value=i32(load<f64>(io+40));
 if(event==0)onStart();else if(event==1)onTick(load<f64>(io+8));else if(event==2)onMoveDone(value,true);
 else if(event==3)onThreshold(value);else if(event==4)onStop();else if(event==5)onDeath(2);else unreachable();
}`;
const sources = { 'generated/pineKingDecision.ts': boundary,'adapter.ts': adapter };
const legacy = `import {handle} from './adapter';
export function ws_abi():i32{return 1;}export function ws_io():i32{return 16384;}
export function ws_init(lo:i32,hi:i32):void{}
export function ws_handle():i32{handle(16384);return 0;}`;
const candidate = `import {handle} from './adapter';
export function ws_abi():i32{return 2;}export function ws_io():i32{return 1024;}
export function ws_init(lo:i32,hi:i32,fuel:i32):i32{return 0;}
export function ws_step(tick:i32,fuel:i32):i32{handle(1024);return 0;}`;
const input = {
  authored: new Map([['king.ts',king]]),legacy: { source: legacy,sources },
  candidate: { source: candidate,sources,lane: 'sim',ioBytes: 4096 },pages: 1,
} satisfies DualPortFixture['input'];
type Columns = Readonly<Record<string,number>>;

export const port = { input,verify: pair => {
  const compare = simulationPair(pair,{ ioBytes: 4096,output: [
    { offset: 1280,count: states.length,width: 8 },{ offset: 2048,count: 1,width: 8 },{ offset: 3072,count: 160,width: 8 },
  ] });
  const evaluate = (event: number,actor: Columns = {},state: Columns = {},observations: Partial<Record<typeof samples[number],number>> = {}) => compare(6,(view,base) => {
    new Uint8Array(view.buffer,base,4096).fill(0);
    const frame = { event,dt: 0.1,target: 2,distance: 20,moving: 0,argument: 0,...observations };
    samples.forEach((name,i) => { view.setFloat64(base+i*8,frame[name],true); });
    fields.forEach(row => { view.setFloat64(base+512+row.id*8,actor[row.alias] ?? row.default,true); });
    states.forEach((name,i) => { view.setFloat64(base+256+i*8,state[name] ?? 0,true); });
  },(view,base) => {
    const count = view.getFloat64(base+1024,true);if (!Number.isInteger(count) || count < 0 || count > 32) throw new Error('Invalid King command count');
    return { state: Object.fromEntries(states.map((name,i) => [name,view.getFloat64(base+256+i*8,true)])),
      commands: Array.from({ length: count },(_,i) => Array.from({ length: 5 },(_unused,j) => view.getFloat64(base+2048+i*40+j*8,true))) };
  });
  type Answer = ReturnType<typeof evaluate>;
  const field = (answer: Answer,name: string): number | undefined => {
    const row = fields.find(value => value.alias === name);if (row === undefined) throw new Error('Unknown King field');
    for (let i = answer.commands.length-1; i >= 0; i--) if (answer.commands[i]?.[0] === SCRIPT_V1_COMMANDS.field && answer.commands[i]?.[2] === row.id) return answer.commands[i]?.[3];
    return undefined;
  };
  const move = (answer: Answer,name: string): void => {
    if (!moves.includes(name)) throw new Error('Unknown King move');
    expect(answer.commands.some(row => row[0] === SCRIPT_V1_COMMANDS.move && row[2] === moves.indexOf(name)+1)).toBe(true);
  };
  const active = { mode: 3,modeT: 0,strikeCd: 2,burstCd: 4,summonCd: 20,chain: 0 };
  move(evaluate(0),'reset');
  const restored = evaluate(0,{ mode: 7,modeT: 1.5,strikeCd: 3,burstCd: 4,summonCd: 5,chain: 6 });
  expect(restored.state).toEqual({ wasLane: 0,mode: 7,modeT: 1.5,strikeCd: 3,burstCd: 4,summonCd: 5,chain: 6 });expect(restored.commands).toEqual([]);
  for (const [phase,name,mode] of [[0,'stalk',3],[1,'stalkFast',3],[2,'lanes',9]] as const) {
    const resumed = evaluate(0,{ mode: 3,phase });move(resumed,name);expect(resumed.state['mode']).toBe(mode);
    const threshold = evaluate(3,{},active,{ argument: phase });move(threshold,name);expect(field(threshold,'phase')).toBe(phase);
    if (phase === 1) expect(threshold.state['summonCd']).toBe(1.2);
    if (phase === 2) expect(threshold.state['chain']).toBe(0);
  }
  for (const argument of [-1,3]) expect(evaluate(3,{},active,{ argument }).commands).toEqual([]);
  move(evaluate(2,{ phase: 2 },active,{ argument: moves.indexOf('reset')+1 }),'lanes');
  const missing = evaluate(1,{},active,{ target: 0 });expect(missing.state['modeT']).toBe(0);expect(missing.commands).toEqual([]);
  const call = evaluate(1,{ phase: 1,adds: 2 },{ ...active,summonCd: 0.1 });move(call,'faceCall');expect(call.state['mode']).toBe(8);
  expect(evaluate(1,{ phase: 1,adds: 3 },{ ...active,summonCd: 0.1 }).state['mode']).toBe(3);
  const melee = evaluate(1,{}, { ...active,strikeCd: 0 },{ distance: 7.099 });move(melee,'face');expect(melee.state['mode']).toBe(4);
  expect(evaluate(1,{}, { ...active,strikeCd: 0 },{ distance: 7.1 }).state['mode']).toBe(3);
  const hit = evaluate(1,{}, { ...active,mode: 4,modeT: 0.8 });expect(field(hit,'strikeCd')).toBe(5);expect(field(hit,'request')).toBe(1);
  const rings = evaluate(1,{}, { ...active,mode: 5,modeT: 0.9 });expect(field(rings,'request')).toBe(2);expect(rings.state['mode']).toBe(6);
  move(evaluate(1,{ rings: 0 },{ ...active,mode: 6 }),'faceOpen');
  expect(evaluate(1,{ rings: 1 },{ ...active,mode: 6 }).state['mode']).toBe(6);
  for (const [phase,time,cd] of [[0,3.2,9],[1,2.6,7.5]] as const) expect(evaluate(1,{ phase },{ ...active,mode: 7,modeT: time },{ dt: 0 }).state['burstCd']).toBe(cd);
  const summoned = evaluate(1,{}, { ...active,mode: 8,modeT: 1.5 });expect(field(summoned,'request')).toBe(3);expect(summoned.state['summonCd']).toBe(20);
  expect(evaluate(1,{ phase: 2,lane: 1 },{ ...active,mode: 9 }).state['wasLane']).toBe(1);
  for (const [chain,time] of [[0,-1.5],[1,0.4]] as const) expect(evaluate(1,{ phase: 2 },{ ...active,mode: 9,chain,wasLane: 1 }).state).toMatchObject({ modeT: time,wasLane: 0 });
  expect(evaluate(1,{ phase: 2 },{ ...active,mode: 9,burstCd: 0 },{ distance: 13.99 }).state['mode']).toBe(5);
  expect(evaluate(1,{ phase: 2 },{ ...active,mode: 9,burstCd: 0 },{ distance: 14 }).state['mode']).toBe(9);
  expect(field(evaluate(1,{ phase: 2 },{ ...active,mode: 9,modeT: 1.2 },{ dt: 0 }),'request')).toBeUndefined();
  const lane = evaluate(1,{ phase: 2 },{ ...active,mode: 9,modeT: 1.20001 },{ dt: 0 });expect(field(lane,'request')).toBe(4);expect(lane.state['chain']).toBe(1);
  expect(evaluate(4).state['mode']).toBe(0);expect(field(evaluate(4),'fighting')).toBe(0);expect(evaluate(5).state['mode']).toBe(2);
  // Carry returned binding columns and publish field commands between calls,
  // as the retained owner does, through melee, summons and the lane phase.
  const actor: Record<string,number> = {};let state: Columns = {};
  const run = (event: number,observations: Partial<Record<typeof samples[number],number>> = {}): Answer => {
    const answer = evaluate(event,actor,state,observations);state = answer.state;
    for (const command of answer.commands) if (command[0] === SCRIPT_V1_COMMANDS.field) {
      const row = fields.find(value => value.id === command[2]), value = command[3];
      if (row === undefined || value === undefined) throw new Error('Invalid King field command');actor[row.alias] = value;
    }
    return answer;
  };
  run(0);run(2,{ argument: moves.indexOf('reset')+1 });
  run(1,{ dt: 2,distance: 6 });expect(state['mode']).toBe(4);
  expect(field(run(1,{ dt: 0.9 }),'request')).toBe(1);
  run(3,{ argument: 1 });run(1,{ dt: 1.2 });expect(state['mode']).toBe(8);
  expect(field(run(1,{ dt: 1.6 }),'request')).toBe(3);
  run(3,{ argument: 2 });actor['lane'] = 1;run(1);expect(state['wasLane']).toBe(1);
  actor['lane'] = 0;run(1);expect(state['modeT']).toBe(-1.5);
  expect(field(run(1,{ dt: 3 }),'request')).toBe(4);expect(state['chain']).toBe(1);
  return Promise.resolve();
} } satisfies DualPortFixture;
