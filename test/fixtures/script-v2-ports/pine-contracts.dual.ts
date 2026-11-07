/** Real authored Pine helpers, compiled unchanged in both ABI closures. This
 * shadow check neither publishes a candidate nor changes the board producer. */
import rules from '../../../src/shards/pine-hollow/behaviour/contractsRules.as?raw';
import random from '../../../src/shards/pine-hollow/behaviour/contractsRandom.as?raw';
import { expect } from 'vitest';
import { ScriptModuleV2 } from '../../../src/shared/engine/script/moduleV2';
import type { DualPortFixture } from '../script-v2-port';

const adapter = `import {contractTag,contractElite,contractCounts,contractProgress,contractLoadedProgress,contractNear} from './rules';
import {contractRandom} from './random';
export function evaluate(io:usize):void{
 const x=load<f64>(io),y=load<f64>(io+8),z=load<f64>(io+16);
 store<f64>(io+64,contractTag(x,y,z,x,-1,z)?1:0);
 store<f64>(io+72,contractElite(x,y,x,z)?1:0);
 store<f64>(io+80,contractCounts(i32(z),x,y,-1,true,false,false,y,x,true,-1)?1:0);
 store<f64>(io+88,contractProgress(x,y,z!=0));
 store<f64>(io+96,contractLoadedProgress(x,y));
 store<f64>(io+104,contractNear(x,y,z,0,0,0,y)?1:0);
 store<f64>(io+112,contractRandom(x,y));
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
  authored: new Map([['rules.ts',rules],['random.ts',random]]),
  legacy: { source: legacy,sources },
  candidate: { source: candidate,sources,lane: 'project',ioBytes: 656 },pages: 1,
} satisfies DualPortFixture['input'];

const callable = (value: unknown): value is (...args: number[]) => unknown => typeof value === 'function';
function finite(value: number): number { if (!Number.isFinite(value)) throw new Error('Non-finite legacy output');return value; }
function invoke(instance: WebAssembly.Instance,name: string,...args: number[]): void {
  const method = instance.exports[name];if (!callable(method)) throw new Error('Missing admitted legacy entry');method(...args);
}
export const port = { input,verify: (pair) => {
  const memory = new WebAssembly.Memory({ initial: input.pages,maximum: input.pages });
  let fuel = 0, depth = 0;
  const instance = new WebAssembly.Instance(new WebAssembly.Module(Uint8Array.from(pair.legacy.bytes)),{ env: {
    memory,enter: () => { if (++depth > 64) throw new Error('Legacy stack exhausted'); },leave: () => { depth--; },
    fuel: (amount: number) => { fuel -= amount;if (fuel < 0) throw new Error('Legacy fuel exhausted'); },
    finite32: finite,finite64: finite,abort: () => { throw new Error('Legacy abort'); },
  } });
  fuel = 1_000_000_000;
  if (instance.exports['__start'] !== undefined) invoke(instance,'__start');invoke(instance,'ws_init',0,0);
  const module = new ScriptModuleV2(pair.candidate.bytes,{ seed: [0,0],initFuel: 1_000_000,ioBytes: input.candidate.ioBytes,output: [{ offset: 1088,count: 7,width: 8 }] });
  // Every exported authored rule stays live through dynamic inputs. Normal
  // and boundary decisions must match, rather than merely link/admit.
  for (const values of [[0,2,0],[1,2,1],[2,2,2],[-3.5,5,3],[9.5,4,-1],[4294967295,4294967296,1]]) {
    const write = (view: DataView,base: number): void => { values.forEach((value,i) => { view.setFloat64(base+i*8,value,true); }); };
    const read = (view: DataView,base: number): number[] => Array.from({ length: 7 },(_,i) => view.getFloat64(base+64+i*8,true));
    const legacyView = new DataView(memory.buffer);write(legacyView,16384);fuel = 1_000_000_000;invoke(instance,'ws_handle');
    expect(module.project(1_000_000,view => { write(view,module.io); },view => read(view,module.io)).value).toEqual(read(legacyView,16384));
    expect(depth).toBe(0);
  }
  return Promise.resolve();
} } satisfies DualPortFixture;
