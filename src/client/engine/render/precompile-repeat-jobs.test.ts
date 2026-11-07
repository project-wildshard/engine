import { expect, test } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, PointLight, Scene, WebGLRenderer } from 'three';
import type { ProgramLike } from '../boot/perflog';
import { runPrecompile, type CompileJob, type PrecompileStage } from './precompile';
import { linkedGl } from '../../../test/engine/linkedGl';

/** A renderer double whose every material already holds a linked program; `compiled` lists each compiled job's label. */
function rendererDouble(): { renderer: WebGLRenderer; compiled: string[] } {
  const renderer: unknown = Object.create(WebGLRenderer.prototype);
  if (!(renderer instanceof WebGLRenderer)) throw new Error('Missing renderer');
  const compiled: string[] = [];
  const program: ProgramLike = { type: 'test', name: 'linked', cacheKey: 'linked', usedTimes: 1, id: 1, program: {}, isReady: () => true, getUniforms: () => ({}) };
  const fields: Record<string, unknown> = {
    info: { programs: [program], render: { frame: 0 } }, extensions: { has: () => false },
    properties: { get: () => ({ programs: new Map([['linked', program]]) }), has: () => true },
    getContext: linkedGl, getRenderTarget: () => null, setRenderTarget: () => undefined,
    compile: (root: Scene) => { compiled.push(root.name); },
  };
  for (const [key, value] of Object.entries(fields)) Reflect.set(renderer, key, value);
  return { renderer, compiled };
}

function job(name: string, material: MeshBasicMaterial, geometry: BoxGeometry, light = false): CompileJob {
  const root = new Scene(); root.name = name; root.add(new Mesh(geometry, material));
  if (light) root.add(new PointLight());
  return { label: name, root, target: null, rt: null };
}

test('a later warm-up does not run a job whose materials already compiled under the same lights and target (G808)', async () => {
  const { renderer, compiled } = rendererDouble(), geometry = new BoxGeometry(), a = new MeshBasicMaterial(), b = new MeshBasicMaterial();
  const stages: { phase: string; units: number }[] = [], observe: PrecompileStage = (phase, _ms, units) => { stages.push({ phase, units }); };
  const pause = (): Promise<void> => Promise.resolve();
  const run = async (jobs: CompileJob[]): Promise<void> => { await runPrecompile(renderer, new PerspectiveCamera(), jobs, jobs.length, undefined, [], () => true, false,
    pause, undefined, observe); };
  try {
    await run([job('a', a, geometry), job('b', b, geometry)]);
    expect(compiled).toEqual(['a', 'b']);
    // the same materials again: a is not run; b, the run's last job, still is (it closes the run's fences)
    compiled.length = 0; stages.length = 0;
    await run([job('a', a, geometry), job('b', b, geometry)]);
    expect(compiled).toEqual(['b']); expect(stages.find(stage => stage.phase === 'repeat-jobs')?.units).toBe(1);
    // a changed light count is a different program key: run again
    compiled.length = 0;
    await run([job('a-lit', a, geometry, true), job('b', b, geometry)]);
    expect(compiled).toEqual(['a-lit', 'b']);
    // a changed material (needsUpdate bumps its version): run again
    compiled.length = 0; a.needsUpdate = true;
    await run([job('a', a, geometry), job('b', b, geometry)]);
    expect(compiled).toEqual(['a', 'b']);
  } finally { geometry.dispose(); a.dispose(); b.dispose(); }
});
