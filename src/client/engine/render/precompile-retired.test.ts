import { expect, test, vi } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { ProgramLike } from '../boot/perflog';
import { noteFrameDrawn } from '../../../shared/engine/core/framePacing';
import { runPrecompile, sceneJobs } from './precompile';

test.each([
  { isolate: false, nativeFailure: false }, { isolate: true, nativeFailure: false },
  { isolate: false, nativeFailure: true }, { isolate: true, nativeFailure: true },
])('a borrowed program may retire across a compile yield (isolate $isolate, native failure $nativeFailure)', async options => {
  const renderer: unknown = Object.create(WebGLRenderer.prototype);
  if (!(renderer instanceof WebGLRenderer)) throw new Error('Missing renderer');
  const geometry = new BoxGeometry(), material = new MeshBasicMaterial(), scene = new Scene();
  scene.add(new Mesh(geometry, material));
  let now = 1000, retired = false, retiredQueries = 0, liveUniforms = 0, liveLinks = 0;
  const nativeFailure = new Error('Original live native link refusal');
  const old: ProgramLike = {
    id: 1, name: 'borrowed', type: 'basic', cacheKey: 'borrowed', usedTimes: 1, program: {},
    isReady: () => { if (retired) retiredQueries++; return true; },
    getUniforms: () => { if (retired) retiredQueries++; return {}; },
  };
  const live: ProgramLike = {
    id: 2, name: 'current', type: 'basic', cacheKey: 'current', usedTimes: 1, program: {},
    isReady: () => true,
    getUniforms: () => { liveUniforms++; if (options.nativeFailure) throw nativeFailure; return {}; },
  };
  const acquired = [old], programs = new Map([['borrowed', old]]);
  const fields: Record<string, unknown> = {
    info: { programs: acquired, render: { frame: 0 } }, extensions: { has: () => true },
    properties: { get: () => ({ programs }), has: () => true },
    getContext: () => ({ LINK_STATUS: 0x8b82, getProgramParameter: (handle: WebGLProgram): boolean => {
      if (handle === undefined) throw new TypeError("Argument 1 ('program') must be a WebGLProgram");
      if (handle === live.program) liveLinks++;
      return true;
    } }),
    getRenderTarget: () => null, setRenderTarget: () => undefined,
    compile: () => { now += 20; },
  };
  for (const [key, value] of Object.entries(fields)) Reflect.set(renderer, key, value);
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const pause = (): Promise<void> => {
    now += 40; noteFrameDrawn(now, now, 30);
    if (!retired) {
      // Three's releaseProgram removes the physical cache entry and destroy()
      // clears .program. A neighbour may publish a new live link on this yield.
      retired = true; old.usedTimes = 0; Reflect.set(old, 'program', undefined);
      acquired.splice(0, 1, live); programs.clear(); programs.set('current', live);
    }
    return Promise.resolve();
  };
  try {
    noteFrameDrawn(now, now, 30);
    const warming = runPrecompile(renderer, new PerspectiveCamera(), sceneJobs(scene, null).jobs, 1,
      undefined, [], () => true, options.isolate, pause);
    await (options.nativeFailure ? expect(warming).rejects.toBe(nativeFailure) : warming);
    expect(retired).toBe(true);
    expect(retiredQueries).toBe(0);
    expect(liveUniforms).toBe(1);
    expect(liveLinks).toBe(options.nativeFailure ? 0 : 1);
  } finally { clock.mockRestore(); noteFrameDrawn(Number.NEGATIVE_INFINITY); geometry.dispose(); material.dispose(); }
});
