import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MeshBasicMaterial, PerspectiveCamera, Scene, WebGLRenderer, WebGLRenderTarget } from 'three';
import { installScopeEnvironment, scopeEnvironment } from '../../../shared/engine/app/scopeEnvironment';
import { noteFrameDrawn } from '../../../shared/engine/core/framePacing';
import { compileOffscreenPass } from '../render/precompile';

const environment = scopeEnvironment(), animationFrame = globalThis.requestAnimationFrame, messageChannel = globalThis.MessageChannel;
let cpuMs = 0, epoch = 0, frame = 0;
const now = (): number => Date.now() - epoch + cpuMs;
const microtasks = async (): Promise<void> => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  epoch = Date.now(); cpuMs = 0; frame = 0;
  vi.spyOn(performance, 'now').mockImplementation(now);
  Reflect.set(globalThis, 'MessageChannel', undefined); Reflect.set(globalThis, 'requestAnimationFrame', () => 0);
  installScopeEnvironment({ ...environment, frame: render => Number(setTimeout(() => { render(now()); }, 16 - (Date.now() - epoch) % 16)), cancelFrame: id => { clearTimeout(id); } });
  noteFrameDrawn(now(), now(), 60);
});
afterEach(() => {
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); installScopeEnvironment(environment);
  Reflect.set(globalThis, 'requestAnimationFrame', animationFrame); Reflect.set(globalThis, 'MessageChannel', messageChannel);
  noteFrameDrawn(Number.NEGATIVE_INFINITY);
});

test.each([
  { query: 0, resolve: 0, compile: 0, ready: true, cancel: false },
  { query: 0, resolve: 0, compile: 0, ready: false, cancel: false },
  { query: 20, resolve: 20, compile: 20, ready: false, cancel: false },
  { query: 0, resolve: 20, compile: 0, ready: false, cancel: false },
  { query: 0, resolve: 0, compile: 20, ready: true, cancel: true },
])('offscreen links pace measured query=$query/resolve=$resolve costs (ready=$ready, cancel=$cancel)', async ({ query, resolve, compile, ready, cancel }) => {
  const renderer: unknown = Object.create(WebGLRenderer.prototype);
  if (!(renderer instanceof WebGLRenderer)) throw new Error('Missing renderer');
  const material = new MeshBasicMaterial(), prior = new WebGLRenderTarget(1, 1), target = new WebGLRenderTarget(1, 1);
  let bound = prior, face = 4, mip = 2;
  const events: { kind: string; frame: number; program: number }[] = [];
  const restored = (): void => { expect(bound).toBe(prior); expect(face).toBe(4); expect(mip).toBe(2); };
  const programs = new Map([0, 1, 2].map(id => [String(id), {
    isReady: (): boolean => { restored(); events.push({ kind: 'query', frame, program: id }); cpuMs += query; return ready; },
    getUniforms: (): void => { restored(); events.push({ kind: 'resolve', frame, program: id }); cpuMs += resolve; },
  }]));
  const fields: Record<string, unknown> = {
    properties: { has: () => true, get: () => ({ programs }) },
    getRenderTarget: () => bound, getActiveCubeFace: () => face, getActiveMipmapLevel: () => mip,
    setRenderTarget: (next: WebGLRenderTarget, nextFace = 0, nextMip = 0) => { bound = next; face = nextFace; mip = nextMip; },
    compile: () => { expect(bound).toBe(target); events.push({ kind: 'compile', frame, program: -1 }); cpuMs += compile; return new Set([material]); },
  };
  for (const [key, value] of Object.entries(fields)) Reflect.set(renderer, key, value);
  let current = true;
  const drawing = setInterval(() => { frame++; noteFrameDrawn(now(), now(), 60); if (cancel) current = false; }, 16);
  try {
    let done = false;
    const pending = (async (): Promise<unknown> => {
      try { await compileOffscreenPass(renderer, { scene: new Scene(), camera: new PerspectiveCamera(), target }, () => current); return null; }
      catch (error) { return error; }
      finally { done = true; clearInterval(drawing); }
    })();
    // Drain each turn's native Promise chain before advancing the next fake render/task deadline.
    for (let i = 0; i < 3000; i++) { await microtasks(); if (done) break; await vi.advanceTimersByTimeAsync(5); }
    expect(done).toBe(true);
    const failure = await pending;
    if (cancel) { expect(String(failure)).toContain('Shader warm-up owner left'); expect(events.map(event => event.kind)).toEqual(['compile']); restored(); return; }
    expect(failure).toBeNull();
    const queries = events.filter(event => event.kind === 'query'), resolved = events.filter(event => event.kind === 'resolve');
    expect(resolved.map(event => event.program)).toEqual(ready ? [] : [0, 1, 2]);
    if (query === 0) {
      for (let i = 0; i < queries.length; i += 3) expect(new Set(queries.slice(i, i + 3).map(event => event.frame)).size).toBe(1);
    } else {
      expect(queries[0]?.frame).toBeGreaterThan(0); // slow compile yields before its first completion query
      for (let i = 1; i < queries.length; i++) expect(queries[i]?.frame).toBeGreaterThan(queries[i - 1]?.frame ?? -1);
    }
    if (resolve === 0) expect(new Set(resolved.map(event => event.frame)).size).toBeLessThanOrEqual(1);
    else expect(new Set(resolved.map(event => event.frame)).size).toBe(3);
    restored();
  } finally { clearInterval(drawing); material.dispose(); prior.dispose(); target.dispose(); }
});
