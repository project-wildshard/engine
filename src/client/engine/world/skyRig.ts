import { PLANET_DIST, SkyBackdropView, cloudLayer, paintedSkyEnvironment } from './skyBackdrop';
import { cascadeRedraws } from './shadowCadence';
import { ownSceneResource } from '../app/sceneOwnership';
import { BackdropLayer, applyLayers, layerKeyedSky, seedLayerTargets, type LayeredSkyBackdrop, type LayerEnvironmentOnly } from './backdropLayer';
import { app } from '../app/runtime';
import { resourceScope } from '../../../shared/engine/app/resources';
import type { Scope } from '../../../shared/engine/app/scope';
import { captureLookChunks, noLookChunks, scopeLookChunks, type LookScopeOptions, type RegionLookParts, type ScopedLook } from '../render/regionLook';
import * as THREE from 'three';
import type { Renderer } from '../render/renderer';
import { TIER, TIER_CONFIG } from '../core/tier';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { cullToSlice, installCascadeCull } from './cascadeCull';
import { fogUniforms, isUnderwater } from './Atmosphere';
import type { LevelSpec } from '../../../shared/engine/level/spec';
import { SOFT_RADII, installPlaneBiasShadowFilter, installShadowFilter } from './shadowFilter';
import { ShadowFade, installShadowFadeChunk, sunFadeUniform } from './shadowFade';
import { patchPointLightSkip } from './pointLightSkip';
import { registerCascades } from './cascadeLights';
import { patchCSMShaderChunk } from './csmLightBlock';
import {WeakShaderMap} from './weakShaderMap';
import { compassDir, type DayCycleClock } from '../../../shared/engine/world/dayCycle';
import { ShadowMaps } from './shadowVariants';
import type { LookStrategy, SkyBackdrop, SkyBackdropContext, SkyBackdropFactory, SkyBackdropPost, SkyBackdropTargets, SkyDressing } from '../render/look';
import { PATCH_ORDER, hasProgramKey, patchShader, takeForeignHook } from '../render/shaderPatches';
import { horizonLight } from './Horizon';
import type { LookupTexture } from 'postprocessing';

/** the key light's shadow direction steps (E89, as a stepped day / night clock's): ≤ ~1 shadow texel about every 1.5 s */
const KEY_SHADOW_STEP = 0.25 * Math.PI / 180;

/** the sun's shadow map(s): cascade count, map size (px), how far they reach (m), the caster margin (m) and, for two
 *  cascades, where the near one ends (m) */
export interface ShadowRig { cascades: number; size: number; far: number; margin: number; /** where each cascade but the last ends (m); empty = CSM's practical splits */ splits: number[]; /** the phone's low-poly rig (E123): normal bias in texels */ phone: boolean }

/** the phone's `phoneSplits` rig (ShadowStyle.rig). E123 (the user's pick `2c2k`, "both 2048 and 2c"): cascades at 2048². E147 (the
 *  user's pick C, crisper near shadows): three of them, to 7 / 22 / 80 m — 0.8 cm a texel near you, half E123's 1.6 cm, for
 *  ~+0.08 ms a frame on the M5 */
// Its filter and radii are shadowFilter.ts's since E138
const PHONE_SHADOW: Omit<ShadowRig, 'margin' | 'phone'> = { cascades: 3, size: 2048, far: 80, splits: [7, 22] };

/**
 * The shadow rig for this tier and the level's shadow style. The phone's portrait camera (94° vertical FOV) makes a cascade's square far
 * wider than its reach: the one 80 m cascade was 189 m across, so a 1024² texel was 18.5 cm and every shadow edge a
 * row of 18 cm steps smeared by the PCF (E123: "blocky, blobby, pixelated, bleeding").
 */
export function shadowRig(phoneSplits: boolean, phoneFar?: number): ShadowRig {
  const T = TIER_CONFIG;
  const base: ShadowRig = { cascades: T.cascades, size: T.shadowMapSize, far: T.shadowFar, margin: T.shadowMargin, splits: [], phone: false };
  if (T.cascades !== 1 || !phoneSplits) return base; // desktop / a level without the split rig: the tier table
  const splits = PHONE_SHADOW.splits;
  return { ...PHONE_SHADOW, far: phoneFar ?? PHONE_SHADOW.far, cascades: splits.length + 1, splits, margin: base.margin, phone: true };
}


/**
 * Lighting rig: HDRI sky for IBL + background, a cascaded-shadow sun matched to the
 * HDRI's brightest pixel, a visible sun disc (for god rays) and the ringed planet that
 * hangs over every the game level.
 */
export class SkyRig {
  private readonly scope = resourceScope().child('Sky');
  sunDir: THREE.Vector3 = new THREE.Vector3(0.3, 0.6, 0.4).normalize();
  /** the level's sun colour (SkySpec.sunColor), set by build() */
  sunColor: THREE.Color = new THREE.Color();
  csm!: CSM;
  private readonly visual: SkyBackdropView;
  get sunDisc(): THREE.Mesh { return this.visual.sunDisc; }
  /** where the sun disc (and so the god rays) sits: the light's sun, or a painted sun's direction (E398) */
  get raysDir(): THREE.Vector3 {
    // FR5: a grid region's rays-only sun holds the disc inside its cell (`BackdropLayer.raysDir`)
    for (const layer of this.layers) { const dir = layer.raysDir(); if (dir !== undefined) return dir ?? this.sunDir; }
    return this.visual.raysDir ?? this.sunDir;
  }
  get planet(): THREE.Group { return this.visual.planet; }
  get planetDir(): THREE.Vector3 { return this.visual.planetDir; }
  /** the fill light (ChunkSky.hemiSky / hemiGround / hemiIntensity) — a runtime handle for the day/night clocks */
  hemi!: THREE.HemisphereLight;
  private materials = new WeakSet<THREE.Material>();
  /** the level this sky lights (handed to build()) */
  private level!: LevelSpec;

  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: Renderer;
  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: Renderer) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
     this.visual = new SkyBackdropView(scene, renderer, this.scope, this); }

  /** the scene the sky lights (the LightPool's home) */
  get sceneRoot(): THREE.Scene { return this.scene; }
  /** the player's camera (world modules cull against it) */
  get viewCamera(): THREE.PerspectiveCamera { return this.camera; }

  /**
   * `look`: the level look's sky parts (01 §13.1) — its light model (`lighting`, installed first, before anything
   * compiles), its shadow style, its backdrop (else the HDRI) and its sky dressing.
   */
  async build(look: Pick<LookStrategy, 'lighting' | 'shadows' | 'backdrop' | 'sky'> | null, backdropData: Pick<SkyBackdropContext, 'level' | 'tier' | 'look'>): Promise<this> {
    this.dressing = look?.sky ?? null;
    this.level = backdropData.level;
    this.visual.configure(this.level, this.dressing);
    const { sky: S, atmosphere: A } = this.level;
    this.sunColor.set(...S.sunColor);
    look?.lighting?.install(); // a level's light model (patched into three's chunks before anything compiles)
    const shadows = look?.shadows ?? null;
    const backdropFactory = look?.backdrop;
    this.backdrop = backdropFactory ? await backdropFactory({ sky: this, scene: this.scene, renderer: this.renderer, ...backdropData }) : null;
    if (this.backdrop) this.lut = this.backdrop.lut;
    const horizon = this.backdrop?.horizon ?? await this.visual.setupHDRI();
    if (this.backdrop === null) this.lut = this.visual.lut;
    this.scene.fog = new THREE.Fog(horizon, 1, 1e6); // distances unused: Atmosphere.ts overrides the maths
    fogUniforms.fogSunDir.value.copy(this.sunDir);
    fogUniforms.fogSunColor.value.set(...S.fogSunColor);
    fogUniforms.fogHeight.value = A.fogHeight;
    fogUniforms.fogHeightFalloff.value = A.fogHeightFalloff;
    fogUniforms.fogHeightDensity.value = A.fogHeightDensity;
    fogUniforms.fogDistDensity.value = A.fogDistDensity;

    const rig = shadowRig(shadows?.rig === 'phoneSplits', shadows?.phoneFar);
    this.csm = new CSM({
      camera: this.camera, parent: this.scene, cascades: rig.cascades, mode: rig.splits.length > 0 ? 'custom' : 'practical',
      // the near cascade ends at `splits[0]` m: a tight square round the player (the deck, the pier under foot), the last one takes the rest
      customSplitsCallback: (_n: number, _near: number, far: number, out: number[]) => { for (const m of rig.splits) out.push(Math.min(0.9, m / far)); out.push(1); },
      maxFar: rig.far, shadowMapSize: rig.size, lightDirection: this.sunDir.clone().negate(),
      lightIntensity: S.sunIntensity, shadowBias: -0.00012, lightMargin: rig.margin, lightNear: 1, lightFar: 600,
    });
    this.csm.fade = true;
    // SF57: the page's sky outlives every shard visit; its cascades hold each set-up material weakly (WeakShaderMap)
    Reflect.set(this.csm, 'shaders', new WeakShaderMap());
    installCascadeCull(this.csm, this.camera); // each cascade draws only the casters its own slice can see the shadow of (PH-P2)
    if (!TIER_CONFIG.softShadows) this.renderer.shadowMap.type = THREE.PCFShadowMap; // 16-tap PCFSoft → 9-tap PCF on the phone
    // E138: the phone's split rig may filter its shadows with a 7×7 / 5×5 tent, not three's 5 noisy taps
    // (shadowFilter.ts) — here, at boot, before a material compiles
    const filter = shadows?.filter === 'tent' && rig.phone;
    if (filter) this.renderer.shadowMap.type = installShadowFilter();
    // E435: every other rig gets three's own PCF with a receiver-plane depth bias, or big flat lit faces band with acne
    // Jake picked the receiver-plane bias; the phone tent retains its own filter and bias.
    else installPlaneBiasShadowFilter();
    patchCSMShaderChunk();
    // E147: a stepped clock's shadow steps may crossfade (shadowFade.ts). E153 (the user's pick A+B, "they all look the
    // same, use the cheapest"): the fading-out ghost is sampled with the 3×3 tent (4 taps)
    if (shadows?.fade === true && installShadowFadeChunk()) {
      this.shadowFade = new ShadowFade(this.csm, this.camera, this.scene);
      for (const [i, g] of this.shadowFade.ghosts.entries()) cullToSlice(this.csm, this.camera, g.shadow, i); // E153: a ghost draws only its cascade's casters
    }
    // NF17: a classic graph program takes the chunk setup (cascadeLights.ts)
    registerCascades({ csm: this.csm, ghosts: this.shadowFade?.ghosts ?? [], fade: sunFadeUniform, setup: (mat) => { this.setupCascades(mat); } });
    if (this.level.tiers?.[TIER]?.pointLightSkip === true) patchPointLightSkip(); // E142: a far / dark point light skips its BRDF (pointLightSkip.ts)
    // a low sun (golden hour, dawn) grazes flat decks: a shadow style may take more normal bias, or the planks speckle with acne
    for (const l of this.csm.lights) { l.color.copy(this.sunColor); l.shadow.normalBias = shadows?.normalBias ?? 0.05; l.shadow.radius = shadows?.radius ?? 2; }
    this.texelBias = shadows?.texelBias === 'phone' && rig.phone;
    // NB5 (QA-FEEDBACK-2026-11-14 rows 2, 3, 5): the desktop's three 2048² cascades take the phone's staggered cadence too
    // (BA-3's A / B, shadowCadence.ts): near every frame, middle every 2nd, far every 4th. Desktop frames run at 60-120, so a
    // far moving caster steps at 15-30 Hz; the shadow pass was ~110 of Driftwood's ~320 draws a frame
    this.farEveryOther = (this.texelBias || TIER_CONFIG.cascadeStagger) && this.csm.lights.length > 1;
    // E174: the phone rig's shadow maps are depth only at 16 bits (Jake's pick C; shadowVariants.ts): 40 MB, not three's 160
    if (shadows?.depth16 === 'phone' && rig.phone) {
      const maps = new ShadowMaps(this.renderer, this.csm, this.shadowFade?.ghosts ?? [], rig.size);
      maps.apply();
      this.shadowMaps = maps;
    }
    if (filter) {
      const [nearR, farR] = SOFT_RADII;
      this.csm.lights.forEach((l, i) => { l.shadow.radius = i === 0 && this.csm.lights.length > 1 ? nearR : farR; });
    }

    this.hemi = new THREE.HemisphereLight(S.hemiSky, S.hemiGround, S.hemiIntensity);
    this.scene.add(this.hemi);

    this.visual.buildSunDisc();
    this.visual.buildPlanet();
    const backdrop = this.backdrop, fog = this.scene.fog, halo = this.visual.sunHalo;
    if (backdrop?.clouds) this.visual.attachClouds(backdrop.clouds); // its own sky layer (a dome): Game.ts keeps `clouds` on the camera
    else this.visual.buildClouds();
    if (backdrop?.dressing) this.scene.add(backdrop.dressing); // its world-anchored sky pieces, where they stand (G321)
    // the backdrop's clock turns every knob above from here on
    if (fog instanceof THREE.Fog) {
      // `fog` is read live: a look that replaces scene.fog after this bind (in its compose) would otherwise leave the
      // backdrop turning a fog nobody draws (E399 council round 21: a dusk fade that never reached the screen)
      const scene = this.scene;
      const liveFog = (): THREE.Fog => (scene.fog instanceof THREE.Fog ? scene.fog : fog);
      this.targets = {
        sunDir: this.sunDir, sunColor: this.sunColor, lights: this.csm.lights, lightDirection: this.csm.lightDirection, hemi: this.hemi,
        get fog() { return liveFog(); },
        fogU: fogUniforms, underwater: isUnderwater, disc: this.sunDisc, halo: halo instanceof THREE.Sprite ? halo : null,
        cloud: this.cloudUniforms, far: horizonLight, planet: this.giantUniforms,
        shadowBusy: () => this.shadowFade?.busy ?? false,
      };
      if (backdrop) {
        backdrop.bind(this.targets);
        this.dayNight = backdrop.clock;
      }
    }
    return this;
  }

  backdrop: SkyBackdrop | null = null;
  /** what a backdrop's clock turns (the lights, fog, disc, clouds, haze): bound to the level's backdrop, mirrored by every layer */
  private targets: SkyBackdropTargets | null = null;
  /** SHARD-PLATFORM G223: the backdrops laid over the level's own (a grid region's sky inside its cell; backdropLayer.ts) */
  private readonly layers = new Set<BackdropLayer>();
  /** the values the layers moved last frame, put back first thing each update */
  private readonly layerUndo: (() => void)[] = [];

  /**
   * SHARD-PLATFORM G223: lay a second backdrop over this sky by a weight (`backdropLayer.ts`). Build the backdrop against the
   * layer's `holder` scene and `targets`, then `attach` it; set its `weight` each frame (a grid region's frame weight: 1
   * inside its cell, blended across the edge band); `dispose` frees it and gives every shared value back. `air`: the
   * owner's own fog object its clock colours (a grid region's: the one frame blends it as the owner's air). `base` (G242):
   * a layer that stands in for this sky's own backdrop by its weight (the grid road's dome and key light): applied before,
   * and drawn under, every other layer, at its weight's share of what they leave (`applyLayers`). Null before the sky is
   * built.
   */
  /** The attached, live backdrop layers (a grid's resident cells' skies), for a warm-up of their domes (`Game.warmSkyLayers`). */
  attachedLayers(): BackdropLayer[] { return [...this.layers].filter((layer) => { const state = layer.state(); return state.attached && !state.disposed; }); }
  layerBackdrop(options: { readonly air?: () => THREE.Fog | null; readonly owner?: Scope; readonly base?: boolean; readonly origin?: () => THREE.Vector3; readonly environment?: LayerEnvironmentOnly; readonly rays?: THREE.Vector3 | true } = {}): BackdropLayer | null {
    const targets = this.targets;
    if (targets === null) return null;
    const layer = new BackdropLayer({ targets, scene: this.scene }, { ...options, assets: app.assets, onDispose: () => { this.layers.delete(layer); } });
    this.layers.add(layer);
    return layer;
  }

  /**
   * G223 / G232: build a level's backdrop as a layer over this sky (`layerBackdrop`): a grid region's own sky inside its
   * cell. Null before the sky is built. The caller attaches the backdrop to the layer (`layer.attach`) once its memory is
   * admitted, or disposes both. SF63: a level whose sky has a gas giant (`sky.planet`) gets its own on the layer
   * (`layerPlanet`), unless `planet` is false (its look's sky dressing paints its own: `SkyDressing.planet`); and a backdrop
   * with no sky layer of its own (`SkyBackdrop.clouds`) gets the engine's cloud layer on the layer, as standalone `build`
   * gives it one (`layerClouds`), unless `clouds` is false (its look's sky dressing: `SkyDressing.clouds`).
   * G321: the layer starts from its level's own declared light (`seedLayerTargets`), the factory's `sky` moves the layer's
   * key light, not the page's (`layerKeyedSky`), and `sun` (its look's dressing, `SkyDressing.sun`) with the disc or halo
   * off hides the page's inside its cell. `origin`: where its level's own frame stands on the page (a grid region's root),
   * at which the layer draws the backdrop's world-anchored sky pieces (`SkyBackdrop.dressing`).
   */
  async layeredBackdrop(factory: SkyBackdropFactory, options: { readonly level: LevelSpec; readonly scope?: Scope; readonly air?: () => THREE.Fog | null; readonly planet?: boolean; readonly clouds?: boolean; readonly sun?: SkyDressing['sun']; readonly origin?: () => THREE.Vector3 }): Promise<{ layer: BackdropLayer; backdrop: SkyBackdrop } | null> {
    // FR5: a disc that is off can stay on as the god rays' source only (E398), as standalone `SkyBackdropView` keeps it
    const rays = options.sun?.disc === false ? options.sun.rays : undefined, raysOnly = rays !== undefined && rays !== false;
    const layer = this.layerBackdrop({ ...(options.air === undefined ? {} : { air: options.air }), ...(options.scope === undefined ? {} : { owner: options.scope }), ...(options.origin === undefined ? {} : { origin: options.origin }),
      ...(!raysOnly ? {} : { rays: typeof rays === 'object' ? compassDir(rays.azimuth, rays.elevation) : true }) });
    if (layer === null) return null;
    try {
      seedLayerTargets(layer, options.level);
      if (options.sun?.disc === false && !raysOnly) layer.targets.disc.visible = false;
      if (options.sun?.halo === false && layer.targets.halo !== null) layer.targets.halo.visible = false;
      // op-hitch47: the engine cloud layer's fbm arrives as the common bake while the backdrop builds, not marched in its frame
      const cloudField = options.clouds !== false ? this.visual.loadCloudField() : Promise.resolve();
      const [backdrop] = await Promise.all([factory({ sky: layerKeyedSky(this, layer), scene: layer.holder, renderer: this.renderer, level: options.level, tier: TIER, look: options.level.lookLayer ?? null }), cloudField]);
      if (options.planet !== false) this.layerPlanet(layer, options.level); // before the layer binds the clock (its crisp disc)
      if (options.clouds !== false && backdrop.clouds === undefined) this.layerClouds(layer, options.level);
      return { layer, backdrop };
    } catch (error) { layer.dispose(); throw error; }
  }

  /**
   * SHARD-PLATFORM G321 part 5: a backdrop-less level's default sky environment as an environment-only layer over this sky
   * (`BackdropLayer`'s `environment`): its painted sky PMREM-filtered as its own page would light with it
   * (`paintedSkyEnvironment`), swapped in at half the layer's weight, its intensity `intensity()` blended by the weight. Null
   * before the sky is built, for a level whose sky is not painted, or when `scope` ends first. The caller attaches the
   * returned backdrop once its memory is admitted (its `gpuCeiling`: the PMREM target), or disposes both.
   */
  async layeredEnvironment(options: { readonly level: Pick<LevelSpec, 'sky'>; readonly scope?: Scope; readonly intensity: () => number }): Promise<{ layer: BackdropLayer; backdrop: LayeredSkyBackdrop & { readonly gpuCeiling: () => number } } | null> {
    if (this.targets === null || options.level.sky.painted === undefined) return null;
    const live = (): boolean => options.scope?.disposed !== true;
    const env = await paintedSkyEnvironment(options.level, this.renderer, live);
    if (env === null) return null;
    const layer = this.layerBackdrop({ environment: { intensity: options.intensity }, ...(options.scope === undefined ? {} : { owner: options.scope }) });
    if (layer === null) { env.dispose(); return null; }
    const holder = layer.holder;
    holder.environment = env.texture;
    let freed = false;
    const backdrop = {
      lut: null, bind: (): void => undefined, update: (): void => undefined,
      rebuild: (): void => { void (async (): Promise<void> => { await env.rebuild(); if (!freed) holder.environment = env.texture; })(); },
      gpuBytes: (): number => (freed ? 0 : env.bytes), gpuCeiling: (): number => env.bytes,
      dispose: (): void => { if (freed) return; freed = true; holder.environment = null; env.dispose(); },
    };
    return { layer, backdrop };
  }

  /**
   * SF63: a layered level's own gas giant (its `sky.planet`; nothing without one), built as the page builds its own and kept
   * on the camera by the layer (`BackdropLayer.follow`). Its sun direction, haze and crispness are the layer's targets, so
   * the level's clock lights it as standalone; its opacity is the layer's weight.
   */
  private layerPlanet(layer: BackdropLayer, level: LevelSpec): void {
    if (level.sky.planet === undefined) return;
    const air = new THREE.Scene(); // its haze starts from the page's fog colour; the clock turns it from the first frame
    air.fog = new THREE.Fog(this.scene.fog instanceof THREE.Fog ? this.scene.fog.color.clone() : new THREE.Color(0.7, 0.8, 0.95), 1, 2);
    const view = new SkyBackdropView(air, this.renderer, this.scope, this), own = layer.targets.planet, giant = view.giantUniforms;
    view.configure(level, null);
    giant.uSunDir = own.uSunDir; giant.uHaze = own.uHaze; giant.uCrisp = own.uCrisp;
    view.buildPlanet();
    air.remove(view.planet);
    layer.follow(view.planet, view.planetDir, PLANET_DIST, giant.uOpacity);
  }

  /**
   * SF63: a layered level's engine cloud layer (the one standalone `build` gives a backdrop without its own sky layer), on
   * the layer's cloud targets, so the level's clock tints and fades it as standalone (`T.cloud`); it drifts on the page's
   * cloud time. Drawn after the layer's dome (`BackdropLayer.follow`) at the clock's opacity times the layer's weight. Its
   * cloud fbm is the page's (`cloudField`, kept by the page sky), so the region adds only the dome mesh and its material.
   */
  private layerClouds(layer: BackdropLayer, level: LevelSpec): void {
    const own = layer.targets.cloud, field = this.visual.cloudField(), fade = { value: 0 }, alpha = { value: own.uCloudAlpha.value };
    ownSceneResource(field, this.scope); // the page's sampler: a region's layer never adopts it
    const clouds = cloudLayer(field, { uTime: this.cloudUniforms.uTime, uSunDir: own.uSunDir, uSunColor: own.uSunColor, uLight: { value: new THREE.Color(1, 1, 1) }, uCloudLit: own.uCloudLit, uCloudAlpha: alpha }, level.sky.painted ? 1 : 0);
    clouds.onBeforeRender = () => { alpha.value = own.uCloudAlpha.value * fade.value; };
    layer.follow(clouds, new THREE.Vector3(), 0, fade);
  }

  /**
   * SF63: a level's light model, fog, sky dressing and world patch (`LookStrategy.lighting` / `fog` / `sky` / `worldPatch`) on the materials under
   * `root` only (G232: a grid region keeps its own look inside its cell), as region-keyed program variants
   * (`render/regionLook.ts`); the page's chunks and programs never change. Null when the level's installs change nothing
   * on this page and it has no world patch. `sweep` patches materials added since (call it before each frame
   * the subtree draws); `frame` runs the look's per-frame parts (its dressing's `update`, its `frame`: call it only while
   * the player is in the cell); the patches leave with `scope`.
   */
  /** Fetch the common cloud bake before a `scopeLevelLook` whose sky dressing reads the cloud field: a grid page's sky has
   *  no cloud layer of its own, so nothing else loads it and the region's look marched the fbm in its world step (~215 ms of
   *  Nalati's and Nine Dragon's at phone 4× CPU). */
  loadCloudField(): Promise<void> { return this.visual.loadCloudField(); }

  scopeLevelLook(root: THREE.Object3D, level: { readonly id: string }, look: RegionLookParts, scope: Scope, options: LookScopeOptions = {}): ScopedLook | null {
    const chunks = captureLookChunks(level.id, look, { sky: this, cloudField: () => this.visual.cloudField() });
    // G321: a look whose installs change nothing here still patches its world's materials with its own `worldPatch`
    if (chunks === null && look.worldPatch === undefined) return null;
    return scopeLookChunks(root, chunks ?? noLookChunks(level.id), scope, options, look);
  }

  attachPost(post: SkyBackdropPost): void { this.backdrop?.attachPost(post); }
  /** 0 = day … 1 = full night; a fixed sky stays at 0 */
  get night(): number { return this.dayNight?.night ?? 0; }
  /** the night lights (cabin windows, lanterns): the clock's 0 by day … 1 by night; the fixed sunset keeps them all lit (1) */
  get lamps(): number { return this.backdrop?.clock.lamps ?? 1; }

  /** the level's learned colour LUT (lut.ts, X1; per level) — Game.buildComposer ends the grade with it; null without a file */
  lut: LookupTexture | null = null;
  /** the day / night clock: the level backdrop's; null on a fixed sky */
  dayNight: DayCycleClock | null = null;

  /**
   * After an in-place WebGL restore (src/client/engine/core/GpuRecovery.ts, E54): the PMREM environment was a render target, so it came
   * back empty. Render it again — a backdrop's own way, the HDR level's from its background texture.
   */
  rebuildEnvironment(): void {
    this.shadowMaps?.apply(true); // E174: the restored context gave the maps back uninitialised
    for (const layer of this.layers) layer.rebuild();
    if (this.backdrop) { this.backdrop.rebuild(); return; }
    this.visual.rebuildEnvironment();
  }



  /**
   * Shared 1×1 fillers so every plain MeshStandard/Physical material carries the same map slots
   * (map · normal · ao · roughness · metalness) and therefore the same program: three keys a program
   * on WHICH slots exist, not their contents, so a coloured post, a mapped plank and a full PBR set
   * were three ~150 ms Metal compiles on the iPhone for what is one shader with different uniforms.
   * White multiplies by 1, a flat normal leaves the geometry normal; materials with their own
   * shader patch (an own customProgramCacheKey) are left alone.
   */
  private static fillers: { white: THREE.DataTexture; flatNormal: THREE.DataTexture } | null = null;
  private static fillSlots(mat: THREE.Material) {
    const m = mat as THREE.MeshStandardMaterial;
    if (!m.isMeshStandardMaterial || hasProgramKey(mat)) return;
    if (!SkyRig.fillers) {
      const tex = (rgb: [number, number, number], srgb: boolean) => { const t = new THREE.DataTexture(new Uint8Array([...rgb, 255]), 1, 1); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t; };
      SkyRig.fillers = { white: tex([255, 255, 255], true), flatNormal: tex([128, 128, 255], false) };
    }
    const { white, flatNormal } = SkyRig.fillers;
    m.map ??= white;
    m.normalMap ??= flatNormal;
    m.aoMap ??= white;         // ao · roughness · metalness read r · g · b: white = ×1
    m.roughnessMap ??= white;
    m.metalnessMap ??= white;
  }

  /** Wrap CSM's onBeforeCompile so materials keep their own shader patches. */
  setupMaterial(mat: THREE.Material): void {
    if (this.materials.has(mat)) return;
    SkyRig.fillSlots(mat);
    this.setupCascades(mat);
  }

  /** the cascade gate and the shadow fade alone (CSM's chunk setup): a classic graph program, which has no family texture slots */
  setupCascades(mat: THREE.Material): void {
    if (this.materials.has(mat)) return;
    this.materials.add(mat);
    const csmHook = takeForeignHook(mat, () => { this.csm.setupMaterial(mat); });
    const fade = this.shadowFade !== null;
    if (this.shadowFade) mat.defines = { ...mat.defines, CSM_GHOSTS: this.shadowFade.ghosts.length }; // E147: the cascades mix in the fade's ghost shadows
    patchShader(mat, 'engine.csm', PATCH_ORDER.shadows, (shader, renderer) => { csmHook(shader, renderer); if (fade) shader.uniforms['uSunFade'] = sunFadeUniform; }, { key: (k) => `${k}|csm`, pureKey: true, sceneShapeKey: true });
    mat.needsUpdate = true;
  }

  /** the cloud layer(s) — Game.ts keeps them centred on the camera; null when the level's sky dressing paints its own */
  get clouds(): THREE.Object3D | null { return this.visual.clouds; }
  set clouds(value: THREE.Object3D | null) { this.visual.clouds = value; }
  /** the level look's own sky layer (LookStrategy.sky): built in place of / beside the cloud layer, updated every frame */
  private dressing: SkyDressing | null = null;
  private get cloudUniforms(): SkyBackdropView['cloudUniforms'] { return this.visual.cloudUniforms; }
  private get giantUniforms(): SkyBackdropView['giantUniforms'] { return this.visual.giantUniforms; }

  /** E174: the phone rig's shadow maps (shadowVariants.ts); null off the low-poly level's phone rig */
  shadowMaps: ShadowMaps | null = null;
  /** E147: the sun's shadow steps crossfade (shadowFade.ts); null = they pop (the other shards) */
  private shadowFade: ShadowFade | null = null;
  /** where the key light's shadow wants to point (setKeyLight); null on a level nothing moves the sun on */
  private keyShadowWant: THREE.Vector3 | null = null;

  /**
   * E123: on the phone's low-poly rig the normal bias is held in shadow texels, not metres. 0.14 m was ~0.75 of the old
   * 18.5 cm texel; on a finer map the same 0.14 m only lifts contact shadows off the deck (E112 already flips it for
   * two-sided sheets). A cascade's square follows the camera's aspect (a resize, a rotation), so it is read each frame.
   */
  private texelBias = false;
  /**
   * E189 (Jake, iPhone 17 Pro: the warm phone must hold a locked 30 in the grass, "keep the look"; his pick of what may
   * give: "far shadows softer" — redrawn less often): on the phone's low-poly rig the far cascade (22–80 m) is redrawn on
   * every other drawn frame, 15 times a second at the locked 30. A skipped frame keeps the last map AND the matrix it was
   * drawn with (WebGLShadowMap skips a light with autoUpdate off before it updates `shadow.matrix`), so the far shadows sit
   * exactly where they were, one frame old; only a moving caster out there (a palm swaying) steps at 15 Hz. The near and
   * middle cascades (the deck, the pier, the flag, everything within 22 m) are redrawn every frame, as before.
   * BA-3 (MF7 battery, G899): now the middle every 2nd and the far every 4th as well (shadowCadence.ts).
   */
  private farEveryOther = false;
  private farTick = 0;
  /**
   * PF3 (Pine's phone row, `shadowEvery`): every cascade redraws on every Nth drawn frame; -1 while every frame. Pine's one
   * 1024² cascade cost ~1.8-2.2 ms of a Chromium-4x phone frame for ~10 casters (the batched trees' per-draw cost,
   * not the walk); a held frame keeps its map and its matrix, so only the swaying crowns and the animals step (15 Hz at 30).
   */
  private everyTick = -1;
  private fitNormalBias(): void {
    for (const l of this.csm.lights) {
      const texel = (l.shadow.camera.right - l.shadow.camera.left) / l.shadow.mapSize.x;
      if (Number.isFinite(texel) && texel > 0) l.shadow.normalBias = Math.min(0.14, 0.76 * texel);
    }
  }

  /**
   * E153: place every shadow for the camera as it is now and draw them at the next render — the cascades, their texel
   * bias and the fade's ghosts (Game.warmTurn: the boot draws the world once facing each way).
   */
  warmShadows(): void {
    if (this.farEveryOther || this.everyTick >= 0) for (const light of this.csm.lights) light.shadow.autoUpdate = true; // the boot's warm-up draws every cascade
    this.csm.update();
    if (this.texelBias) this.fitNormalBias();
    this.shadowFade?.warm();
  }

  /** Apply the current backdrop-owner weights before shader preparation, without advancing the sky clock,
   * cloud time, alternating-cascade cadence or simulation. The next ordinary frame restores/reapplies these slots. */
  prepareLayers(): void {
    for (let i = this.layerUndo.length - 1; i >= 0; i--) this.layerUndo[i]?.();
    this.layerUndo.length = 0;
    if (this.layers.size > 0) this.applyLayers(0);
  }

  update(dt = 0): void {
    // G223: what a layered backdrop moved last frame goes back before the level's own backdrop runs
    for (let i = this.layerUndo.length - 1; i >= 0; i--) this.layerUndo[i]?.();
    this.layerUndo.length = 0;
    const B = this.backdrop;
    if (B !== null && B.updateAt !== 'late') B.update(dt, this.camera); // before the CSM: the clock turns its light
    if (B !== null && B.fadesPlanet !== false) this.visual.fadePlanet(this.night);
    const want = this.keyShadowWant;
    if (want !== null && want.angleTo(this.csm.lightDirection) > KEY_SHADOW_STEP) this.csm.lightDirection.copy(want); // a big jump (a Time of day pick, the sun ↔ moon swap) moves at once
    this.csm.update();
    if (this.texelBias) this.fitNormalBias();
    this.shadowFade?.update(dt); // after the CSM and its bias: each ghost copies its cascade's square
    if (this.farEveryOther) {
      this.farTick = (this.farTick + 1) % 8;
      const redraw = cascadeRedraws(this.farTick, this.csm.lights.length);
      this.csm.lights.forEach((light, i) => { light.shadow.autoUpdate = redraw[i] ?? true; });
      // DW: a running fade's ghosts redraw on the ticks no far or middle cascade does (2 and 6 of the 8, 7.5 Hz at the
      // phone's 30); on the fade's first frame they take their cascades' maps (ShadowFade.adopt) and draw only if that
      // was refused. They had redrawn every frame of every fade (+~40 draws), then all at once on its first (G913)
      const fade = this.shadowFade;
      if (fade?.busy === true && !fade.started && this.farTick % 4 !== 2) for (const ghost of fade.ghosts) ghost.shadow.autoUpdate = false;
    } else if (TIER_CONFIG.shadowEvery > 1) {
      this.everyTick = (this.everyTick + 1) % TIER_CONFIG.shadowEvery;
      for (const light of this.csm.lights) light.shadow.autoUpdate = this.everyTick === 0;
    } else if (this.everyTick >= 0) {
      this.everyTick = -1;
      for (const light of this.csm.lights) light.shadow.autoUpdate = true;
    }
    this.cloudUniforms.uTime.value += dt; this.giantUniforms.uTime.value += dt;
    if (B?.updateAt === 'late') B.update(dt, this.camera); // a clock that steps its own shadow light: after the cascades
    this.dressing?.update?.(dt);
    if (this.layers.size > 0) this.applyLayers(dt);
    this.visual.updateSunHalo(this.camera);
  }

  /**
   * G223 / G242: every layer over the level's own state (base layers first, `applyLayers`), then the cascades again so the
   * shadows follow the blended key light
   */
  private applyLayers(dt: number): void {
    this.layerUndo.push(...applyLayers(this.layers, dt, this.camera));
    if (this.layerUndo.length === 0) return;
    this.csm.update();
    if (this.texelBias) this.fitNormalBias();
  }

  // ── runtime setters (a level's day/night sky rig + weather; nothing calls them on a fixed-time level) ──

  /**
   * Move the key light (the sun, or the moon at night) and recolour it: the CSM direction + colour × intensity, the
   * fog's in-scatter direction, the cloud / planet lighting direction. `sunDir` is updated in place (Game.ts places
   * the sun disc along it every frame; a level's own materials read it from here).
   * The shadow direction moves in KEY_SHADOW_STEP steps, not every frame (E89, as a stepped clock does it: a sun sliding a
   * fraction of a texel per frame made every shadow edge crawl); the disc, the fog and the clouds stay continuous.
   */
  setKeyLight(dir: THREE.Vector3, color: THREE.Color, intensity: number): void {
    this.sunDir.copy(dir).normalize();
    this.sunColor.copy(color);
    this.keyShadowWant = (this.keyShadowWant ?? new THREE.Vector3()).copy(this.sunDir).negate(); // stepped in update(): the frame's last writer wins (the rig, then LightCheat)
    for (const l of this.csm.lights) { l.color.copy(color); l.intensity = intensity; }
    fogUniforms.fogSunDir.value.copy(this.sunDir);
    this.cloudUniforms.uSunDir.value.copy(this.sunDir);
    this.giantUniforms.uSunDir.value.copy(this.sunDir);
  }

  /** the cloud layer's colour toward the sun, and a multiplier over the whole layer (night, a storm's gloom); default white */
  setCloudLight(sunColor: THREE.Color, light: THREE.Color): void {
    this.cloudUniforms.uSunColor.value.copy(sunColor);
    this.cloudUniforms.uLight.value.copy(light);
  }

  /** a multiplier over the ringed giant's colour and its opacity (a storm deck hides it); default white, 1 */
  setPlanetLight(light: THREE.Color, opacity = 1): void {
    this.giantUniforms.uLight.value.copy(light);
    this.giantUniforms.uOpacity.value = opacity;
  }

  /**
   * Hold everything a day clock or a level's own light rig writes on this sky (SHARD-PLATFORM G223: a grid region's runtime
   * lights the page's one sky while it is entered, and must leave it as it found it). The returned function puts back:
   * the key light (`sunDir`, `sunColor`, each cascade light's colour and intensity, the shadow direction and where the
   * stepped shadow wants to go), the cascades' shadow map size (a changed map is freed and redrawn at the held size), the
   * hemisphere fill, the sun disc (shown, scale, colour) and its halo (scale, opacity), and the cloud and planet lighting.
   * The fog's in-scatter direction `setKeyLight` also writes is `fogUniforms` (the caller holds that set).
   */
  holdLight(): () => void {
    const csm = this.csm, cloud = this.cloudUniforms, giant = this.giantUniforms, hemi = this.hemi;
    const sunDir = this.sunDir.clone(), sunColor = this.sunColor.clone(), want = this.keyShadowWant?.clone() ?? null;
    const lightDirection = csm.lightDirection.clone(), mapSize = csm.shadowMapSize;
    const lights = csm.lights.map((l) => ({ l, color: l.color.clone(), intensity: l.intensity, size: l.shadow.mapSize.clone() }));
    const fill = { sky: hemi.color.clone(), ground: hemi.groundColor.clone(), intensity: hemi.intensity };
    const disc = this.sunDisc, discMaterial = disc.material instanceof THREE.MeshBasicMaterial ? disc.material : null;
    const shown = disc.visible, discScale = disc.scale.clone(), discColor = discMaterial?.color.clone() ?? null;
    const halo = this.visual.sunHalo, haloScale = halo?.scale.clone() ?? null, haloOpacity = halo?.material.opacity ?? 1;
    const clouds = { dir: cloud.uSunDir.value.clone(), sun: cloud.uSunColor.value.clone(), light: cloud.uLight.value.clone() };
    const planet = { dir: giant.uSunDir.value.clone(), light: giant.uLight.value.clone(), opacity: giant.uOpacity.value };
    return () => {
      this.sunDir.copy(sunDir); this.sunColor.copy(sunColor);
      this.keyShadowWant = want === null ? null : (this.keyShadowWant ?? new THREE.Vector3()).copy(want);
      csm.lightDirection.copy(lightDirection); csm.shadowMapSize = mapSize;
      for (const { l, color, intensity, size } of lights) {
        l.color.copy(color); l.intensity = intensity;
        if (!l.shadow.mapSize.equals(size)) { l.shadow.mapSize.copy(size); l.shadow.map?.dispose(); l.shadow.map = null; }
      }
      hemi.color.copy(fill.sky); hemi.groundColor.copy(fill.ground); hemi.intensity = fill.intensity;
      disc.visible = shown; disc.scale.copy(discScale);
      if (discMaterial !== null && discColor !== null) discMaterial.color.copy(discColor);
      if (halo !== null && haloScale !== null) { halo.scale.copy(haloScale); halo.material.opacity = haloOpacity; }
      cloud.uSunDir.value.copy(clouds.dir); cloud.uSunColor.value.copy(clouds.sun); cloud.uLight.value.copy(clouds.light);
      giant.uSunDir.value.copy(planet.dir); giant.uLight.value.copy(planet.light); giant.uOpacity.value = planet.opacity;
    };
  }



}
