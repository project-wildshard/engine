import { expect, test } from 'vitest';
import { EffectPass, HueSaturationEffect } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { MeshBasicMaterial, PerspectiveCamera, Scene, ShaderLib, ShaderMaterial } from 'three';
import { displayColourFragment, markDisplayColour, protectDisplayColour, protectDisplayColourAo } from './displayColour';

test('the real merged post shader restores source colour after grading without another texture sample', () => {
  const pass = new EffectPass(new PerspectiveCamera(), new HueSaturationEffect({ saturation: 0.9 }));
  pass.recompile(); protectDisplayColour(pass);
  const material = pass.fullscreenMaterial;
  if (!(material instanceof ShaderMaterial)) throw new Error('Missing effect material');
  const original = material.fragmentShader, patched = displayColourFragment(original, 'post');
  expect(patched.match(/texture2D\(inputBuffer,UV\)/gu)?.length).toBe(original.match(/texture2D\(inputBuffer,UV\)/gu)?.length);
  expect(patched.indexOf('displayColourSource=color0')).toBeLessThan(patched.indexOf('color0.a=clamp'));
  expect(patched.indexOf('if(displayColourSource.a<0.0)')).toBeGreaterThan(patched.indexOf('gl_FragColor=color0;'));
  expect(patched.indexOf('if(displayColourSource.a<0.0)')).toBeLessThan(patched.indexOf('#include <colorspace_fragment>'));
  pass.recompile(); expect(() => displayColourFragment(material.fragmentShader, 'post')).not.toThrow();
  pass.dispose();
});

test('opaque mean colours use their original depth-tested surface and refuse transparent marks', () => {
  const material = new MeshBasicMaterial({ fog: false, toneMapped: false }); markDisplayColour(material);
  expect(displayColourFragment(ShaderLib.basic.fragmentShader, 'surface')).toContain('gl_FragColor.a = -1.0;');
  expect(material.depthTest).toBe(true); expect(material.depthWrite).toBe(true); material.dispose();
  const transparent = new MeshBasicMaterial({ transparent: true });
  expect(() => markDisplayColour(transparent)).toThrow('opaque'); transparent.dispose();
});

test('AO keeps marked source pixels and reattaches the patch after real quality reconfiguration', () => {
  const ao = new N8AOPostPass(new Scene(), new PerspectiveCamera(), 16, 16); protectDisplayColourAo(ao);
  const current = (): ShaderMaterial => {
    const quad: unknown = Reflect.get(ao, 'effectCompositerQuad');
    const material: unknown = typeof quad === 'object' && quad !== null ? Reflect.get(quad, 'material') : null;
    if (!(material instanceof ShaderMaterial)) throw new Error('Missing AO material'); return material;
  };
  const first = current(); expect(displayColourFragment(first.fragmentShader, 'ao')).toContain('if (sceneTexel.a < 0.0)');
  ao.configuration.halfRes = !ao.configuration.halfRes;
  expect(current()).not.toBe(first); expect(current().customProgramCacheKey()).toContain('display-colour-ao');
  ao.dispose();
});
