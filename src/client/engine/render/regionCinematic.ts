/**
 * A cinematic level's own post inside a page that runs another chain (SHARD-PLATFORM SF63 follow-up, E435): its volumetric
 * shafts, its colour fringe and its film grain, the three effects the cinematic engine chain has and the clean one has not
 * (`Game.buildComposer`). A grid page shell runs the clean chain; a cinematic region (Pine Hollow's chain, Nalati's) carries
 * these into its cell, faded by its owner weight, and its sky clock drives the shafts as it does standalone.
 *
 * - **Compiled once, neutral.** The three effects join the page's one colour pass at install (`place`), in the cinematic
 *   chain's own order (the fringe first, the shafts before the god rays, the grain last), at zero opacity / zero offset, and
 *   the march's program is compiled then too (`warm`). Entering, leaving or crossing a cell writes uniforms only.
 * - **Targets only while carried.** The march runs into its own target (`VolumetricsEffect`'s pre-pass, at the tier's
 *   scale), parked at 1×1 until a region takes the effects (`take`) and parked again on `release`: its memory is held only
 *   while a cinematic region carries them. The fringe and the grain hold no targets.
 * - **Its depth.** The march reads the page's scene depth: the colour pass's own depth texture where the page has one (a
 *   chain with depth readers), else, on a page whose viewmodels draw into the depth slices (E142: the scene target's depth
 *   is the world's), the scene target's depth as a texture, attached only while carried (a depth renderbuffer the same
 *   size becomes a depth texture: a target re-set-up, never a recompile). A page with neither keeps the shafts off.
 * - **The region's clock.** `port` is the `SkyBackdropPost.vol` a region's sky backdrop drives; writes are kept per region,
 *   and only the carrying region's reach the march (a neighbour's clock writing too never takes over the page's shafts).
 * - **God rays** (SHARD-PLATFORM G321 part 5): a page whose own chain leaves its god rays out (its tier's `godRays: false`:
 *   the grid shell) is handed a rays effect built as the engine chain builds its own (`rays`). It joins the colour pass right
 *   after the shafts at opacity 0, and its passes run only while its opacity is above 0 and the sun is in view
 *   (`skipRaysOffscreen`). A region whose own chain draws rays (any chain kind) carries them (`takeRays`): the rays read the
 *   same scene depth as the shafts, attached while either is carried, and the frame turns their opacity as the region's
 *   chain and clock set it. Released with the carrier, back at 0.
 *
 * Generic engine code (E405): no level is named here.
 */
import { BlendFunction, ChromaticAberrationEffect, NoiseEffect, type Effect, type GodRaysEffect } from 'postprocessing';
import { Color, DepthTexture, FloatType, Vector2, Vector3, type PerspectiveCamera, type Texture, type WebGLRenderTarget } from 'three';
import { TIER_CONFIG } from '../core/tier';
import { VolumetricsEffect, makeNoiseTexture } from '../core/Volumetrics';
import type { Renderer } from './renderer';
import { CINEMATIC_FX, type SkyBackdropPost } from './look';

type Rgb = readonly [number, number, number];
/** What a carrying region starts its shafts from (a standalone boot of its level: `setSun`, `setFogColor`, `setMedium`). */
export interface RegionCinematicStart {
  /** its atmosphere's in-scatter strength (`ChunkAtmosphere.volumetric.strength`; 0.55 without one) */
  readonly strength: number;
  /** its atmosphere's volumetric sun colour */
  readonly sunColor: Rgb;
  /** the one sun's direction now and the region's air now */
  readonly sunDir?: Vector3 | undefined;
  readonly fog?: Color | undefined;
}
/** The readout: whether a region carries the effects, its weight, the march's strength, the fringe, the grain, the target. */
export interface RegionCinematicState {
  readonly carrier: string | null;
  readonly weight: number;
  /** the shafts' composite opacity and the march's strength */
  readonly vol: readonly [number, number];
  readonly chroma: number;
  readonly grain: number;
  /** the march target's size ([1, 1]: parked) */
  readonly target: readonly [number, number] | null;
  /** where the march reads depth, and whether the scene target's depth texture is attached now */
  readonly depth: 'pass' | 'scene' | 'none';
  readonly sceneDepth: boolean;
  /** G321 part 5: the carried god rays' carrier and opacity (absent: the page has no carried rays) */
  readonly rays?: readonly [string | null, number];
}

interface VolWrites { sunDir?: Vector3; sunColor?: Color; fog?: Color; strength?: number }

/** The cinematic chain's shafts, fringe and grain for one page's colour pass (see the header). */
export class RegionCinematic {
  readonly vol: VolumetricsEffect;
  readonly chroma: ChromaticAberrationEffect;
  readonly grain: NoiseEffect;
  private readonly noise: Texture;
  private carrier: string | null = null;
  private w = 0;
  private readonly writes = new Map<string, VolWrites>();
  private restoreLight: (() => void) | null = null;
  private depth: 'pass' | 'scene' | 'none' = 'none';
  private scene: WebGLRenderTarget | null = null;
  private sceneDepth: DepthTexture | null = null;

  private readonly renderer: Renderer | null;
  /** G321 part 5: the god rays for a page whose chain has none (null: the page draws its own, or none to carry) */
  readonly rays: GodRaysEffect | null;
  private raysCarrier: string | null = null;

  /**
   * `renderer`: the page's (it compiles the march at `warm`); `tier`: the march's steps and scale (the tier's); `rays`: a god
   * rays effect for a page whose own chain has none (G321 part 5), its passes skipped while its opacity is 0
   */
  constructor(camera: PerspectiveCamera, renderer: Renderer | null = null, tier: { readonly volumetricSteps: number; readonly volumetricScale: number } = TIER_CONFIG, rays: GodRaysEffect | null = null) {
    this.renderer = renderer;
    this.rays = rays;
    if (rays !== null) rays.blendMode.opacity.value = 0;
    this.noise = makeNoiseTexture();
    this.vol = new VolumetricsEffect(camera, this.noise, tier.volumetricSteps, tier.volumetricScale, { prepass: true, parked: true });
    this.chroma = new ChromaticAberrationEffect({ offset: new Vector2(0, 0), radialModulation: true, modulationOffset: CINEMATIC_FX.chromaModulation });
    this.grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: true });
    this.weight(0);
  }

  /**
   * Splice the effects into a colour pass's live effect list (its program is rebuilt by the caller's one recompile): the
   * fringe first (the cinematic pass sorts its convolution first), the shafts next (before the god rays), the grain right
   * after `grainAfter`. Returns the removal. A list that already holds a convolution effect keeps it and goes without the
   * fringe (an effect pass merges one).
   */
  place(effects: Effect[], grainAfter: Effect, hasConvolution: boolean): () => void {
    const added: Effect[] = hasConvolution ? [this.vol] : [this.chroma, this.vol];
    if (this.rays !== null) added.push(this.rays); // the god rays right after the shafts, as the cinematic chain orders them
    effects.splice(0, 0, ...added);
    effects.splice(effects.indexOf(grainAfter) + 1, 0, this.grain);
    added.push(this.grain);
    return () => { for (const effect of added) { const i = effects.indexOf(effect); if (i !== -1) effects.splice(i, 1); } };
  }

  /**
   * Where the march reads depth (at install, before `warm`): `pass`, the colour pass's own depth texture; else `scene`, the
   * scene target of a page on the depth slices, given a depth texture while carried; neither: no shafts.
   */
  depthFrom(source: { readonly pass: Texture | null; readonly scene: WebGLRenderTarget | null }): void {
    if (source.pass !== null) { this.vol.setDepthTexture(source.pass); this.rays?.setDepthTexture(source.pass); this.depth = 'pass'; return; }
    // a scene target that already has a depth texture would have handed the pass its depth: none to give it here
    if ((source.scene?.depthTexture ?? null) !== null || source.scene === null) { this.depth = 'none'; return; }
    this.scene = source.scene; this.depth = 'scene';
    this.vol.setDepthTexture(new DepthTexture(1, 1, FloatType)); // the packing define now; the texture itself at take
  }

  /** the scene target's depth as a texture, for the march and the rays (attached while either is carried) */
  private attachSceneDepth(): void {
    const scene = this.scene;
    if (this.depth !== 'scene' || scene === null || (scene.depthTexture ?? null) !== null) return;
    const depth = new DepthTexture(scene.width, scene.height, FloatType);
    depth.name = 'RegionCinematic.SceneDepth';
    scene.depthTexture = depth; scene.dispose(); // set up again at the next draw, with its depth as this texture
    this.sceneDepth = depth;
    this.vol.setDepthTexture(depth);
    this.rays?.setDepthTexture(depth);
  }
  private detachSceneDepth(): void {
    if (this.carrier !== null || this.raysCarrier !== null) return;
    const scene = this.scene, depth = this.sceneDepth;
    if (scene !== null && depth !== null && scene.depthTexture === depth) { scene.depthTexture = null; scene.dispose(); }
    depth?.dispose(); this.sceneDepth = null;
  }

  /**
   * G321 part 5: region `instance`'s own chain draws god rays: the page's carried rays are its (the frame turns their
   * opacity), reading the scene depth. Nothing without carried rays or a depth to mask the sun with.
   */
  takeRays(instance: string): void {
    if (this.rays === null || this.depth === 'none' || this.raysCarrier === instance) return;
    this.raysCarrier = instance;
    this.attachSceneDepth();
  }
  /** compile the march's program now (install), never at a crossing */
  warm(): void { if (this.depth !== 'none' && this.renderer !== null) this.vol.warm(this.renderer); }

  /** The `SkyBackdropPost.vol` region `instance`'s clock drives: kept per region, live only while it carries. */
  port(instance: string): SkyBackdropPost['vol'] {
    const own = (): VolWrites => { let w = this.writes.get(instance); if (w === undefined) { w = {}; this.writes.set(instance, w); } return w; };
    return {
      setSun: (dir, color) => { const w = own(); (w.sunDir ??= new Vector3()).copy(dir); (w.sunColor ??= new Color()).copy(color); if (this.carrier === instance) this.vol.setSun(dir, color); },
      setFogColor: (c) => { (own().fog ??= new Color()).copy(c); if (this.carrier === instance) this.vol.setFogColor(c); },
      setStrength: (s) => { own().strength = s; if (this.carrier === instance) this.vol.setStrength(s); },
    };
  }
  /** a region leaves the page: its kept writes go */
  forget(instance: string): void { this.writes.delete(instance); if (this.carrier === instance || this.raysCarrier === instance) this.release(); }

  /** Region `instance` carries the effects: the march's target is sized, its level's start values then its clock's writes applied. */
  take(instance: string, start: RegionCinematicStart): void {
    if (this.carrier === instance) return;
    this.release();
    this.carrier = instance;
    this.restoreLight = this.vol.holdLight();
    const sunColor = new Color(start.sunColor[0], start.sunColor[1], start.sunColor[2]);
    if (start.sunDir !== undefined) this.vol.setSun(start.sunDir, sunColor);
    if (start.fog !== undefined) this.vol.setFogColor(start.fog);
    this.vol.setStrength(start.strength);
    const w = this.writes.get(instance);
    if (w?.sunDir !== undefined && w.sunColor !== undefined) this.vol.setSun(w.sunDir, w.sunColor);
    if (w?.fog !== undefined) this.vol.setFogColor(w.fog);
    if (w?.strength !== undefined) this.vol.setStrength(w.strength);
    if (this.depth === 'none') return; // no scene depth to march against: the fringe and the grain only
    this.attachSceneDepth();
    this.vol.setParked(false);
  }
  /** The carrier's weight (0..1): shafts/fringe follow its blend; grain is hidden outside the actual cell. */
  weight(w: number, grainVisible = true): void {
    this.w = this.carrier === null ? 0 : w;
    this.vol.blendMode.opacity.value = this.w;
    this.chroma.offset.set(CINEMATIC_FX.chroma * this.w, CINEMATIC_FX.chroma * this.w);
    this.grain.blendMode.opacity.value = grainVisible ? CINEMATIC_FX.grain * this.w : 0;
  }
  /** The carrier leaves: the march parks (its target freed), every effect neutral (the rays at 0), the march's light back. */
  release(): void {
    if (this.raysCarrier !== null) { this.raysCarrier = null; if (this.rays !== null) this.rays.blendMode.opacity.value = 0; }
    if (this.carrier !== null) {
      this.carrier = null;
      this.weight(0);
      this.vol.setParked(true);
      this.restoreLight?.(); this.restoreLight = null;
    }
    this.detachSceneDepth();
  }

  state(): RegionCinematicState {
    const r = (n: number): number => Math.round(n * 1e5) / 1e5, num = (v: unknown): number => (typeof v === 'number' ? v : 0);
    return { carrier: this.carrier, weight: r(this.w), vol: [r(num(this.vol.blendMode.opacity.value)), r(this.vol.strength())], chroma: r(this.chroma.offset.x), grain: r(num(this.grain.blendMode.opacity.value)), target: this.vol.targetSize(),
      depth: this.depth, sceneDepth: this.sceneDepth !== null, ...(this.rays === null ? {} : { rays: [this.raysCarrier, r(num(this.rays.blendMode.opacity.value))] as const }) };
  }

  dispose(): void { this.release(); this.writes.clear(); this.vol.dispose(); this.chroma.dispose(); this.grain.dispose(); this.rays?.dispose(); this.noise.dispose(); }
}
