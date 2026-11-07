import type { HudBand } from '../../../client/engine/ui/hudSlots';
import type { MinimapPalette } from '../../../client/engine/ui/Minimap';
import type { LookReplaceContext } from '../../../client/engine/render/look';
import type { SkyRig as Sky } from '../../../client/engine/world/skyRig';
import type { TreeFactory } from '../../../client/engine/world/TreeFactory';
import type { Noise2D } from '../core/noise';
import type { SpeciesWeights, TreeSpeciesTraits, TreeSetVariant } from '../../../client/engine/world/forest/treeSpecies';
// Engine-owned level data; structurally compatible with the transitional manifests.
export type Vec2 = [number, number];
export type RGB = [number, number, number];
export interface CabinSite { x: number; z: number; rot: number }
export interface PondDef { x: number; z: number; r: number }
export interface TerrainNoise { n: Noise2D; n2: Noise2D }
/** a level's terrain as functions: height, normal, ground-layer weights, trails, pads, pond and water */
export interface TerrainField {
  heightAt: (x: number, z: number) => number;
  normalAt: (x: number, z: number, eps?: number) => [number, number, number];
  splatAt: (x: number, z: number) => [number, number, number, number];
  trailDistance: (x: number, z: number) => number;
  cabinMask: (x: number, z: number) => number;
  pondMask: (x: number, z: number) => number;
  waterLevel: () => number;
  streamAt?: (x: number, z: number) => number | null;
  trails: Vec2[][];
  cabinSites: CabinSite[];
  pond: PondDef | null;
  /**
   * Metres this field's `heightAt` (and `waterLevel`) sit from the heights its offline bake was made from: a level that
   * shifts its whole world vertically at runtime (a Debug variant) applies the shift in its own functions, and the baked
   * grid (public/assets/baked/<slug>/terrain.bin) is installed shifted by the same amount. Read once, when the bake is
   * installed; absent or 0, the bake installs exactly as baked.
   */
  readonly datum?: number;
}
export interface TerrainSpec {
  landscape: (x: number, z: number, noise: TerrainNoise) => number;
  trails: Vec2[][];
  cabinSites: CabinSite[];
  pond?: PondDef;
  pondFill?: number;
  oceanLevel?: number;
  graded?: { paths: Vec2[][]; maxGrade: number; bench?: boolean };
  finish?: (x: number, z: number, h: number) => number;
  streamAt?: (x: number, z: number) => number | null;
  splat?: (x: number, z: number, t: TerrainField, noise: TerrainNoise) => [number, number, number, number];
}
export interface LevelAssets {
  groundLayers: [string, string, string, string];
  groundTints: [RGB, RGB, RGB, RGB];
  slabRock: string;
  boreal?: { normalK: [number, number, number, number]; trailDust: [number, number, number, number]; grassTint: RGB };
}
export interface TreeSpec {
  factory: string | (() => Promise<(renderer: LookReplaceContext['renderer'], sky: Sky) => Promise<TreeFactory>>);
  bark?: string;
  twigAtlas?: string;
  noun: string;
  set?: string;
  /** the set's variants, in its GLB's order (the level's own: Pine Hollow's PINE_TREE_SET) */
  setVariants?: readonly TreeSetVariant[];
  drawnBy?: 'model';
}
export interface ForestSpec {
  spacing: number;
  densityFreq: number;
  clearings: [number, number];
  maxSlope: number;
  tintHue: number;
  tintHueJitter: [number, number];
  tintSat: [number, number];
  tintLight: [number, number];
  largeVariantChance: number;
  density?: (x: number, z: number) => number;
  scale?: (x: number, z: number) => number;
  species?: (x: number, z: number) => SpeciesWeights;
  /** how each species of the set is planted, in draw order (needed with `species`) */
  speciesTraits?: readonly TreeSpeciesTraits[];
  understory?: { ferns: number; shrubs: number; fernCanopy: boolean };
  infill?: { x: number; z: number; r: number };
  mask?: (x: number, z: number) => number;
}
export type FaunaKind = string;
export interface HerdPlan {
  kind: FaunaKind;
  count: number;
  variants?: string[] | undefined;
  anchor?: { x: number; z: number; rMin: number; rMax: number };
  canopy: boolean;
  trailBand: [number, number];
}
export interface SkySpec {
  hdri?: string;
  sunColor: RGB;
  sunIntensity: number;
  envIntensity: number;
  bgIntensity: number;
  fogSunColor: RGB;
  cloudSunColor: RGB;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  planet?: { azimuth: number; elevation: number; size: number; tilt: number; roll?: number };
  sun?: { azimuth: number; elevation: number };
  painted?: { zenith: RGB; horizon: RGB; ground: RGB; glow: RGB };
}
export interface AtmosphereSpec {
  edgeHaze?: boolean;
  wetSurfaces?: boolean;
  /** compile the weather fog term (`weatherFog`, E390) into this level's fog */
  weather?: boolean;
  fogHeight: number;
  fogHeightFalloff: number;
  fogHeightDensity: number;
  fogDistDensity: number;
  volumetricSunColor: RGB;
  volumetric?: { height: number; falloff: number; density: number; strength: number };
}
export interface GradeSpec {
  saturation: number;
  brightness: number;
  contrast: number;
  bloomIntensity: number;
  bloomThreshold: number;
  shadowTint: RGB;
  highTint: RGB;
  lift: RGB;
  gain: RGB;
  gamma: number;
}
export interface GradeLook {
  grade: Partial<GradeSpec>;
  curve: number;
  vibrance: number;
  vol: number;
  fogDist: number;
  sat: number;
  ambient: number;
  sky: number;
  dayMist: number;
}
export interface SpawnPose { x: number; z: number; yaw: number; y?: number }
export interface HorizonBand { azimuth: number; spread: number; height: number; rough: number }
export interface HorizonRing { r: number; base: number; color: RGB; top: RGB; snowLine: number; haze: number; bands: HorizonBand[]; floor: number }
export interface HorizonSpec { rings: HorizonRing[]; cloudSea: boolean }
export interface HudSpec {
  bands?: readonly HudBand[];
  dayBadge?: boolean;
}
export interface MinimapSpec {
  /** the map baked from the world (SF66, G246): the image's URL. It covers the CHUNK_SIZE square centred on the origin,
   *  north (+Z) up and east (−X) right; the minimap and the full map draw it as their ground, loaded when they first need
   *  it and released with them. Omitted = the painted ground (`palette`, else the hillshade) */
  image?: string;
  palette?: MinimapPalette;
  openWater?: { level: number; deepDepth: number };
  outside?: string;
}
export interface PoiSpec { id: string; name: string; x: number; z: number; r?: number }

export interface ExploreArt { world: string; models: string; sets: string; practice: string }
export interface CompareTarget { id: string; label: string; model: string; target: string; live: string; image: string }
export type ExploreSpec = (ExploreArt | { art: ExploreArt }) & { compare?: readonly CompareTarget[] };
export function exploreArt(spec: ExploreSpec | undefined): ExploreArt | undefined { return spec === undefined ? undefined : 'art' in spec ? spec.art : spec; }
