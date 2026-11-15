import { parseManifestMetadata } from '@wildshard/format/minimap';

const image = 'data:image/', art = { world: image, models: image, sets: image, practice: image };

/** Minimal complete metadata for engine-owned manifest compiler tests. */
export const fixtureManifest = parseManifestMetadata({
  slug: 'fixture', status: 'live', order: 1, api: 1, name: 'Fixture', label: 'Fixture', seed: 1, biome: 'fixture', blurb: 'fixture',
  card: { thumb: image, portrait: image, landscape: image }, style: 'fixture', kitLook: 'toon', weapon: 'sword', treeCount: 0,
  trees: { factory: 'none', noun: 'trees' }, assetGlobs: [], spawn: { x: 0, z: 0, yaw: 0 },
  sky: { sunColor: [0, 0, 0], sunIntensity: 0, envIntensity: 0, bgIntensity: 0, fogSunColor: [0, 0, 0], cloudSunColor: [0, 0, 0], hemiSky: 0, hemiGround: 0, hemiIntensity: 0 },
  atmosphere: { fogHeight: 0, fogHeightFalloff: 0, fogHeightDensity: 0, fogDistDensity: 0, volumetricSunColor: [0, 0, 0] },
  grade: { saturation: 0, brightness: 0, contrast: 0, bloomIntensity: 0, bloomThreshold: 0, shadowTint: [0, 0, 0], highTint: [0, 0, 0], lift: [0, 0, 0], gain: [0, 0, 0], gamma: 1 },
  minimap: { image }, pois: [], explore: { art }, spawns: [], audio: { ambience: 'fixture', score: 'fixture' },
  bindings: { accent: 'fixture', budgets: { module: './budgets.generated', export: 'default' } },
});
