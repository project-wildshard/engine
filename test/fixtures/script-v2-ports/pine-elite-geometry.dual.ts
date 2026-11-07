/** All three actual shared elite geometry helpers, compiled without editing
 * their authored body. Native movement and the shipping elite guests stay v1. */
import geometry from '../../../src/shards/pine-hollow/behaviour/elites/common.as?raw';
import { expect } from 'vitest';
import { projectionPair } from '../script-v2-projection';
import type { DualPortFixture } from '../script-v2-port';

const adapter = `import {heading,distance,fleeHeading} from './common';
export function evaluate(io:usize):void{
 const x=load<f64>(io),z=load<f64>(io+8),tx=load<f64>(io+16),tz=load<f64>(io+24);
 store<f64>(io+64,heading(x,z,tx,tz));store<f64>(io+72,distance(x,z,tx,tz));
 store<f64>(io+80,fleeHeading(x,z,tx,tz,load<f64>(io+32),load<f64>(io+40),load<f64>(io+48)));
}`;
const sources = { 'adapter.ts': adapter };
const legacy = `import {evaluate} from './adapter';
export function ws_abi():i32{return 1;}export function ws_io():i32{return 16384;}
export function ws_init(lo:i32,hi:i32):void{}
export function ws_handle():i32{evaluate(16384);return 0;}`;
const candidate = `import {evaluate} from './adapter';
export function ws_abi():i32{return 2;}export function ws_io():i32{return 1024;}
export function ws_init(lo:i32,hi:i32,fuel:i32):i32{return 0;}
export function ws_project(fuel:i32):i32{evaluate(1024);return 0;}`;
const input = {
  authored: new Map([['common.ts',geometry]]),legacy: { source: legacy,sources },
  candidate: { source: candidate,sources,lane: 'project',ioBytes: 656 },pages: 1,
} satisfies DualPortFixture['input'];

export const port = { input,verify: pair => {
  const compare = projectionPair(pair,{ ioBytes: 656,output: [{ offset: 1088,count: 3,width: 8 }] });
  for (const [x,z,tx,tz,homeX,homeZ,leash] of [
    [0,0,0,0,0,0,22],[0,0,3,4,0,0,22],[0,0,-3,-4,0,0,22],
    [0.000999,0,3,4,0,0,22],[0.001,0,3,4,0,0,22],[0.001001,0,3,4,0,0,22],
    [21,0,19,0,0,0,22],[22,0,19,0,0,0,22],[23,0,19,0,0,0,22],
    [40,-40,-40,40,2,3,22],[-100,100,-100,100,0,0,22],[1e-12,-1e-12,0,0,0,0,22],
  ] as const) {
    const values = [x,z,tx,tz,homeX,homeZ,leash];
    const answer = compare((view,base) => {
      new Uint8Array(view.buffer,base,656).fill(0);
      values.forEach((value,i) => { view.setFloat64(base+i*8,value,true); });
    },(view,base) => [view.getFloat64(base+64,true),view.getFloat64(base+72,true),view.getFloat64(base+80,true)]);
    expect(answer[0]).toBeCloseTo(Math.atan2(tx-x,tz-z),12);
    expect(answer[1]).toBeCloseTo(Math.hypot(tx-x,tz-z),12);
    expect(answer[2]).toBeGreaterThanOrEqual(-Math.PI);expect(answer[2]).toBeLessThanOrEqual(Math.PI);
  }
  return Promise.resolve();
} } satisfies DualPortFixture;
