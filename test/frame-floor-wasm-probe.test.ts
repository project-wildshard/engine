import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Test the serialized blank-page protocol without touching global native constructors.
import { createContext, runInContext } from 'node:vm';
import { runWasmMemoryProbe } from '../scripts/frame-floor-wasm-probe.mjs';
import { WASM_CONSTRUCTORS_SCRIPT } from '../scripts/frame-floor-wasm-constructors.mjs';
import { validateFrameFloorArgs } from '../scripts/frame-floor-args.mjs';

test('requires native/Timeline evidence and refuses quiet or a different surface', () => {
  const args = ['--wasm-memory-probe', '--surface=sim', '--wasm-constructors=tmp/native', '--webkit-timeline=tmp/timeline'];
  expect(() => validateFrameFloorArgs(args)).not.toThrow();
  expect(() => validateFrameFloorArgs([...args, '--worker'])).not.toThrow();
  expect(() => validateFrameFloorArgs([...args, '--quiet'])).toThrow('no-quiet Simulator');
  expect(() => validateFrameFloorArgs(['--wasm-memory-probe', '--surface=desktop'])).toThrow();
  expect(() => validateFrameFloorArgs(['--wasm-memory-probe', '--surface=sim'])).toThrow();
});

test('constructs the exact imported-memory bank and checks weak targets only after all probes', async () => {
  const waits: number[] = [];
  let clock = 0, weakReads = 0, memoryCountAtFirstWeakRead: unknown;
  const context = createContext({
    window: {},
    performance: { timeOrigin: 1234, now: () => ++clock },
    WebAssembly: { Memory: WebAssembly.Memory, Module: WebAssembly.Module, Instance: WebAssembly.Instance },
    WeakRef: class {
      readonly #weak: WeakRef<object>;
      constructor(target: object) { this.#weak = new WeakRef(target); }
      deref(): object | undefined {
        if (weakReads++ === 0) memoryCountAtFirstWeakRead = runInContext('window.__wasmDurationCensus.rows.filter(r => r.kind === "Memory").length', context);
        return this.#weak.deref();
      }
    },
    FinalizationRegistry,
    setTimeout: (receive: () => void, ms: number) => { waits.push(ms); queueMicrotask(receive); },
    requestAnimationFrame: () => { throw new Error('No rAF belongs in the blank probe'); },
  });
  runInContext(WASM_CONSTRUCTORS_SCRIPT, context);
  const promise: unknown = runInContext(`(${runWasmMemoryProbe.toString()})()`, context);
  const result: unknown = await promise;
  const expectedConstructions: unknown = expect.arrayContaining([
      expect.objectContaining({ id: 1, phase: 'fresh-baseline', strongBefore: 0 }),
      expect.objectContaining({ id: 38, phase: 'hold-to-38', strongBefore: 37 }),
      expect.objectContaining({ id: 39, phase: 'retained-probe', strongBefore: 38 }),
      expect.objectContaining({ id: 42, phase: 'retained-probe', strongBefore: 41 }),
      expect.objectContaining({ id: 43, phase: 'post-drop-probe', strongBefore: 0 }),
      expect.objectContaining({ id: 46, phase: 'post-drop-probe', strongBefore: 3 }),
    ]);
  expect(result).toEqual(expect.objectContaining({ strongHeldAtCheckpoint: 4, strongBankVerifiedBeforeDrop: 42, weakAvailable: true, finalizationAvailable: true,
    constructions: expectedConstructions,
  }));
  const counts: unknown = runInContext(`(() => { const r = window.__wasmDurationCensus.rows; return [r.filter(v => v.kind === 'Memory').length, r.filter(v => v.kind === 'Instance').length, r.filter(v => v.kind === 'Module').length]; })()`, context);
  expect(counts).toEqual([46, 46, 1]);
  expect(memoryCountAtFirstWeakRead).toBe(46);
  expect(weakReads).toBe(84);
  expect(waits).toEqual([...Array.from({ length: 42 }, () => 50), 200, 0, 50, 50, 50, 50, 1000]);
});
