import type { NavmeshGroundRows,NavigationContent } from '@wildshard/format/navigation';
import type { SetName } from '../../../client/engine/player/viewmodelTextures';
import type { FallCause } from '../combat/pipeline';
import type { HorizonStrips } from '../../../client/engine/world/HorizonMatte';
import type { ByteKey } from '../boot/steps';
import type { Ktx2Table, TexMode } from '../../../client/engine/boot/gpuFiles';
import type { ChunkFiles } from '../../../client/engine/boot/bytes';
import type { LookStrategy } from '../../../client/engine/render/look';
import type { WaterBody } from '../world/water/body';
import type { Tier } from '../../../client/engine/core/tier';
import type { HuntTuning } from '../../../server/engine/ai/hunt';
import type { RosterEntry } from '../../../client/engine/models/live';
import type { InputContextDef } from '../../../server/engine/level/context';
import type { SfxDecodePolicy } from '../../../client/engine/audio/preload';
import type { LevelAudioProfile } from '../../../client/engine/audio/levelAudio';
import type { AtmosphereSpec, ExploreSpec, ForestSpec, GradeSpec, GradeLook, HerdPlan, HorizonSpec, HudSpec, LevelAssets, MinimapSpec, PoiSpec, RGB, SkySpec, SpawnPose, TerrainField, TreeSpec } from './data';
import type { EngineTierKnobs } from '../../../client/engine/render/tiers';
import type { BudgetInputs } from '../../../client/engine/render/budgets';
import type { TickRate } from '../app/scheduler';

export type EngineMechanism = 'weather' | 'dayCycle' | 'bosses' | 'elites' | 'spawns' | 'quests' | 'swim' | 'hover' | 'explore' | 'practice';
export interface CreatureRenderSpec { lowPoly: boolean; waitForModels: boolean; furRim: boolean; tintRange: number; oneMaterial: boolean }
export interface FightRules { input?: { bufferMs: number; coyoteMs: number }; telegraphed?: boolean; maxHitDamage?: number; capExempt?: readonly string[]; attackers?: number }
export interface Bounds { x0: number; x1: number; z0: number; z1: number; floor: number }
// oxlint-disable-next-line typescript/no-empty-object-type, typescript/no-empty-interface -- Shards declare typed tier knobs through the public engine API.
export interface TierKnobMap {}
export interface TierKnobs extends Partial<EngineTierKnobs>, Partial<TierKnobMap>, Partial<Record<`${string}.${string}`, number | boolean>> { treeHiDist?: number; shadowFar?: number; animalShadowDist?: number; grassSlots?: number; envSteps?: boolean; pointLightSkip?: boolean; skipRaysOffscreen?: boolean; godRays?: boolean; ao?: boolean; aa?: 'fxaa' | 'smaa' | 'off'; slices?: boolean; warmTurns?: number; textures?: 'img' | 'ktx2'; msaa?: number; ticks?: Readonly<Record<string, TickRate>> }
export type TierOverrides = Partial<Record<Tier, TierKnobs>>;
export interface AudioSpec {
  bed?: string; samples?: SfxDecodePolicy; alertOnlyHostile?: boolean;
  /** 'none' declares no ambience: omit bed and install no sampled/synth/zoned ambient content. Score and cues remain independent. */
  ambience: string;
  score: string;
  /** Serializable cue IDs; frozen trusted manifests may retain their lazy legacy loader. */
  cues?: Readonly<Record<string, string>> | (() => Promise<object>);
  preload?: () => Promise<LevelAudioProfile>;
}
/** Ordered source URLs; a GPU reference uses the existing tier/texture file policy. */
export type BootSourceReference = string | { readonly gpu: string };
/** Serializable sources for both render tiers, resolved when boot chooses its texture mode. */
export interface BootSourceRows {
  readonly tiers: Readonly<Record<Tier, Readonly<Record<ByteKey, readonly BootSourceReference[]>>>>;
  readonly gpuFiles?: Ktx2Table;
}
/** Offline-resolved inventory for every tier and texture choice, in authored order. */
export interface BootModeRows<T> { readonly modes: Readonly<Record<Tier, Readonly<Record<TexMode, T>>>> }
/** A flattened file inventory from a fixed source tier and texture mode. */
export interface BootFileSelection { readonly sources: BootSourceRows | BootModeRows<ChunkFiles>; readonly tier: Tier; readonly tex: TexMode }
export interface BootSpec {
  viewmodelSets?: readonly SetName[];
  shaders?: { scene?: boolean; shadows?: boolean; background?: boolean; post?: boolean };
  /** The plugin runs grass, cabins and props as separate counted world steps. */
  stagedWorld?: boolean;
  lateReads?: readonly string[] | BootModeRows<readonly string[]> | ((tier: Tier, tex?: TexMode) => readonly string[]);
  files: readonly string[] | BootModeRows<readonly string[]> | BootFileSelection | ((tier: Tier) => readonly string[]);
  sources?: BootSourceRows | BootModeRows<ChunkFiles> | ((tier: Tier, tex: TexMode) => ChunkFiles);
  bakedUnread?: RegExp;
  steps?: Readonly<Record<string, { label: string; weight: number }>>;
  bytes?: Readonly<Partial<Record<ByteKey, string>>>;
  /** Serializable audio URLs; a trusted legacy loader remains supported during conversion. */
  audio?: readonly string[] | (() => Promise<readonly string[]>);
  explore?: { art: readonly string[] };
  precache?: readonly string[];
  barrier?: boolean;
  phone?: { deferExtras?: boolean; fragile?: boolean; trace?: boolean };
  cullBeforeFirstDraw?: boolean;
}
export interface LoadoutSpec {
  weapons: readonly string[]; tools: readonly string[]; start: readonly string[]; held?: string;
  pickups?: readonly { id: string; at: string }[];
  loans?: readonly { id: string; in: string }[];
  grants?: readonly { id: string; by: string; replaces?: string }[];
  viewmodel?: string; ammo?: readonly string[];
}

/** The engine consumes opaque level data; game presentation and discovery stay above this boundary. */
export interface LevelSpec {
  /** Required platform navigation: declared original bytes, validated before path queries. */
  navigation?: NavigationContent;
  blender?: { area: { x0: number; x1: number; z0: number; z1: number }; models: readonly string[] };
  id: string;
  /** Optional offline asset folder; level/save identity stays `id`. Omit for the ordinary same-folder path. */
  bakedId?: string;
  seed?: number; treeCount?: number; label?: string;
  creatureStyle?: string; creatures?: CreatureRenderSpec;
  debugOptions?: readonly string[];
  /** Authored diagnostic camera poses, exposed to capture scripts without content-world casts. */
  capturePoses?: () => Promise<Readonly<Record<string, { eye: readonly [number, number, number]; yaw: number; pitch: number; feet?: readonly [number, number, number]; probe?: { name?: string; x?: number; y?: number; z?: number; yaw?: number; pitch?: number } }>>>;
  /** Offline creature-navigation policy; the ground exclusion does not remove registered walkable decks. */
  navmesh?: { excludeGroundAt: (x: number,z: number,y: number) => boolean; ground?: never } | { ground: NavmeshGroundRows; excludeGroundAt?: never };
  /** `water`: the level's water bodies, registered in `app.world.water` at level.data (before any world step reads them) */
  ground: { terrain?: TerrainField; structures?: true; paths?: 'plugin'; water?: readonly WaterBody[];
    /** A separate tile owner draws the ground; height queries, collision and the cliff slab remain. */
    tiled?: true };
  spawn: SpawnPose; bounds?: Bounds; camera?: { portraitFov: number };
  /** Optional creature death plane; absent keeps existing worlds unchanged. */
  world?: { killY: number; fallCause?: FallCause };
  sky: SkySpec; atmosphere: AtmosphereSpec; grade: GradeSpec;
  look?: () => Promise<LookStrategy>; lookLayer?: GradeLook; tiers?: TierOverrides; budgets: BudgetInputs;
  mechanisms: readonly EngineMechanism[]; fight: FightRules; input?: readonly InputContextDef[];
  boot: BootSpec; audio: AudioSpec; loadout: LoadoutSpec;
  species: readonly string[]; spawns: readonly HerdPlan[]; spawnTables?: readonly string[];
  faunaTuning?: Partial<Record<string, Partial<HuntTuning>>>;
  /**
   * Edge dressing and containment. `visible` hides the drawing only; `walls: false` leaves out the four chunk-edge walls,
   * for a level placed inside a larger platform that owns what lies past its edge (absent = walls).
   */
  boundary?: { visible?: boolean; walls?: boolean };
  trees?: TreeSpec; forest?: ForestSpec; horizon?: HorizonSpec; horizonStrips?: HorizonStrips;
  minimap: MinimapSpec; hud?: HudSpec; pois?: readonly PoiSpec[];
  groundColor?: (x: number, z: number, h: number, slope: number, terrain: TerrainField, out: RGB) => RGB;
  surfaceAt?: (x: number, z: number, h: number, slope: number) => [number, number, number];
  assets?: LevelAssets; explore?: ExploreSpec;
  kitLook: 'toon' | 'painterly' | 'pbr';
  /** the first-person hands: the flat-shaded toon gloves, or the smooth ones (absent = 'pbr') */
  hands?: 'toon' | 'pbr';
  roster?: () => Promise<readonly RosterEntry[]>;
}

export function resolveTierKnobs(defaults: TierKnobs, kit: TierKnobs, level: TierOverrides | undefined, tier: Tier): TierKnobs {
  return { ...defaults, ...kit, ...level?.[tier] };
}

export function needsTerrainCollider(spec: Pick<LevelSpec, 'ground'>): boolean {
  return spec.ground.terrain !== undefined && spec.ground.structures !== true;
}

/** Offline resource identity supplied by the level author, independent of simulation and save identity. */
export function levelBakedId(level: Pick<LevelSpec, 'id' | 'bakedId'>): string { return level.bakedId ?? level.id; }
