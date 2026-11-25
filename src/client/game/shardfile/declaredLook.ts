import { lookLightManifest, type LookLightSource } from '@wildshard/engine/render/lookLight';
import { levelLook, type LookLevel } from '@wildshard/format/look-level';
import type { ManifestMetadata } from '@wildshard/format/minimap';
import type { ShardManifest } from '../shard/manifest';

type LevelLook = Pick<ShardManifest, 'sky' | 'atmosphere' | 'grade' | 'horizon'>;
/** what a declared page's level look is read from: its look section, and (a product built before OF9b2) its manifest */
export interface LevelLookSource {
  readonly look: { readonly level?: LookLevel | undefined };
  readonly manifest?: Partial<Pick<ManifestMetadata, 'sky' | 'atmosphere' | 'grade' | 'horizon'>> | undefined;
}

/** A level look with its horizon only when it has one (an absent horizon is the default ridge rings). */
function withHorizon(level: Omit<LevelLook, 'horizon'>, horizon: LevelLook['horizon']): LevelLook {
  return horizon === undefined ? level : { ...level, horizon };
}

/** A manifest with no horizon of its own, for a declared page's level look (`declaredLevel`) to give it one or none. */
export function withoutHorizon<M extends { readonly horizon?: unknown }>(manifest: M): Omit<M, 'horizon'> {
  const { horizon: _horizon, ...rest } = manifest;
  return rest;
}

/**
 * ONE-FORMAT OF9b2: the level look a declared page draws. `look/look`'s `level` (sky rig, atmosphere, grade, horizon)
 * first; a product built before OF9b2 has none, and its `ui/level` manifest's fields are lifted at the door (format
 * `levelLook`, the same values byte for byte); with neither, the discovery manifest's, as before. The look is the
 * product's own, so a page draws what its product says even where the discovery document is older or newer.
 */
export function declaredLevel(manifest: LevelLook, source: LevelLookSource): LevelLook {
  const level = levelLook({ look: source.look.level === undefined ? {} : { level: source.look.level }, ...(source.manifest === undefined ? {} : { manifest: source.manifest }) });
  if (level === undefined) return withHorizon({ sky: manifest.sky, atmosphere: manifest.atmosphere, grade: manifest.grade }, manifest.horizon);
  return withHorizon({ sky: level.sky, atmosphere: level.atmosphere, grade: level.grade }, level.horizon);
}

/**
 * QA 11-25 row 52 (FORMAT-PRUNE FP47b): a runtime page's level look (a discovery naming its client-plan entry, Nalati's
 * kind) is its product's (`look.level`) over its discovery document's, as a declared page's is. SDK 0.4.32 on carries
 * no level look in discovery, so a runtime page that read discovery alone drew the plain sky with no HDRI, and its sky
 * rig refused at level.world (Nalati on SDK 0.4.34).
 */
export function nativePageLevel<M extends LevelLook>(manifest: M, source: LevelLookSource): Omit<M, 'horizon'> & LevelLook {
  return { ...withoutHorizon(manifest), ...declaredLevel(manifest, source) };
}

/**
 * ONE-FORMAT OF7: a declared page's level look reads `look/look` over its manifest. Where the look declares a setting it
 * wins: `look.light.heightFog` the atmosphere's height fog, `look.grade.bloom` the desktop bloom (the phone tier draws
 * none, M4.9). OF9b2 moved the rest (sun, hemisphere, tints, grade, horizon) into `look.level`, read by `declaredLevel`;
 * `look.light.ao`, the bloom radius and the grid's neighbour cells' light and bloom (`regionalWorld`, which takes
 * `declaredLevel` only) stay as they were; the keyed sky, its painted dome (`look.sky`) and a toon look's light keep
 * reading `level.sky` through the page's `render`. A look that declares nothing returns the level's own objects. `on` is
 * the Debug row ("Look light"), as for an undeclared page (`sourceManifest`).
 */
export function declaredLook(manifest: LevelLook, source: LevelLookSource & { readonly look: LookLightSource }, on: boolean, tier: string): LevelLook {
  const base = declaredLevel(manifest, source), look = source.look;
  const fog = on && look.light?.heightFog !== undefined, bloom = on && tier !== 'phone' && look.grade.bloom !== undefined;
  if (!fog && !bloom) return base;
  const light = lookLightManifest(look, on, tier);
  return withHorizon({
    sky: base.sky,
    atmosphere: fog ? { ...base.atmosphere, ...light.atmosphere } : base.atmosphere,
    grade: bloom ? { ...base.grade, bloomIntensity: light.bloom.intensity, bloomThreshold: light.bloom.threshold } : base.grade,
  }, base.horizon);
}
