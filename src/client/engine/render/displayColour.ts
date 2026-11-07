import { type Material, ShaderMaterial } from 'three';
import type { EffectPass } from 'postprocessing';
import type { N8AOPostPass } from 'n8ao';
import { patchShader, PATCH_ORDER } from './shaderPatches';

/** Dependency shader contracts, kept in one place for real-material tests. */
export function displayColourFragment(source: string, stage: 'surface' | 'post' | 'ao'): string {
  if (stage === 'surface') {
    const token = '#include <opaque_fragment>';
    if (!source.includes(token)) throw new Error('Display colour surface contract changed');
    return source.replace(token, `${token}\ngl_FragColor.a = -1.0;`);
  }
  if (stage === 'ao') {
    const token = 'vec4 sceneTexel = texture2D(sceneDiffuse, vUv);';
    if (!source.includes(token)) throw new Error('Display colour AO contract changed');
    return source.replace(token, `${token}\nif (sceneTexel.a < 0.0) { gl_FragColor = sceneTexel; if (gammaCorrection) gl_FragColor = sRGBTransferOETF(gl_FragColor); return; }`);
  }
  const input = 'vec4 color0=texture2D(inputBuffer,UV);', output = 'gl_FragColor=color0;';
  if (!source.includes(input) || !source.includes(output)) throw new Error('Display colour post contract changed');
  return source.replace(input, `${input}vec4 displayColourSource=color0;`)
    .replace(output, `${output}if(displayColourSource.a<0.0)gl_FragColor=vec4(displayColourSource.rgb,1.0);`);
}

/** Mark an opaque native material without allocating a mask, target or pass. */
export function markDisplayColour(material: Material): void {
  if (material.transparent || !material.depthWrite) throw new Error('Display colour requires an opaque depth-writing surface');
  patchShader(material, 'display-colour-surface', PATCH_ORDER.material, shader => {
    shader.fragmentShader = displayColourFragment(shader.fragmentShader, 'surface');
  }, { key: 'display-colour-surface' });
}

/** Keep the original linear input through every recompile of the merged chain. */
export function protectDisplayColour(pass: EffectPass): void {
  patchShader(pass.fullscreenMaterial, 'display-colour-post', PATCH_ORDER.decorate, shader => {
    shader.fragmentShader = displayColourFragment(shader.fragmentShader, 'post');
  }, { key: 'display-colour-post' });
}

const protectedAo = new WeakSet();
/** n8ao rebuilds its composite material when depth/quality modes change. */
export function protectDisplayColourAo(ao: N8AOPostPass): void {
  if (protectedAo.has(ao)) return;
  const configure: unknown = Reflect.get(ao, 'configureEffectCompositer');
  if (typeof configure !== 'function') throw new Error('Display colour AO factory contract changed');
  const patch = (): void => {
    const quad: unknown = Reflect.get(ao, 'effectCompositerQuad');
    const material: unknown = typeof quad === 'object' && quad !== null ? Reflect.get(quad, 'material') : null;
    if (!(material instanceof ShaderMaterial)) throw new Error('Display colour AO material contract changed');
    patchShader(material, 'display-colour-ao', PATCH_ORDER.decorate, shader => {
      shader.fragmentShader = displayColourFragment(shader.fragmentShader, 'ao');
    }, { key: 'display-colour-ao' });
  };
  Reflect.set(ao, 'configureEffectCompositer', (...args: unknown[]): void => { Reflect.apply(configure, ao, args); patch(); });
  patch(); protectedAo.add(ao);
}
