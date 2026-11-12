import { expect, test } from 'vitest';
import * as THREE from 'three';
import { compilePbr } from '../src/client/engine/render/families/pbr';
import { parseFamilyMaterial, type PbrMaterialParams } from '@wildshard/format/materialFamilies';

// Meta TEMPLATE-E2E LF1-1: the measure look takes a finish. Three knobs per role [structure, trim, floor], each off when
// absent: `tint` keeps a share of the mesh's own colour inside its role, `grain` shades the role colour with value noise,
// `grid` scales the lines' opacity down to 0. And a size label clears a cap laid into its face's top. Every knob is a
// uniform over one shader text: a finished shard and a plain one share one program.

const MEASURE = {
  floor: [0.42, 0.5, 0.27], label: { colour: [1, 0.93, 0.8], height: 0.36 }, lift: 0.4,
  line: { alpha: 0.45, colour: [1, 0.95, 0.82], floorAlpha: 0.3, width: 0.011 }, structure: [0.6, 0.57, 0.48], sub: { alpha: 0.08, step: 0.25 }, trim: [0.3, 0.44, 0.18],
};
const FINISH = { tint: [0.85, 0.7, 0], grain: { amount: [0.18, 0.12, 0.1], size: 0.6 }, grid: [0.25, 0.3, 0] };

function pbr(measure: object): PbrMaterialParams {
  const p = parseFamilyMaterial({ family: 'pbr', vertexColours: true, faceted: true, metalness: 0, measure });
  if (p.family !== 'pbr') throw new Error('not pbr');
  return p;
}
const noTextures = (): THREE.Texture => { throw new Error('no textures'); };

/** the material's shader after its patches run, as three would hand it to the compiler */
function compiled(measure: object): { material: THREE.MeshStandardMaterial; uniforms: Record<string, THREE.IUniform>; fragment: string; vertex: string } {
  const material = compilePbr(pbr(measure), noTextures), lib = THREE.ShaderLib.standard;
  const shader = { uniforms: THREE.UniformsUtils.clone(lib.uniforms), vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, Object.create(THREE.WebGLRenderer.prototype) as THREE.WebGLRenderer);
  return { material, uniforms: shader.uniforms, fragment: shader.fragmentShader, vertex: shader.vertexShader };
}
const vec = (u: THREE.IUniform | undefined): number[] => {
  const value: unknown = u?.value;
  if (value instanceof THREE.Vector3 || value instanceof THREE.Vector4) return value.toArray();
  throw new Error('not a vector uniform');
};

test('tint: each role mixes the surface colour into its role colour by its share, off by default', () => {
  const plain = compiled(MEASURE), finished = compiled({ ...MEASURE, tint: FINISH.tint });
  expect(vec(plain.uniforms['famMTint'])).toEqual([0, 0, 0]);
  expect(vec(finished.uniforms['famMTint'])).toEqual([0.85, 0.7, 0]);
  // the surface colour is diffuseColor after three's color_fragment (`diffuseColor *= vColor`): vertex × material colour
  const mixAt = finished.fragment.indexOf('famMBase = mix( famMBase, diffuseColor.rgb, dot( famMTint, famMSel ) )');
  const colourAt = finished.fragment.indexOf('diffuseColor *= vColor'), outAt = finished.fragment.indexOf('diffuseColor.rgb = famMOut');
  expect(colourAt).toBeGreaterThanOrEqual(0);
  expect(mixAt).toBeGreaterThan(colourAt);
  expect(outAt).toBeGreaterThan(mixAt);
});

test('grain: an amount per role and one size, value noise in world metres, off by default', () => {
  const plain = compiled(MEASURE), finished = compiled({ ...MEASURE, grain: FINISH.grain });
  expect(vec(plain.uniforms['famMGrain']).slice(0, 3)).toEqual([0, 0, 0]);
  const grain = vec(finished.uniforms['famMGrain']);
  expect(grain.map((x) => Math.round(x * 1e6) / 1e6)).toEqual([0.18, 0.12, 0.1, 0.6]);
  expect(finished.fragment).toMatch(/float famMNoise\( vec3 p \)/u);
  // only a role with grain pays for the noise
  expect(finished.fragment).toMatch(/if \( famMGrainA > 0\.0 \) \{\s*vec3 famMQ = vFamMPos \/ famMGrain\.w;/u);
});

test('grid: a per-role multiplier on the 1 m lines and the sub-grid, down to 0, 1 by default', () => {
  const plain = compiled(MEASURE), finished = compiled({ ...MEASURE, grid: FINISH.grid });
  expect(vec(plain.uniforms['famMGridK'])).toEqual([1, 1, 1]);
  expect(vec(finished.uniforms['famMGridK'])).toEqual([0.25, 0.3, 0]);
  expect(finished.fragment).toMatch(/famMLineA = \( famMHasRole \? famMAlpha\.x : famMAlpha\.y \) \* famMGridA/u);
  expect(finished.fragment).toMatch(/famMFine \* famMAlpha\.z \* famMGridA/u);
});

test('a size label sits at least 0.3 m under its face top, clear of a cap laid into the wall', () => {
  const { fragment } = compiled(MEASURE);
  // Mossgate's hut roof sits 0.2 m into its walls: the glyphs' top segments hid under it, and "2×3" read as mirrored
  expect(fragment).toMatch(/famMMargin = 0\.4 \* famMGh, famMTop = max\( famMMargin, 0\.3 \);/u);
  expect(fragment).toMatch(/vec2 famML = vec2\( famMFace\.x - famMMargin, famMFace\.y - \( famMH - famMTop - famMGh \) \)/u);
});

test('a finished shard and a plain one share one program: the same key and the same shader text', () => {
  const plain = compiled(MEASURE), finished = compiled({ ...MEASURE, ...FINISH });
  expect(finished.material.customProgramCacheKey()).toBe(plain.material.customProgramCacheKey());
  expect(finished.material.customProgramCacheKey()).toBe('family.pbr.measure.v1');
  expect(finished.fragment).toBe(plain.fragment);
  expect(finished.vertex).toBe(plain.vertex);
});
