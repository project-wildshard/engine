import { lookLightManifest, type LookLightSource } from '@wildshard/engine/render/lookLight';
import type { ShardManifest } from '../shard/manifest';

type LevelLook = Pick<ShardManifest, 'sky' | 'atmosphere' | 'grade'>;

/**
 * ONE-FORMAT OF7: a declared page's level look reads `look/look` over its manifest. Where the look declares a setting it
 * wins: `look.light.heightFog` the atmosphere's height fog, `look.grade.bloom` the desktop bloom (the phone tier draws
 * none, M4.9). What the look has no word for (sun, hemisphere, tints) stays the manifest's until OF9b moves it, as do
 * `look.light.ao`, the bloom radius and the grid's neighbour cells (`regionalWorld`, which builds from the manifest); the
 * keyed sky, its painted dome (`look.sky`) and a toon look's light keep reading `level.sky` through the page's `render`.
 * A look that declares nothing returns the manifest's own objects. `on` is the Debug row ("Look light"), as for an
 * undeclared page (`sourceManifest`).
 */
export function declaredLook(manifest: LevelLook, look: LookLightSource, on: boolean, tier: string): LevelLook {
  const fog = on && look.light?.heightFog !== undefined, bloom = on && tier !== 'phone' && look.grade.bloom !== undefined;
  if (!fog && !bloom) return { sky: manifest.sky, atmosphere: manifest.atmosphere, grade: manifest.grade };
  const light = lookLightManifest(look, on, tier);
  return {
    sky: manifest.sky,
    atmosphere: fog ? { ...manifest.atmosphere, ...light.atmosphere } : manifest.atmosphere,
    grade: bloom ? { ...manifest.grade, bloomIntensity: light.bloom.intensity, bloomThreshold: light.bloom.threshold } : manifest.grade,
  };
}
