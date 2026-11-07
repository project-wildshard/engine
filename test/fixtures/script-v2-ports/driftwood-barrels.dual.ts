/** Real barrel AS, with continuation columns and sampled body authorities.
 * The native body owner, public producer and save adapters remain unchanged. */
import barrels from '../../../src/shards/driftwood-isle/behaviour/barrels.as?raw';
import { BARREL_DECISION } from '../../../src/shards/driftwood-isle/generators/barrelDecision';
import { expect } from 'vitest';
import { simulationPair } from '../script-v2-projection';
import type { DualPortFixture } from '../script-v2-port';

const params = BARREL_DECISION[0].params;
const states = ['lost','wedge','fromX','fromY','fromZ','lastTick'] as const;
const samples = ['alive','bodyX','bodyY','bodyZ','playerX','playerY','playerZ','intentX','intentZ','floor','tick','start'] as const;
const boundary = `let io:usize=0;export function begin(base:usize):void{io=base;}
export namespace Body{export const barrel:i32=5;}
export namespace Params{${Object.entries(params).map(([name,value]) => `export const ${name}:f64=${String(value)};`).join('')}}
export class State{${states.map((name,i) => `static get ${name}():f64{return load<f64>(io+${256+i*8});}static set ${name}(value:f64){store<f64>(io+${256+i*8},value);}`).join('')}}
export class Clock{static get tick():i32{return i32(load<f64>(io+80));}}
@inline function body(id:i32):void{if(id!=Body.barrel)unreachable();}
@inline function player(id:i32):void{if(id!=0x7fffffff)unreachable();}
export namespace Read{
 export function bodyAlive(id:i32):bool{body(id);return load<f64>(io)!=0;}
 export function bodyX(id:i32):f64{body(id);return load<f64>(io+8);}
 export function bodyY(id:i32):f64{body(id);return load<f64>(io+16);}
 export function bodyZ(id:i32):f64{body(id);return load<f64>(io+24);}
 export function x(id:i32):f64{player(id);return load<f64>(io+32);}
 export function y(id:i32):f64{player(id);return load<f64>(io+40);}
 export function z(id:i32):f64{player(id);return load<f64>(io+48);}
 export function playerIntent(axis:i32):f64{if(axis<0||axis>1)unreachable();return load<f64>(io+56+usize(axis)*8);}
 export function declaredFloor(x:f64,z:f64):i32{store<f64>(io+552,1);store<f64>(io+560,x);store<f64>(io+568,z);return 1;}
}
export namespace List{export function at(i:i32):f64{if(i!=0)unreachable();return load<f64>(io+72);}}
export namespace Do{
 export function bodySpawn(id:i32):void{body(id);store<f64>(io+512,17);store<f64>(io+520,f64(id));}
 export function bodyTeleport(id:i32,x:f64,y:f64,z:f64):void{body(id);store<f64>(io+512,18);store<f64>(io+520,f64(id));store<f64>(io+528,x);store<f64>(io+536,y);store<f64>(io+544,z);}
}`;
const sources = { 'generated/driftwoodBarrels.ts': boundary };
const legacy = `import {onStart,onTick} from './barrels';import {begin} from './generated/driftwoodBarrels';
export function ws_abi():i32{return 1;}export function ws_io():i32{return 16384;}
export function ws_init(lo:i32,hi:i32):void{}
export function ws_handle():i32{begin(16384);if(load<f64>(16384+88)!=0)onStart();else onTick(0);return 0;}`;
const candidate = `import {onStart,onTick} from './barrels';import {begin} from './generated/driftwoodBarrels';
export function ws_abi():i32{return 2;}export function ws_io():i32{return 1024;}
export function ws_init(lo:i32,hi:i32,fuel:i32):i32{return 0;}
export function ws_step(tick:i32,fuel:i32):i32{begin(1024);store<f64>(1024+80,f64(tick));if(load<f64>(1024+88)!=0)onStart();else onTick(0);return 0;}`;
const input = {
  authored: new Map([['barrels.ts',barrels]]),legacy: { source: legacy,sources },
  candidate: { source: candidate,sources,lane: 'sim',ioBytes: 1024 },pages: 1,
} satisfies DualPortFixture['input'];
type Frame = Record<typeof samples[number],number>;
function numericState(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((entry: unknown) => typeof entry === 'number' && Number.isFinite(entry));
}

export const port = { input,verify: pair => {
  const compare = simulationPair(pair,{ ioBytes: 1024,output: [{ offset: 1280,count: 6,width: 8 },{ offset: 1536,count: 8,width: 8 }] });
  const home: Frame = { alive: 1,bodyX: params.homeX,bodyY: params.homeY+0.475,bodyZ: params.homeZ,
    playerX: params.homeX+30,playerY: params.homeY,playerZ: params.homeZ,intentX: 0,intentZ: 0,floor: params.homeY,tick: 0,start: 0 };
  const evaluate = (frame: Frame,state: readonly number[]) => compare(frame.tick,(view,base) => {
    new Uint8Array(view.buffer,base,1024).fill(0);
    samples.forEach((name,i) => { view.setFloat64(base+i*8,frame[name],true); });
    state.forEach((value,i) => { view.setFloat64(base+256+i*8,value,true); });
  },(view,base) => ({ state: states.map((_,i) => view.getFloat64(base+256+i*8,true)),
    command: Array.from({ length: 8 },(_,i) => view.getFloat64(base+512+i*8,true)) }));
  const fresh = (): number[] => states.map(() => 0);
  expect(evaluate({ ...home,start: 1,alive: 0,tick: 6 },fresh())).toMatchObject({ state: [0,0,0,0,0,6],command: [17,5,0,0,0,0,0,0] });
  expect(evaluate({ ...home,start: 1,tick: 6 },fresh()).command[0]).toBe(0);
  expect(evaluate({ ...home,alive: 0,tick: 12 },fresh()).state[5]).toBe(12);
  const beyond = evaluate({ ...home,bodyX: params.homeX+params.leash+1,tick: 6 },fresh());
  expect(beyond.command.slice(0,5)).toEqual([18,5,params.homeX,params.homeY+0.475+0.01,params.homeZ]);
  expect(evaluate({ ...home,tick: 6 },[2,2,0,0,0,0]).state.slice(0,2)).toEqual([0,0]);
  for (const [bodyX,bodyY,bodyZ] of [[params.plateAX,params.plateAY+0.475,params.plateAZ],[params.plateBX,params.plateBY+0.475,params.plateBZ]] as const) {
    expect(evaluate({ ...home,bodyX,bodyY,bodyZ,floor: params.water-2,tick: 6 },[2,2,0,0,0,0]).state.slice(0,2)).toEqual([0,0]);
  }
  const run = (kind: 'lost' | 'wedged' | 'rolling'): void => {
    let state = fresh(), teleports = 0;
    for (let tick = 6; tick <= 360; tick+=6) {
      const x = params.homeX+6+(kind === 'rolling' ? tick/6*0.05 : 0);
      const result = evaluate({ ...home,tick,bodyX: x,playerX: x-1,intentX: kind === 'lost' ? 0 : 3,
        floor: kind === 'lost' ? params.water-2 : params.homeY },state);
      const serialized = JSON.stringify(result.state), saved: unknown = JSON.parse(serialized);
      if (!numericState(saved)) throw new Error('Invalid round-tripped barrel continuation');state = saved;
      expect(JSON.stringify(state)).toBe(serialized);
      if (result.command[0] === 18) teleports++;
      if (tick <= 216) expect(teleports).toBe(0);
    }
    expect(teleports).toBe(kind === 'rolling' ? 0 : 1);
  };
  run('lost');run('wedged');run('rolling');
  return Promise.resolve();
} } satisfies DualPortFixture;
