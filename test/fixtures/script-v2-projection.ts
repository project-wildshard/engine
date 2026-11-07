import { expect } from 'vitest';
import { ScriptModuleV2 } from '../../src/shared/engine/script/moduleV2';
import type { FloatColumnV2 } from '@wildshard/format/scriptMemoryV2';
import type { DualPortFixture } from './script-v2-port';

const callable = (value: unknown): value is (...args: number[]) => unknown => typeof value === 'function';
function finite(value: number): number { if (!Number.isFinite(value)) throw new Error('Non-finite legacy output');return value; }

/** Execute both admitted shadow artifacts on the same samples. The v2 host
 * rewinds memory/globals on each entry; authored rules must consume explicit
 * continuation columns and agree with v1 across varying observations. */
function entryPair(pair: Parameters<DualPortFixture['verify']>[0],options: {
  readonly ioBytes: number; readonly output: readonly FloatColumnV2[];
}): <T>(tick: number | undefined,write: (view: DataView,base: number) => void,read: (view: DataView,base: number) => T) => T {
  const pages = pair.candidate.artifact.pages, memory = new WebAssembly.Memory({ initial: pages,maximum: pages });
  let fuel = 0, depth = 0;
  const instance = new WebAssembly.Instance(new WebAssembly.Module(Uint8Array.from(pair.legacy.bytes)),{ env: {
    memory,enter: () => { if (++depth > 64) throw new Error('Legacy stack exhausted'); },leave: () => { depth--; },
    fuel: (amount: number) => { fuel -= amount;if (fuel < 0) throw new Error('Legacy fuel exhausted'); },
    finite32: finite,finite64: finite,abort: () => { throw new Error('Legacy abort'); },
  } });
  const invoke = (name: string,...args: number[]): unknown => {
    const method = instance.exports[name];if (!callable(method)) throw new Error('Missing admitted legacy entry');return method(...args);
  };
  fuel = 1_000_000_000;
  if (instance.exports['__start'] !== undefined) invoke('__start');invoke('ws_init',0,0);
  const oldIO = invoke('ws_io');if (typeof oldIO !== 'number') throw new Error('Invalid legacy IO');
  const module = new ScriptModuleV2(pair.candidate.bytes,{ seed: [0,0],initFuel: 1_000_000,...options });
  return <T>(tick: number | undefined,write: (view: DataView,base: number) => void,read: (view: DataView,base: number) => T): T => {
    const oldView = new DataView(memory.buffer);write(oldView,oldIO);fuel = 1_000_000_000;invoke('ws_handle');
    const expected = read(oldView,oldIO);
    const supply = (view: DataView): void => { write(view,module.io); }, collect = (view: DataView): T => read(view,module.io);
    const actual = (tick === undefined ? module.project(1_000_000,supply,collect) : module.step(tick,1_000_000,supply,collect)).value;
    expect(actual).toEqual(expected);expect(depth).toBe(0);return actual;
  };
}

export function projectionPair(...args: Parameters<typeof entryPair>) {
  const run = entryPair(...args);
  return <T>(write: (view: DataView,base: number) => void,read: (view: DataView,base: number) => T): T => run(undefined,write,read);
}

/** Sim adapters carry the same explicit tick through the v2 work entry. */
export function simulationPair(...args: Parameters<typeof entryPair>) {
  const run = entryPair(...args);
  return <T>(tick: number,write: (view: DataView,base: number) => void,read: (view: DataView,base: number) => T): T => run(tick,write,read);
}
