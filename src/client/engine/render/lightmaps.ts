/**
 * Baked lightmaps on a standard surface (G532 (4)): an offline bake's two maps, read from a UV set of the surface's own.
 * - `ao`: the sky's occlusion, multiplying the ambient and hemisphere fill the live clock tints (three's `aoMap`);
 * - `bounceMap`: the sun's baked indirect light, added in proportion to the live sun (three's `lightMap`, its intensity
 *   the `bounce` param, `sunBounce` once a frame).
 * The sun and its shadows stay live; only what the clock barely moves is baked. A graph look takes the same param names
 * as its own lent textures; this is the same contract for a plain MeshStandardMaterial. A surface with an occlusion
 * (ORM) map of its own refuses an `ao` map: both would claim three's one occlusion slot.
 */
import * as THREE from 'three';

const filler = (texture: THREE.Texture | null): boolean => texture === null || (texture instanceof THREE.DataTexture && texture.image.width === 1 && texture.image.height === 1);

/** Lend a standard surface one of its baked maps by param name (`ao` or `bounceMap`). */
export function bindStandardLightmap(material: THREE.MeshStandardMaterial, param: string, texture: THREE.Texture): void {
  if (param === 'ao') {
    if (!filler(material.aoMap) && material.aoMap !== texture) throw new Error('A baked AO map needs a surface without its own occlusion map');
    material.aoMap = texture; material.aoMapIntensity = 1;
  } else if (param === 'bounceMap') material.lightMap = texture;
  else throw new Error(`Unknown standard lightmap param ${param}`);
  material.needsUpdate = true;
}

/** A standard surface's scalar lightmap param: `bounce` scales its bounce map. */
export function setStandardLightmap(material: THREE.MeshStandardMaterial, param: string, value: number): void {
  if (param !== 'bounce' || !Number.isFinite(value)) throw new Error(`Unknown standard lightmap param ${param}`);
  material.lightMapIntensity = value;
}

/** How strongly the baked bounce shows under the live sun: its luminance × intensity × elevation over the bake's
 *  reference elevation (floored at 0.2), ÷ the bake's gain; 0 before the sky has a sun light. */
export function sunBounce(light: Pick<THREE.DirectionalLight, 'intensity' | 'color'> | undefined, sunY: number, referenceY: number, gain: number): number {
  if (light === undefined) return 0;
  const lum = light.intensity * (0.2126 * light.color.r + 0.7152 * light.color.g + 0.0722 * light.color.b);
  return lum * (Math.max(0, sunY) / Math.max(0.2, referenceY)) / gain;
}
