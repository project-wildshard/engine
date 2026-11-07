/** Shadow the shipped H9 view body under both ABIs. Its private sway and clock
 * survive display frames; no live view source, producer or module is changed. */
import bridge from '../../../src/shards/driftwood-isle/behaviour/bridgeSway.as?raw';
import page from '../../../src/shards/driftwood-isle/data/questPageComposition.json' with { type: 'json' };
import { ViewLane } from '../../../src/shared/engine/script/viewLane';
import { expect } from 'vitest';
import type { DualPortFixture } from '../script-v2-port';

const legacy = `import {ws_init as init,ws_view as view} from './bridgeSway';
export function ws_abi():i32{return 1;}export function ws_io():i32{return 1024;}
export function ws_init(lo:i32,hi:i32):void{init(lo,hi,0);}
export function ws_handle():i32{view(load<f64>(1104),load<f64>(1112),1000000);return 0;}`;
const candidate = `import {ws_init as init,ws_view as view} from './bridgeSway';
export function ws_abi():i32{return 2;}export function ws_io():i32{return 1024;}
export function ws_init(lo:i32,hi:i32,fuel:i32):i32{return init(lo,hi,fuel);}
export function ws_view(dt:f64,alpha:f64,fuel:i32):i32{return view(dt,alpha,fuel);}`;
const input = { authored: new Map([['bridgeSway.ts',bridge]]),legacy: { source: legacy },candidate: { source: candidate,lane: 'view',ioBytes: 4096 },pages: 1 } satisfies DualPortFixture['input'];
const callable = (value: unknown): value is (...args: number[]) => unknown => typeof value === 'function';

export const port = { input,verify: pair => {
  let fuel = 1_000_000_000, depth = 0;
  const memory = new WebAssembly.Memory({ initial: 1,maximum: 1 });
  const finite = (value: number): number => { if (!Number.isFinite(value)) throw new Error('Non-finite legacy view output');return value; };
  const instance = new WebAssembly.Instance(new WebAssembly.Module(Uint8Array.from(pair.legacy.bytes)),{ env: {
    memory,enter: () => { if (++depth > 64) throw new Error('Legacy view stack exhausted'); },leave: () => { depth--; },
    fuel: (amount: number) => { fuel -= amount;if (fuel < 0) throw new Error('Legacy view fuel exhausted'); },
    finite32: finite,finite64: finite,abort: () => { throw new Error('Legacy view abort'); },
  } });
  const call = (name: string,...args: number[]): unknown => {
    const method = instance.exports[name];if (!callable(method)) throw new Error('Missing admitted legacy view entry');return method(...args);
  };
  if (instance.exports['__start'] !== undefined) call('__start');call('ws_init',0,0);
  expect(call('ws_io')).toBe(1024);
  let uploads = 0, values: number[] = [];
  const lane = new ViewLane(pair.candidate.bytes,1,{
    bindings: [{ handle: 1,columns: 13 }],transforms: [],channels: 2,
    bounds: { translation: 1,scale: [1,1],shear: 0 },targetMs: 100,fuel: 1_000_000,
  },{ write: () => { throw new Error('Bridge view must not write transforms'); },channels: bank => { values = Array.from(bank); },upload: () => { uploads++; } });
  const oldView = new DataView(memory.buffer), io = 1024;
  const s = page.sway, parameters = [s.height,s.ease,s.threshold,s.rate,s.speed,s.rollHz,s.roll,s.dipHz,s.dip];
  let sway = 0, clock = 0;
  for (let frame = 0; frame < 480; frame++) {
    const dt = frame%41 === 0 ? 0 : frame%37 === 0 ? 0.5 : frame%3 === 0 ? 1/30 : 1/60;
    const floor = frame%97 < 70 ? 1 : 0, y = frame%89 < 70 ? 0 : s.height+1, speed = frame%23;
    const current = [floor,y,0,speed,...parameters], sample = { previousTick: frame,currentTick: frame+1,values: [...current,...current] };
    expect(lane.frame(dt,(frame%10)/10,frame+1,frame%31 === 0 ? [] : [sample],60,() => 0)).toBe(true);
    // Copy only the host IO region, leaving each instance's private globals
    // intact. Poison both replies so copied candidate results cannot mask a
    // missing legacy write. Neither guest allocates in its IO columns.
    new Uint8Array(memory.buffer,io,4096).set(new Uint8Array(lane.memory.buffer,io,4096));
    const entry = io+128+(18-1)*24, channel = io+oldView.getUint32(entry+4,true);
    oldView.setFloat64(channel,Number.NaN,true);oldView.setFloat64(channel+8,Number.NaN,true);
    oldView.setUint32(entry+16,0,true);oldView.setUint32(io+76,0,true);
    fuel = 1_000_000_000;expect(call('ws_handle')).toBe(0);expect(depth).toBe(0);
    expect(oldView.getUint32(entry+16,true)).toBe(2);expect(oldView.getUint32(io+76,true)).toBe(2);
    expect([oldView.getFloat64(channel,true),oldView.getFloat64(channel+8,true)]).toEqual(values);
    let roll = 0, dip = 0;
    if (frame%31 !== 0) {
      const on = floor > 0.5 && Math.abs(y) < s.height ? 1 : 0;
      sway += (on-sway)*Math.min(1,dt*s.ease);
      if (sway >= s.threshold) {
        clock += dt*(s.rate+speed*s.speed);
        roll = Math.sin(clock*s.rollHz)*s.roll*sway;dip = Math.sin(clock*s.dipHz)*s.dip*sway;
      }
    }
    expect(values[0]).toBeCloseTo(roll,14);expect(values[1]).toBeCloseTo(dip,14);
    expect(lane.isFrozen).toBe(false);expect(lane.interval).toBe(1);expect(uploads).toBe(frame+1);
  }
  return Promise.resolve();
} } satisfies DualPortFixture;
