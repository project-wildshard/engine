import { describe, expect, it, vi } from 'vitest';
import { DepthTexture, DirectionalLight, Group, Scene, WebGLRenderTarget } from 'three';
import { CompileLights, compileLightSource, compileSceneSource, createCompileScene } from './compileLights';
import { includeFutureLights, type CompileJob } from './precompile';
import { realGc } from '@wildshard/engine/test/realGc';

function sceneLoan(): {warm: Scene; source: WeakRef<Scene>} {
  const source = new Scene(), warm = createCompileScene(source);
  expect(compileSceneSource(warm)).toBe(source);
  return {warm, source: new WeakRef(source)};
}

function lightCopy(lights: CompileLights, source: DirectionalLight): DirectionalLight {
  const copy = lights.copy(source);
  if (!(copy instanceof DirectionalLight)) throw new Error('Expected a directional compile light');
  return copy;
}

function target(): WebGLRenderTarget {
  const map = new WebGLRenderTarget(16, 16);
  map.depthTexture = new DepthTexture(16, 16);
  return map;
}

describe('compile-only light storage', () => {
  it('a retained compile scene releases its retired source page', async () => {
    await realGc('src/client/engine/render/compile-lights.test.ts', 'a retained compile scene releases its retired source page', async collect => {
      const {warm, source} = sceneLoan();
      await collect(source);
      expect(compileSceneSource(warm)).toBe(warm);
    });
  });

  it('borrows the live shadow without changing or disposing its light and map', () => {
    const lights = new CompileLights(), source = new DirectionalLight();
    source.castShadow = true; source.intensity = 2;
    source.shadow.map = target(); source.shadow.needsUpdate = true;
    const disposed = vi.fn(); source.shadow.map.addEventListener('dispose', () => { disposed(); });
    const copy = lightCopy(lights, source), root = new Group(); root.add(copy);
    lights.prepare();
    expect(copy.castShadow).toBe(true); expect(copy.intensity).toBe(source.intensity);
    expect(copy.shadow.map).toBe(source.shadow.map);
    expect(copy.shadow.autoUpdate).toBe(false); expect(copy.shadow.needsUpdate).toBe(false);
    lights.dispose(); lights.dispose();
    expect(disposed).not.toHaveBeenCalled(); expect(copy.parent).toBeNull();
    expect(source.shadow.needsUpdate).toBe(true); expect(source.shadow.map).not.toBeNull();
    source.dispose();
  });

  it('releases private warm-up maps on success or failure, including after a source resize', () => {
    for (const fail of [false, true]) {
      const lights = new CompileLights(), source = new DirectionalLight(), copy = lightCopy(lights, source);
      const privateMap = target(), retired = vi.fn(); privateMap.addEventListener('dispose', () => { retired(); });
      try {
        lights.prepare(); expect(copy.shadow.needsUpdate).toBe(true);
        copy.shadow.map = privateMap;
        lights.prepare(); expect(copy.shadow.map).toBe(privateMap); expect(copy.shadow.needsUpdate).toBe(false);
        if (fail) throw new Error('Warm cancelled');
        source.shadow.map = target();
        lights.prepare(); expect(retired).toHaveBeenCalledOnce(); expect(copy.shadow.map).toBe(source.shadow.map);
        const replacement = target(); source.shadow.map.dispose(); source.shadow.map = replacement;
        lights.prepare(); expect(copy.shadow.map).toBe(replacement);
      } catch (error) { expect(String(error)).toContain('Warm cancelled'); }
      finally { lights.dispose(); }
      expect(retired).toHaveBeenCalledOnce(); source.dispose();
    }
  });
});

// G808: a warm's jobs share one copy of each future light (re-parented into the compiling job's root), not a clone a job
it('jobs share one copy of each future light, cloned again after the warm disposes it', () => {
  const page = new Scene(), future = new Group(), sun = new DirectionalLight();
  future.add(sun);
  const jobs: CompileJob[] = [0, 1, 2].map(i => ({ label: `job ${String(i)}`, root: new Group(), target: page, rt: null }));
  includeFutureLights(jobs, page, future);
  const lights = jobs[0]?.lights;
  if (lights === undefined) throw new Error('Expected compile lights');
  expect(jobs.every(job => job.lights === lights)).toBe(true);
  const first = lightCopy(lights, sun), again = lightCopy(lights, sun);
  expect(again).toBe(first); expect(compileLightSource(first)).toBe(sun);
  jobs[0]?.root.add(first); jobs[1]?.root.add(again);
  expect(first.parent).toBe(jobs[1]?.root);
  lights.dispose();
  expect(first.parent).toBeNull();
  expect(lightCopy(lights, sun)).not.toBe(first);
  lights.dispose();
});
