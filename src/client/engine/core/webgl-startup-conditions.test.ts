import { afterEach, expect, test, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { readyWebGLContext, GAME_CONTEXT_ATTRIBUTES } from './webglStartup';

afterEach(() => { vi.useRealTimers(); });
function fixture() {
  let created = true, lost = true, precision = false, requests = 0;
  const gl = { VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, HIGH_FLOAT: 3, MEDIUM_FLOAT: 4, LOW_FLOAT: 5,
    isContextLost: () => lost, getShaderPrecisionFormat: () => precision ? {} : null };
  const canvas = Object.assign(new EventTarget(), { getContext: (kind: string, attributes: WebGLContextAttributes) => {
    expect(kind).toBe('webgl2'); expect(attributes).toBe(GAME_CONTEXT_ATTRIBUTES); requests++;
    return created ? gl : null;
  } });
  const owner = new Scope('startup-test');
  // The actual operation needs only the canvas's native event/capability ports.
  // Keep this fixture narrow without casting a partial renderer or GL context.
  const start = (): Promise<unknown> => {
    const result: unknown = Reflect.apply(readyWebGLContext, undefined, [canvas, () => undefined, owner]);
    if (!(result instanceof Promise)) throw new Error('Startup must return a promise');
    return result;
  };
  return { canvas, owner, gl, start, requests: () => requests,
    state: (exists: boolean, contextLost: boolean, precise: boolean) => { created = exists; lost = contextLost; precision = precise; } };
}

test('elapsed time cannot replace the actual context and complete precision capabilities', async () => {
  vi.useFakeTimers(); const f = fixture(); let completed = false;
  try {
    const ready = f.start().then(value => { completed = true; return value; });
    const lost = new Event('webglcontextlost', { cancelable: true }); f.canvas.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000); expect(completed).toBe(false);
    f.state(false, false, true); await vi.advanceTimersByTimeAsync(250); expect(completed).toBe(false);
    f.state(true, false, false); await vi.advanceTimersByTimeAsync(250); expect(completed).toBe(false);
    f.state(true, false, true); await vi.advanceTimersByTimeAsync(250);
    expect(await ready).toBe(f.gl); expect(f.requests()).toBeGreaterThan(3);
    expect(f.owner.census.listeners).toBe(0); expect(f.owner.census.timers).toBe(0);
  } finally { f.owner.dispose(); }
});

test('owner retirement ends pending capability queries without a late startup', async () => {
  vi.useFakeTimers(); const f = fixture();
  const pending = expect(f.start()).rejects.toThrow('owner left');
  const requests = f.requests(); f.owner.dispose(); await pending;
  f.state(true, false, true); await vi.advanceTimersByTimeAsync(60_000);
  expect(f.requests()).toBe(requests); expect(f.owner.census.listeners).toBe(0); expect(f.owner.census.timers).toBe(0);
  await expect(f.start()).rejects.toThrow('owner left');
});
