import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Isolate the injected page observer from the test process's constructors.
import { createContext, runInContext } from 'node:vm';
import { WASM_CONSTRUCTORS_SCRIPT, SCRIPT_MEMORY_POOL } from '../scripts/frame-floor-wasm-constructors.mjs';
import { validateFrameFloorArgs } from '../scripts/frame-floor-args.mjs';

test('admits the diagnostic flag for the original Sim worker and refuses other surfaces', () => {
  const args = ['--surface=sim', '--shards=grid', '--grid-scenario=runtime-travel', '--wasm-constructors=tmp/observe'];
  expect(() => validateFrameFloorArgs(args)).not.toThrow();
  expect(() => validateFrameFloorArgs(['--worker', ...args])).not.toThrow();
  expect(() => validateFrameFloorArgs(['--surface=desktop', '--wasm-constructors=tmp/observe'])).toThrow('require --surface=sim');
});

test('reads pool counters once with the original receiver and accepts older app pins', () => {
  let reads = 0;
  const probe = { scriptMemory() { expect(this).toBe(probe); reads++; return { hits: reads, misses: 0 }; } };
  const context = createContext({ window: { __wildshard: probe } });
  const before: unknown = runInContext(SCRIPT_MEMORY_POOL, context);
  const after: unknown = runInContext(SCRIPT_MEMORY_POOL, context);
  expect(before).toEqual({ hits: 1, misses: 0 });
  expect(after).toEqual({ hits: 2, misses: 0 });
  expect(reads).toBe(2);
  expect(runInContext(SCRIPT_MEMORY_POOL, createContext({ window: {} }))).toBeNull();
});

function page(): { evaluate: (source: string) => unknown } {
  let clock = 0;
  const context = createContext({
    window: { __wildshard: { world: { game: { frameCount: 7, frameRafTime: 32 } } } },
    performance: { timeOrigin: 1234, now: () => ++clock },
    WebAssembly: { Memory: WebAssembly.Memory, Module: WebAssembly.Module, Instance: WebAssembly.Instance },
    // Any new scheduling/subscription would fail the observer before app boot.
    requestAnimationFrame: () => { throw new Error('Unexpected frame subscription'); },
    setTimeout: () => { throw new Error('Unexpected timer'); },
  });
  runInContext(WASM_CONSTRUCTORS_SCRIPT, context);
  return { evaluate: (source) => { const value: unknown = runInContext(source, context); return value; } };
}

test('preserves native prototypes, newTarget, module/instance links and original frame clocks', () => {
  const fixture = page();
  expect(fixture.evaluate(`(() => {
    class Derived extends WebAssembly.Memory {}
    const memory = new Derived({ initial: 1 });
    const module = new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0]));
    const instance = new WebAssembly.Instance(module, { env: { memory } });
    return memory instanceof Derived && memory instanceof WebAssembly.Memory && instance instanceof WebAssembly.Instance;
  })()`)).toBe(true);
  expect(fixture.evaluate('window.__wasmDurationCensus')).toEqual({
    origin: 1234, installedAt: 1, dropped: 0,
    rows: [
      expect.objectContaining({ sequence: 1, kind: 'Memory', startMs: 2, endMs: 3, durationMs: 1,
        beforeFrame: 7, afterFrame: 7, previousRafMs: 32, memory: 1, descriptor: { initial: 1 }, success: true }),
      expect.objectContaining({ sequence: 2, kind: 'Module', durationMs: 1, module: 1, byteLength: 8 }),
      expect.objectContaining({ sequence: 3, kind: 'Instance', durationMs: 1, module: 1, memory: 1 }),
    ],
  });
});

test('propagates native refusal and bounds the diagnostic bank without blocking later constructors', () => {
  const fixture = page();
  expect(() => fixture.evaluate('new WebAssembly.Memory({ initial: -1 })')).toThrow();
  expect(fixture.evaluate('window.__wasmDurationCensus.rows[0]')).toEqual(expect.objectContaining({ success: false, kind: 'Memory', durationMs: 1 }));
  expect(fixture.evaluate(`(() => {
    for (let i = 0; i < 1025; i++) new WebAssembly.Memory({ initial: 0 });
    return { rows: window.__wasmDurationCensus.rows.length, dropped: window.__wasmDurationCensus.dropped };
  })()`)).toEqual({ rows: 1024, dropped: 2 });
});
