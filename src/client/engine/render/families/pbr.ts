/**
 * The PBR material family (SHARD-PLATFORM SF10a): three's metal / rough MeshStandardMaterial driven by renderer-neutral
 * parameters. A colour map, a tangent-space normal map and one packed ORM map (occlusion r, roughness g, metalness b:
 * Poly Haven's ARM, glTF's metallic-roughness with occlusion) with scalar factors over each.
 *
 * Every slot is always filled (a 1×1 white or flat-normal filler where the surface has no map), so every PBR material
 * shares one program per object variant and a missing map is a uniform, not a recompile (the same trick the sky rig
 * plays on loaded models). Program changes come only from `vertexColours`, `faceted`, `doubleSided`, `alphaCutoff > 0` and a
 * procedural `ground` layer (ground.ts: wind ripples, grain and terrain light shaping, Signal Dunes' sand) or `measure`
 * layer (measure.ts: SF56's dev-map grid, roles and size labels).
 */
import * as THREE from 'three';
import { applyGround } from './ground';
import { applyMeasure } from './measure';
import type { PbrMaterialParams } from '@wildshard/format/materialFamilies';

/** How a texture is read: `colour` is sRGB, `data` is linear (normals, ORM). */
export type TextureUse = 'colour' | 'data';
/**
 * Turns a parameter's texture reference into a texture (a shardfile file hash through the asset store, or an asset
 * path during the transition). The resolver owns loading, caching and the glTF UV convention (no vertical flip).
 */
export type TextureResolver = (ref: string, use: TextureUse) => THREE.Texture;

let fillers: { white: THREE.DataTexture; flatNormal: THREE.DataTexture } | null = null;
/** the shared 1×1 fillers: white multiplies by one, the flat normal leaves the geometry normal */
export function pbrFillers(): { readonly white: THREE.DataTexture; readonly flatNormal: THREE.DataTexture } {
  if (fillers) return fillers;
  const tex = (rgb: [number, number, number], srgb: boolean): THREE.DataTexture => {
    const t = new THREE.DataTexture(new Uint8Array([...rgb, 255]), 1, 1);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.name = 'family:pbr-filler';
    t.needsUpdate = true;
    return t;
  };
  fillers = { white: tex([255, 255, 255], true), flatNormal: tex([128, 128, 255], false) };
  return fillers;
}

/** Compile a PBR surface to a three.js material (WebGL v1 renderer). */
export function compilePbr(params: PbrMaterialParams, textures: TextureResolver, emitterPools?: (id: string) => { readonly value: readonly THREE.Vector4[] }): THREE.MeshStandardMaterial {
  const { white, flatNormal } = pbrFillers();
  const { colour, normal, orm } = params.maps;
  const ormMap = orm === null ? white : textures(orm, 'data');
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setRGB(...params.colour, THREE.SRGBColorSpace),
    map: colour === null ? white : textures(colour, 'colour'),
    normalMap: normal === null ? flatNormal : textures(normal, 'data'),
    // glTF's UV convention (unflipped textures, as GLB and KTX2 load): three's tangent frame expects flipped ones, so the
    // normal map's green runs the other way, as GLTFLoader sets it
    // (SF50: the 8-bit filler's 128 / 255 is not zero, so a 0.3 degree tilt along the UVs moved a low key's light by ~1 %;
    // with no normal map the scale is zero and the geometry normal stands exactly)
    normalScale: normal === null ? new THREE.Vector2(0, 0) : new THREE.Vector2(params.normalScale, -params.normalScale),
    aoMap: ormMap, aoMapIntensity: orm === null ? 0 : params.occlusion,
    roughnessMap: ormMap, metalnessMap: ormMap,
    roughness: params.roughness, metalness: params.metalness,
    envMapIntensity: params.envStrength,
    vertexColors: params.vertexColours, flatShading: params.faceted,
    side: params.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    alphaTest: params.alphaCutoff,
  });
  m.name = 'family:pbr';
  if (params.ground !== null && params.measure !== null) throw new Error('material family: a PBR surface takes a ground or a measure layer, not both');
  if (params.ground !== null) applyGround(m, params.ground, textures, emitterPools);
  if (params.measure !== null) applyMeasure(m, params.measure);
  return m;
}
