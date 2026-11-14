import type { Camera, Color, DirectionalLight, Fog, Group, HemisphereLight, Material, Mesh, Object3D, Sprite, Texture, Vector3, PerspectiveCamera, Scene, WebGLRenderer, WebGLRenderTarget } from 'three';
import type { BloomEffect, BrightnessContrastEffect, ChromaticAberrationEffect, Effect, EffectComposer, GodRaysEffect, HueSaturationEffect, LookupTexture, LUT3DEffect, NoiseEffect, Pass, ToneMappingEffect, VignetteEffect } from 'postprocessing';
import type { N8AOPostPass } from 'n8ao';
import type { LookKey } from './dataLook';
import type { GradeEffect } from '../core/Grade';
import type { DayCycleClock } from '../../../shared/engine/world/dayCycle';
import type { SkyRig as Sky } from '../world/skyRig';
import type { App } from '../app/app';
import type { Scope } from '../../../shared/engine/app/scope';
import type { LevelContext } from '../../../server/engine/level/context';
import type { Tier } from '../core/tier';
import type { LevelSpec } from '../../../shared/engine/level/spec';
import type { VolumetricsEffect } from '../core/Volumetrics';
import type { Terrain } from '../world/Terrain';
import type { Forest } from '../world/forest/Forest';

export interface EngineEffects {
  ao: N8AOPostPass | null;
  vol: VolumetricsEffect;
  godRays: GodRaysEffect;
  bloom: BloomEffect;
  chroma: ChromaticAberrationEffect | null;
  vignette: VignetteEffect;
  tone: ToneMappingEffect;
  saturation: HueSaturationEffect;
  contrast: BrightnessContrastEffect;

  grade: GradeEffect;

  lut: LUT3DEffect | null;
  grain: NoiseEffect | null;

  order: Effect[];
}

/** what a `mode: 'replace'` compose gets: the engine built no chain, so there are no engine effects to hand over */
export interface LookReplaceContext {
  app: App;
  scope: Scope;
  debug: LevelContext['debug'];
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  /** the engine's one composer (HalfFloat, `multisampling` from the tier's `msaa` knob), still empty */
  composer: EffectComposer;
  tier: Tier;
}

/** the engine's two colour chains (Game.buildComposer): 'cinematic' (volumetrics, god rays, grain, fringe, the level's
 *  learned LUT) and 'clean' (E88, the L5 pick: no volumetrics, grain or fringe; faint rays, the LUT last) */
export type EngineChainKind = 'clean' | 'cinematic';
/**
 * The knobs that differ between the two chains beside which effects they hold (Game.buildComposer builds from these; a grid
 * cell carries a region's chain from the same table, SF63): the god rays' opacity, bloom's luminance smoothing and the
 * vignette's darkness.
 */
export const ENGINE_CHAIN_TUNING: Readonly<Record<EngineChainKind, { readonly rays: number; readonly bloomSmoothing: number; readonly vignette: number }>> = {
  cinematic: { rays: 1, bloomSmoothing: 0.3, vignette: 0.55 },
  // faint rays (a midday sun must not wash the sand and lagoon to white), bloom only what is really over the threshold, a
  // light vignette
  clean: { rays: 0.12, bloomSmoothing: 0.08, vignette: 0.35 },
};
/**
 * The cinematic chain's fixed fringe and grain (`Game.buildComposer`; a grid page carries them into a cinematic region's
 * cell from here, `regionCinematic.ts`): the chromatic aberration's offset and radial modulation, the overlay grain's opacity.
 */
export const CINEMATIC_FX = { chroma: 0.0006, chromaModulation: 0.35, grain: 0.12 } as const;

interface LookComposeContext extends LookReplaceContext {
  /** the engine chain's effects: the 'cinematic' chain's unless the compose asked `engineChain('clean')` first */
  fx: EngineEffects;
  /** the engine's colour chain, in order, for the composition's `chain` slot (01 §13.1, 13 C6); one kind per level */
  engineChain: (kind: EngineChainKind) => Effect[];
}

/** a `mode: 'replace'` composition: the whole chain, in order (01 §13.1: a level's own composer) */
export interface LookChain { chain: Pass[] }

export interface LookComposition {

  beforeScene?: Pass[];

  afterScene?: Pass[];

  beforeChain?: Pass[];

  chain?: Effect[];

  afterChain?: Pass[];
}

/**
 * A level's fog patch (01 §13.2's ordered `fog_fragment` slots: engine fog 100, stylize 200, a level's fog 300). The
 * engine runs `install()` once, after its own `installAtmosphere()` and before the sky builds or anything compiles.
 */
export interface FogModel { order: number; install: () => void }

/** the heightfield a painter samples (live: the baked terrain replaces the procedural one once `ready()` resolves) */
export interface PainterField {
  ready: () => Promise<boolean>;
  heightAt: (x: number, z: number) => number;
  normalAt: (x: number, z: number, eps?: number) => [number, number, number];
  trails: () => readonly (readonly [number, number])[][];
  /** the distance (m) to the nearest trail's centre line */
  trailDistance: (x: number, z: number) => number;
  /**
   * Replace this frame's ground with the painter's own sampled ground (a baked collider grid it streamed): every height /
   * normal query reads it from now on, and its splat when it brings one (trails and water stay the level's, and the splat
   * without one), and the terrain collider is sampled from it (a collider built before the painter ran is rebuilt:
   * `Terrain.groundBound`, `resampleTerrain`). A required manifest ground counts as loaded once it is bound. Absent on a
   * field that is not a live level frame's (a bake script's).
   */
  bindGround?: (ground: { readonly heightAt: (x: number, z: number) => number; readonly normalAt: (x: number, z: number, eps?: number) => [number, number, number]; readonly splatAt?: (x: number, z: number) => [number, number, number, number] }) => void;
}
/** a level's own ground: it builds the terrain's mesh(es) into `t.group` and sets `t.mesh` / `t.material` (Terrain.build) */
export interface TerrainPainter { build: (t: Terrain, field: PainterField, scope: Scope) => Promise<void> }

/** what a `GrassDriver` builds: its group goes in the scene, `update` runs every frame from the engine's Grass */
export interface GrassLayer { group: Group | Object3D; update: (dt: number, playerPos: Vector3) => void }
/** a level's own grass in place of the engine's carpet (Grass.build); `prepare` (Grass.prepare, awaited before the
 *  synchronous build) does what can run across frames first: compiling its looks, decoding its buffers */
export interface GrassDriver { build: (sky: Sky, forest: Forest) => GrassLayer; prepare?: () => Promise<void> }

/**
 * A level's own sky layer on the engine's sky rig (07 §6.2 step 5). Sky.build runs `build` where it builds its cloud
 * layer, after the shadow cascades exist (a light-loop patch goes there) and before anything compiles; `update` runs in
 * Sky.update every frame, after the clock.
 */
export interface SkyDressing {
  /** false: the engine's cloud layer is not built (`sky.clouds` stays null) — the level paints its own sky */
  clouds: boolean;
  /** false: the engine's planet is not built (`sky.planet` stays an empty group outside the scene) — the level paints its own */
  planet: boolean;
  /**
   * true: the level's world draws its whole sky itself (a painted dome or backdrop in its own scene, not a `backdrop`
   * factory). Wherever the level is drawn beside other content (a grid cell), that sky owns the horizon by the level's
   * weight, as a `backdrop` does (SHARD-PLATFORM G321). Absent: the level's sky is the engine's or its `backdrop`.
   */
  ownSky?: boolean;
  /** false: the world's own opaque sky covers every pixel the scene leaves empty, so the HDRI rig draws no background
   *  (it stays the environment's source). Absent: the HDRI is the background too. */
  background?: false;
  /**
   * Sun surface/corona visibility at build; each omitted flag defaults to true. Lighting is unchanged. `rays` (E398):
   * with the disc off (a level whose painted sky has the sun), keep the disc as the god rays' source only: it is never
   * drawn in the frame, but the rays pass masks it. `true` = at the light's sun; `{ azimuth, elevation }` (degrees, the
   * same compass as `sky.sun`) = at the painted sun.
   */
  sun?: { disc?: boolean; halo?: boolean; rays?: boolean | { azimuth: number; elevation: number } };
  /** `cloudField`: the engine's tileable cloud fbm (R), for a level's cloud shadows */
  build?: (sky: Sky, cloudField: Texture) => void;
  update?: (dt: number) => void;
}

/** a level's light model, patched into three's chunks at the top of Sky.build (before anything compiles) */
export interface LightingRig { install: () => void }

/**
 * The sun's shadow rig as data (Sky.build). Without one: the tier table's cascades, three's filter, normal bias 0.05,
 * radius 2, steps that pop.
 */
export interface ShadowStyle {
  /** 'phoneSplits': on a one-cascade tier (the phone), three 2048² cascades to 7 / 22 / 80 m (E123, E147) */
  rig: 'tier' | 'phoneSplits';
  /** the phone rig's last cascade ends here (m) instead of 80 (DW: Driftwood's draw budget) */
  phoneFar?: number;
  /** 'tent': the phone rig's 7×7 / 5×5 tent filter (E138, shadowFilter.ts) */
  filter?: 'tent';
  /** each step of the key light's shadow crossfades (E147 / E153, shadowFade.ts) */
  fade?: boolean;
  normalBias: number;
  radius: number;
  /** 'phone': on the phone rig the normal bias is fitted in texels and the far cascade draws every other frame */
  texelBias?: 'phone';
  /** 'phone': the phone rig's maps are depth only at 16 bits (E174, shadowVariants.ts) */
  depth16?: 'phone';
}

/** a level's fog switched off and back on around an off-screen shot (Explore's map from overhead) */
export interface FogControl { suspend: () => void; resume: () => void }

/** Material handover after the sky exists, before terrain and kit meshes build. */
export interface WorldLookContext {
  readonly renderer: WebGLRenderer;
  readonly sky: Sky;
  readonly scope: Scope;
}

const preparedWorldLooks = new WeakMap<Scope, Map<LookStrategy, Promise<void>>>();

/** Await optional world material preparation once per look and owning scope.
 * Failure remains rejected; disposed owners never proceed into terrain build. */
export function prepareWorldLook(look: LookStrategy | null, context: WorldLookContext): Promise<void> {
  if (look?.prepareWorld === undefined) return Promise.resolve();
  if (context.scope.disposed) return Promise.reject(new Error('World look preparation requires a live scope'));
  let prepared = preparedWorldLooks.get(context.scope);
  if (prepared === undefined) { prepared = new Map(); preparedWorldLooks.set(context.scope, prepared); }
  let pending = prepared.get(look);
  if (pending === undefined) {
    const prepare = look.prepareWorld;
    pending = Promise.resolve().then(() => prepare(context)).then(() => {
      if (context.scope.disposed) throw new Error('World left while preparing its look');
      return undefined;
    });
    prepared.set(look, pending);
  }
  return pending;
}

interface LookParts {
  /** Scoped material compilation/lending, awaited before Terrain.build in
   * standalone and regional worlds. Absent preserves the existing build order. */
  prepareWorld?: (context: WorldLookContext) => Promise<void>;
  backdrop?: SkyBackdropFactory;

  lighting?: LightingRig;

  shadows?: ShadowStyle;

  fogControl?: FogControl;

  sky?: SkyDressing;

  frame?: (dt: number, t: number) => void;

  dispose?: () => void;

  fog?: FogModel;

  terrainPainter?: TerrainPainter;

  grass?: GrassDriver;
  /**
   * Its own patch on each of its world's materials (a haze that takes its painted horizon's colour by heading), declared so
   * a grid cell applies it to the materials under its region's root (SHARD-PLATFORM G321, `render/regionLook.ts`) as its
   * compose applies it to its scene standalone; `scope` frees the patch. A material the asset cache shares is left alone
   * in a cell (another region may draw it).
   */
  worldPatch?: (material: Material, scope: Scope) => void;
}

/** 'extend' (the default): the level's passes go in slots around the engine's chain */
export interface ExtendLook extends LookParts {
  mode?: 'extend';
  /**
   * The engine chain its compose asks for, declared so a grid cell can carry it without composing (SF63); absent: the
   * cinematic chain (what a compose that asks nothing gets). Game.buildComposer builds the declared kind before compose,
   * so a compose that asks the other kind throws.
   */
  chain?: EngineChainKind;
  /**
   * The learned colour LUT its compose applies inside its own effects (a file in `render/lut.ts`'s 33³ format, its public
   * URL), declared so a grid cell can carry it without composing, like `chain` (op-lut20). Absent: its LUT is its
   * backdrop's (`SkyBackdrop.lut`) or its level's own file. Standalone the compose applies it as before.
   */
  lut?: string;
  /**
   * Its own post composite as a grid cell runs it (SF63 / G158: inside its cell a level owns the whole frame, its post
   * stack included), declared so the frame owner can run it where it carries this level, without composing. Absent: the
   * cell carries its engine chain only. Standalone its compose builds its composite as before.
   */
  cell?: LookCellComposite;
  /**
   * A data look's day keys replaced in place (SHARD-SOURCE AP5: `wildshard watch` sets a look live through engine's dev
   * hook); the next frame samples them. False: this look can't take them live (a fog kind change), so the page reloads.
   */
  liveKeys?: (keys: readonly LookKey[]) => boolean;
  compose: (c: LookComposeContext) => LookComposition;
}

/** What a look's grid-cell composite is built from (SF63 / G158): what the region draws, the page's one camera and renderer. */
export interface LookCellContext {
  /** everything the region draws (its scene subtree and its authored root), at the cell's render offset */
  readonly root: Object3D;
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
  readonly tier: Tier;
  /** the region's resident scope: whatever the build makes besides `display` and `passes` is owned by it */
  readonly scope: Scope;
}
/** A look's own post composite for a grid cell: its colour composite and the side passes it reads. */
export interface LookCellPost {
  /**
   * its colour composite over the scene-linear colour, in the place of the frame's tone mapping: the frame owner gives it a
   * NORMAL blend and fades it in by its cell's owner weight as the frame's tone mapping fades out (blended at the 16 m edge)
   */
  readonly display: Effect;
  /**
   * side passes that render into their own targets for `display` to read (`needsSwap` false), placed before the frame's
   * colour pass and run only while its cell carries the frame; the frame owner frees them and `display` when the region leaves
   */
  readonly passes?: readonly Pass[];
}
/** A look's composite as a grid cell runs it (SF63 / G158, `ExtendLook.cell`). */
export interface LookCellComposite {
  /**
   * 'chain': `display` is its whole colour chain (its compose's `chain` holds no engine effect), so the engine grade, look
   * layer, learned LUT, bloom, vignette, god rays and shafts stay out of its cell; 'tone': only its tone mapping is its own,
   * and the carried engine chain stays
   */
  readonly replaces: 'chain' | 'tone';
  /** build it once the region's world exists (its world hook has run), before its programs warm */
  readonly build: (c: LookCellContext) => LookCellPost;
}

/**
 * The engine chain's knobs that stand for a 'replace' compose where an engine chain draws the level's content instead of
 * its own composer (SF63: a grid cell on a page shell): its bloom (null: it blooms nothing), vignette darkness, god rays'
 * opacity and whether it draws AO, on one tier.
 */
export interface EngineKnobs {
  readonly bloom: { readonly intensity: number; readonly threshold: number; readonly smoothing: number } | null;
  readonly vignette: number;
  readonly rays: number;
  readonly ao: boolean;
  /**
   * its own display transform (tone curve and grade) as one effect over the scene-linear colour, made fresh for each
   * chain that draws it, with a NORMAL blend so its opacity fades it: an engine chain carrying it puts it where its tone
   * mapping runs and fades its own tone mapping and grade out as this fades in. Absent: the engine's tone mapping stays.
   */
  readonly display?: () => Effect;
}

/** 'replace': the level's compose builds the whole chain; the engine adds exactly its passes to its one composer */
export interface ReplaceLook extends LookParts {
  mode: 'replace';
  compose: (c: LookReplaceContext) => LookChain;
  /** SF63: the engine knobs its chain amounts to on a tier (`EngineKnobs`); absent: an engine chain keeps its own there */
  engineKnobs?: (tier: Tier) => EngineKnobs;
  /** its own composite as a grid cell runs it, as `ExtendLook.cell`; declared, a grid cell carries it instead of `engineKnobs` */
  cell?: LookCellComposite;
}

export type LookStrategy = ExtendLook | ReplaceLook;


export interface SkyBackdropTargets {
  sunDir: Vector3; sunColor: Color;
  lights: DirectionalLight[]; lightDirection: Vector3;
  hemi: HemisphereLight; fog: Fog;
  fogU: { fogSunDir: { value: Vector3 }; fogSunColor: { value: Color }; fogDistDensity: { value: number }; fogHeightDensity: { value: number } };
  /** true while the eye is under water (Atmosphere.ts owns the fog then) */
  underwater: () => boolean;
  disc: Mesh; halo: Sprite | null;
  cloud: { uSunDir: { value: Vector3 }; uSunColor: { value: Color }; uCloudLit: { value: Color }; uCloudAlpha: { value: number } };
  far: { uHazeCol: { value: Color }; uSeaSky: { value: Color }; uSeaSun: { value: Color }; uSeaSunDir: { value: Vector3 } };
  /** the gas giant's live uniforms (`uCrisp` 1: a crisp, opaque disc) */
  planet: { uSunDir: { value: Vector3 }; uHaze: { value: Color }; uCrisp: { value: number } };
  /** a key-light shadow step is still crossfading (ShadowStyle.fade): hold the next one */
  shadowBusy: () => boolean;
}
/** the post effects the clock drives (Game.buildComposer hands them over) */
export interface SkyBackdropPost {
  vol: { setSun: (dir: Vector3, color: Color) => void; setFogColor: (c: Color) => void; setStrength: (s: number) => void };
  rays: { blendMode: { opacity: { value: number } } } | null;
  /** the grade's HueSaturationEffect */
  hueSat: { saturation: number } | null;
}


export interface SkyBackdrop {
  clock: DayCycleClock;
  horizon: Color;
  lut: LookupTexture | null;
  bind: (targets: SkyBackdropTargets) => void;
  update: (dt: number, camera: PerspectiveCamera) => void;
  rebuild: () => void;
  attachPost: (post: SkyBackdropPost) => void;
  /** the backdrop's own sky layer (a dome): Game keeps it on the camera, and the engine builds no cloud layer */
  clouds?: Object3D;
  /**
   * Its world-anchored sky pieces, placed in its level's own frame (a cloud sea under floating islands, camera-facing cloud
   * puffs, a glow at its painted sun): standalone `SkyRig.build` adds them to the page scene where they stand; a grid
   * cell's layer (`BackdropLayer`) draws them at its region's origin, faded by its owner weight (SHARD-PLATFORM G321). A
   * look's compose that patches its scene's materials leaves these alone (they are the sky's, not the world's).
   */
  dressing?: Object3D;
  /** 'late': `update` runs at the end of Sky.update, after the shadow cascades (default: first, before them) */
  updateAt?: 'early' | 'late';
  /** false: the planet keeps its built opacity (default: it fades in with the clock's night) */
  fadesPlanet?: boolean;
  /** the dome's live palette uniforms a horizon painting blends with (HorizonMatte); `middayLit` its noon cloud colour */
  palette?: { uHorizon: { value: Color }; uCloudLit: { value: Color }; uSunGlow: { value: Color }; uSunDir: { value: Vector3 }; middayLit: Color };
  /** free its textures, render targets and dome (a layered backdrop, `SkyRig.layerBackdrop`, leaves with its region; G223) */
  dispose?: () => void;
  /** the GPU bytes its textures and render targets hold now (the census a layered backdrop is charged by; G223) */
  gpuBytes?: () => number;
  /** the most GPU bytes it can hold (its resident key cap, environment and PMREM targets): what a layer reserves (G223) */
  gpuCeiling?: () => number;
  /**
   * The offscreen pass its `bind` draws first (its environment, before the PMREM filter): a grid cell's layer links its
   * programs against that target (`compileOffscreenPass`) before it attaches the backdrop, so the frame it binds in does not
   * wait on a link (op-hitch47: a 34 ms blocking link in the frame Pine's cell sky attached). Optional data, read once.
   */
  environmentPass?: OffscreenPass;
}

/** An offscreen draw: what `renderer.render(scene, camera)` into `target` draws (`compileOffscreenPass`). */
export interface OffscreenPass { readonly scene: Object3D; readonly camera: Camera; readonly target: WebGLRenderTarget }
/** What a sky backdrop's factory is built with (`SkyRig.build`, or a grid cell's layer, `SkyRig.layeredBackdrop`). */
export interface SkyBackdropContext {
  sky: Sky; scene: Scene;
  /**
   * The page renderer, read-only: what the backdrop's offscreen passes (its PMREM environment) draw with, and what a game
   * helper compiles the backdrop's own material graphs on before the world stage (`lookGraphMaterials(scope, context, …)`
   * in `@wildshard/engine/game/plugin/shaderFamily`). A shard hands that helper the whole context instead of reading `renderer`
   * itself, so its runtime never holds the renderer for it (the runtime-performance `raw-render` guard).
   */
  readonly renderer: WebGLRenderer;
  level: LevelSpec; tier: Tier; look: { vol: number; fogDist: number; sat: number; ambient: number; sky: number } | null;
}
export type SkyBackdropFactory = (c: SkyBackdropContext) => Promise<SkyBackdrop>;
