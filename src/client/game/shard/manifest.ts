import type { Scope } from '@wildshard/engine/app/scope';
import type { TerrainLattice } from '@wildshard/engine/physics/terrain';
import { inflateScalarBlocks,readScalarChannel,readScalarLattice,ScalarLatticeBindings } from '@wildshard/engine/world/scalarChannel';
import { readFileInputs } from '../../../shared/game/shardfile/fileInputs';
import { ScalarLatticeSchema,ScalarTripletSchema,type ScalarLatticeRows,type ScalarTripletRows } from '@wildshard/format/scalarChannel';
import { bakedSamplers } from '@wildshard/format/bakedTerrainSampling';
import { basinBody,type WaterBody } from '@wildshard/engine/world/water/body';
import type { ShardPlugin } from "../plugin/context";
import type { Ktx2Table } from '@wildshard/engine/boot/gpuFiles';
import type { SwordArms, SwordFraming, SwordMoveSet, SwordRig } from '@wildshard/engine/combat/view/melee';
import type { Noise2D } from '@wildshard/engine/core/noise';
import type { HuntTuning } from '@wildshard/engine/ai/hunt';
import type { ExploreSpec } from '@wildshard/engine/level/data';
import type { LevelSpec, EngineMechanism, TierOverrides, BootSpec, LoadoutSpec } from '@wildshard/engine/level/spec';
import type { RosterEntry } from '@wildshard/engine/models/live';
import type { SwimArms } from '@wildshard/engine/player/Hands';
import type { LookReplaceContext, LookStrategy } from '@wildshard/engine/render/look';
import type { Renderer } from '@wildshard/engine/render/renderer';
import type { HudBand } from '@wildshard/engine/ui/hudSlots';
import type { MinimapPalette } from '@wildshard/engine/ui/Minimap';
import { mapPalette, parseManifestMetadata, parseCapturePoses, FixedForestQueriesSchema, type ManifestMetadata, type MapPaletteRow } from '@wildshard/format/minimap';
import type { Forest } from '@wildshard/engine/world/forest/Forest';
import type { SpeciesWeights, TreeSpeciesTraits, TreeSetVariant } from '@wildshard/engine/world/forest/treeSpecies';
import type { WorldRegistry } from '@wildshard/engine/world/registry';
import type { SkyRig as Sky } from '@wildshard/engine/world/skyRig';
import type { TreeFactory } from '@wildshard/engine/world/TreeFactory';
import { flatTerrainField } from '@wildshard/engine/world/groundField';
import { createBakedTerrainField } from '@wildshard/engine/world/bakedTerrainField';
import { buildTerrainMetadata } from '@wildshard/engine/world/terrainField';
import { declaredWaterBody } from '@wildshard/engine/world/water/declared';
import { ForestRowsSchema, GroundRowsSchema, PondClipSchema,type GroundRows } from '@wildshard/format/terrain';
import { currentPageMode } from '../../../shared/game/grid/pageMode';
import * as v from 'valibot';

import type { AccentId } from '@wildshard/format/accent';
import type { RegionalSimCost, RuntimeCost } from '@wildshard/format/runtimeCost';
import type { ShardSlug } from '../../../shared/game/shard/slug';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';
/**
 * ShardManifest — everything that makes one Wildshard shard different from another.
 *
 * A shard is one 500 m × 500 m chunk with its own biome. The engine (renderer, sky rig,
 * terrain mesh, forest/grass/prop placers, fauna AI, HUD) is shared; a ShardManifest is the
 * *data* that drives it: the terrain field, which textures and tree species to use, where
 * the animals live, what the sky and fog look like, and how the shard appears on the title
 * screen. Defs are plain data + pure functions — no three.js objects, no DOM, no side effects —
 * so they can be evaluated at module init and swapped by `src/client/game/shard/registry.ts`. (`render` is
 * a lazy loader: the three.js code it imports is only fetched and run when the shard boots.)
 *
 * Fixed by the Wildshard fundamentals (NOT per chunk, see `src/shared/engine/core/config.ts`): chunk size
 * (500 m), slab depth, the four 15 m entry roads at the edge midpoints reaching ≥ 50 m in and
 * level with no-man's-land (y = 0) at the boundary, and the terrain mesh resolution.
 *
 * To add a shard: see `docs/SHARDS.md`.
 */
import type { PerspectiveCamera, Scene } from 'three';

/** a shard's own sword (ShardManifest.sword): the engine Sword's rigid rig, moves and portrait framing — or an animated rig
 *  (`arms`) swung by the engine's own moves */
export interface ShardSword {
  rig?: SwordRig; arms?: SwordArms; moves?: SwordMoveSet; framing?: Partial<SwordFraming>; portraitPullX?: number;
  /** the found iron sword's own animated rig (Driftwood: the same castaway arms holding the iron blade, E334) */
  ironArms?: SwordArms;
  /** the swimming hands on the same rig (Hands.ts plays its swim clips); omitted = the white-gloved hands */
  swim?: SwimArms;
}

/** What core hands a shard's field models (`ShardManifest.fieldModels`): the fields it built, the shard's sky and registry. */
export interface FieldModelsContext<Floor = unknown> {
  sky: Sky;
  renderer: Renderer | null;
  /** the forest field (its trees' placements and view) */
  forest: Forest | null;
  /** the forest floor's field (its kinds' copies and cells); null where none was built */
  under: Floor | null;
  registry: WorldRegistry;
}

/** [x, z] metres, origin at the chunk centre, chunk spans ±250 on both axes */
type Vec2 = [number, number];
/** linear-space RGB triple, 0..1 (values above 1 are allowed for HDR sun colours) */
type RGB = [number, number, number];

export interface CabinSite { x: number; z: number; rot: number }
export interface PondDef { x: number; z: number; r: number }

/** The two seeded noise fields every terrain gets: `n` = Noise2D(seed), `n2` = Noise2D(seed + 7). */
export interface TerrainNoise { n: Noise2D; n2: Noise2D }

/**
 * The compiled terrain: pure functions over (x, z). Built once per def by `buildTerrain()` in
 * `src/shared/engine/world/terrainField.ts`; `src/shared/engine/world/Heightfield.ts` re-exports the active one so the many
 * consumers (Terrain, Forest, Grass, Props, Cabin, Water, Player, animals…) call these directly.
 */
export interface ChunkTerrain {
  /** surface height in metres (after trails, cabin pads, pond basin and entry-road levelling) */
  heightAt: (x: number, z: number) => number;
  /** unit surface normal by central differences */
  normalAt: (x: number, z: number, eps?: number) => [number, number, number];
  /** blend weights for the four ground layers in `ChunkAssets.groundLayers`, summing to 1 */
  splatAt: (x: number, z: number) => [number, number, number, number];
  /** metres to the nearest trail centreline */
  trailDistance: (x: number, z: number) => number;
  /** 0 off the cabin pads → 1 on them */
  cabinMask: (x: number, z: number) => number;
  /** 0 outside the pond basin → 1 at its centre (always 0 when the chunk has no pond) */
  pondMask: (x: number, z: number) => number;
  /** still-water surface height (far below the terrain when the chunk has no pond) */
  waterLevel: () => number;
  /** running water (a creek): its surface at (x, z), or null off it — wading, the dry-ground test, the boundary line */
  streamAt?: (x: number, z: number) => number | null;
  trails: Vec2[][];
  cabinSites: CabinSite[];
  pond: PondDef | null;
  /** metres `heightAt` sits from the heights the offline bake was made from (a world shifted vertically at runtime, e.g.
   *  Driftwood's G164 drop): the bake installs shifted by it (the engine's `TerrainField.datum`) */
  readonly datum?: number;
}

/** What a def supplies to `buildTerrain()`; the shared parts (roads, pads, trail beds, pond dish) are added for you. */
export interface TerrainSpec {
  /**
   * Raw landscape height (metres) before any of the shared shaping. Use the seeded `noise`
   * fields, never Math.random. Keep it within roughly −10..+40 m; the entry roads are forced
   * to y = 0 at the boundary regardless.
   */
  landscape: (x: number, z: number, noise: TerrainNoise) => number;
  /**
   * Dirt-trail polylines. By convention the first four start at the edge midpoints
   * `[0, ∓250]` / `[∓250, 0]` and run straight for ROAD_LENGTH before bending — that is the
   * mandated entry road. Any number of extra spurs may follow.
   */
  trails: Vec2[][];
  /** Flattened pads where the log cabins stand (`src/engine/world/Cabin.ts` builds one per site). */
  cabinSites: CabinSite[];
  /** Optional still pond; the basin is dished into the landscape below its water line. */
  pond?: PondDef;
  /** metres the pond surface sits above the raw landscape height at its centre (default 1.0) */
  pondFill?: number;
  /** open-water shard: `waterLevel()` returns this (pass `ShardManifest.ocean.level`) and the landscape below it is sea floor */
  oceanLevel?: number;
  /**
   * Paths graded to a walkable profile (PHYSICS.md: the player climbs ≤ 40°): along each polyline the ground is cut
   * and filled so the centreline never climbs steeper than `maxGrade` (rise / run), blended out over a few metres
   * each side. Where the ground is already that gentle it is left exactly as it is — unless `bench`: then the whole
   * path is a shelf levelled across (a footpath traversing a slope steeper than the motor climbs, whose own grade is
   * gentle, still needs a flat tread to walk on).
   */
  graded?: { paths: Vec2[][]; maxGrade: number; bench?: boolean };
  /**
   * A last touch on the finished height, after the graded paths, the pond dish, the trail beds and the cabin pads but
   * before the entry roads are levelled (so the fundamentals still hold): for what the shared shaping would flatten —
   * an islet standing out of the pond's dish (Pine Hollow). Omitted = nothing.
   */
  finish?: (x: number, z: number, h: number) => number;
  /** running water beyond the pond (Pine Hollow's creek): its surface at (x, z), or null off it. Omitted = none. */
  streamAt?: (x: number, z: number) => number | null;
  /**
   * Ground-layer blend for `ChunkAssets.groundLayers` — [layer0, layer1, layer2, layer3], any
   * scale (normalised for you). `t` is the finished terrain so you can query slope, height,
   * trail distance and the masks. Omitted (a shard with no splat ground: Driftwood colours by height and slope, E318):
   * all layer 0.
   */
  splat?: (x: number, z: number, t: ChunkTerrain, noise: TerrainNoise) => [number, number, number, number];
}

/** Texture / model ids under `public/assets/` (see `scripts/fetch-assets.mjs`). */
export interface ChunkAssets {
  /** four PBR ground sets blended by `splatAt`, in weight order */
  groundLayers: [string, string, string, string];
  /** per-layer albedo multipliers (linear RGB) applied in the terrain shader */
  groundTints: [RGB, RGB, RGB, RGB];
  /** PBR set for the rock walls of the floating slab */
  slabRock: string;
  /**
   * The boreal ground (PINE-HOLLOW PH-L8): the terrain shader's canopy-driven needle litter, moss patches and tiling
   * breakup, with per-layer normal strengths (src/client/engine/world/lookFlags.ts). Absent: the plain splat shader.
   */
  /** `trailDust`: the trail layer pulled toward its own luminance × this tint by `amount` ([r, g, b, amount]) — dry, dusty
   *  compacted soil instead of the set's grey-violet pebbles (PH-L1 round 3); `grassTint` × the grass tufts' colour (the dry
   *  golden-olive boreal grass, not a lime lawn) */
  boreal?: { normalK: [number, number, number, number]; trailDust: [number, number, number, number]; grassTint: RGB };
}

/** A declared tree set's factory: its product's `world/trees` rows built on the game's tree set factory (models/treeSet). */
export function declaredTreeSet(slug: string): ChunkTrees['factory'] {
  return async () => {
    const { productTreeSet, TreeSetFactory } = await import('../models/treeSet');
    return async (renderer, sky) => new TreeSetFactory(renderer, await productTreeSet(slug), sky).build();
  };
}

/** Which tree builder to use and what it should be textured with. */
export interface ChunkTrees {
  /**
   * `'pine'` → `src/client/engine/world/TreeFactory.ts` (baked branch cards). New species = new factory id. `'none'`: the
   * shard has no forest trees — no tree textures, geometry or branch-card bake at launch, an empty Forest
   * (collision / culling hooks still work). A baked tree set's rows (look graphs or painterly) build on `declaredTreeSet`.
   */
  factory: 'none' | (() => Promise<(renderer: LookReplaceContext['renderer'], sky: Sky) => Promise<TreeFactory>>);
  /** PBR set for the trunks (the `'pine'` factory's; omitted by a shard without pines) */
  bark?: string;
  /** folder under `public/assets/tex/` holding `twig_rgba.png`, `twig_nor_gl.jpg`, `twig_arm.jpg` (the `'pine'` factory's) */
  twigAtlas?: string;
  /** what the HUD calls them, plural ("pines", "birches") */
  noun: string;
  /**
   * A Blender-built species set (PH-B4): the folder under `public/assets/models/` with its trees.glb + card / impostor
   * atlases (scripts/blender/trees/run.sh). Its variants are `TREE_SPECS_V2` (src/shared/engine/world/forest/placement.ts), planted by
   * `ChunkForest.species`. Omitted (or a build without its files): the runtime pines.
   */
  set?: string;
  /** the set's variants, in its GLB's order (E405: the level's own; Pine Hollow's PINE_TREE_SET) */
  setVariants?: readonly TreeSetVariant[];
  /**
   * `'model'`: the shard's own tree model draws the forest (`place`, E315: Pine Hollow's forest tree,
   * src/shards/pine-hollow/world/drawnModels.ts) — the core Forest places the trees and hands the model its view, and
   * draws nothing itself unless the shard hands the drawing back (`Forest.drawItself`). Omitted: the Forest draws them.
   */
  drawnBy?: 'model';
}

/** Forest placement tuning (`src/client/engine/world/forest/Forest.ts`). The total is `ShardManifest.treeCount`. */
export interface ChunkForest {
  /** metres between placement candidates on the jittered grid */
  spacing: number;
  /** frequency of the clearing / grove density noise (1/m) */
  densityFreq: number;
  /** density noise range mapped 0→1 keep probability: [sparse, dense] */
  clearings: [number, number];
  /** minimum surface normal y (1 = flat); steeper ground gets no trees */
  maxSlope: number;
  /** foliage tint HSL: base hue, hue jitter [lo, hi], saturation [lo, hi], lightness [lo, hi] */
  tintHue: number;
  tintHueJitter: [number, number];
  tintSat: [number, number];
  tintLight: [number, number];
  /** chance a tree uses the large variant (index 3) instead of variants 0–2 */
  largeVariantChance: number;
  /**
   * Per-place keep multiplier on the density noise (src/shared/engine/world/forest/placement.ts): > 1 thickens a grove (Pine Hollow's
   * old-growth), < 1 thins it, 0 keeps the ground bare — no tree and no undergrowth (building pads, a boss arena).
   * Omitted = 1 everywhere.
   */
  density?: (x: number, z: number) => number;
  /** per-place multiplier on a tree's size (the old-growth's giants); omitted = 1. With a species set: pines and firs only */
  scale?: (x: number, z: number) => number;
  /** with a species set (`ChunkTrees.set`): the species mix at (x, z), relative weights (src/shared/engine/world/forest/placement.ts) */
  species?: (x: number, z: number) => SpeciesWeights;
  /** how each species of the set is planted, in draw order (needed with `species`; E405: the level's own) */
  speciesTraits?: readonly TreeSpeciesTraits[];
  /**
   * The understory (src/shared/engine/world/forest/placement.ts placeUndergrowth; PINE-HOLLOW PH-L8): × the fern and shrub caps (and their
   * candidate counts); `fernCanopy` lets ferns fill the dense shade outside the fern-cluster noise (≥ 5 trunks in 12 m).
   * Omitted = the engine's counts.
   */
  understory?: { ferns: number; shrubs: number; fernCanopy: boolean };
  /**
   * A denser stand than `spacing` allows: a second candidate grid, half a cell off the first, inside the circle (x, z, r),
   * tested after the chunk's own candidates by the same rules (density, trails, pads, slope). Omitted = none.
   */
  infill?: { x: number; z: number; r: number };
  /** optional keep probability 0..1 at (x, z), applied after the clearing noise (Nalati: spruce only in the gullies); omitted = everywhere */
  mask?: (x: number, z: number) => number;
}

/** a registered species kind (`src/engine/entities/species/<kind>.ts`): 'deer' | 'boar' built in; bear / elk… as they register */
export type FaunaKind = 'deer' | 'boar' | (string & Record<never, never>);

/** One herd / sounder. `src/server/engine/entities/AnimalManager.ts` finds a clearing that satisfies it. */
export interface HerdPlan {
  kind: FaunaKind;
  count: number;
  /** restrict the herd to these variant ids of the species (e.g. ['black', 'scarback']); omit for the full weighted table */
  variants?: string[] | undefined;
  /** ring around a point to search for the herd centre; omit for anywhere in the chunk */
  anchor?: { x: number; z: number; rMin: number; rMax: number };
  /** true = under the canopy (boars), false = in a clearing (deer) */
  canopy: boolean;
  /** metres off the nearest trail centreline: [min, max] */
  trailBand: [number, number];
}

/** Lighting rig (`src/engine/world/Sky.ts`). */
export interface ChunkSky {
  /** file stem under `public/assets/hdri/` (without `_2k.hdr`); the sun is found from its brightest pixel. The HDRI rig's
   *  (Pine Hollow); omitted by a stylized or painted sky, which downloads none (E318) */
  hdri?: string;
  sunColor: RGB;
  sunIntensity: number;
  envIntensity: number;
  bgIntensity: number;
  /** tint the fog takes when looking toward the sun */
  fogSunColor: RGB;
  /** tint of the procedural cloud layer toward the sun */
  cloudSunColor: RGB;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  /**
   * The ringed gas giant (`Sky.buildGasGiant`): a banded cream / tan / rust planet with a thin bright
   * ring, lit from the sun's side. Omitted = the default grey planet low over the west (Pine Hollow).
   * Degrees: `azimuth` compass (0 = north = +Z, 90 = east = −X), `elevation` above the horizon,
   * `size` = the body's apparent diameter, `tilt` = ring opening (0 edge-on … 90 face-on), `roll` = the
   * ring's lean on the sky (optional, default 20).
   */
  planet?: { azimuth: number; elevation: number; size: number; tilt: number; roll?: number };
  /**
   * Put the sun here instead of at the HDRI's brightest pixel (degrees: compass azimuth as `planet`, elevation above
   * the horizon). Nalati: a late-afternoon sun from the WSW.
   */
  sun?: { azimuth: number; elevation: number };
  /**
   * A painted sky instead of the HDRI (`style: 'painterly'`): `Sky.ts` paints a small equirectangular gradient —
   * `zenith` overhead → `horizon` at the skyline → `ground` below it, a warm `glow` around the sun — and uses it as
   * the background and the environment. Nothing is downloaded for the sky (`hdri` is then unused).
   */
  painted?: { zenith: RGB; horizon: RGB; ground: RGB; glow: RGB };
}

/** Height + distance fog (`src/client/engine/world/Atmosphere.ts`) and the volumetric sun shafts. */
export interface ChunkAtmosphere {
  /** metres; fog is densest below this */
  edgeHaze?: boolean;
  wetSurfaces?: boolean;
  /** compile the weather fog (`weatherFog` from @wildshard/engine, E390): a storm the shard eases in and out */
  weather?: boolean;
  fogHeight: number;
  fogHeightFalloff: number;
  fogHeightDensity: number;
  fogDistDensity: number;
  /** colour of the god-ray / volumetric light */
  volumetricSunColor: RGB;
  /** the volumetric light's medium (`src/client/engine/core/Volumetrics.ts`); omitted = the forest haze (height −8, falloff 0.12, density 0.0045, strength 0.55) */
  volumetric?: { height: number; falloff: number; density: number; strength: number };
}

/** Post-process colour grade (`src/client/engine/core/Game.ts` composer + `src/client/engine/core/Grade.ts`). */
export interface ChunkGrade {
  saturation: number;
  brightness: number;
  contrast: number;
  bloomIntensity: number;
  bloomThreshold: number;
  /** split-tone multipliers for shadows / highlights (display-space RGB) */
  shadowTint: RGB;
  highTint: RGB;
  lift: RGB;
  gain: RGB;
  gamma: number;
}

/**
 * A shard's look-loop grade (PINE-HOLLOW PH-L1 / L4), laid over `grade` and the day clock
 * (src/client/engine/world/lookFlags.ts): grade overrides, a display-space S-curve and vibrance in GradeEffect, and multipliers on the
 * clock's volumetric in-scatter / distance fog plus a saturation offset (PineDayNight.look; the presets untouched).
 */
export interface ChunkLook {
  grade: Partial<ChunkGrade>;
  /** S-curve strength around mid grey (0 = none) */
  curve: number;
  /** saturation lift that spares what is already saturated (0 = none) */
  vibrance: number;
  /** × the volumetric in-scatter, × the distance fog, + the clock's grade saturation */
  vol: number;
  fogDist: number;
  sat: number;
  /** × the sky's fill light (the IBL and the hemisphere): lighter shade under the canopy, the sun untouched */
  ambient: number;
  /** × the sky dome's brightness by day (the photo targets' paler sky; the IBL follows it, the fog colour does not) */
  sky: number;
  /** × the ground-mist sheets under a high sun (1 at dawn, dusk and night: the mist is the morning's and the night's) */
  dayMist: number;
}

/** `y`: the feet's height, for a shard whose floor is built (`structures`) rather than the terrain; omitted = `heightAt(x, z)` */
export interface SpawnPose { x: number; z: number; yaw: number; y?: number }

/** what a structure-first shard's world builder is handed (main.ts, the props step) */
export interface StructureContext {
  renderer: Renderer;
  scene: Scene;
  camera: PerspectiveCamera;
  /** the world registry (src/client/engine/world/registry.ts): what the shard registers is drawn, collides, and lends its floor */
  registry: WorldRegistry;
  /** a per-frame callback after the player's move (the camera is placed): time since the build (s), frame dt */
  onUpdate: (fn: (dt: number, t: number) => void, label?: string) => void;
  /** the step's progress bar, 0..1 */
  progress: (f: number, detail?: string) => void;
}

/**
 * A structure-first shard (Nine Dragon Stack's fragment, NINE-DRAGON-STACK P0-5c): its world is built floors on colliders,
 * not a landscape. The terrain functions still answer (the def's flat datum, far under the build) but nothing is drawn or
 * collides there — no terrain mesh, splat or slab and no heightfield collider — and no ground cover is built (grass,
 * undergrowth, forest particles, cabins, props, trail walkways). `build` makes the world: a lazy loader, so the def stays
 * node-safe and the code downloads with the shard.
 */
export interface ChunkStructures {
  /** extra files the world reads at boot (declared, so DOWNLOAD counts them and the offline cache holds them) */
  files: readonly string[];
  build: () => Promise<{ build: (ctx: StructureContext) => Promise<void> }>;
}

/**
 * Open water covering the whole shard (Driftwood Isle). The terrain's `waterLevel()` returns
 * `level` when this is set (the pond's line otherwise); everything below it is sea floor. The
 * ocean surface itself is `src/shards/driftwood-isle/world/Ocean.ts`.
 */
interface OceanDef {
  /** sea-surface height in metres */
  level: number;
  /** shallow-water colour (over sand) and deep-water colour, linear RGB */
  shallowColor: RGB;
  deepColor: RGB;
  /** metres below the surface at which the water reads as fully deep */
  deepDepth: number;
}

/**
 * How the shard is rendered: textured PBR (Pine Hollow), faceted flat-shaded vertex colours with no textures
 * (Driftwood Isle), or soft cel-banded vertex/gradient colour with painted shadows and rim light, no textures
 * (Nalati Grasslands — every mesh on the shared `src/client/engine/world/painterly.ts` material).
 */
export type KnownChunkStyle = 'pbr' | 'toon' | 'painterly' | 'jiehua' | 'greybox';
/** Opaque authored look label; keep familiar words in editor completion without closing the vocabulary. */
export type ChunkStyle = KnownChunkStyle | (string & Record<never, never>);

/**
 * One azimuth band of a horizon ring (`ChunkHorizon`): a bump in the ring's height profile centred on a compass
 * bearing (0 = north = +Z, 90 = east = −X), `spread` degrees either side (cosine falloff), `height` metres above
 * the ring's base at its peak. `rough` 0 = smooth rolling hills … 1 = jagged ridged peaks.
 */
export interface HorizonBand { azimuth: number; spread: number; height: number; rough: number }
/** A painted horizon ring: radius (m), base height (m, relative to y = 0), colours (linear), snow above `snowLine` of its height (0..1, > 1 = none), haze 0..1 */
export interface HorizonRing { r: number; base: number; color: RGB; top: RGB; snowLine: number; haze: number; bands: HorizonBand[]; floor: number }
/** A shard-specific horizon (`src/client/engine/world/Horizon.ts`): rings near → far; replaces the default three ridge rings. */
export interface ChunkHorizon { rings: HorizonRing[]; cloudSea: boolean }
/**
 * The first-person weapon the shard hands the player: `src/engine/player/Crossbow.ts`, `src/engine/player/Sword.ts` (+ the iron sword
 * on the wreck), or the Nalati kit (`src/shards/nalati-grasslands/weapons/nalatiKit.ts`: bow · sabre · spear). 'sword' and 'nalati' are the
 * melee shards (`meleeShard`): telegraphed charges on an arc, the hurt arc + trauma shake.
 */
export type ChunkWeapon = 'crossbow' | 'sword' | 'custom';
/** the optional pieces of the ONE base HUD a shard switches on (E154) — the layout, the controls and the status column are
 *  every shard's; a shard's own rows / discs come in through src/client/engine/ui/hudSlots.ts from its own modules */
export interface ChunkHud {
  bands?: readonly HudBand[];
  /** the sun / moon badge on the minimap's rim (Minimap.showDayBadge) */
  dayBadge?: boolean;
}

/** Compatibility names for manifests not yet migrated to the engine look contract. */


export interface ShardManifest {
  /** Interior board cruise: road preserves the grid road speed; absent/shard keeps the ordinary 14 m/s. */
  hoverSpeedClass?: 'shard' | 'road';
  /** Reviewed opaque-runtime home measurements, available before world bootstrap; the declaration shares this data. */
  runtimeCost?: RuntimeCost;
  /** SF57: a reviewed per-sim resident reading for this shard's regional shardfile sims; the allocator charges it instead of the declared ceiling. */
  regionalSimCost?: RegionalSimCost;
  next?: string;
  /** Built first-party data source, admitted before the existing session boot; picker identity stays on this manifest. */
  shardfile?: string;
  /** First-party grid declaration for a trusted hybrid; discovery alone does not replace the standalone boot path. */
  gridShardfile?: string;
  /** Built-in finite page owner, derived from the admitted entry policy; no source module exists. */
  clientPlanRuntime?: true;
  /** Definition-owned raw scalar preparation; never an authored callback. */
  scalarBlocks?: ScalarLatticeBindings;
  blender?: { area: { x0: number; x1: number; z0: number; z1: number }; models: readonly string[] };
  /** Migrated manifests declare their plugin and level policy; legacy hooks retire per shard phase. */
  load?: () => Promise<{ default: new () => ShardPlugin;
    resolveTrustedRuntime?: (entry: string) => new () => ShardPlugin }>;
  kitLook?: LevelSpec['kitLook'];
  /** the first-person hands' style; 'pbr' when absent (E405 AG25) */
  hands?: LevelSpec['hands'];
  creatures?: LevelSpec['creatures'];
  world?: LevelSpec['world'];
  /** Optional offline creature-navigation mask; water bodies remain the default. */
  navmesh?: LevelSpec['navmesh'];
  /** Required admitted creature navigation, independent of the offline bake exclusion mask. */
  navigation?: LevelSpec['navigation'];
  debugOptions?: LevelSpec['debugOptions'];
  uses?: readonly (EngineMechanism | 'coins' | 'loot' | 'compendium' | 'feats' | 'bag.pack')[];
  tiers?: TierOverrides;
  boot?: BootSpec;
  loadout?: LoadoutSpec;
  budgets?: LevelSpec['budgets'];
  audio?: LevelSpec['audio'];
  species?: LevelSpec['species'];
  encounters?: readonly string[];
  bag?: { tabs: readonly string[]; pack: { slots: number; keeps?: readonly string[] }; skinsTitle?: string };
  dev?: { poses: () => Promise<Readonly<Record<string, { eye: readonly [number, number, number]; yaw: number; pitch: number; feet?: readonly [number, number, number]; mockup: string; frame: string; probe?: { name?: string; x?: number; y?: number; z?: number; yaw?: number; pitch?: number } }>>> };
  /** Plugin API version; mismatches fail before the first asset load. */
  api: 1;
  /** title-card order, starting at one */
  order: number;
  status: 'live' | 'experimental' | 'earlyAccess' | 'hidden';
  /** False keeps a grid destination out of SHARD SELECT, including Developer. */
  shardSelect?: boolean;
  /** URL-safe key used by `?chunk=<slug>` and the registry */
  slug: ShardSlug;
  name: string;
  /** world-grid position shown in the HUD, e.g. `(+3, −2)` */
  label: string;
  /** master seed; every Rng / Noise2D in the engine derives from it */
  seed: number;
  /** total trees the forest places (subject to the density noise) */
  treeCount: number;
  /** one-line biome name for the picker, e.g. "Boreal pine forest" */
  biome: string;
  /** the HUD accent inside its grid cell: one of the platform's 20 (G104, `src/client/game/shardfile/accent.ts`); absent: the road's cyan */
  accent?: AccentId;
  /** two sentences for the title-screen picker */
  blurb: string;
  /** picker thumbnail and full-bleed title-screen stills, imported from the shard's thumbs folder */
  card: { thumb: string; portrait: string; landscape: string };
  /** landscape terrain, a structure-first world, or both; every shard supplies at least one */
  ground: {
    paths?: 'plugin'; terrain: ChunkTerrain; structures?: true | ChunkStructures; water?: readonly WaterBody[]; tiled?: true; collider?: TerrainLattice }
    | { paths?: 'plugin'; terrain?: ChunkTerrain; structures: true | ChunkStructures; water?: readonly WaterBody[]; tiled?: true; collider?: TerrainLattice };
  /** the PBR ground's texture sets; omitted by a shard that loads none (the low-poly Driftwood, E318) */
  assets?: ChunkAssets;
  assetGlobs?: readonly string[];
  ktx2?: () => Promise<{ GPU_FILES: Ktx2Table }>;
  trees: ChunkTrees;
  /** the forest's placement; omitted by a treeless shard (Driftwood, E318) */
  forest?: ChunkForest;
  spawns: HerdPlan[];
  /**
   * Per-shard overrides of a species' hunting-loop numbers (`HuntTuning`, src/server/engine/entities/AnimalManager.ts), merged over
   * the species' own by `AnimalManager.tuningFor` — Driftwood's boars see you from far off on open sand. Keyed by kind.
   */
  faunaTuning?: Partial<Record<FaunaKind, Partial<HuntTuning>>>;
  /** hit cap, exempt enemy kinds, and simultaneous attackers (E294 / E297); omitted = the old fights.
   * Driftwood caps hits at 20 except the Drowned Captain, and permits two attackers at once. */
  fight?: LevelSpec['fight'];
  /** the shard's loot rules (E314, project/archive/2026-09-30-driftwood-loot.md; src/game/loot/): `coins` = kills burst doubloons into a
   *  saved purse, shown by a coin chip under VITALS (src/client/game/loot/coins.ts has the values). Omitted = no coins */
  loot?: { coins?: boolean };
  /** E314 stage 3: the player's body shadow (src/engine/player/BodyShadow.ts) — an invisible low-poly castaway on your feet whose
   *  only trace is its shadow on the ground (worn hat / cape on it). Driftwood: true. Omitted = no body shadow */
  bodyShadow?: boolean;
  sky: ChunkSky;
  atmosphere: ChunkAtmosphere;
  grade: ChunkGrade;
  /** the look loop's grade over `grade` (PH-L1 / L4) */
  look?: ChunkLook;
  /** where the player stands on entering (feet, metres; yaw radians — π faces +Z, the compass' north) */
  spawn: SpawnPose;
  /** rendering style; the former implicit PBR default is explicit in every manifest */
  style: ChunkStyle;
  /** player weapon; the former implicit crossbow default is explicit in every manifest */
  weapon: ChunkWeapon;
  /** what this shard switches on in the ONE base HUD every shard shares (E154, src/client/engine/ui/hudSlots.ts); omitted = the base alone */
  hud?: ChunkHud;
  /** a painted horizon of its own (Nalati: the plateau rolling on, the snow range south); omitted = the default ridge rings */
  horizon?: ChunkHorizon;
  /** Visual edge dressing only (default visible); never disables player-containment colliders. */
  boundary?: { visible?: boolean };
  /** G784 / D189: 'world' = the entered world draws its whole cell's ground itself, so the grid cell's coarse tiles hide at
   *  once on entry; absent, those tiles are its ground and stay until the tile registration's coarse replacement. */
  cellGround?: 'world';
  /** Authored far-field imagery; consumed by the generic painted-horizon renderer. */
  horizonStrips?: { day: string; night: string; elMin: number; elMax: number; scale?: number; phone?: { day: string; night: string } };
  /**
   * `style: 'painterly'`: the ground's painted colour (linear RGB, written into `out` and returned) at (x, z), given the
   * surface height `h` and `slope` (0 flat → 1 vertical) — height, slope and noise → a palette ramp. `src/client/engine/world/Terrain.ts` calls it once per terrain vertex; no textures are loaded.
   */
  groundColor?: (x: number, z: number, h: number, slope: number, t: ChunkTerrain, out: RGB) => RGB;
  /**
   * `style: 'painterly'`: the per-vertex masks for the per-pixel ground detail (src/shards/nalati-grasslands/terrainSurface.ts) —
   * [gravel, rock, snow], each 0..1, given the surface height `h` and `slope`. Roads come from the trails.
   */
  surfaceAt?: (x: number, z: number, h: number, slope: number) => [number, number, number];
  /** open water over the whole shard; omitted = dry land with an optional pond */
  ocean?: OceanDef;
  /** where the pond's surface mesh (src/shards/pine-hollow/world/pond.ts) leaves out water inside its square — another body draws its own
   *  there (Pine Hollow: the beaver pool, E322 F-L6); omitted = none */
  pondLilyExclusions?: readonly { x: number; z: number; r: number }[];
  pondClip?: (x: number, z: number) => boolean;
  /** the shard on the minimap and the full map: its baked map image (SF66) and its painted look; omitted = the hillshade */
  minimap?: ChunkMapDef;
  /** named places — Explore World's mini map pins them and flies to them (src/client/engine/explore/MiniMap.ts); omitted = none */
  pois?: ChunkPoi[];
  /** the title's EXPLORE WORLD is offered on this shard (project/archive/2026-09-23-explore-world.md; the models it shows are what the
   *  shard's setup registers — src/client/engine/explore/registry.ts); omitted = play only */
  explore?: ExploreSpec;
  /**
   * The shard's render strategy (`ShardRender`): its own passes in the engine's composer, its per-frame uniforms, its
   * tuning of the engine's effects. A lazy loader, so the def stays node-safe and the code downloads with the shard:
   * `render: async () => (await import('./look/render')).createRender()` — a fresh strategy per call (a rebuilt shard gets
   * a new one). Game.buildSky awaits it. Omitted = the engine's chain as it is. The game hands it the shard's loaded
   * product (`toLevelSpec(manifest, product)`), so a look reads its built output, never `shard.config`; the engine only
   * ever sees the bound loader (progress/shard-platform/product-in-look-o272/).
   */
  render?: (product: ShardProduct) => Promise<LookStrategy>;
  /**
   * A built fragment's limits (the landscape shards have the terrain's edge walls instead): below `floor` or outside the
   * box, on foot or on the board, the player is put back on the last floor they stood on inside them (a registry floor;
   * else the spawn) — a soft respawn, no death. Omitted = no limits.
   */
  bounds?: { x0: number; x1: number; z0: number; z1: number; floor: number };
  /** `weapon: 'sword'`: the shard's own sword for the engine's Sword — its viewmodel (`rig`), and optionally its moves (the
   *  rest pose) and portrait framing; a lazy loader, so the def stays node-safe. Omitted = the wooden sword */
  sword?: () => Promise<ShardSword>;
  /**
   * The shard's live models (E306 / E315 M5, src/client/engine/models/live.ts): its creature roster — every species it can spawn, alive
   * now or not (its bosses, its flocks) — its people and the gear its player holds, listed in its Model Explorer at boot
   * (src/client/engine/models/roster.ts). A lazy loader, so the def stays node-safe: `roster: async () => (await import('./<slug>/roster')).ROSTER`.
   * Omitted = the models its world places, and a card per species of the animals alive when Explore opens. Like `render`,
   * it gets the shard's loaded product, so a specimen's model can read its built output.
   */
  roster?: (product: ShardProduct) => Promise<readonly RosterEntry[]>;
  /**
   * The core fields' copies drawn as the shard's own models (E315 M2 / E349, Pine Hollow: the forest's trees as its forest
   * tree model, the forest floor's six kinds as theirs — src/shards/pine-hollow/world/drawnModels.ts). Called once, after
   * the props step, with the fields core built. A lazy loader, so the def stays node-safe: `fieldModels: async () =>
   * (await import('./<slug>/world/drawnModels')).placeDrawnModels`; main.ts starts it while the world builds. Omitted =
   * the fields draw their copies themselves.
   */
  fieldModels?: () => Promise<(ctx: FieldModelsContext) => void>;
  /** the first person's field of view: `portrait` = the sword's hip FOV base on a portrait screen before Hor+ (degrees;
   *  the engine's 72° gives ~94° vertical / ~52° across at 9:19.5); omitted = the engine's */
  camera?: { portraitFov: number };
}

declare const __BUILD_ID__: string; // vite.config.ts define; absent under Node
/**
 * The URL the maps fetch for a shard's baked map image (`ChunkMapDef.image`), versioned by the build: /assets is cached as
 * immutable for a year, so a rebake must never reuse a URL a phone already holds. Undefined = none baked.
 */
export function bakedMapUrl(image: string | undefined): string | undefined {
  if (image === undefined || image.startsWith('data:') || image.startsWith('blob:')) return image;
  const build = ((): string => { try { return __BUILD_ID__; } catch { return ''; } })();
  return build === '' ? image : `${image}?v=${encodeURIComponent(build)}`;
}

/**
 * The shard on the maps (src/client/engine/ui/Minimap.ts, Map.ts). The ground is the map baked from the world (SF66, G246 / G247:
 * scripts/bake-maps.mjs renders the shard straight down; test/baked-maps.test.ts fails a stale one), never hand-drawn shapes;
 * its places, quest markers, portals and entries stay listed data drawn on top (test/map-coverage.test.ts).
 */
export interface ChunkMapDef {
  /** the baked map image (scripts/bake-maps.mjs: `/assets/<slug>/map/top.webp`, the `image` of the shard's
   *  look/map.baked.json stamp; test/map-coverage.test.ts holds them equal) */
  image?: string;
  /** the level's own painted map look (07 §6.2 step 7): its ground colours (also the grid's edge reader), its overlay, its
   *  named places (Minimap.ts); the painted ground only shows where no baked image is named */
  palette?: MinimapPalette;
  openWater?: { level: number; deepDepth: number };
  outside?: string;
}

/** a named place on the shard: world XZ in metres; `r` ≈ its size (how far back the fly-to camera stands) */
export interface ChunkPoi { id: string; name: string; x: number; z: number; r?: number }

/** Data for first-party discovery and boot; native module loaders stay explicit bindings. */
export type ShardManifestRows = Omit<ShardManifest, 'scalarBlocks' | 'load' | 'render' | 'roster' | 'ktx2' | 'dev' | 'groundColor' | 'ground' | 'horizon' | 'pois' | 'spawns' | 'minimap' | 'trees' | 'audio'> & {
  /** the look as a row: a post-graph look read from a product file's row (game/looks/postGraphLook `postGraphLook`);
   *  `defineShard` binds it as `render`, so a manifest never carries it */
  readonly postLook?: { readonly file: string; readonly field: readonly string[] };
  readonly spawns: readonly ShardManifest['spawns'][number][];
  readonly trees: ChunkTrees | (Omit<ChunkTrees,'factory'> & { factory: 'declared' });
  readonly audio?: NonNullable<ShardManifest['audio']> & { catalogue?: boolean };
  readonly minimap?: Omit<ChunkMapDef, 'palette'> & { readonly palette?: MapPaletteRow };
  readonly ground?: ShardManifest['ground'];
  readonly horizon?: { readonly rings: readonly HorizonRing[]; readonly cloudSea: boolean };
  readonly pois?: readonly ChunkPoi[];
  readonly poses?: Awaited<ReturnType<NonNullable<ShardManifest['dev']>['poses']>>;
  readonly groundColour?: readonly [number, number, number];
  /** Explicit finite recipes; all admit before the original ordered decodes. */
  readonly groundRows?: GroundRows;
  readonly groundColourSamples?: ScalarTripletRows;
  readonly surfaceSamples?: ScalarTripletRows;
  readonly forestMaskSamples?: ScalarLatticeRows;
  /** Exact candidate rows; binary density joins the manifest's verified scalar preparation. */
  readonly forestRows?: unknown;
  readonly mapGroundSamples?: ScalarTripletRows;
};
/** Resolve admitted raster recipes in their original order, copied boot poses and entry metadata.
 * Native callbacks remain explicit bindings; declared tree/audio choices use existing product loaders. */
export function defineShard(rows: ShardManifestRows,
  bindings: Pick<ShardManifest, 'load' | 'render' | 'roster' | 'ktx2' | 'dev'> & { readonly ground?: ShardManifest['ground'] }): ShardManifest {
  if ('runtimeEntry' in rows) throw new Error('Declared manifests do not name runtime modules');
  for (const key of ['groundRows','groundColourSamples','surfaceSamples','forestMaskSamples','mapGroundSamples','forestRows']) {
    const descriptor = Object.getOwnPropertyDescriptor(rows,key);
    if (key in rows && (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor))) throw new Error('Manifest samples require own data fields');
  }
  if('scalarBlocks' in rows)throw new Error('Scalar intake is constructed by the manifest reader');
  const scalarBlocks=new ScalarLatticeBindings();
  const { postLook,poses,groundColour,horizon,pois,minimap,groundRows,groundColourSamples,surfaceSamples,forestMaskSamples,mapGroundSamples,forestRows,...data } = rows;
  if (postLook !== undefined && bindings.render !== undefined) throw new Error('Conflicting manifest look bindings');
  const nativeGround = bindings.ground ?? data.ground,{ palette,...mapFields } = minimap ?? {};
  if (groundRows !== undefined && nativeGround !== undefined || groundColourSamples !== undefined && groundColour !== undefined
    || surfaceSamples !== undefined && data.surfaceAt !== undefined || forestMaskSamples !== undefined && (data.forest === undefined || 'mask' in data.forest)
    || mapGroundSamples !== undefined && palette === undefined
    || forestRows !== undefined && (data.forest === undefined || 'density' in data.forest || 'scale' in data.forest || 'species' in data.forest)) throw new Error('Conflicting manifest sample bindings');
  if (nativeGround === undefined && groundRows === undefined) throw new Error('Shard boot needs its declared ground owner');
  const groundData = groundRows === undefined ? undefined : v.parse(GroundRowsSchema,groundRows),
    pigmentData = groundColourSamples === undefined ? undefined : v.parse(ScalarTripletSchema,groundColourSamples),
    surfaceData = surfaceSamples === undefined ? undefined : v.parse(ScalarTripletSchema,surfaceSamples),
    forestData = forestMaskSamples === undefined ? undefined : v.parse(ScalarLatticeSchema,forestMaskSamples),
    mapData = mapGroundSamples === undefined ? undefined : v.parse(ScalarTripletSchema,mapGroundSamples),
    forestCandidates = forestRows === undefined ? undefined : v.parse(ForestRowsSchema,forestRows);
  let audio = data.audio,boot = data.boot;
  if (audio?.catalogue !== undefined) {
    const { catalogue,...audioData } = audio,preload = audio.preload ?? (catalogue ? async () => {
      const { productAudioCatalogue } = await import('../shardfile/audioCatalogue');return productAudioCatalogue(data.slug);
    } : undefined);
    audio = { ...audioData,...(preload === undefined ? {} : { preload }) };
    if (catalogue && boot !== undefined && boot.audio === undefined) boot = { ...boot,audio: async () => {
      const { productAudioFiles } = await import('../shardfile/audioCatalogue');return productAudioFiles(data.slug);
    } };
  }
  const trees: ChunkTrees = data.trees.factory === 'declared' ? { ...data.trees,factory: declaredTreeSet(data.slug) } : data.trees;
  // Retain the original binding order after every referenced shape/count admits.
  const forestMask = forestData === undefined ? undefined : typeof forestData.values.data==='string'?readScalarLattice(forestData):scalarBlocks.lattice(forestData),
    sampledColour = pigmentData === undefined ? undefined : declaredGroundColour(pigmentData,scalarBlocks),
    sampledSurface = surfaceData === undefined ? undefined : declaredSurface(surfaceData,scalarBlocks),
    ground = groundData === undefined ? nativeGround : declaredGround(groundData,scalarBlocks),
    sampledMap = mapData === undefined ? undefined : declaredMapColour(mapData,scalarBlocks),
    forestQueries = forestCandidates === undefined ? undefined : declaredForestQueries(forestCandidates,scalarBlocks);
  if (ground === undefined) throw new Error('Shard boot needs its declared ground owner');
  if(rows.navmesh?.ground!==undefined&&typeof rows.navmesh.ground.wet.values.data!=='string')scalarBlocks.lattice(rows.navmesh.ground.wet);
  const map = minimap === undefined ? undefined : { ...mapFields,...(palette === undefined ? {} : { palette: sampledMap === undefined ? mapPalette(palette) : { ...mapPalette(palette),ground: sampledMap } }) };
  const manifest: ShardManifest = { ...data, ...bindings, ground, spawns: [...data.spawns],
    trees,...(audio === undefined ? {} : { audio }),...(boot === undefined ? {} : { boot }),
    ...(data.forest === undefined || forestMask === undefined && forestQueries === undefined ? {} : {
      forest: { ...data.forest, ...forestQueries, ...(forestMask === undefined ? {} : { mask: forestMask }) } }),
    ...(sampledColour === undefined ? {} : { groundColor: sampledColour }),
    ...(sampledSurface === undefined ? {} : { surfaceAt: sampledSurface }),
    ...(map === undefined ? {} : { minimap: map }),
    ...(horizon === undefined ? {} : { horizon: { ...horizon, rings: [...horizon.rings] } }),
    ...(pois === undefined ? {} : { pois: [...pois] }),
    ...(poses === undefined ? {} : { dev: { poses: () => Promise.resolve(structuredClone(poses)) } }),
    ...(groundColour === undefined ? {} : { groundColor: (_x, _z, _h, _slope, _terrain, out) => { out[0] = groundColour[0]; out[1] = groundColour[1]; out[2] = groundColour[2]; return out; } }),
  };
  scalarBlocks.seal();
  if(scalarBlocks.files.length>0)manifest.scalarBlocks=scalarBlocks;
  if (postLook !== undefined) manifest.render = async (product) => (await import('../looks/postGraphLook')).postGraphLook(product, postLook);
  return manifest;
}


/**
 * A shard's ground from its declared rows (`GroundRowsSchema`, G4): its baked terrain field by key and seed (or a flat datum) with
 * the declared trails, pads, pond, rest water level and datum, and its water bodies from the same rows a shardfile's water
 * section admits (a declared stream also answers the terrain's `streamAt`: wading, the dry-ground test, the boundary).
 * An optional lattice replaces the pond mask; ground-only basins borrow that same field and its live water level.
 * The manifest names a generated rows file (`ground: { platform: 'declared', rows }`); no shard code builds its ground.
 */
export function declaredGround(input: unknown,scalarBlocks?:ScalarLatticeBindings): ShardManifest['ground'] & { terrain: ChunkTerrain } {
  const rows = v.parse(GroundRowsSchema,input), mask = rows.mask;
  const fileMask=mask!==undefined&&typeof mask.values.data!=='string';
  const sampledMask=fileMask&&scalarBlocks!==undefined?scalarBlocks.lattice(mask,{min:0,max:1}):undefined;
  if(fileMask&&sampledMask===undefined)throw new Error('Ground mask requires its scalar intake');
  const values = mask === undefined||fileMask ? null : readScalarChannel(mask.values);
  if (values !== null && (!(values instanceof Float32Array) || !values.every(value => value >= 0 && value <= 1))) throw new Error('Invalid pond mask lattice');
  const bodies = rows.bodies.map(row => ({ row,body: row.kind === 'terrain-basin' ? null : declaredWaterBody(row) }));
  const stream = bodies.find(({ row }) => row.kind === 'stream')?.body ?? undefined;
  const metadata = buildTerrainMetadata(rows.terrain.seed, { trails: rows.trails, cabinSites: rows.cabinSites,
    ...(rows.pond === undefined ? {} : { pond: rows.pond }), ...(stream === undefined ? {} : { streamAt: stream.restAt }) }, () => rows.water);
  if (mask !== undefined && values instanceof Float32Array) metadata.pondMask = bakedSamplers({ res: mask.res,size: mask.size,heights: values,seed: rows.terrain.seed,landscapeHash: 0,splat: new Uint8Array(0),undergrowth: null }).heightAt;
  if(sampledMask!==undefined)metadata.pondMask=sampledMask;
  const source = rows.terrain, terrain = 'flat' in source ? flatTerrainField(source.flat, metadata)
    : createBakedTerrainField(source, { ...metadata, ...(rows.datum === undefined ? {} : { datum: rows.datum }) });
  const water = bodies.map(({ row,body }) => body ?? basinBody(row.id,terrain));
  return { ...(rows.paths === undefined ? {} : { paths: rows.paths }), terrain, water };
}

/** A declared forest's queries (`ForestRowsSchema`, G4): each exact jittered candidate answers from its generated row. */
export function declaredForestQueries(input: { readonly forest: unknown }, scalarBlocks?: ScalarLatticeBindings): Required<Pick<ChunkForest, 'density' | 'scale' | 'species'>>;
export function declaredForestQueries(input: v.InferOutput<typeof FixedForestQueriesSchema>, scalarBlocks?: ScalarLatticeBindings): Required<Pick<ChunkForest, 'density'>>;
export function declaredForestQueries(input: unknown, scalarBlocks?: ScalarLatticeBindings): Pick<ChunkForest, 'density' | 'scale' | 'species'>;
export function declaredForestQueries(input: unknown, scalarBlocks?: ScalarLatticeBindings): Pick<ChunkForest, 'density' | 'scale' | 'species'> {
  if (v.is(FixedForestQueriesSchema, input)) { const { density } = input; return { density: () => density }; }
  const rows = v.parse(ForestRowsSchema,input), density = rows.density === undefined ? null
    : typeof rows.density.data === 'string' ? readScalarChannel(rows.density) : scalarBlocks?.channel(rows.density);
  if (density === undefined) throw new Error('Forest density requires its scalar intake');
  const at = new Map(rows.forest.map((row,index) => [`${String(row.x)},${String(row.z)}`,{ row,index }]));
  const row = (x: number, z: number) => {
    const found = at.get(`${String(x)},${String(z)}`);
    if (found === undefined) throw new Error('Forest candidate differs from its declared rows');
    return found;
  };
  return { density: (x,z) => { const found = row(x,z), value = density === null && 'density' in found.row ? found.row.density
      : typeof density === 'function' ? density(found.index) : density?.[found.index];
    if (value === undefined) throw new Error('Missing forest density');return value; },
    scale: (x,z) => row(x,z).row.scale,species: (x,z) => row(x,z).row.species };
}

/** A declared clip (`PondClipSchema`, G4): whether the pond grid cell holding (x, z) is one of the rows' listed cells. */
export function declaredPondClip(input: unknown): (x: number, z: number) => boolean {
  const rows = v.parse(PondClipSchema, input), cells = new Set(rows.cells);
  return (x, z) => { const i = Math.floor((x - rows.x0) / rows.cell), j = Math.floor((z - rows.z0) / rows.cell);
    return i >= 0 && j >= 0 && i < rows.segs && j < rows.segs && cells.has(j * rows.segs + i); };
}


/** The generated discovery root lends only native/generated fields. */
export type AuthoredShardBindings = Omit<ShardManifestRows, keyof ManifestMetadata | 'trees' | 'poses'> & {
  readonly spawns?: ShardManifestRows['spawns'];
  readonly poses?: unknown;
  readonly mapPalette?: MapPaletteRow;
  readonly audioBindings?: Pick<NonNullable<ShardManifest['audio']>, 'cues' | 'preload'>;
  readonly bootBindings?: Pick<BootSpec, 'files' | 'sources' | 'lateReads' | 'bakedUnread' | 'audio' | 'explore'>;
  readonly forestQueries?: Pick<ChunkForest, 'density' | 'scale' | 'species'>;
};
/** Validate authored metadata, resolve literal bundled image imports and compose
 * the unchanged native boot owners. Missing source images refuse admission. */
export function defineAuthoredShard(input: unknown, slug: ShardSlug, rows: AuthoredShardBindings,
  native: Parameters<typeof defineShard>[1], images: Readonly<Record<string, string>>): ShardManifest {
  const {bindings: _declaredBindings, boot: bootData, fight: authoredFight, ...data} = parseManifestMetadata(input, slug);
  const image = (path: string): string => {
    const url = images[path];
    if (url !== undefined) return url;
    if (path.startsWith('/src/')) throw new Error('Manifest source image is not bundled');
    return path;
  };
  const { mapPalette: palette, audioBindings, bootBindings, forestQueries, poses, ...bindings } = rows;
  const { catalogue, ...audio } = data.audio;
  const compare = data.explore.compare?.map(row => ({...row, live: image(row.live), image: image(row.image)}));
  // a declared tree set (its product's rows file) builds on the game's tree set factory
  const factory: ChunkTrees['factory'] | undefined = data.trees.treeSet === undefined ? data.trees.factory : declaredTreeSet(slug);
  if (factory === undefined) throw new Error('Manifest trees have no declared factory');
  const trees: ChunkTrees = {...data.trees, factory};
  const spawns = data.spawns ?? bindings.spawns;
  if (spawns === undefined) throw new Error('Manifest has no declared spawn inventory');
  const tiers = ((): TierOverrides | undefined => {
    const {grid, phone, desktop} = data.tiers ?? {};
    if (grid === undefined) return data.tiers;
    if (phone === undefined || desktop === undefined) throw new Error('Manifest grid tier rows require both tier rows');
    // read when the level applies its row: the page mode is decided at boot, after discovery
    return { get phone() { return currentPageMode() === 'grid' ? {...phone, ...grid.phone} : phone; },
      get desktop() { return currentPageMode() === 'grid' ? {...desktop, ...grid.desktop} : desktop; } };
  })();
  if (bootData !== undefined && bootBindings === undefined) throw new Error('Manifest boot inventory has no native binding');
  const { attackers, ...fightRows } = authoredFight ?? {};
  const fight = authoredFight === undefined ? undefined : { ...fightRows,
    ...(attackers === undefined ? {} : { attackers: attackers === 'unbounded' ? Infinity : attackers }) };
  return defineShard({ ...bindings, ...data, slug, trees, spawns,
    ...(fight === undefined ? {} : { fight }),
    ...(_declaredBindings.entry !== undefined && 'platform' in _declaredBindings.entry ? { clientPlanRuntime: true } : {}),
    ...(poses === undefined ? {} : { poses: parseCapturePoses(poses) }),
    ...(data.forest === undefined ? {} : {forest: {...data.forest, ...forestQueries}}),
    ...(tiers === undefined ? {} : {tiers}),
    audio: {...audio, ...audioBindings, ...(catalogue===undefined?{}:{catalogue})},
    ...(bootBindings === undefined ? {} : { boot: { ...bootData, ...bootBindings, explore: { art: bootBindings.explore === undefined ? [...Object.values(data.explore.art).map(image), ...(compare?.flatMap(({live, image: target}) => [live, target]) ?? [])] : bootBindings.explore.art.map(image) } } }),
    card: { thumb: image(data.card.thumb), portrait: image(data.card.portrait), landscape: image(data.card.landscape) },
    sky: { ...data.sky, ...(data.sky.hdri === undefined ? {} : { hdri: image(data.sky.hdri) }) },
    minimap: { ...data.minimap, image: image(data.minimap.image), ...(palette === undefined ? {} : { palette }) },
    explore: { art: { world: image(data.explore.art.world), models: image(data.explore.art.models),
      sets: image(data.explore.art.sets), practice: image(data.explore.art.practice) }, ...(compare === undefined ? {} : {compare}) },
  }, native);
}

/** Ordered scalar rasters as the existing ground-colour callback, retaining the caller's output. */
export function declaredGroundColour(input: unknown,scalarBlocks?:ScalarLatticeBindings): NonNullable<ShardManifest['groundColor']> {
  const rows=v.parse(ScalarTripletSchema,input),sample=(row:ScalarLatticeRows)=>scalarBlocks===undefined||typeof row.values.data==='string'?readScalarLattice(row):scalarBlocks.lattice(row),
    first=sample(rows[0]),second=sample(rows[1]),third=sample(rows[2]);
  return (x,z,_height,_slope,_terrain,out) => { out[0] = first(x,z);out[1] = second(x,z);out[2] = third(x,z);return out; };
}
/** Ordered scalar rasters as the existing surface callback, allocating its original fresh tuple. */
export function declaredSurface(input: unknown,scalarBlocks?:ScalarLatticeBindings): NonNullable<ShardManifest['surfaceAt']> {
  const rows=v.parse(ScalarTripletSchema,input),sample=(row:ScalarLatticeRows)=>scalarBlocks===undefined||typeof row.values.data==='string'?readScalarLattice(row):scalarBlocks.lattice(row),
    first=sample(rows[0]),second=sample(rows[1]),third=sample(rows[2]);
  return (x,z,_height,_slope) => [first(x,z),second(x,z),third(x,z)];
}

/** Ordered scalar rasters as the existing minimap callback, retaining its output and void return. */
export function declaredMapColour(input: unknown,scalarBlocks?:ScalarLatticeBindings): MinimapPalette['ground'] {
  const rows=v.parse(ScalarTripletSchema,input),sample=(row:ScalarLatticeRows)=>scalarBlocks===undefined||typeof row.values.data==='string'?readScalarLattice(row):scalarBlocks.lattice(row),
    first=sample(rows[0]),second=sample(rows[1]),third=sample(rows[2]);
  return (x,z,_height,_slope,_forest,out) => { out[0] = first(x,z);out[1] = second(x,z);out[2] = third(x,z); };
}

/** Read one definition's bounded named scalar blocks through the SAME product.
 * No IO occurs during declaration; a malformed suffix publishes no sampler. */
export async function prepareManifestScalarBlocks(manifest: ShardManifest, product: ShardProduct, scope: Scope): Promise<void> {
  const intake = manifest.scalarBlocks;
  if (intake === undefined) return;
  const file = product.file, hasFile = product.hasFile, { slug: identity } = manifest;
  const live = (): void => {
    const { slug: productIdentity } = product, { slug: manifestIdentity } = manifest;
    if (scope.disposed || scope.disposing || productIdentity !== identity || manifestIdentity !== identity
      || product.file !== file || product.hasFile !== hasFile || manifest.scalarBlocks !== intake) {
      throw new Error('Retired or replaced scalar source');
    }
  };
  live();
  if (intake.prepared) return;
  const names = intake.files;
  for (const name of names) {
    live();
    if (!hasFile.call(product, name)) throw new Error('Missing manifest scalar file');
    live();
  }
  const blocks = await readFileInputs(names,async name=>{
    const bytes = await file.call(product, name);
    live();
    return Uint8Array.from(bytes);
  },live);
  live();
  const inflated = await inflateScalarBlocks(blocks);
  live();
  intake.prepare(blocks, inflated);
}
