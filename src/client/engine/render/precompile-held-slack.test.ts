import { expect, test, vi } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { noteFrameDrawn, setBuildHeld } from '../../../shared/engine/core/framePacing';
import { runPrecompile, type CompileJob } from './precompile';
import { linkedGl } from '../../../test/engine/linkedGl';

/** The frame each of nine new jobs (`cost` ms of compile each) is issued in, off-main-thread compile (not WebKit's queue). */
async function issue(options: { held: boolean; cost: number; webkit?: boolean }): Promise<number[]> {
  const renderer: unknown = Object.create(WebGLRenderer.prototype);
  if (!(renderer instanceof WebGLRenderer)) throw new Error('Missing renderer');
  const geometry = new BoxGeometry(), material = new MeshBasicMaterial(), root = new Scene();
  root.add(new Mesh(geometry, material));
  let now = 1000, frame = 0;
  const issued: number[] = [];
  const fields: Record<string, unknown> = {
    info: { programs: [], render: { frame: 0 } }, extensions: { has: () => false },
    properties: { get: () => ({}), has: () => false }, getContext: linkedGl, getRenderTarget: () => null,
    setRenderTarget: () => undefined, compile: () => { issued.push(frame); now += options.cost; },
  };
  for (const [key, value] of Object.entries(fields)) Reflect.set(renderer, key, value);
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const pause = (): Promise<void> => { frame++; now = 1000 + frame * (1000 / 30); noteFrameDrawn(now, now, 30); return Promise.resolve(); };
  // new jobs (a custom preparation never counts as cached), one material each
  const jobs: CompileJob[] = Array.from({ length: 9 }, () => ({ label: 'new', root, target: null, rt: null, prepare: () => undefined }));
  try {
    noteFrameDrawn(now, now, 30); setBuildHeld(options.held);
    await runPrecompile(renderer, new PerspectiveCamera(), jobs, 1, undefined, [], () => true, options.webkit === true, pause, undefined, undefined, 6);
    return issued;
  } finally {
    setBuildHeld(false); clock.mockRestore(); noteFrameDrawn(Number.NEGATIVE_INFINITY); geometry.dispose(); material.dispose();
  }
}

test('a held frame keeps issuing cheap new jobs to the held build budget where compile is off the main thread (D176)', async () => {
  // 3 ms jobs: eight fill the 24 ms held budget, where the 6 ms slice took two
  expect(await issue({ held: true, cost: 3 })).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1]);
});

test('slow jobs share the held budget too: a held slice ends once it is spent, at most one job past it (G808)', async () => {
  // 12 ms jobs (a node material's build at 4x): two fill the 24 ms held budget, where each used to end its own slice
  expect(await issue({ held: true, cost: 12 })).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4]);
  // a job longer than the whole budget still gets a frame of its own
  expect(await issue({ held: true, cost: 30 })).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test('moving frames and WebKit\'s queued compile keep the explicit slice', async () => {
  expect(await issue({ held: false, cost: 3 })).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4]);
  expect(await issue({ held: true, cost: 3, webkit: true })).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4]);
});
