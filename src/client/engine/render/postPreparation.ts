import { BufferAttribute, BufferGeometry } from 'three';
import { EffectMaterial, type EffectPass } from 'postprocessing';

/** The real post pass triangle has no normal attribute; HAS_NORMAL changes its linked vertex program. */
export function postTriangle(): BufferGeometry {
  return new BufferGeometry()
    .setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
    .setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
}

/** Three binds a shader material's uniforms object once, when it first compiles a program key, and keeps that binding when
 *  the material returns to a key it compiled before. So a publication replaces the entries, never the object: a colour pass
 *  that went A, B, A again (a region's display placed, removed with its world, placed again with the rebuilt one) drew A's
 *  code with B's uniforms (a rebuilt Sky's warm look: its LUT off, film grain at full). */
function replaceUniforms(target: EffectMaterial['uniforms'], source: EffectMaterial['uniforms']): void {
  for (const name of Object.keys(target)) if (!Object.hasOwn(source, name)) Reflect.deleteProperty(target, name);
  Object.assign(target, source);
}

/** Prepare a revised compound shader while the original material keeps drawing. Uniforms and content textures
 * remain borrowed. Publication keeps the original identity; the synchronous acquire must retain its linked program
 * before the temporary holder is disposed. A concurrent recompile/removal invalidates this candidate. */
export async function prepareEffectPass(pass: EffectPass, prepare: (material: EffectMaterial) => Promise<void>,
  acquire: (material: EffectMaterial) => void, current: () => boolean): Promise<boolean> {
  const original = pass.fullscreenMaterial;
  if (!(original instanceof EffectMaterial)) throw new Error('Effect preparation requires an effect material');
  const next = new EffectMaterial();
  // ShaderMaterial.copy clones texture-valued uniforms. Copy render state without cloning borrowed content.
  const { uniforms, uniformsGroups, userData } = original;
  try {
    original.uniforms = {}; original.uniformsGroups = []; original.userData = {};
    next.copy(original);
  } finally { original.uniforms = uniforms; original.uniformsGroups = uniformsGroups; original.userData = userData; }
  next.uniforms = { ...uniforms }; next.uniformsGroups = uniformsGroups; next.userData = userData;
  next.onBeforeCompile = original.onBeforeCompile.bind(original); next.customProgramCacheKey = original.customProgramCacheKey.bind(original);
  const version = original.version;
  const state = (): { needsSwap: boolean; needsDepthTexture: boolean; skip: boolean } => {
    const skip: unknown = Reflect.get(pass, 'skipRendering');
    if (typeof skip !== 'boolean') throw new Error('Effect pass render state is unavailable');
    return { needsSwap: pass.needsSwap, needsDepthTexture: pass.needsDepthTexture, skip };
  };
  const before = state();
  const restoreFlags = (): void => {
    pass.needsSwap = before.needsSwap; pass.needsDepthTexture = before.needsDepthTexture;
    Reflect.set(pass, 'skipRendering', before.skip);
  };
  let after = before;
  try {
    try {
      pass.fullscreenMaterial = next; pass.recompile();
      after = state();
    } finally { pass.fullscreenMaterial = original; restoreFlags(); }
    await prepare(next);
    if (!current() || pass.fullscreenMaterial !== original || original.version !== version) return false;
    const old = { vertexShader: original.vertexShader, fragmentShader: original.fragmentShader,
      defines: original.defines, extensions: original.extensions }, oldUniforms = { ...original.uniforms };
    try {
      original.vertexShader = next.vertexShader; original.fragmentShader = next.fragmentShader;
      replaceUniforms(original.uniforms, next.uniforms); original.defines = next.defines; original.extensions = next.extensions;
      original.needsUpdate = true;
      acquire(original);
      pass.needsSwap = after.needsSwap; pass.needsDepthTexture = after.needsDepthTexture;
      Reflect.set(pass, 'skipRendering', after.skip);
      return true;
    } catch (error) { Object.assign(original, old); replaceUniforms(original.uniforms, oldUniforms); original.needsUpdate = true; restoreFlags(); throw error; }
  } finally { next.dispose(); }
}
