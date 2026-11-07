import { expect, test } from 'vitest';
import { CompressedArrayTexture, CompressedTexture, MeshPhysicalMaterial, RepeatWrapping, RGBA_ASTC_4x4_Format, RGBA_BPTC_Format, SRGBColorSpace, ShaderLib, WebGLRenderer, type CompressedPixelFormat, type WebGLProgramParametersWithUniforms } from 'three';
import { compressedLayerArray, layeredMap, MAP_LAYER_ATTRIBUTE } from './layeredMaps';
import { PATCH_ORDER, patchShader } from './shaderPatches';

/** a compressed texture of edge `n` (one byte a texel stands in for its blocks), every level filled with `fill` */
function coat(n: number, fill: number, format: CompressedPixelFormat = RGBA_ASTC_4x4_Format): CompressedTexture {
  const mipmaps = [];
  for (let e = n; e >= 1; e >>= 1) mipmaps.push({ data: new Uint8Array(e * e).fill(fill), width: e, height: e });
  const t = new CompressedTexture(mipmaps, n, n, format);
  t.colorSpace = SRGBColorSpace; t.wrapS = t.wrapT = RepeatWrapping; t.anisotropy = 4;
  return t;
}

// EP7 / PF7b: textures that differ only in their image become one array, each layer its own image's mip chain
test('same-format layers make one array, each level holding every layer in order', () => {
  const a = coat(8, 1), b = coat(8, 2), array = compressedLayerArray([a, b], { like: a, name: 'coats' });
  if (array === null) throw new Error('Expected an array');
  expect(array).toBeInstanceOf(CompressedArrayTexture);
  expect(array.image.depth).toBe(2);
  expect(array.mipmaps).toHaveLength(4);
  const top = array.mipmaps[0]; if (top === undefined) throw new Error('Missing level 0');
  expect(top.data.slice(0, 64).every(v => v === 1)).toBe(true);
  expect(top.data.slice(64).every(v => v === 2)).toBe(true);
  expect(array.colorSpace).toBe(SRGBColorSpace); expect(array.wrapS).toBe(RepeatWrapping); expect(array.anisotropy).toBe(4);
  expect(array.generateMipmaps).toBe(false); expect(array.flipY).toBe(false);
});

test('layers of another format, or with their mips released, make no array', () => {
  const a = coat(8, 1);
  expect(compressedLayerArray([a, coat(8, 2, RGBA_BPTC_Format)], { like: a, name: 'mixed' })).toBeNull();
  const released = coat(8, 3); released.mipmaps = [];
  expect(compressedLayerArray([a, released], { like: a, name: 'released' })).toBeNull();
});

test('a layered material samples its map from the array at the vertex layer', () => {
  const a = coat(8, 1), array = compressedLayerArray([a, coat(8, 2)], { like: a, name: 'coats' });
  if (array === null) throw new Error('Expected an array');
  const material = new MeshPhysicalMaterial({ map: a });
  layeredMap(material, array);
  const shader: object = { vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader, uniforms: {} };
  const renderer: unknown = Object.create(WebGLRenderer.prototype);
  const isProgram = (value: object): value is WebGLProgramParametersWithUniforms => 'vertexShader' in value && 'fragmentShader' in value && 'uniforms' in value;
  if (!isProgram(shader) || !(renderer instanceof WebGLRenderer)) throw new Error('Missing compile fixture');
  try {
    material.onBeforeCompile(shader, renderer);
    expect(shader.vertexShader).toContain(`attribute float ${MAP_LAYER_ATTRIBUTE};`);
    expect(shader.vertexShader).toContain(`vMapLayer = int( ${MAP_LAYER_ATTRIBUTE} + 0.5 );`);
    expect(shader.fragmentShader).toContain('uniform highp sampler2DArray mapLayers;');
    expect(shader.fragmentShader).toContain('vec4 sampledDiffuseColor = texture( mapLayers, vec3( vMapUv, float( vMapLayer ) ) );');
    expect(shader.fragmentShader).not.toContain('#include <map_fragment>');
    expect(shader.uniforms['mapLayers']?.value).toBe(array);
  } finally { material.dispose(); }
});

test('a layered copy of a patched material never shares the plain program', () => {
  const a = coat(8, 1), array = compressedLayerArray([a, coat(8, 2)], { like: a, name: 'coats' });
  if (array === null) throw new Error('Expected an array');
  // two copies of one fur, each finished as the sky finishes it (a pure key, asked once it is set up)
  const fur = (): MeshPhysicalMaterial => {
    const m = new MeshPhysicalMaterial({ map: a });
    patchShader(m, 'test.fur', PATCH_ORDER.material, (shader) => { shader.fragmentShader += '\n'; });
    patchShader(m, 'test.csm', PATCH_ORDER.shadows, (shader) => { shader.vertexShader += '\n'; }, { key: (k) => `${k}|csm`, pureKey: true });
    m.customProgramCacheKey();
    return m;
  };
  const plain = fur(), layered = fur();
  layeredMap(layered, array);
  try { expect(layered.customProgramCacheKey()).not.toBe(plain.customProgramCacheKey()); }
  finally { plain.dispose(); layered.dispose(); }
});
