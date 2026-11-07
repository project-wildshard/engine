import { expect, test } from 'vitest';
import { DepthEffect, EffectComposer, EffectPass, RenderPass } from 'postprocessing';
import { BufferGeometry, Mesh, Scene, ShaderMaterial, Texture, Uniform, WebGLRenderTarget } from 'three';
import { ownComposerDepth } from './composerDepth';
import { collectTextures, type CompileJob } from './precompile';
import { MemoryAttribution } from '../../../shared/engine/core/memoryAttribution';

const isTexture = (value: unknown): value is Texture => value instanceof Texture;

function createDepth(composer: EffectComposer): Texture {
  const create: unknown = Reflect.get(composer, 'createDepthTexture');
  if (typeof create !== 'function') throw new Error('Pinned postprocessing depth factory missing');
  Reflect.apply(create, composer, []);
  const depth: unknown = Reflect.get(composer, 'stableDepthTexture');
  if (!isTexture(depth)) throw new Error('Composer did not create a stable depth texture');
  return depth;
}

for (const targetInitialized of [false, true]) test(`composer releases sampled depth when target initialized=${String(targetInitialized)}`, () => {
  const composer = new EffectComposer(), ledger = new MemoryAttribution(), handles: object[] = [];
  ownComposerDepth(composer);
  // Depth-slice passes sample the stable texture without binding its render target.
  // Three installs the texture's native disposal hook on sampling; the target's
  // native disposal hook exists only after initRenderTarget / setRenderTarget.
  try {
    for (let visit = 0; visit < 5; visit++) {
      const pass = new EffectPass(undefined, new DepthEffect()); pass.needsDepthTexture = true; composer.passes.push(pass);
      const depth = createDepth(composer), native = {}; handles.push(native);
      pass.setDepthTexture(depth);
      ledger.allocation(native, 'gpu', 'texture', 4_380_192);
      let disposals = 0;
      depth.addEventListener('dispose', () => { disposals++; ledger.release(native, 'gpu'); });
      const target: unknown = Reflect.get(composer, 'depthRenderTarget');
      if (!(target instanceof WebGLRenderTarget)) throw new Error('Stable depth target missing');
      if (targetInitialized) target.addEventListener('dispose', () => { depth.dispose(); });
      composer.removePass(pass);
      expect(pass.getDepthTexture()).toBeNull();
      expect(disposals).toBe(1);
      expect(ledger.summary().totals.gpu).toBe(0);
      pass.dispose();
    }
    expect(handles).toHaveLength(5);
  } finally { composer.dispose(); }
});

for (const retire of ['removeAllPasses', 'dispose', 'reset'] as const) test(`${retire} releases an uninitialized depth target's uploaded sampler`, () => {
  const composer = new EffectComposer(); ownComposerDepth(composer);
  const depth = createDepth(composer), ledger = new MemoryAttribution(), native = {};
  ledger.allocation(native, 'gpu', 'texture', 4_380_192);
  depth.addEventListener('dispose', () => { ledger.release(native, 'gpu'); });
  try {
    composer[retire](); expect(ledger.summary().totals.gpu).toBe(0);
  } finally { composer.dispose(); }
});

test('removing an unrelated pass keeps depth available to a remaining reader', () => {
  const composer = new EffectComposer(); ownComposerDepth(composer);
  const reader = new EffectPass(undefined, new DepthEffect()), unrelated = new RenderPass(); reader.needsDepthTexture = true;
  composer.passes.push(reader, unrelated); const depth = createDepth(composer); reader.setDepthTexture(depth);
  let disposals = 0; depth.addEventListener('dispose', () => { disposals++; });
  try {
    composer.removePass(unrelated); expect(disposals).toBe(0); expect(reader.getDepthTexture()).toBe(depth);
    composer.removePass(reader); expect(disposals).toBe(1);
  } finally { composer.dispose(); reader.dispose(); unrelated.dispose(); }
});


test('queued preparation does not recreate retired composer depth allocations', () => {
  const composer = new EffectComposer(), ledger = new MemoryAttribution(); ownComposerDepth(composer);
  const geometry = new BufferGeometry(), handles: object[] = [];
  const upload = (texture: Texture): void => {
    const native = {}; handles.push(native); ledger.allocation(native, 'gpu', 'texture', 4_380_192);
    texture.addEventListener('dispose', () => { ledger.release(native, 'gpu'); });
  };
  try {
    for (let visit = 0; visit < 5; visit++) {
      const pass = new EffectPass(undefined, new DepthEffect()); pass.needsDepthTexture = true; composer.passes.push(pass);
      createDepth(composer);
      const depth = composer.inputBuffer.depthTexture;
      if (depth === null) throw new Error('Composer input depth missing');
      const material = new ShaderMaterial({ uniforms: { heldDepth: new Uniform(depth) } }), root = new Scene();
      root.add(new Mesh(geometry, material));
      const jobs: CompileJob[] = [{ label: 'captured post preparation', root, target: null, rt: composer.inputBuffer }];
      upload(depth);
      composer.removePass(pass); pass.dispose();
      expect(ledger.summary().totals.gpu).toBe(0);
      // A job captured before the pass retired can resume afterward. Only content
      // images may be eagerly uploaded; generated depth belongs to its target.
      for (const texture of collectTextures(jobs)) upload(texture);
      expect(ledger.summary().totals.gpu).toBe(0);
      material.dispose();
    }
    expect(handles).toHaveLength(5);
  } finally { composer.dispose(); geometry.dispose(); }
});

test('depth attachments stay borrowed while content image preparation is unchanged', () => {
  const composer = new EffectComposer(), target = new WebGLRenderTarget(8, 8), depth = createDepth(composer);
  const content = new Texture(), material = new ShaderMaterial({ uniforms: {
    generatedDepth: new Uniform(depth), generatedColour: new Uniform(target.texture), image: new Uniform(content),
  } });
  const root = new Scene(), geometry = new BufferGeometry(); root.add(new Mesh(geometry, material));
  try {
    expect(collectTextures([{ label: 'live post preparation', root, target: null, rt: target }])).toEqual([content]);
    expect(material.uniforms['generatedDepth']?.value).toBe(depth);
    expect(material.uniforms['image']?.value).toBe(content);
  } finally { composer.dispose(); target.dispose(); depth.dispose(); content.dispose(); material.dispose(); geometry.dispose(); }
});
