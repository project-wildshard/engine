import { expect, test } from 'vitest';
import { N8AOPostPass } from 'n8ao';
import { BloomEffect, EffectPass, Pass, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import { DataTexture, DepthTexture, Mesh, OrthographicCamera, PerspectiveCamera, Scene, ShaderMaterial, WebGLRenderTarget, type Camera, type Object3D } from 'three';
import { postJobs, warmPostJobs, type CompileJob } from './precompile';
import { VolumetricsEffect } from '../core/Volumetrics';

function preparedMaterials(jobs: readonly CompileJob[]): ShaderMaterial[] {
  return jobs.flatMap(job => job.root.children.flatMap(child => {
    const material: unknown = Reflect.get(child, 'material');
    return material instanceof ShaderMaterial ? [material] : [];
  }));
}

test('composer back-references cannot hide nested bloom preparation', () => {
  const bloom = new BloomEffect(), colour = new EffectPass(new PerspectiveCamera(), bloom);
  const composer: { passes: Pass[] } = { passes: [] };
  const world = Object.assign(new Pass('world'), { composer });
  composer.passes.push(world, colour);
  const target = new WebGLRenderTarget(1, 1);
  const jobs = postJobs(composer, target);
  const materials = preparedMaterials(jobs);
  expect(materials).toContain(bloom.luminanceMaterial);
  expect(materials.map(material => material.name)).toContain('DownsamplingMaterial');
  expect(materials.map(material => material.name)).toContain('UpsamplingMaterial');
  expect(new Set(materials).size).toBe(materials.length);
  const luma = jobs.find(job => preparedMaterials([job]).includes(bloom.luminanceMaterial));
  expect(luma?.rt?.texture).toBe(bloom.luminancePass.texture);
  const down = jobs.find(job => preparedMaterials([job]).some(material => material.name === 'DownsamplingMaterial'));
  expect(down?.rt?.texture).toBe(bloom.mipmapBlurPass.texture);
  expect(jobs.find(job => preparedMaterials([job]).some(material => material === colour.fullscreenMaterial))?.rt).toBe(target);
  expect(composer.passes).toEqual([world, colour]);
  for (const job of jobs) job.dispose?.();
  colour.dispose(); world.dispose(); target.dispose();
});

test('preparation still excludes disabled passes and unused tone adaptation', () => {
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
  const colour = new EffectPass(new PerspectiveCamera(), tone);
  const disabled = new Pass('disabled'), skipped = new ShaderMaterial();
  disabled.fullscreenMaterial = skipped; disabled.enabled = false;
  const jobs = postJobs({ passes: [disabled, colour] }, null);
  const materials = preparedMaterials(jobs);
  expect(materials).not.toContain(skipped);
  expect(materials).toEqual([colour.fullscreenMaterial]);
  expect(jobs.every(job => job.rt === null)).toBe(true);
  expect(disabled.enabled).toBe(false);
  for (const job of jobs) job.dispose?.();
  colour.dispose(); disabled.dispose();
});


test('screen output does not send nested bloom targets to the canvas', () => {
  const bloom = new BloomEffect({ mipmapBlur: true }), colour = new EffectPass(new PerspectiveCamera(), bloom);
  colour.renderToScreen = true;
  const target = new WebGLRenderTarget(8, 8), jobs = postJobs({ passes: [colour] }, target, 1);
  expect(jobs.find(job => preparedMaterials([job]).some(material => material === colour.fullscreenMaterial))?.rt).toBeNull();
  expect(jobs.find(job => preparedMaterials([job]).includes(bloom.luminanceMaterial))?.rt?.texture).toBe(bloom.luminancePass.texture);
  expect(jobs.every(job => job.root.children.every(mesh => mesh instanceof Mesh && !mesh.frustumCulled))).toBe(true);
  for (const job of jobs) job.dispose?.();
  colour.dispose(); target.dispose();
});

function warmFixture() {
  const original = new WebGLRenderTarget(4, 4), target = new WebGLRenderTarget(8, 8);
  const pass = new Pass('post'); pass.fullscreenMaterial = new ShaderMaterial();
  const second = new Pass('screen'); second.fullscreenMaterial = new ShaderMaterial(); second.renderToScreen = true;
  const jobs = postJobs({ passes: [pass, second] }, target, 1);
  let current: WebGLRenderTarget | null = original, face = 3, mip = 2;
  const draws: (WebGLRenderTarget | null)[] = [];
  const renderer = {
    getRenderTarget: () => current, getActiveCubeFace: () => face, getActiveMipmapLevel: () => mip,
    setRenderTarget: (next: WebGLRenderTarget | null, cube = 0, level = 0): void => { current = next; face = cube; mip = level; },
    render: (root: Object3D, camera: Camera): void => {
      expect(root.children).toHaveLength(1); expect(camera).toBeInstanceOf(OrthographicCamera); draws.push(current);
    },
  };
  const dispose = (): void => { for (const job of jobs) job.dispose?.(); pass.dispose(); second.dispose(); original.dispose(); target.dispose(); };
  return { original, target, jobs, renderer, draws, dispose };
}

test('linked post draws use existing targets with a restored paint between each', async () => {
  const f = warmFixture(), progress: number[] = [], painted: number[] = [];
  try {
    await warmPostJobs(f.renderer, f.jobs, async () => {
      expect(f.renderer.getRenderTarget()).toBe(f.original);
      expect(f.renderer.getActiveCubeFace()).toBe(3); expect(f.renderer.getActiveMipmapLevel()).toBe(2);
      painted.push(f.draws.length); await Promise.resolve();
    }, () => true, done => { progress.push(done); });
    expect(f.draws).toEqual([f.target, null]); expect(painted).toEqual([1, 2]); expect(progress).toEqual([1, 2]);
  } finally { f.dispose(); }
});

test('a post material that samples its stand-in target is left to the real composer draw (no feedback loop)', async () => {
  const f = warmFixture(), depth = new DepthTexture(8, 8);
  f.target.depthTexture = depth;
  const first = preparedMaterials(f.jobs.slice(0, 1))[0];
  if (first === undefined) throw new Error('Missing post material');
  try {
    first.uniforms['depthBuffer'] = { value: depth };
    await warmPostJobs(f.renderer, f.jobs, () => Promise.resolve(), () => true);
    expect(f.draws).toEqual([null]);
    f.draws.length = 0; first.uniforms['depthBuffer'] = { value: null }; first.uniforms['inputBuffer'] = { value: [f.target.texture] };
    await warmPostJobs(f.renderer, f.jobs, () => Promise.resolve(), () => true);
    expect(f.draws).toEqual([null]);
    f.draws.length = 0; first.uniforms['inputBuffer'] = { value: new DepthTexture(8, 8) };
    await warmPostJobs(f.renderer, f.jobs, () => Promise.resolve(), () => true);
    expect(f.draws).toEqual([f.target, null]);
  } finally { f.dispose(); depth.dispose(); }
});

test('post warm-up restores the target on draw failure and never starts stale work', async () => {
  const f = warmFixture();
  try {
    await expect(warmPostJobs(f.renderer, f.jobs, () => Promise.resolve(), () => false)).rejects.toThrow('owner left');
    expect(f.draws).toHaveLength(0);
    let current = true;
    await expect(warmPostJobs(f.renderer, f.jobs, async () => { current = false; await Promise.resolve(); }, () => current)).rejects.toThrow('owner left');
    expect(f.draws).toEqual([f.target]); expect(f.renderer.getRenderTarget()).toBe(f.original);
    const broken = { ...f.renderer, render: (): void => { throw new Error('driver refused'); } };
    await expect(warmPostJobs(broken, f.jobs, () => Promise.resolve(), () => true)).rejects.toThrow('driver refused');
    expect(f.renderer.getRenderTarget()).toBe(f.original); expect(f.renderer.getActiveCubeFace()).toBe(3); expect(f.renderer.getActiveMipmapLevel()).toBe(2);
  } finally { f.dispose(); }
});


test('desktop AO sample arrays stay with the real pass until it binds them', async () => {
  const pass = new N8AOPostPass(new Scene(), new PerspectiveCamera(), 8, 8), target = new WebGLRenderTarget(8, 8);
  const jobs = postJobs({ passes: [pass] }, target, 1), f = warmFixture();
  const unbound = jobs.filter(job => preparedMaterials([job]).some(material =>
    Object.values(material.uniforms).some(uniform => Array.isArray(uniform.value) && uniform.value.length === 0)));
  expect(unbound.length).toBeGreaterThanOrEqual(2);
  const drawn: Object3D[] = [], progress: number[] = [];
  try {
    await warmPostJobs({ ...f.renderer, render: (root: Object3D): void => { drawn.push(root); } }, jobs,
      () => Promise.resolve(), () => true, done => { progress.push(done); });
    for (const job of unbound) expect(drawn).not.toContain(job.root);
    expect(drawn.length).toBe(jobs.length - unbound.length); expect(progress.at(-1)).toBe(drawn.length);
    expect(unbound.every(job => preparedMaterials([job]).some(material =>
      Object.values(material.uniforms).some(uniform => Array.isArray(uniform.value) && uniform.value.length === 0)))).toBe(true);
  } finally { for (const job of jobs) job.dispose?.(); pass.dispose(); target.dispose(); f.dispose(); }
});

// PF10: a separate volumetric march draws into its own target; warming it into the screen pass's target linked a second,
// never-drawn program (its output colour space is part of the key)
test('an effect that draws into its own target warms its material there, not on the screen', () => {
  const effect = new VolumetricsEffect(new PerspectiveCamera(), new DataTexture(new Uint8Array(4), 1, 1), 14, 0.5);
  const colour = new EffectPass(new PerspectiveCamera(), effect);
  colour.renderToScreen = true;
  const jobs = postJobs({ passes: [colour] }, new WebGLRenderTarget(8, 8), 1);
  const own: unknown = Reflect.get(effect, 'renderTarget'), march: unknown = Reflect.get(effect, 'marchMat');
  expect(own).toBeInstanceOf(WebGLRenderTarget); expect(march).toBeInstanceOf(ShaderMaterial);
  expect(jobs.find(job => job.root.children.some(child => Reflect.get(child, 'material') === march))?.rt).toBe(own);
  expect(jobs.find(job => preparedMaterials([job]).some(material => material === colour.fullscreenMaterial))?.rt).toBeNull();
  for (const job of jobs) job.dispose?.();
  colour.dispose();
});
