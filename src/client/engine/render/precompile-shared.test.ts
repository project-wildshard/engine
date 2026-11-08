import { expect, test, vi } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { nativeBudgetSpent, noteFrameDrawn, setBuildHeld } from '../../../shared/engine/core/framePacing';
import { runPrecompile, sceneJobs } from './precompile';
import { linkedGl } from '../../../test/engine/linkedGl';

test.each([{cost: 12, held: false, cancel: false}, {cost: 30, held: true, cancel: false},
  {cost: 0, held: true, cancel: false}, {cost: 30, held: true, cancel: true}])(
  'queued warm-ups recheck the shared frame (cost $cost, held $held, cancel $cancel)', async ({cost, held, cancel}) => {
  const renderer: unknown = Object.create(WebGLRenderer.prototype);
  if (!(renderer instanceof WebGLRenderer)) throw new Error('Missing renderer');
  const geometry = new BoxGeometry(), a = new MeshBasicMaterial(), b = new MeshBasicMaterial(), scene = new Scene();
  const first = new Mesh(geometry, a), second = new Mesh(geometry, b); scene.add(first, second);
  let now = 1000, frame = 0, secondCurrent = true;
  const calls: {material: string; frame: number}[] = [], waiting: (() => void)[] = [];
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const fields: Record<string, unknown> = {info: {programs: [], render: {frame: 0}}, extensions: {has: () => false},
    properties: {get: () => ({}), has: () => false}, getContext: linkedGl, getRenderTarget: () => null, setRenderTarget: () => undefined,
    compile: (root: Scene): void => {
      root.traverse(object => {
        if (!(object instanceof Mesh)) return;
        calls.push({material: object.material === a ? 'a' : 'b', frame});
        now += cost; if (cancel && object.material === a) secondCurrent = false;
      });
    }};
  for (const [key, value] of Object.entries(fields)) Reflect.set(renderer, key, value);
  const pause = (): Promise<void> => new Promise(resolve => { waiting.push(resolve); });
  // Both queues first see a spent frame, then resume behind the same completed draw.
  noteFrameDrawn(now - 40, now - 40, 30); setBuildHeld(held);
  try {
    const start = (root: Mesh, current: () => boolean) => runPrecompile(renderer, new PerspectiveCamera(), sceneJobs(scene, null, 1, [root]).jobs,
      1, undefined, [], current, true, pause, undefined, undefined, 6);
    let done = false;
    const result = Promise.allSettled([start(first, () => true), start(second, () => secondCurrent)])
      .then(values => { done = true; return values; });
    expect(calls).toEqual([]);
    for (let tick = 0; tick < 10; tick++) {
      if (done) break;
      frame++; now = 1000 + frame * 100; noteFrameDrawn(now, now, 30);
      const ready = waiting.splice(0); for (const release of ready) release();
      for (let microtask = 0; microtask < 10; microtask++) await Promise.resolve();
    }
    expect(done).toBe(true);
    const verdicts = await result;
    expect(verdicts[0]?.status).toBe('fulfilled');
    expect(verdicts[1]?.status).toBe(cancel ? 'rejected' : 'fulfilled');
    expect(calls).toEqual(cancel ? [{material: 'a', frame: 1}]
      : [{material: 'a', frame: 1}, {material: 'b', frame: cost === 0 ? 1 : 2}]);
  } finally {setBuildHeld(false); noteFrameDrawn(Number.NEGATIVE_INFINITY); clock.mockRestore(); geometry.dispose(); a.dispose(); b.dispose();}
});

test.each([false, true])('a draw-only spent budget admits one atomic job after a yield (held %s)', async held => {
  const renderer: unknown = Object.create(WebGLRenderer.prototype);
  if (!(renderer instanceof WebGLRenderer)) throw new Error('Missing renderer');
  const geometry = new BoxGeometry(), a = new MeshBasicMaterial(), b = new MeshBasicMaterial(), scene = new Scene();
  const first = new Mesh(geometry, a), second = new Mesh(geometry, b); scene.add(first, second);
  let now = 1040, frame = 0, pauses = 0;
  const calls: {frame: number; spent: boolean}[] = [];
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const fields: Record<string, unknown> = {info: {programs: [], render: {frame: 0}}, extensions: {has: () => false},
    properties: {get: () => ({}), has: () => false}, getContext: linkedGl, getRenderTarget: () => null, setRenderTarget: () => undefined,
    compile: (): void => {calls.push({frame, spent: nativeBudgetSpent(6)});}};
  for (const [key, value] of Object.entries(fields)) Reflect.set(renderer, key, value);
  const pause = (): Promise<void> => {
    if (++pauses > 16) throw new Error('Draw-only budget starved atomic shader work');
    const drawn = 1000 + ++frame * 100;
    noteFrameDrawn(drawn, drawn, 30);
    // Every completed-frame continuation arrives after its draw-only budget.
    // No other warm-up runs here and compile itself advances no clock.
    now = drawn + 40;
    expect(nativeBudgetSpent(6)).toBe(true);
    return Promise.resolve();
  };
  try {
    setBuildHeld(held); noteFrameDrawn(1000, 1000, 30);
    const jobs = [first, second].flatMap(mesh => sceneJobs(scene, null, 1, [mesh]).jobs);
    await runPrecompile(renderer, new PerspectiveCamera(), jobs, 1, undefined, [], () => true, true, pause, undefined, undefined, 6);
    expect(calls).toHaveLength(2);
    expect(calls.every(call => call.frame > 0 && call.spent)).toBe(true);
    expect(new Set(calls.map(call => call.frame)).size).toBe(2);
  } finally {setBuildHeld(false); noteFrameDrawn(Number.NEGATIVE_INFINITY); clock.mockRestore(); geometry.dispose(); a.dispose(); b.dispose();}
});
