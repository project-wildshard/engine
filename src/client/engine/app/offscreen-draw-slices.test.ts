import { expect, test, vi } from 'vitest';
import { BoxGeometry, InstancedMesh, Mesh, MeshBasicMaterial, PerspectiveCamera, PMREMGenerator, Points, Scene, WebGLRenderer, WebGLRenderTarget, type Object3D } from 'three';
import { Scope } from '../../../shared/engine/app/scope';
import { registerOffscreenPreparation } from '../render/offscreenPreparation';
import { warmOffscreenPasses, type OffscreenWarmRenderer, type ParkedDrawBudget } from '../render/parkedDraws';
import { warmOffscreenBuild } from '../render/offscreenBuild';
import { SkyEnvironment } from '../render/skyEnvironment';
import type { ProgramLike } from '../boot/perflog';
import { linkedGl } from '../../../test/engine/linkedGl';

/** The slicing rules at one native unit a slice (the WebKit live budget before G782 raised it to two, D152). */
const ONE_UNIT: ParkedDrawBudget = { drawables: 8, newMaterials: 1, newBindings: 1, bufferBytes: 256 * 1024 };

function scalarTarget(value: unknown): value is WebGLRenderTarget { return value instanceof WebGLRenderTarget && !Array.isArray(value.texture); }

test.each([false, true])('offscreen caster batches restore state before yielding (cancel=%s)', async cancel => {
  const owner = new Scope('offscreen-slices'), scene = new Scene(), camera = new PerspectiveCamera();
  const geometry = new BoxGeometry(), material = new MeshBasicMaterial(), override = new MeshBasicMaterial();
  const instanced = new InstancedMesh(geometry, material, 3);
  const meshes = [new Mesh(geometry, material), new Mesh(geometry, material), instanced, new Points(geometry, material)];
  const sources = new Set<Object3D>(meshes);
  meshes.forEach((mesh, i) => { mesh.name = String(i); scene.add(mesh); });
  const target = new WebGLRenderTarget(8, 8), prior = new WebGLRenderTarget(2, 2);
  registerOffscreenPreparation(scene, owner, { label: 'fixture', camera, material: override, target, roots: () => [scene] });
  let bound: ReturnType<OffscreenWarmRenderer['getRenderTarget']> = prior;
  let face = 3, mip = 2, current = true, pauses = 0;
  const frames: string[][] = [];
  const renderer: OffscreenWarmRenderer = {
    shadowMap: { autoUpdate: true, needsUpdate: true },
    getRenderTarget: () => bound, getActiveCubeFace: () => face, getActiveMipmapLevel: () => mip,
    setRenderTarget: (next, nextFace = 0, nextMip = 0) => {
      if (next !== null && !scalarTarget(next)) throw new Error('Unexpected fixture render target');
      bound = next; face = nextFace; mip = nextMip;
    },
    render: () => {
      expect(scene.overrideMaterial).toBe(override); expect(bound).not.toBe(target);
      expect(renderer.shadowMap.autoUpdate).toBe(false);
      const drawn: string[] = [];
      scene.traverseVisible(node => { if (sources.has(node) && node.layers.test(camera.layers)) drawn.push(node.name); });
      frames.push(drawn);
    },
  };
  const pause = (): Promise<void> => {
    pauses++;
    expect(scene.overrideMaterial).toBeNull(); expect(bound).toBe(prior); expect(face).toBe(3); expect(mip).toBe(2);
    expect(renderer.shadowMap).toEqual({ autoUpdate: true, needsUpdate: true });
    expect(meshes.every(mesh => mesh.layers.mask === 1 && mesh.frustumCulled)).toBe(true);
    expect(instanced.count).toBe(3);
    if (cancel) current = false;
    return Promise.resolve();
  };
  try {
    const warming = warmOffscreenPasses(renderer, scene, () => current, pause, undefined, undefined, ONE_UNIT);
    if (cancel) { await expect(warming).rejects.toThrow('owner left'); expect(frames).toEqual([['0']]); expect(pauses).toBe(1); }
    else { expect(await warming).toBe(3); expect(frames).toEqual([['0'], ['2'], ['3']]); expect(pauses).toBe(3); }
  } finally { owner.dispose(); geometry.dispose(); material.dispose(); override.dispose(); target.dispose(); prior.dispose(); }
});

// DL23 (Pine's Sky frame): an equirect sky's first environment links its programs ahead on WebKit (`warmOffscreenBuild`)
// and its first refresh then draws with that generator; elsewhere nothing is built ahead
test('a sky warm-up builds nothing outside WebKit, and a primed generator draws the first refresh', async () => {
  const renderer: unknown = Object.create(WebGLRenderer.prototype);
  if (!(renderer instanceof WebGLRenderer)) throw new Error('Renderer missing');
  let built = 0;
  await warmOffscreenBuild(renderer, () => { built++; return new WebGLRenderTarget(1, 1); }, () => true, { webKitOnly: true });
  expect(built).toBe(0);
  for (const [key, value] of Object.entries({ getRenderTarget: (): null => null, setRenderTarget: (): void => undefined, render: (): void => undefined })) Reflect.set(renderer, key, value);
  const scene = new Scene(), source = new WebGLRenderTarget(64, 32), cube = new WebGLRenderTarget(8, 8);
  const drawn: unknown[] = [], freed: string[] = [];
  const generator = (name: string): PMREMGenerator => {
    const made: unknown = Object.create(PMREMGenerator.prototype);
    if (!(made instanceof PMREMGenerator)) throw new Error('Generator missing');
    return Object.assign(made, { _renderer: renderer, dispose: () => { freed.push(name); },
      fromEquirectangular: (texture: unknown, target: unknown) => { drawn.push([name, texture, target]); return cube; } });
  };
  const env = new SkyEnvironment(renderer, scene, { kind: 'equirect', scene: new Scene(), camera: new PerspectiveCamera(), target: source }, { every: 60, stepped: false });
  env.prime(generator('warmed'));
  env.prime(generator('late'));
  env.refresh();
  expect(drawn).toEqual([['warmed', source.texture, null]]);
  expect(scene.environment).toBe(cube.texture);
  expect(freed).toEqual(['late']);
  env.dispose();
  expect(freed).toEqual(['late', 'warmed']);
  source.dispose();
});

test('a WebKit sky warm-up links what its build would draw, draws nothing and frees the output (DL23)', async () => {
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
  vi.stubGlobal('requestAnimationFrame', (draw: (at: number) => void): number => Number(setTimeout(() => { draw(performance.now()); }, 0)));
  vi.stubGlobal('cancelAnimationFrame', (id: number): void => { clearTimeout(id); });
  const renderer: unknown = Object.create(WebGLRenderer.prototype);
  if (!(renderer instanceof WebGLRenderer)) throw new Error('Renderer missing');
  const programs: ProgramLike[] = [], compiled: unknown[] = [], drawn: unknown[] = [];
  let target: unknown = null;
  for (const [key, value] of Object.entries({
    info: { programs, render: { frame: 0 } }, extensions: { has: (name: string): boolean => name === 'KHR_parallel_shader_compile' },
    properties: { has: (): boolean => true, get: (): object => ({ programs: new Map(programs.map(program => [program.cacheKey, program])) }) },
    getContext: linkedGl, getRenderTarget: (): unknown => target, setRenderTarget: (next: unknown): void => { target = next; },
    getActiveCubeFace: (): number => 0, getActiveMipmapLevel: (): number => 0, autoClear: true, toneMapping: 0, xr: { enabled: false },
    render: (root: unknown): void => { drawn.push(root); },
    compile: (root: Scene): void => {
      root.traverse(object => {
        if (!(object instanceof Mesh)) return;
        compiled.push(object.material);
        const id = programs.length;
        programs.push({ type: 'test', name: `program-${id}`, cacheKey: `program-${id}`, usedTimes: 1, id, program: {}, isReady: () => true, getUniforms: () => ({}) });
      });
    },
  })) Reflect.set(renderer, key, value);
  const geometry = new BoxGeometry(), material = new MeshBasicMaterial(), pass = new Mesh(geometry, material), camera = new PerspectiveCamera();
  const into = new WebGLRenderTarget(4, 4);
  let freed = 0;
  try {
    for (const owned of [true, false]) {
      const output = new WebGLRenderTarget(2, 2); output.addEventListener('dispose', () => { freed++; });
      let live = true;
      const warm = warmOffscreenBuild(renderer, (commands) => {
        commands.setRenderTarget(into); commands.render(pass, camera); live = owned; return output;
      }, () => live, { webKitOnly: true });
      await (owned ? warm : expect(warm).rejects.toThrow('owner left'));
    }
    expect(drawn).toEqual([]);
    expect(compiled[0]).toBe(material);
    expect(freed).toBe(2);
  } finally { vi.unstubAllGlobals(); geometry.dispose(); material.dispose(); into.dispose(); }
});
