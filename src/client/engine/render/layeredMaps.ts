import * as THREE from 'three';
import { layerArrayMips, releaseAfterUpload } from '../core/ktx2';
import { PATCH_ORDER, patchShader } from './shaderPatches';

/**
 * Texture families (EP7, first used by PF7b): textures that differ only in their image (a creature's coat variants, a
 * prop family's paints) drawn by ONE classic material, its `map` read from a compressed array texture at a per-vertex
 * layer. Members that would each need their own material (and draw) can then share a batch, an instance table or a
 * merged mesh, each vertex carrying its member's layer in `aMapLayer`.
 *
 *   const family = compressedLayerArray([coatA, coatB], { like: coatA, name: 'deer coats' });   // null: not one format
 *   layeredMap(material, family);                         // material.map stays the program's map (its uv, its transform)
 *   geometry.setAttribute(MAP_LAYER_ATTRIBUTE, new THREE.BufferAttribute(layers, 1));   // 0 = coatA, 1 = coatB
 *
 * The layers' own mips are copied (the same concatenation the KTX2 terrain arrays use, `layerArrayMips`), so build the
 * array before the sources upload (their mips are released after upload); the array releases its copy after its own.
 */
export const MAP_LAYER_ATTRIBUTE = 'aMapLayer';

/** `layers` as one compressed array of their shared format and edge (≤ `size`), sampled as `like`; null when any layer is
 *  not a compressed texture with its mips still on the CPU, or they disagree on format or edge */
export function compressedLayerArray(layers: readonly THREE.Texture[], opts: { readonly like: THREE.Texture; readonly name: string; readonly size?: number }): THREE.CompressedArrayTexture | null {
  const compressed = layers.map((t) => (t instanceof THREE.CompressedTexture && t.mipmaps.length > 0 && !(t instanceof THREE.CompressedArrayTexture) ? t : null));
  if (compressed.length === 0 || compressed.some((t) => t === null)) return null;
  const mips = layerArrayMips(compressed, opts.size ?? Infinity);
  if (mips === null) return null;
  const { like } = opts, t = new THREE.CompressedArrayTexture(mips.mipmaps, mips.n, mips.n, layers.length, mips.format);
  t.wrapS = like.wrapS; t.wrapT = like.wrapT;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false; t.anisotropy = like.anisotropy; t.flipY = false;
  t.colorSpace = like.colorSpace; t.name = opts.name;
  t.needsUpdate = true;
  return releaseAfterUpload(t);
}

/**
 * Draw `material`'s map from `array` at each vertex's `aMapLayer` (rounded; a whole layer per triangle), as three's own
 * `sampledDiffuseColor` (later stages may read it, as they read three's). The material
 * keeps its own `map` (the program's USE_MAP, its uv channel and transform), which the patched program no longer samples,
 * so that texture is never bound for it. Its key is the same for every array: one program for all of them. `opts.layer`:
 * the layer as a vertex-stage GLSL float (default the `aMapLayer` attribute), e.g. read from a batch's per-slot data.
 */
export function layeredMap(material: THREE.Material, array: THREE.CompressedArrayTexture, opts: { readonly layer?: string } = {}): void {
  if (!(material instanceof THREE.MeshStandardMaterial) || material.map === null) throw new Error('A layered map needs a standard material with a map');
  const uniform = { value: array }, layer = opts.layer ?? MAP_LAYER_ATTRIBUTE;
  patchShader(material, 'engine.layered-map', PATCH_ORDER.decorate, (shader) => {
    shader.uniforms['mapLayers'] = uniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        ${layer === MAP_LAYER_ATTRIBUTE ? `attribute float ${MAP_LAYER_ATTRIBUTE};` : ''} flat varying int vMapLayer;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vMapLayer = int( ${layer} + 0.5 );`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform highp sampler2DArray mapLayers; flat varying int vMapLayer;`)
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 sampledDiffuseColor = texture( mapLayers, vec3( vMapUv, float( vMapLayer ) ) );
          diffuseColor *= sampledDiffuseColor;
        #endif`);
  // appended, never left to the prior key: a cloned fur keeps its source's key function, so a layered copy would share
  // the plain fur's program (its rigs then drew with `mapLayers` on a stale texture unit)
  }, { key: (prior) => `${prior}|layered-map:${layer}`, pureKey: true });
}
