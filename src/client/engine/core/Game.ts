import { app } from '../app/runtime';
import { engineString } from '../../../shared/engine/strings';
import { Scope } from '../../../shared/engine/app/scope';
import { FencedUnits } from '../render/fencedUnits';
import { FrameDrawRanges, type FrameDrawRange } from '../render/frameDrawRange';
import { casterOrder, firstViewCut, firstViewOrder } from '../render/firstFrameParts';
import { installBrowserScopeEnvironment } from '../app/view/scopeEnvironment';
import {pagePresentation} from '../app/view/presentation';
import {PresentationLoop} from '../app/view/presentationLoop';
import { SceneOwnership, sceneResourceOwner } from '../app/sceneOwnership';
import { UploadOwnership } from '../render/uploadOwnership';
import { composerAllocations, cachedResourceAllocations, type ResourceAllocation } from '../render/textureBytes';
import { ViewmodelRoot } from '../render/viewmodel';
import type { Phase } from '../app/systems';
import { currentOwner, enterOwner } from '../../../shared/engine/app/ownership';
import * as THREE from 'three';
import { createRenderer, type Renderer } from '../render/renderer';
import { CAMERA_FOV } from '../../../shared/engine/core/config';
import {
  EffectComposer, type RenderPass, EffectPass, BloomEffect, FXAAEffect, VignetteEffect, ToneMappingEffect,
  ToneMappingMode, BlendFunction, EffectAttribute, GodRaysEffect, LUT3DEffect, KernelSize, ChromaticAberrationEffect, HueSaturationEffect, BrightnessContrastEffect, NoiseEffect,
  type Effect, Pass, MaskPass, ClearMaskPass,
} from 'postprocessing';
import type { N8AOPostPass } from 'n8ao';
import { halfGodRaysMask, ldrOutputBuffer, quarterBloom } from '../render/lighterTargets';
import { installAoTransparency } from '../render/aoTransparency';
import { protectDisplayColour, protectDisplayColourAo } from '../render/displayColour';
import { retried } from '../boot/retry';
import { RegionCinematic } from '../render/regionCinematic';
import { prepareWorldLook, CINEMATIC_FX, ENGINE_CHAIN_TUNING, type EngineChainKind, type EngineEffects, type LookComposition, type LookStrategy, type ReplaceLook } from '../render/look';
import { resolveTierKnobs, type LevelSpec, type TierKnobs } from '../../../shared/engine/level/spec';
import { installAtmosphere } from '../world/Atmosphere';
import { installFogPatch } from '../render/fogPatches';
import { setAnisotropy } from './assets';
import { SkyRig as Sky } from '../world/skyRig';
import type { BackdropLayer } from '../world/backdropLayer';
import { GradeEffect } from './Grade';
import { VolumetricsEffect, makeNoiseTexture } from './Volumetrics';
import { TIER, TIER_CONFIG, frameCapFps, gfxPrefs, setMobileFrameCap, type Tier } from './tier';
import { pacedSkip, slowGpuPacingFor, webglRendererName, type SlowGpuPacing } from './slowGpuPacing';
import { worldTime } from '../../../shared/engine/core/time';
import { installViewport, viewportHeight } from './viewport';
import { FIXED_STEP, MAX_FIXED_STEPS } from '../../../shared/engine/core/fixedStep';
import { SHADOW_LAYER } from './shadowLayer';
import { WorldRenderPass } from './worldDepth';
import { ownComposerDepth } from '../render/composerDepth';
import { noteDrawnEnvironment } from '../render/drawnEnvironment';
import { emitFault, makeSystem, setLoopState, systemFault, type GameSystem } from '../../../shared/engine/core/faults';
import { frameCost } from '../../../shared/engine/core/frameCost';
import { sustainedFrames } from './sustainedFrames';
import { diagnosticNow } from '../../../shared/engine/core/clock';
import { yieldTask } from '../../../shared/engine/core/workSlice';
import { buildHeld, heldDrawDeferred, noteFrameDrawn } from '../../../shared/engine/core/framePacing';
import { isDev, onDev } from './devMode';
import { activeDevPixels, drawingPixelRatio } from './devPixels';
import { RenderBudget, budgetCeiling } from './renderBudget';
import { graphicsMode, lowPowerOn, noteFastFrames, PIXELS_EVENT } from './graphicsMode';
import { flagOn, frameCapFor, noteShipped, presetLabel, setFrameReadout, type ShippedLook } from './graphicsQuality';
import { classifyFrames } from '../boot/lowPower';
import { boundEntryWarmup } from '../render/entryWarmupBound';
import { dropOutputDepth, installMemorySaver, shadowLights } from '../render/memorySaver';
import { dropShadowColour } from '../world/shadowVariants';
import { duringShadowPass } from '../world/cascadeCull';
import { recordGpuCheckpoint, traceBootPasses } from '../boot/gpuTrace';
import { exploreEntryPending, recordExploreFrame, recordBootCheckpoint, bootTraceActive } from '../boot/bootTrace';
import { cullPlaced } from '../models/place';
import { DrawCheck, hdrTargetType } from '../render/drawCheck';

/** the world's pace during a hit-stop (not 0: nothing downstream has to cope with a zero dt) */
const HIT_STOP_SCALE = 0.04;
/** the frame cap's tolerance for vsync timestamp jitter (see Game.start) */
const FRAME_CAP_SLACK_MS = 4;
/**
 * The frame cap's decision for one animation frame (Game.start's loop): `null` while the next capped frame is not yet
 * due, else the cadence anchor to keep once this frame draws. A frame on time anchors at its own timestamp, as before. A
 * frame drawn late (op-hitch48: a task held the main thread past its vsync) is drawn in its own slot: the anchor stays at
 * `lastDrawn + 1/cap`, so the next frame is due on the old cadence instead of a whole vsync later too: one late frame,
 * never a late frame and a slow one. The anchor stays within 1/cap - slack - one 60 Hz vsync (- 0.5 ms) of `t`, 12 ms
 * at a 30 fps capture cap and nothing at 60, so the next frame can never land on the very next 60 Hz vsync (no
 * 30 <-> 60 judder), and a long stall simply resyncs.
 */
export function frameCapAnchor(lastDrawn: number, t: number, cap: number): number | null {
  const step = 1000 / cap, since = t - lastDrawn;
  if (since < step - FRAME_CAP_SLACK_MS) return null;
  if (since <= step + FRAME_CAP_SLACK_MS || !Number.isFinite(lastDrawn)) return t;
  return Math.max(lastDrawn + step, t - Math.max(0, step - FRAME_CAP_SLACK_MS - 1000 / 60 - 0.5));
}
/** E153: the boot's warm-up draws of the world, one per quarter-turn (Game.warmTurn) */
const WARM_TURNS = 4;
/** LS8 (J188, J204): a first-frame slice whose fence took longer than this narrows every later slice to one new drawable,
 *  so a slow GPU (CI's SwiftShader at 4x CPU: 1.7-4.9 s for an eight-drawable slice of Driftwood) reports each pipeline
 *  build as it completes. A GPU the shaders step measured slow (`firstFrame`'s `narrow`) starts narrow instead: the slow
 *  slice that trips the fallback has already held the bar (Driftwood's fifth, two new materials, 2.3 s). */
const FIRST_DRAW_NARROW = { afterMs: 400, budget: { drawables: 1, newMaterials: 1, newBindings: 1, bufferBytes: 4_000_000 } } as const;
/** LS8 (J204, "weight steps by measured cost per kind"): one first-frame unit of each kind, in measured seconds, so the
 *  step's bar share follows where its time goes. Driftwood Isle, headless Chromium at 4x CPU (SwiftShader, the calibration
 *  profile of loadingPaths.ts), loading-card-proof --throttle --dump, 2026-11-09: 264 world drawables 41.8 s, 25 shadow
 *  maps 3.8 s, 5 views 0.96 s, 2 post passes 0.32 s. */
const FIRST_FRAME_SECONDS = { drawable: 0.158, shadowMap: 0.152, view: 0.192, postPass: 0.158, viewPart: 0.28, mapPart: 0.58 } as const;
/** LS11 (J204): on a GPU the shaders step measured slow, the first full view after the world's slices still cost one
 *  1.3-1.9 s GPU unit (Driftwood, SwiftShader at 4x CPU, fenced: the same programs and draws, 45 ms when drawn again), so
 *  the bar sat still through it. Drawn first as growing prefixes of its draw order, the units were 0.15-0.56 s each and the full
 *  view after them 42 ms. The opaque order takes `opaque` parts, then the transparent order `transparent` more: drawn as
 *  one part, the transparent tail (the ocean, the shrine pool, flames, particles) was 1.5 s at load 35 and 3.3 s at load
 *  60; in eight parts at load 15 they were 0.12-0.63 s, 2.27 s in all (`viewPart`). */
const FIRST_VIEW_PARTS = { opaque: 5, transparent: 3 } as const;
const FIRST_VIEW_UNITS = FIRST_VIEW_PARTS.opaque + FIRST_VIEW_PARTS.transparent;
/** LS11 (J204): the first full shadow map of the first pose (the CSM's near cascade) was one 1.3-1.5 s unit at load 35-60
 *  (the four after it 0.3-0.6 s). On a GPU the shaders step measured slow it is drawn first as growing prefixes of its
 *  casters, each a fenced unit, the last being the map itself: in thirds at load 15 the two prefixes took 0.83 s and
 *  0.33 s (`mapPart`, the mean) and the whole map 0.47 s after them. */
const FIRST_MAP_PARTS = 4;
/** the three slots of one fixed step, in order: `pre` readies the world, `step` advances it, `post` moves against it */
export type FixedPhase = 'pre' | 'step' | 'post';

/**
 * E142 (the 30-fps-at-2× lane): the god rays' passes only while the sun can be in the picture. GodRaysEffect.update
 * copies the scene's depth at full size, draws the sun disc + halo into it (depth-tested), blurs that and marches the
 * rays toward the sun's screen point — every frame, though with the sun outside the view the mask is empty and the rays
 * are black, which the SCREEN blend leaves as the image. So: while the sun's bounds are outside the camera's frustum (or
 * it is hidden, or the rays are at 0), the passes are skipped and the rays' target is cleared once. The same picture;
 * −0.06…−0.15 ms on the M5 at 1206×2622 at the six E142 poses (the sun was out of view at all of them).
 */
function skipRaysOffscreen(rays: GodRaysEffect, camera: THREE.Camera, disc: THREE.Mesh): void {
  const update = rays.update.bind(rays);
  const frustum = new THREE.Frustum(), m = new THREE.Matrix4(), box = new THREE.Box3(), sphere = new THREE.Sphere(), v = new THREE.Vector3();
  const clearColor = new THREE.Color();
  const target: unknown = Reflect.get(rays, 'renderTargetB'); // the rays' output (`rays.texture`'s target; not in the typings)
  if (!(target instanceof THREE.WebGLRenderTarget)) return;
  let cleared = false;
  const inView = (): boolean => {
    if (!disc.visible || rays.blendMode.opacity.value <= 0) return false;
    // the disc's world bounds, and each child's (the halo sprite faces the camera: its half-diagonal around its centre)
    box.makeEmpty();
    disc.traverseVisible((o) => {
      if (o instanceof THREE.Sprite) {
        o.getWorldPosition(v);
        const e = o.matrixWorld.elements, r = Math.hypot(e[0], e[1], e[2]) * Math.SQRT1_2;
        box.expandByPoint(v.clone().addScalar(r)); box.expandByPoint(v.clone().addScalar(-r));
      } else box.expandByObject(o, false);
    });
    if (box.isEmpty()) return false;
    box.getBoundingSphere(sphere);
    frustum.setFromProjectionMatrix(m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    return frustum.intersectsSphere(sphere);
  };
  rays.update = (renderer, inputBuffer, deltaTime) => {
    if (inView()) { cleared = false; update(renderer, inputBuffer, deltaTime); return; }
    if (cleared) return;
    const prev = renderer.getRenderTarget(), alpha = renderer.getClearAlpha();
    renderer.getClearColor(clearColor);
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.setClearColor(clearColor, alpha);
    renderer.setRenderTarget(prev);
    cleared = true;
  };
}

/**
 * An effect whose blend opacity is 0 composites nothing (every blend function mixes by it): its own offscreen passes
 * (`update`: the bloom's luminance and mip chain, the rays' light pass and blur, the volumetric march) wait until it shows
 * again, when its next update runs before the frame composites it. A look that grades in its own passes (Nalati's post
 * graph) keeps the engine chain at opacity 0: its census drew 12 renders a frame, 10 of them full-screen post passes.
 * D178 (G813): while `paused` (a held crossing view) its offscreen passes wait too, and it composites what it last drew:
 * the opacity, and so every program key, stays as it was.
 */
function skipWhileTransparent(effect: Effect, paused: () => boolean): void {
  const update = effect.update.bind(effect);
  effect.update = (renderer, inputBuffer, deltaTime) => { if (effect.blendMode.opacity.value > 0 && !paused()) update(renderer, inputBuffer, deltaTime); };
}

/** D188 (G815): where a crossing reveals the player (render space) and how far round it the entry prepares first. */
interface EntryArrival { readonly at: THREE.Vector3; readonly radius: number }
/** D188: the arrival's radius, the held view's draw range (D175, G813): what the player sees from the entry is drawn
 *  before the reveal; beyond it, content waits for the after-reveal warm-up. */
const ARRIVAL_RADIUS = 125;

/** one engine colour chain, built (Game.buildComposer): its effects, in order, and by name */
interface BuiltChain { clean: boolean; order: Effect[]; fx: Omit<EngineEffects, 'order'> }

/** An entered frame's preparation trace (`Game.entryPreparation`): its destination root, owner, running phase, measured
 *  work counts and scalar timings. A named type, so consumers of the emitted declarations see it (a private field's type
 *  is not emitted). */
export interface EntryPreparation {
  root: string; owner: string; completed: boolean; phase: string;
  progress: { done: number; total: number; detail: string } | null;
  stages: { phase: string; elapsedMs: number; units: number; endAt: number }[];
  /** D196: the stage a warm-up stall ended the wait in (the entry revealed with what had linked), else absent */
  stalled?: string;
}

export class Game {
  private readonly frameDrawRanges: FrameDrawRanges = new FrameDrawRanges();
  /** D178: whether this frame draws a held view (an enabled frame draw range): the post chain's offscreen work pauses. */
  private postHeld = false;
  /** Limit distant ordinary draws only during live presentation; the owning
   * caller enables its range while waiting and disables it before playing. */
  bindFrameDrawRange(owner: Scope, distance: number): FrameDrawRange { return this.frameDrawRanges.bind(owner, distance); }
  /** Hidden owned roots skip only ordinary frame matrix walks. Explicit CPU,
   * offscreen and visible-frame updates retain their original methods. */
  bindHiddenFrameRoot(owner: Scope, root: THREE.Object3D): void { this.frameDrawRanges.trackHiddenRoot(owner, root); }
  readonly app: typeof app = app;
  renderer: Renderer;
  /** The page's one rendered scene: the render pass, AO, shadows, the sky and the leak census read this root. */
  readonly rootScene: THREE.Scene = new THREE.Scene();
  private readonly sceneFrames: { scene: THREE.Scene }[] = [];
  /**
   * Where frame-local content goes: the root scene, or the scene subtree of the regional frame the traveller is in
   * (`bindScene`). Content code adds to `game.scene`; it never needs to know which frame it was built in.
   */
  get scene(): THREE.Scene { return this.sceneFrames.at(-1)?.scene ?? this.rootScene; }
  /**
   * While `entered` lives (or until the returned leave), `scene` resolves to `frame`, a subtree of the root scene placed
   * at the region's render offset, so a region's content draws in place under the one renderer, camera and sky (the
   * same stack model as `App.bindWater` and `LevelFrameBinding`). The root keeps rendering; nothing else changes.
   */
  bindScene(frame: THREE.Scene, entered: Scope): () => void {
    if (entered.disposed) throw new Error('Cannot bind a scene frame to a disposed scope');
    if (frame === this.rootScene) throw new Error('The root scene is not a frame');
    const entry = { scene: frame }; this.sceneFrames.push(entry);
    let forget: () => void = () => undefined;
    const leave = (): void => {
      forget();
      const index = this.sceneFrames.indexOf(entry);
      if (index !== -1) this.sceneFrames.splice(index, 1);
    };
    forget = entered.capture('disposers', leave);
    return leave;
  }
  camera: THREE.PerspectiveCamera;
  readonly viewmodel: ViewmodelRoot;
  private _composer: EffectComposer | null = null;
  private compositionChanged = true;
  private readonly compositionObservers = new Set<(bytes: number) => void>();
  /** A budget owner reads actual allocated composer targets after warm-up and resize, without owning the renderer. */
  observeComposerAllocation(read: (bytes: number) => void): () => void {
    if (this._composer === null) throw new Error('Composer allocation observed before build');
    read(this.composerAllocationResources().reduce((sum, row) => sum + row.bytes, 0));
    this.compositionObservers.add(read);
    const scope = this.engineScope.child('composer.allocation');
    scope.onDispose(() => { this.compositionObservers.delete(read); });
    this.levelScope.onDispose(() => { queueMicrotask(() => {
      // All synchronous resource disposers finish first; a retired observer cannot write into another lifetime.
      if (!scope.disposed && this._composer !== null) read(this.composerAllocationResources().reduce((sum, row) => sum + row.bytes, 0));
    }); });
    return () => { scope.dispose(); };
  }
  /** Actual composer target handles and its drawn shared fullscreen attributes. Read-only identities let an
   * independent WebGL census reconcile nested bloom targets without relying on resource names. */
  composerAllocationResources(): readonly ResourceAllocation[] {
    if (this._composer === null) return [];
    const rows = [...composerAllocations(this._composer, this.renderer)];
    // postprocessing shares this one triangle across all passes. Only charge it after this renderer drew it.
    const geometry: unknown = Reflect.get(Pass, 'fullscreenGeometry');
    if (geometry instanceof THREE.BufferGeometry && this.uploads.resources().has(geometry)) {
      rows.push(...cachedResourceAllocations(geometry).filter(row => row.kind === 'gpu'));
    }
    return rows;
  }
  private _sky: Sky | null = null;
  // oxlint-disable-next-line typescript/no-deprecated -- Clock→Timer changes getDelta semantics; migrate separately
  clock: THREE.Clock = new THREE.Clock();
  // Frame phases (PHYSICS P2 / ENGINE-FIT E2): input → fixed steps (pre → step → post, × 0‥3) → update (`onUpdate`) → late → render.
  // Every entry is a GameSystem (src/shared/engine/core/faults.ts, E133): called inside its own try/catch, switched off if it keeps throwing.
  readonly engineScope: Scope = app.engineScope.child('game');
  readonly levelScope: Scope = currentOwner() ?? new Scope('level');
  /** Original player/camera lifetime; scoped world facades cannot replace it with a regional lifetime. */
  readonly playerScope: Scope = this.levelScope;
  get tier(): Tier { return TIER; }
  private ownership: SceneOwnership | null = null;
  private readonly uploads = new UploadOwnership(this.levelScope, app.assets);
  readonly leakBaseline: Scope['census'] = new Scope('baseline').census;
  hudBaseline = 0;
  hudRetained: ReadonlySet<Element> = new Set();
  retainedHudCount(): number {
    return [...document.querySelectorAll('#hud *')].filter((node) => {
      const owner = this.app.ui.hud.ownerOf(node);
      return this.hudRetained.has(node) || (owner !== null && !owner.belongsTo(this.levelScope));
    }).length;
  }
  /** Snapshot the engine rig before any level geometry is built. */
  retainEngineScene(): void {
    this.ownership = new SceneOwnership(this.rootScene, this.levelScope, this.app.assets);
    this.ownership.retain(this.rootScene);
  }
  captureLevelResources(): void { this.ownership?.retainContainer(this._composer, this.engineScope); this.ownership?.capture(); }
  retainKitResources(): void {
    this.ownership?.retain(this.camera);
    this.ownership?.retainContainer(this._composer, this.engineScope);
    this.ownership?.retainContainer(this._sky);
  }
  retainedSceneObjects(): number { return this.ownership?.retainedNodeCount() ?? 0; }
  retainedGpuCounts(): { geometries: number; textures: number; programs: number } {
    const live = this.uploads.resources();
    const textures = new Set<unknown>(), programs = new Set<unknown>();
    let geometries = 0;
    for (const resource of new Set([...this.app.assets.retainedResources(), ...this.app.assets.acquiredResources()])) {
      if (resource instanceof THREE.BufferGeometry && live.has(resource)) geometries++;
      const value: unknown = this.renderer.properties.get(resource);
      if (typeof value !== 'object' || value === null) continue;
      const props = value;
      if (resource instanceof THREE.Texture) {
        const texture: unknown = Reflect.get(props, '__webglTexture'); if (texture !== undefined) textures.add(texture);
      }
      // X22: a retained render target's attachments are retained textures too (three counts each in info.memory.textures);
      // counting only Texture resources charged every page-level target to the level as a leak (12 phone / 20 desktop)
      if (resource instanceof THREE.WebGLRenderTarget) {
        const colour: unknown = Reflect.get(resource, 'textures'), depth: unknown = Reflect.get(resource, 'depthTexture'), attachments: unknown[] = [depth];
        if (Array.isArray(colour)) for (let i = 0; i < colour.length; i++) { const item: unknown = Reflect.get(colour, i); attachments.push(item); }
        for (const attachment of attachments) {
          const state: unknown = attachment instanceof THREE.Texture ? this.renderer.properties.get(attachment) : null;
          const texture: unknown = typeof state === 'object' && state !== null ? Reflect.get(state, '__webglTexture') : undefined;
          if (texture !== undefined) textures.add(texture);
        }
      }
      if (resource instanceof THREE.Material) {
        const compiled: unknown = Reflect.get(props, 'programs');
        if (compiled instanceof Map) for (const program of compiled.values()) programs.add(program);
      }
    }
    return { geometries, textures: textures.size, programs: programs.size };
  }
  gpuResourceDiagnostics(): object {
    const retained = new Set<object>([...this.app.assets.retainedResources(), ...this.app.assets.acquiredResources()]);
    const live = this.uploads.resources();
    const read = (value: unknown, key: string): unknown => typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
    return { total: { ...this.renderer.info.memory, programs: this.renderer.info.programs?.length ?? 0 },
      // SF57: the live unowned uploads and those collected without a dispose (UploadOwnership.orphanCensus)
      orphans: this.uploads.orphanCensus(),
      retained: this.retainedGpuCounts(), resources: [...live].map((resource) => {
        const props: unknown = this.renderer.properties.get(resource);
        const compiled = read(props, 'programs'), source = read(resource, 'source'), image = read(source, 'data');
        const owner = sceneResourceOwner(resource);
        return { type: resource.constructor.name, uuid: read(resource, 'uuid'), name: read(resource, 'name'),
          owner: owner === null ? null : { name: owner.name, disposed: owner.disposed, level: owner.belongsTo(this.levelScope) },
          retained: retained.has(resource), texture: read(props, '__webglTexture') !== undefined,
          programs: compiled instanceof Map ? [...compiled.values()].map((p: unknown) => read(p, 'id')) : [],
          source: read(source, 'uuid'), image: { width: read(image, 'width'), height: read(image, 'height'), src: read(image, 'src') },
          allocation: read(resource, '__f8Allocation') };
      }) };
  }
  unloadLevel(): void {
    if (this.levelScope.disposed) return;
    this.captureLevelResources();
    this.app.setState('loading');
    this.frameGate = () => false;
    this.levelScope.dispose();
    this.app.events.emit('level.unloaded', { id: this.levelId });
  }
  registrationScope: Scope = this.engineScope;
  private readonly fixed: Record<FixedPhase, Phase> = { pre: 'fixed.pre', step: 'fixed.step', post: 'fixed.post' };
  /** SF57: each live system's fault record, keyed by the app's own system row, so a retired world's systems (and the closures
   *  they hold) go with their row; a re-registered id starts a fresh record. */
  private readonly faultSystems = new WeakMap<object, GameSystem<(dt: number, t: number) => void>>();
  private anonymous = 0;
  /** E357 F2: list order is the execution order; observation never registers a system. */
  systemLabels(): Record<'input' | 'fixed.pre' | 'fixed.step' | 'fixed.post' | 'update' | 'late', string[]> {
    const phases = this.app.systemsByPhase();
    return {
      input: phases.input.map((s) => s.id),
      'fixed.pre': phases['fixed.pre'].map((s) => s.id),
      'fixed.step': phases['fixed.step'].map((s) => s.id),
      'fixed.post': phases['fixed.post'].map((s) => s.id),
      update: phases.update.map((s) => s.id),
      late: phases.late.map((s) => s.id),
    };
  }
  levelSystemIds(): string[] { return this.app.systemIds(this.levelScope); }
  /** The bootstrap boundary: everything registered next belongs to the level. */
  beginLevelSystems(): void {
    this.app.cpu.bind(this.levelScope, this.levelId);
    this.registrationScope = this.levelScope; this.app.levelScope = this.levelScope;
    enterOwner(this.levelScope);
  }
  /** the sky + the draw: core (a throw there that repeats is fatal, faults.ts) */
  private readonly renderSystem = makeSystem(null, 'render', true, 'render');
  /** frames drawn since start() (the fault streak counts in these) */
  private frameNo = 0;
  /** true once a core system died (faults.ts 'fatal'): the loop stops; the fatal modal is up */
  dead = false;
  private fixedAcc = 0;
  private firstFixedStep = true;
  /** 0‥1: how far this frame's render sits past the last fixed step (interpolate anything the fixed step moves) */
  alpha = 0;
  /** fixed steps run this frame (hit-stop does not change simulation time) */
  fixedSteps = 0;
  stats = { fps: 0, frames: 0, acc: 0 };
  /** last 120 frame times in ms (ring; `frameI` is the next slot) — the perf meter reads p50/p95 from it */
  frameMs: Float32Array<ArrayBuffer> = new Float32Array(120); frameI = 0;
  /** the same frames' main-thread time in ms (input → the frame submitted), slot for slot with `frameMs` (src/client/engine/ui/perfProbe.ts) */
  workMs: Float32Array<ArrayBuffer> = new Float32Array(120);
  /** …of which the game logic (input → fixed steps → updaters → late) and the draw's CPU side (sky + composer.render) */
  updateMs: Float32Array<ArrayBuffer> = new Float32Array(120); renderMs: Float32Array<ArrayBuffer> = new Float32Array(120);
  /** frames drawn since start() */
  frameCount = 0;
  /** QA 2026-11-13 row 6: two reads after the first frames that make a world drawing nothing loud (render/drawCheck.ts) */
  private readonly drawCheck = new DrawCheck({
    renderer: { getContext: () => this.renderer.getContext(), getRenderTarget: () => this.renderer.getRenderTarget(), setRenderTarget: (t) => { this.renderer.setRenderTarget(t); } },
    target: () => { const t: unknown = this._composer === null ? null : Reflect.get(this._composer, 'inputBuffer'); return t instanceof THREE.WebGLRenderTarget ? t : null; },
    report: (error, certain) => { emitFault({ system: 'render.blank', error, verdict: certain ? 'fatal' : 'uncaught' }); },
  });
  /** Browser rAF timestamp of the last completed draw; null for the initial synchronous draw.
   * Cadence reads this delivered-frame clock; callback-start work and polling use separate clocks. */
  frameRafTime: number | null = null;
  /** E357 F2: simulation time observed only on a drawn frame; the wall clock still runs behind menus. */
  private _frameTime = 0;
  get frameTime(): number { return this._frameTime; }
  /** draw calls / triangles of the last whole frame (all composer passes) */
  lastFrame = { calls: 0, triangles: 0 };
  /** WebGL context loss bookkeeping (iOS drops the context in the background); the perf meter shows it */
  gl = { lostAt: 0, restoredAt: 0, events: 0 };
  /** Return false to skip a whole frame (updaters + render): a menu covering the canvas, a still title on a phone. */
  private gate: () => boolean = () => true;
  get frameGate(): () => boolean { return this.gate; }
  set frameGate(gate: () => boolean) { this.gate=gate;pagePresentation.refresh();this.kickLoop(); }
  /** GPU recovery (src/client/engine/core/GpuRecovery.ts): true while the WebGL context is lost or being rebuilt — no tick, no draw, not even a forced frame */
  hold = false;
  /** Re-evaluate presentation after input or ownership changes; a covered world remains parked. Set by start(). */
  kickLoop: () => void = () => undefined;
  /** Request a fresh frame on the next playable turn; covered/hidden worlds stay parked.
   * Explicit, counted loader/title warm-up uses hiddenFrame instead. */
  primeFrame: () => void = () => undefined;
  /**
   * FC2 (frame cost: nothing drawn behind the loader): ONE whole frame (the systems' step and the draw) now, in this task,
   * even with the gate shut. The loader pays the first world frame and its ready frame with it under the opaque card,
   * instead of free-running world frames behind it.
   */
  hiddenFrame: () => void = () => undefined;
  /**
   * The first frame's view without its draw: ONE systems step and the view's preparation (the player's eye and FOV on the
   * camera, the shard's per-frame look, placed copies culled for the view) now, even with the gate shut and before
   * start(). Until the first step the camera stands at the origin, so a boot warm-up taken after this links what the
   * next frame draws. Nothing is drawn, and the loop itself still starts parked in start().
   */
  stepFrame(): void {
    if (this.dead || pagePresentation.state === 'hidden') return;
    const frame = this.pageFrame();
    this.stepOnly = true;
    try { frame.draw(undefined, true); } finally { this.stepOnly = false; }
  }
  private stepOnly = false;
  /** FC2: one draw of the world into the composer's input buffer (the real formats, nothing presented): what a live frame
   *  would build, upload and link, without a frame on screen. False when there is no composer target yet. */
  offscreenDraw(): boolean {
    const target: unknown = Reflect.get(this.composer, 'inputBuffer');
    if (!(target instanceof THREE.WebGLRenderTarget)) return false;
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    try { this.renderer.render(this.rootScene, this.camera); }
    finally { this.renderer.setRenderTarget(prev); }
    return true;
  }
  private captures: { maxW: number; resolve: (c: HTMLCanvasElement) => void }[] = [];
  /** A copy of the next rendered frame, at most `maxW` px wide (the review inbox's screenshot, src/client/engine/ui/Feedback.ts). The drawing
   *  buffer is not preserved, so the copy is taken in the same task as composer.render(); it resolves on the next frame drawn. */
  captureFrame(maxW: number): Promise<HTMLCanvasElement> { return new Promise((resolve) => { this.captures.push({ maxW, resolve }); }); }
  private flushCaptures(): void {
    const src = this.canvas;
    for (const { maxW, resolve } of this.captures.splice(0)) {
      const k = Math.min(1, maxW / Math.max(1, src.width));
      const c = document.createElement('canvas'); c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
      c.getContext('2d')?.drawImage(src, 0, 0, c.width, c.height);
      resolve(c);
    }
  }
  /**
   * A small still of the world as it stands, now: one frame rendered and copied in the same task (the drawing buffer
   * is not preserved). The app-switch resume screen's backdrop, taken as the page hides (E61, GpuRecovery.ts). Null
   * before the composer exists or on a dead context.
   */
  /** A shard's per-frame render uniforms, re-read for the camera as it stands now: a render outside the loop from a
   *  moved camera (Model Explorer's catalog thumbnail) must call it first. Nine Dragon's silk fog is measured from the
   *  camera `frame()` saw, so a thumbnail fogged from the turntable's eye came out a white silhouette (E289). */
  shardFrame(): void { this.camera.updateMatrixWorld(); this.lookStrategy?.frame?.(0, this.clock.elapsedTime); }

  /** The official map bake's world-height override, independent of scene material families.
   * The caller owns disposal; ordinary frames never instantiate this capture-only material. */
  captureHeightMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        vertexShader: 'varying float vH; void main(){ vec4 p = vec4(position, 1.0);\n#ifdef USE_INSTANCING\n p = instanceMatrix * p;\n#endif\n vec4 w = modelMatrix * p; vH = w.y; gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: 'varying float vH; void main(){ float v = clamp((vH + 100.0) / 400.0, 0.0, 1.0) * 65535.0; gl_FragColor = vec4(floor(v / 256.0) / 255.0, mod(floor(v), 256.0) / 255.0, 1.0, 1.0); }',
      side: THREE.DoubleSide, toneMapped: false,
    });
  }

  snapshot(maxW: number): HTMLCanvasElement | null {
    if (this._composer === null || this.hold || this.renderer.getContext().isContextLost()) return null;
    this.lookStrategy?.frame?.(0, this.clock.elapsedTime);
    this._composer.render(0);
    const src = this.canvas, k = Math.min(1, maxW / Math.max(1, src.width));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(src.width * k)); c.height = Math.max(1, Math.round(src.height * k));
    c.getContext('2d')?.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }
  private renderPass!: RenderPass;
  volumetrics!: VolumetricsEffect;
  /** runtime handles on the colour chain (set by buildComposer) — the day/night clock + weather retune them */
  post: { grade: GradeEffect; saturation: HueSaturationEffect; contrast: BrightnessContrastEffect; bloom: BloomEffect; vignette: VignetteEffect; rays: GodRaysEffect | null; /** the AO pass (null: the tier or level draws none) */ ao: N8AOPostPass | null; tone: ToneMappingEffect } | null = null;
  /** the post chain — set by buildComposer(); resize() and the loop hold the nullable field directly */
  get composer(): EffectComposer { if (this._composer === null) throw new Error('Game.composer read before buildComposer()'); return this._composer; }
  /** whether buildComposer() has run (an early scene-only shader pass runs before it, DL10) */
  get composerBuilt(): boolean { return this._composer !== null; }
  /** the sky — set by buildSky() */
  get sky(): Sky { if (this._sky === null) throw new Error('Game.sky read before buildSky()'); return this._sky; }

  readonly level: LevelSpec;
  public canvas: HTMLCanvasElement;
  constructor(canvas: HTMLCanvasElement, context: WebGL2RenderingContext, level: LevelSpec) {
    installBrowserScopeEnvironment({ Mesh: THREE.Mesh, InstancedMesh: THREE.InstancedMesh });
    this.canvas = canvas;
    this.level = level;
    this.app.scene = this.rootScene;
    this.app.render = this;
    enterOwner(this.engineScope);
    installAtmosphere(level.atmosphere); // the engine fog (slot 100); a level look's own fog (LookStrategy.fog, slot 300) installs in buildSky, before anything compiles
    installViewport(); // --ws-vh: the real height (an iOS home-screen app reports innerHeight a status bar short — viewport.ts)
    const tracedBoot = bootTraceActive();
    if (tracedBoot) recordBootCheckpoint('renderer:before', { userAgent: navigator.userAgent.slice(0, 250), devicePixelRatio: window.devicePixelRatio });
    try {
      this.renderer = createRenderer(canvas, context, { assets: app.assets, scope: this.engineScope, uploads: this.uploads });
    } catch (error) {
      if (tracedBoot) recordBootCheckpoint('renderer:failed', { message: error instanceof Error ? error.message.slice(0, 250) : String(error).slice(0, 250) });
      throw error;
    }
    if (tracedBoot) recordGpuCheckpoint(this.renderer, 'renderer:created');
    // QA row 25 / MG2: a Developer's screen × density pick (core/devPixels.ts), else a phone's Low graphics
    // (core/graphicsMode.ts), stands in for the tier's cap; either applies live
    this.renderer.setPixelRatio(this.wantedRatio());
    // the new ratio waits for the frame that draws (RT3: never in the task that decided it, whose cleared canvas nothing
    // would replace; under a menu or the title the world stays as it was until play draws again)
    const repixel = (): void => { const ratio = this.wantedRatio(); this.pickedRatio = ratio === this.renderer.getPixelRatio() ? null : ratio; this.applyQuality(); };
    this.engineScope.listen(document, PIXELS_EVENT, repixel);
    // MG8 prototype: the player has control, so the boot's shadow draws are done: a no-shadows mode clears the maps once more
    this.engineScope.listen(document, 'ws:control-ready', () => { this.qualityClearedMaps = new WeakSet(); });
    // MG12 prototype: the phone's cap follows the preset and Low Power live (60 only on exactly Low with Low Power off); read
    // off a cached value, refreshed on every PIXELS_EVENT (a control, a preset, a Low Power flip) and the 2 s mode check
    if (this.phoneGraphics) this.engineScope.onDispose(setMobileFrameCap(() => this.qualityCap));
    // MG8 prototype: Settings ▸ Graphics' frame readout (fps over the last half second, the median and slow frames, draws)
    this.engineScope.onDispose(setFrameReadout(() => {
      const ms = [...this.frameMs].filter((v) => v > 0).sort((a, b) => a - b);
      if (ms.length === 0) return '';
      const at = (q: number): number => ms[Math.min(ms.length - 1, Math.floor(ms.length * q))] ?? 0;
      // the cap is the one in force now; the rest is the play before this menu opened (a menu over the world holds its frames)
      const cap = frameCapFps();
      return `Cap now ${cap > 0 ? `${String(cap)} fps` : 'none'}. Last play: ${String(this.stats.fps)} fps · frame ${at(0.5).toFixed(1)} ms, slow ${at(0.95).toFixed(1)} ms · ${String(this.lastFrame.calls)} draws`;
    }));
    // MG3: Low Power Mode is switched in the phone's own settings, away from the page. As the page comes back it counts a second
    // of its frames: faster than 30 Hz proves Low Power off (a busy page cannot prove it on: the idle title reads that). The
    // reading itself lands, lapses or flips on its own clock, so the mode in force is compared every two seconds, and a
    // change tells the page (Settings, the first-play card) and lands in the next drawn frame
    this.engineScope.listen(document, 'visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      const stamps: number[] = [];
      const tick = (now: number): void => {
        if (this.engineScope.disposed || document.visibilityState !== 'visible') return;
        stamps.push(now);
        if (now - (stamps[0] ?? now) < 1000) { this.engineScope.raf(tick); return; }
        const frames = classifyFrames(stamps);
        if (frames !== null && !frames.slow) noteFastFrames();
      };
      this.engineScope.raf(tick); repixel();
    });
    let mode = graphicsMode();
    this.engineScope.interval(2000, () => {
      this.qualityCap = this.phoneGraphics ? frameCapFor(presetLabel(), lowPowerOn()) : 30;
      const now = graphicsMode();
      if (now !== mode) { mode = now; document.dispatchEvent(new CustomEvent(PIXELS_EVENT)); }
    });
    this.engineScope.onDispose(onDev(repixel));
    this.renderer.setSize(window.innerWidth, viewportHeight());
    this.renderer.toneMapping = THREE.NoToneMapping; // tone mapping happens in the composer
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // r186 removed PCFSoft: it renders PCF anyway, and the type is in every program's cache key
    setAnisotropy(this.renderer);
    installMemorySaver(this.renderer); // SF22d
    // shadow-only casters (shadowLayer.ts): the shadow pass tests layers against the view camera, so the view camera sees
    // SHADOW_LAYER while — and only while — the shadow maps draw. Before this the cabins' depth proxies (PLAY-PERF lever
    // 12, 46868b5) were never drawn: the cabins cast no wall / roof shadow at all.
    const shadowMap = this.renderer.shadowMap, renderShadows = shadowMap.render.bind(shadowMap);
    // D107: one pass's arguments ride in these slots, so the shadow pass makes no closure a frame
    type ShadowArgs = Parameters<typeof renderShadows>;
    let passLights: ShadowArgs[0] | null = null, passScene: ShadowArgs[1] | null = null, passCamera: ShadowArgs[2] | null = null;
    const drawShadows = (): void => { if (passLights !== null && passScene !== null && passCamera !== null) renderShadows(passLights, passScene, passCamera); };
    const dropColour = (rt: THREE.WebGLRenderTarget): void => { dropShadowColour(this.renderer, rt); };
    shadowMap.render = (lights, scene, camera) => {
      // MG8 prototype: Settings ▸ Graphics ▸ Shadows off clears each cascade once (a pass that draws nothing) and then draws
      // none: nothing is shadowed and the shadow pass costs nothing
      if (this.qualityShadowsOff) {
        // Codex review: track the maps cleared, not the calls (a parked draw's stand-in map, or a map three made anew, is not
        // the one a clear covered)
        const shadows: { needsUpdate: boolean; map: object | null }[] = [];
        for (const light of lights) { const shadow: unknown = Reflect.get(light, 'shadow'); if (shadow instanceof THREE.LightShadow) shadows.push(shadow as { needsUpdate: boolean; map: object | null }); }
        if (shadows.every((shadow) => shadow.map !== null && this.qualityClearedMaps.has(shadow.map))) return;
        const held = camera.layers.mask;
        for (const shadow of shadows) shadow.needsUpdate = true;
        camera.layers.disableAll();
        try { renderShadows(lights, scene, camera); } finally { camera.layers.mask = held; }
        for (const shadow of shadows) if (shadow.map !== null) this.qualityClearedMaps.add(shadow.map);
        return;
      }
      const mask = camera.layers.mask;
      camera.layers.enable(SHADOW_LAYER);
      passLights = lights; passScene = scene; passCamera = camera;
      try { duringShadowPass(drawShadows); } finally { camera.layers.mask = mask; passLights = null; passScene = null; passCamera = null; }
      shadowLights(lights, dropColour); // SF22d: three's maps keep their depth only
    };
    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, window.innerWidth / viewportHeight(), 0.08, 2600);
    this.viewmodel = new ViewmodelRoot();
    this.camera.add(this.viewmodel); this.rootScene.add(this.camera);
    this.engineScope.listen(window, 'resize', () => this.resize());
  }

  /** the shard's render strategy (ShardManifest.render), loaded by buildSky; null = the engine's chain as it is */
  private lookStrategy: LookStrategy | null = null;
  /** the shard's look strategy once buildSky has loaded it (its terrain painter and grass driver are read by Terrain / Grass) */
  get look(): LookStrategy | null { return this.lookStrategy; }
  private levelId = '';
  /** where the strategy put its passes (asked once, in buildComposer) */
  private composition: LookComposition | null = null;

  /** `detail` names each stage on the loading card as it starts (DL21: a cold Simulator card sat 1.2 s on the bare step). */
  async buildSky(detail?: (text: string) => void): Promise<Sky> {
    this.levelId = this.level.id;
    const loadLook = this.level.look;
    const render = loadLook === undefined ? null : retried(loadLook); // the render code downloads while the sky builds; buildComposer reads both
    if (render !== null) detail?.('render code');
    this.lookStrategy = await render;
    detail?.('sky and lighting');
    const fog = this.lookStrategy?.fog; // after installAtmosphere (the constructor), before the sky or anything compiles (01 §13.2: its slot)
    if (fog !== undefined) installFogPatch(`level.fog.${this.level.id}`, fog.order, fog.install, this.level.id);
    this._sky = await new Sky(this.rootScene, this.camera, this.renderer).build(this.lookStrategy, { level: this.level, tier: TIER, look: this.level.lookLayer ?? null }); // its lighting, shadows, backdrop and sky dressing
    this.levelScope.onDispose(() => { this.lookStrategy?.dispose?.(); this.lookStrategy = null; });
    detail?.('world look');
    await prepareWorldLook(this.lookStrategy, { renderer: this.renderer, sky: this._sky, scope: this.levelScope });
    return this._sky;
  }

  /**
   * The colour chain's pass: the engine's cinematic chain — or, with a shard render strategy, the order it composes from
   * the engine's chain (`c.engineChain('clean' | 'cinematic')`, built on its first ask) and its own effects, asked here,
   * once (ShardManifest.LookStrategy.compose).
   */
  private colourPass(composer: EffectComposer, engineChain: (kind: EngineChainKind) => BuiltChain, aa: Effect | null): { pass: EffectPass; merged: boolean } {
    // FC9: FXAA joins the colour pass, one full-frame pass fewer, where nothing in it is another convolution or moves UVs
    // (postprocessing allows one of either per pass and runs it first, on the pass's input: the lit frame before grading),
    // and only with no shard pass in the composer: around a shard's own passes (Nine's ink graph) the colour pass's input
    // is not the frame the player sees, and a merged FXAA left Nine's wires stair-stepped (art/frame-cost/round-3-fc9-fxaa)
    const pass = (effects: Effect[]): { pass: EffectPass; merged: boolean } => {
      const C = this.composition, shardPasses = C !== null && [C.beforeScene, C.afterScene, C.beforeChain, C.afterChain].some(passes => (passes?.length ?? 0) > 0);
      // G4: an empty chain (a shard's composite drew the frame into the composer's buffer) makes the FXAA pass the colour pass:
      // FXAA alone in it, on that frame, as its own pass would run
      const merged = aa !== null && (effects.length === 0 || !shardPasses && effects.every(effect => (effect.getAttributes() & EffectAttribute.CONVOLUTION) === 0 && !/\bmainUv\b/u.test(effect.getFragmentShader())));
      return { pass: new EffectPass(this.camera, ...(merged && aa !== null ? [aa, ...effects] : effects)), merged };
    };
    const R = this.lookStrategy;
    if (R === null || R.mode === 'replace') return pass(engineChain('cinematic').order); // a 'replace' look never reaches the engine chain (replaceComposer)
    const scope = this.levelScope.child('look');
    const asked: { built: BuiltChain | null } = { built: null };
    const pick = (kind: EngineChainKind): BuiltChain => (asked.built = engineChain(kind));
    if (R.chain !== undefined) pick(R.chain); // the declared kind first: a compose asking the other one throws
    this.composition = R.compose({
      app: this.app, scope, debug: { expose: (name, value) => { scope.onDispose(this.app.debug.scopedExpose(name, value)); } }, renderer: this.renderer, scene: this.rootScene, camera: this.camera, composer, tier: TIER,
      get fx(): EngineEffects { const b = asked.built ?? pick('cinematic'); return { ...b.fx, order: b.order }; },
      engineChain: (kind) => pick(kind).order,
    });
    return pass(this.composition.chain ?? (asked.built ?? pick('cinematic')).order);
  }

  /** the strategy's passes into their slots around the engine's (ShardManifest.LookComposition): scene → AO → colour → SMAA */
  private placeShardPasses(composer: EffectComposer, colour: EffectPass): void {
    const C = this.composition;
    if (C === null) return;
    const insert = (passes: Pass[] | undefined, at: number): void => { for (const [i, p] of (passes ?? []).entries()) composer.addPass(p, at + i); };
    insert(C.beforeChain, composer.passes.indexOf(colour));
    insert(C.afterChain, composer.passes.indexOf(colour) + 1);
    insert(C.afterScene, composer.passes.indexOf(this.renderPass) + 1);
    insert(C.beforeScene, 0);
  }

  private renderKnobs(): TierKnobs {
    const kit: TierKnobs = {};
    for (const schema of this.app.levelRegistrations.knobSchemas()) Object.assign(kit, schema.defaults);
    return resolveTierKnobs({ ao: TIER_CONFIG.ao, slices: false, warmTurns: WARM_TURNS }, kit, this.level.tiers, TIER);
  }

  /**
   * A `mode: 'replace'` look (01 §13.1): one composer (HalfFloat, `multisampling` from the tier's `msaa` knob, clamped to
   * the GPU's samples, 0 while anti-aliasing is off) holding exactly the passes the shard's compose returns, in order.
   */
  private replaceComposer(R: ReplaceLook): EffectComposer {
    const msaa = TIER_CONFIG.smaa === 'off' ? 0 : this.renderKnobs().msaa ?? 0;
    const composer = new EffectComposer(this.renderer, { frameBufferType: hdrTargetType(this.renderer), multisampling: Math.min(msaa, this.renderer.capabilities.maxSamples) });
    ownComposerDepth(composer);
    const scope = this.levelScope.child('look');
    const { chain } = R.compose({ app: this.app, scope, debug: { expose: (name, value) => { scope.onDispose(this.app.debug.scopedExpose(name, value)); } }, renderer: this.renderer, scene: this.rootScene, camera: this.camera, composer, tier: TIER });
    for (const p of chain) composer.addPass(p);
    return composer;
  }

  /** n8ao's pass, fetched by prepareComposer only when this tier and level draw AO (J8: a phone entry loads no AO code) */
  private aoPass: typeof N8AOPostPass | null = null;
  /** Load what buildComposer will build from: the AO module when the tier and level have AO on (null: never fetched). */
  async prepareComposer(): Promise<void> {
    if (this.lookStrategy?.mode === 'replace' || this.aoPass !== null || !(this.renderKnobs().ao ?? TIER_CONFIG.ao)) return;
    this.aoPass = (await import('n8ao')).N8AOPostPass;
  }

  buildComposer(): void {
    if (this.lookStrategy?.mode === 'replace') { this._composer = this.replaceComposer(this.lookStrategy); return; } // the level look's whole chain
    const { atmosphere: A } = this.level;
    const { grade: G, look } = this.app.gradeFor({ grade: this.level.grade, ...(this.level.lookLayer === undefined ? {} : { look: this.level.lookLayer }) }); // + the look loop's layer (PH-L1 / L4)
    const composer = new EffectComposer(this.renderer, { frameBufferType: hdrTargetType(this.renderer), multisampling: 0 });
    ownComposerDepth(composer);
    // the scene pass keeps the world's depth for the depth readers below (AO, the volumetric march, the god rays' sun mask):
    // the viewmodels' depth clear used to leave them the weapon alone (worldDepth.ts)
    // E142: on Pine Hollow's phone tier the viewmodels draw into near depth slices instead of clearing, so the world's
    // depth needs no mid-pass copy (worldDepth.ts)
    const knobs = this.renderKnobs();
    const slices = knobs.slices ?? false; // E142 / E189: a level's tier knob (its phone tier's `slices`)
    this.renderPass = new WorldRenderPass(this.rootScene, this.camera, composer, slices);
    composer.addPass(this.renderPass);

    let aoPass: N8AOPostPass | null = null;
    // A level's tier data can keep its compositor below the transient boot peak.
    if (knobs.ao ?? TIER_CONFIG.ao) {
      const AoPass = this.aoPass;
      if (AoPass === null) throw new Error('Game.buildComposer with AO on before prepareComposer()');
      const ao = new AoPass(this.rootScene, this.camera, window.innerWidth, viewportHeight());
      aoPass = ao;
      // a level's tier knobs may tune it (LF1-4: a shardfile look's `light.ao`)
      const aoRadius = knobs['ao.radius'], aoIntensity = knobs['ao.intensity'];
      ao.configuration.aoRadius = typeof aoRadius === 'number' ? aoRadius : 2.5;
      ao.configuration.distanceFalloff = 1.0;
      ao.configuration.intensity = typeof aoIntensity === 'number' ? aoIntensity : 2.5;
      ao.configuration.halfRes = true;
      ao.configuration.screenSpaceRadius = false;
      ao.configuration.gammaCorrection = false;
      ao.configuration.color = new THREE.Color(0.05, 0.06, 0.05);
      // its transparency pre-passes: without opaque multi-material meshes or depth-free transparents (PH-P2), and not at all
      // when nothing would draw in them (SF69, bit-identical) — aoTransparency.ts
      installAoTransparency(ao, this.rootScene, this.camera, { lean: () => this.aoLeanTransparency, skipEmpty: () => this.aoSkipEmptyTransparency });
      protectDisplayColourAo(ao);
      composer.addPass(ao);
    }

    const vol = new VolumetricsEffect(this.camera, makeNoiseTexture(), TIER_CONFIG.volumetricSteps, TIER_CONFIG.volumetricScale);
    vol.setSun(this.sky.sunDir, new THREE.Color(...A.volumetricSunColor));
    if (this.rootScene.fog) vol.setFogColor((this.rootScene.fog as THREE.Fog).color);
    if (A.volumetric) vol.setMedium(A.volumetric);
    this.volumetrics = vol;
    // the colour chain, built by a factory: an Effect belongs to one EffectPass, so each chain gets its own instances
    // the tier knobs `aa` and `godRays` (E189, Jake's picks from the before / after boards, progress/282–283, 2026-09-26:
    // "no regression"): a level's phone frame may run one FXAA pass on the graded frame instead of SMAA's three, and leave
    // out the god rays (the warm iPhone's grass frame was 48 ms with the post chain and 17 without)
    // G749 (Jake's pick of the G713 lighter render targets): anti-aliasing is one FXAA pass on the graded frame wherever the
    // tier or level has it on (SMAA's edge and weight targets are gone, E189's phone option for every tier)
    // FC9 / QB20: the phone frame runs no FXAA pass by default (a full 2x-frame read and write, ~47 % of Driftwood's post
    // GPU time); Settings ▸ Graphics ▸ Anti-aliasing On keeps the old look, and an explicit player choice beats a level's
    // MG8: on a phone, Settings ▸ Graphics ▸ Anti-aliasing replaces the boot-time AA pref, so High's AA is the level's own
    const levelAa = knobs.aa ?? (TIER === 'phone' || TIER_CONFIG.smaa === 'off' ? 'off' : 'fxaa');
    const shippedAa = this.phoneGraphics ? levelAa : gfxPrefs.aa === 'on' ? 'fxaa' : gfxPrefs.aa === 'off' ? 'off' : levelAa;
    // G945: the phone's engine chain keeps bloom off; desktop keeps its existing chain.
    this.qualityShipped = { bloom: TIER !== 'phone', rays: knobs.godRays ?? true, aa: shippedAa !== 'off' };
    noteShipped(this.qualityShipped);
    // MG8: on a phone, Settings ▸ Graphics' Bloom, Sun rays and Anti-aliasing decide what the chain holds (since a preset: as
    // shipped); a change rebuilds the chain live (applyQuality → rebuildComposer)
    const chainNow = this.qualityChainWanted();
    this.qualityChainBuilt = chainNow;
    const aa = chainNow.fxaa ? 'fxaa' : 'off';
    const fxaa = aa === 'off' ? null : new FXAAEffect();
    const raysOn = chainNow.rays;
    const bloomOn = chainNow.bloom;
    const chain = (clean: boolean): BuiltChain => {
      const godRays = new GodRaysEffect(this.camera, this.sky.sunDisc, {
        blendFunction: BlendFunction.SCREEN, kernelSize: KernelSize.MEDIUM, density: 0.96, decay: 0.95, weight: 0.5,
        exposure: 0.4, samples: TIER_CONFIG.godRaysSamples, clampMax: 1.0, resolutionScale: TIER_CONFIG.godRaysScale,
      });
      if (knobs.skipRaysOffscreen === true) skipRaysOffscreen(godRays, this.camera, this.sky.sunDisc); // the disc off screen = no rays to draw (E142, E189)
      halfGodRaysMask(godRays); // G749: the rays' light mask at half the frame (lighterTargets.ts)
      const tuning = ENGINE_CHAIN_TUNING[clean ? 'clean' : 'cinematic'];
      const bloom = new BloomEffect({ intensity: G.bloomIntensity, luminanceThreshold: G.bloomThreshold, luminanceSmoothing: tuning.bloomSmoothing, mipmapBlur: true, radius: 0.6, levels: TIER_CONFIG.bloomLevels });
      quarterBloom(bloom); // G749: luminance at a quarter of the frame, its mip chain one level smaller (lighterTargets.ts)
      const held = (): boolean => this.postHeld;
      skipWhileTransparent(bloom, held); skipWhileTransparent(godRays, held); skipWhileTransparent(vol, held);
      const vignette = new VignetteEffect({ offset: 0.32, darkness: tuning.vignette });
      const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
      const grade = new HueSaturationEffect({ saturation: G.saturation });
      const contrast = new BrightnessContrastEffect({ brightness: G.brightness, contrast: G.contrast });
      const split = new GradeEffect(G, look);
      if (!clean) this.grade = split;
      this.post = { grade: split, saturation: grade, contrast, bloom, vignette, rays: raysOn ? godRays : null, ao: aoPass, tone };
      if (!clean) {
        const chroma = new ChromaticAberrationEffect({ offset: new THREE.Vector2(CINEMATIC_FX.chroma, CINEMATIC_FX.chroma), radialModulation: true, modulationOffset: CINEMATIC_FX.chromaModulation });
        const grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: true });
        grain.blendMode.opacity.value = CINEMATIC_FX.grain;
        this.sky.attachPost({ vol, rays: godRays, hueSat: grade }); // Pine Hollow's clock (PH-L2) turns the shafts, the rays and the saturation with the hour; a fixed sky ignores it
        // a PBR shard's learned LUT (lut.ts, per shard — PINE-HOLLOW PH-L4) ends its grade, before the grain; no file = no
        // LUT, the chain as before
        const lut = this.sky.lut ? new LUT3DEffect(this.sky.lut, { inputColorSpace: THREE.SRGBColorSpace, tetrahedralInterpolation: true }) : null;
        // one EffectPass for the whole chain: one program and one full-screen pass fewer per frame
        const order: Effect[] = [vol, ...(raysOn ? [godRays] : []), ...(bloomOn ? [bloom] : []), chroma, vignette, tone, grade, contrast, split, ...(lut ? [lut] : []), grain];
        return { clean, order, fx: { ao: aoPass, vol, godRays, bloom, chroma, vignette, tone, saturation: grade, contrast, grade: split, lut, grain } };
      }
      // the clean look (DRIFTWOOD-REMASTER L5): no volumetric haze, grain or fringe washing the toon bands to low
      // contrast — the colour-ramp fog does the aerial perspective; the god rays stay faint, the vignette light
      godRays.blendMode.opacity.value = tuning.rays; // faint (ENGINE_CHAIN_TUNING): looking into a midday sun must not wash the sand and lagoon to white
      // bloom only what is really over 1.0 (the def's threshold): the sun, glints, glyphs, fireflies; the vignette light (both set above from the table)
      // the learned LUT (X1, src/client/engine/world/lut.ts) is the last grade step: the palette fitted to the mockups. Always on — the
      // user locked it in (E85); only Debug ▸ Look ▸ Learned LUT Off (the fit's own captures) builds without it
      const lut = this.sky.lut ? new LUT3DEffect(this.sky.lut, { inputColorSpace: THREE.SRGBColorSpace, tetrahedralInterpolation: true }) : null;
      const order: Effect[] = [...(raysOn ? [godRays] : []), ...(bloomOn ? [bloom] : []), vignette, tone, grade, contrast, split, ...(lut ? [lut] : [])];
      return { clean, order, fx: { ao: aoPass, vol, godRays, bloom, chroma: null, vignette, tone, saturation: grade, contrast, grade: split, lut, grain: null } };
    };
    // the level look picks the chain (a compose may ask the clean L5 chain, E88, the user's Look Lab pick); every other
    // level keeps the original haze + grain + fringe chain. One chain is built: its effects belong to one pass
    let built: BuiltChain | null = null;
    const { pass: colour, merged: fxaaMerged } = this.colourPass(composer, (kind) => {
      built ??= chain(kind === 'clean');
      if (built.clean !== (kind === 'clean')) throw new Error(`[look] the engine chain is already built '${built.clean ? 'clean' : 'cinematic'}'; a compose asks one kind, and reading c.fx before c.engineChain() builds 'cinematic', so a look that wants 'clean' asks c.engineChain('clean') first`);
      return built;
    }, TIER === 'phone' ? fxaa : null);
    protectDisplayColour(colour);
    composer.addPass(colour);
    this.placeShardPasses(composer, colour); // a shard's own passes around the engine's (none without a render strategy)
    // FXAA reads its pass's input image, so outside the phone's merged colour pass it gets a pass of its own on the graded
    // frame (EffectPass orders effects by kind)
    if (fxaa !== null && !fxaaMerged) composer.addPass(new EffectPass(this.camera, fxaa));
    // the depth slices: every depth reader reads the scene target's own depth texture (the world + the weapon, no copy)
    const sceneDepth = composer.inputBuffer.depthTexture;
    if (slices && sceneDepth !== null) for (const p of composer.passes) if (p !== this.renderPass) p.setDepthTexture(sceneDepth);
    dropOutputDepth(composer, this.renderPass); // SF22d: one composer depth buffer
    // G749: with nothing between the scene and the colour pass, the output buffer only ever holds the graded frame
    if (aoPass === null && composer.passes.indexOf(colour) === composer.passes.indexOf(this.renderPass) + 1) ldrOutputBuffer(composer);
    this._composer = composer;
    this.applyQuality();
  }

  /** MG12 prototype: the phone's frame cap in force (frameCapFor), cached for the loop */
  private qualityCap: 30 | 60 = 30;
  /** MG8 prototype: the shadows-off state (the shadow pass wrapper) and the cascade maps it has cleared */
  private qualityShadowsOff = false;
  private qualityClearedMaps = new WeakSet();
  /** what the level ships (bloom, rays, edges), and what the chain was last built with */
  private qualityShipped: ShippedLook = { bloom: TIER !== 'phone', rays: true, aa: false };
  private qualityChainBuilt: { bloom: boolean; rays: boolean; fxaa: boolean } | null = null;
  /** the chain the controls ask for now (off a phone: as shipped) */
  private qualityChainWanted(): { bloom: boolean; rays: boolean; fxaa: boolean } {
    const S = this.qualityShipped;
    if (!this.phoneGraphics) return { bloom: S.bloom, rays: S.rays, fxaa: S.aa };
    const mode = graphicsMode();
    return { bloom: flagOn('bloom', mode, S.bloom), rays: flagOn('rays', mode, S.rays), fxaa: flagOn('aa', mode, S.aa) };
  }
  /**
   * MG8 (meta MOBILE-GRAPHICS-PLAN MG8): Settings ▸ Graphics' controls, live, on a phone. Shadows through the wrapper above;
   * bloom, sun rays and anti-aliasing (FXAA) by rebuilding the colour chain when what it should hold changes (an effect in the
   * chain at opacity 0 still costs its composite; out of it, nothing). Pixel density follows through drawingPixelRatio. On
   * High every control is as shipped, so this changes nothing.
   */
  applyQuality(): void {
    if (!this.phoneGraphics) return;
    this.qualityCap = frameCapFor(presetLabel(), lowPowerOn());
    const mode = graphicsMode();
    // cleared again on every apply: the boot's own shadow draws (the loading card's parted map, the warm turns) fill the maps
    // outside this wrapper's frames, so a clear made before them would not hold (and control-ready clears once more)
    this.qualityShadowsOff = !flagOn('shadows', mode, true); this.qualityClearedMaps = new WeakSet();
    const composer = this._composer;
    if (composer === null) return;
    const want = this.qualityChainWanted(), built = this.qualityChainBuilt;
    if (built !== null && (want.bloom !== built.bloom || want.rays !== built.rays || want.fxaa !== built.fxaa)) { this.rebuildComposer(); return; }
    this.kickLoop();
  }
  /** MG8 prototype: the composer again, as the controls now ask (its buffers freed; its effects left to the GC: a look's LUT
   *  texture is the sky's, and Effect.dispose would free it) */
  private rebuildComposer(): void {
    const old = this._composer;
    if (old === null) return;
    this._composer = null;
    this.buildComposer();
    (this._composer as EffectComposer | null)?.setSize(window.innerWidth, viewportHeight());
    old.inputBuffer.dispose(); old.outputBuffer.dispose();
    this.compositionChanged = true;
    this.kickLoop();
  }

  /**
   * Every frame, after the fixed steps. `label` names the system in error reports (default: the function's name); `core`
   * marks one the game cannot run without — if it keeps throwing the loop stops and the fatal modal goes up, where any
   * other system is just switched off (src/shared/engine/core/faults.ts).
   */
  private register(phase: Phase, fn: (dt: number, t: number) => void, label?: string, core = false, scope = this.registrationScope, content = true): void {
    const id = label === 'main' ? 'main.frame' : label ?? `engine.core.callback.${String(this.anonymous++)}`;
    if (content) this.app.addContentSystem({ id, phase, run: fn, core }, scope);
    else this.app.addSystem({ id, phase, run: fn, core }, scope);
  }
  onUpdate(fn: (dt: number, t: number) => void, label?: string, core = false): void { this.register('update', fn, label, core); }
  /** One player-owned callback survives world-frame changes and ends with the original player scope. */
  onPlayerUpdate(fn: (dt: number, t: number) => void, label: string): void { this.register('update', fn, label, false, this.playerScope, false); }
  /** E357 F2: a temporary harness observer of simulation frames, removed when its walk finishes. */
  watchFrames(fn: (dt: number) => void): () => void {
    const scope = this.levelScope.child('observer');
    this.register('update', fn, 'harness.walk', false, scope, false);
    return () => { scope.dispose(); };
  }
  /** First in the frame: read controls into intents the fixed steps consume (the player's move, a queued jump). */
  onInput(fn: (dt: number) => void, label?: string, core = false): void { this.register('input', fn, label, core); }
  /** Once per fixed step (dt = FIXED_STEP), in phase order. */
  onFixed(phase: FixedPhase, fn: (dt: number) => void, label?: string, core = false): void { this.register(this.fixed[phase], fn, label, core); }
  /** After every updater: things that pose from this frame's final state (the camera from the interpolated player). */
  onLate(fn: (dt: number) => void, label?: string, core = false): void { this.register('late', fn, label, core); }

  /** a system threw (one try/catch per call, below): count it, report it; a core system that keeps failing stops the loop */
  private fault(s: GameSystem<unknown>, e: unknown): void {
    if (s.label !== 'engine.events') this.app.events.emit('fault', { source: s.label, message: e instanceof Error ? e.message : String(e), error: e });
    if (systemFault(s, e, this.frameNo, diagnosticNow()) === 'fatal' && !this.dead) { this.dead = true; this.app.setState('error'); setLoopState('dead'); }
  }
  /** (a method, not the field: the loop's early-out narrows `this.dead` to false for the rest of the frame) */
  private isDead(): boolean { return this.dead; }
  /** one fixed phase, each system guarded */
  private runPhase(phase: Phase, dt = FIXED_STEP, t = this.clock.elapsedTime): void {
    if (this.app.state === 'paused') return;
    const on = frameCost.on; // the dev fps panel's timing rows (src/shared/engine/core/frameCost.ts): one boolean read while it is closed
    for (const spec of this.app.systemsByPhase()[phase]) {
      let s = this.faultSystems.get(spec);
      if (!s) { s = makeSystem(spec.run, spec.id, spec.core ?? false, spec.id); this.faultSystems.set(spec, s); }
      if (!s.on) continue;
      let t0: number | undefined;
      try {
        // Predicates and schedule lookups belong to the same system as its run.
        // A bookkeeping refusal must not escape and skip the rest of the phase.
        if (spec.when && !spec.when(this.app)) continue;
        const scheduledDt = this.app.scheduler.systemDt(spec, dt);
        if (scheduledDt === 0 && spec.tick && spec.tick !== 'always') continue;
        if (on) t0 = diagnosticNow();
        spec.run(scheduledDt, t);
      } catch (e) { this.fault(s, e); }
      if (t0 !== undefined) frameCost.system(s.label, diagnosticNow() - t0);
    }
    this.flushEvents(phase);
  }
  private readonly eventSystem = makeSystem(null, 'engine.events', false, 'engine.events');
  private flushEvents(phase: Phase): void {
    try { this.app.events.flush(phase); } catch (error) { this.fault(this.eventSystem, error); }
  }

  /** Run the fixed steps owed by real time; hit-stop only scales presentation. */
  private runFixed(dt: number): void {
    if ('app' in this && this.app.state === 'paused') { this.fixedSteps = 0; return; }
    this.fixedAcc += dt;
    // Loading and the first minimap/UI paint are not simulation time. Start live physics with one tick,
    // even if the first eligible frame arrives late; deterministic capture retains its authored cadence.
    if (this.firstFixedStep && this.app.clock.mode !== 'capture' && this.fixedAcc >= FIXED_STEP) this.fixedAcc = FIXED_STEP;
    let n = 0;
    while (this.fixedAcc >= FIXED_STEP && n < MAX_FIXED_STEPS) {
      this.runPhase(this.fixed.pre);
      this.runPhase(this.fixed.step);
      this.runPhase(this.fixed.post);
      this.fixedAcc -= FIXED_STEP; n++;
    }
    if (n === MAX_FIXED_STEPS && this.fixedAcc >= FIXED_STEP) this.fixedAcc %= FIXED_STEP;
    this.alpha = this.fixedAcc / FIXED_STEP;
    this.fixedSteps = n;
    if (n > 0) this.firstFixedStep = false;
  }

  private stopLeft = 0;
  /** Visual hit-stop. Presentation reads worldTime.scale; gameplay keeps real deltas and clocks. */
  hitStop(seconds: number): void { this.stopLeft = Math.max(this.stopLeft, seconds); }
  /** skip n8ao's depth-free transparency pre-pass (buildComposer; PH-P2) — a live switch for A/B captures */
  aoLeanTransparency = true;
  /** skip both n8ao transparency pre-passes when nothing would draw in them (aoTransparency.ts; SF69) — a live switch for A/B captures */
  aoSkipEmptyTransparency = true;
  /**
   * A cinematic chain's shafts, fringe and grain for a page that runs another chain (`regionCinematic.ts`; the grid's frame);
   * where this page's own chain leaves its god rays out (its tier's `godRays: false`), god rays built as the chain builds its
   * own, for a region whose chain draws them (G321 part 5), their passes skipped while at 0 or with the sun out of view.
   */
  regionCinematic(): RegionCinematic {
    const rays = this.post?.rays === null ? new GodRaysEffect(this.camera, this.sky.sunDisc, {
      blendFunction: BlendFunction.SCREEN, kernelSize: KernelSize.MEDIUM, density: 0.96, decay: 0.95, weight: 0.5,
      exposure: 0.4, samples: TIER_CONFIG.godRaysSamples, clampMax: 1.0, resolutionScale: TIER_CONFIG.godRaysScale,
    }) : null;
    if (rays !== null) skipRaysOffscreen(rays, this.camera, this.sky.sunDisc);
    return new RegionCinematic(this.camera, this.renderer, TIER_CONFIG, rays);
  }
  /** the scene pass draws the viewmodels into the depth slices (E142): the scene target's own depth is the world's */
  get depthSlices(): boolean { return this.renderPass instanceof WorldRenderPass && this.renderPass.slices; }
  /** the PBR chain's split-tone / look grade (buildComposer; its uniforms are live — the look loop tunes them in place) */
  grade: GradeEffect | null = null;

  /**
   * Build every program the first frame would otherwise compile in one stall — the scene's
   * materials, the shadow-depth variants, the sky background and the post chain — with progress
   * (src/engine/boot/precompile.ts). Returns the distinct material count.
   */

  /** Warm an attached sky against the allocated composer's actual target before exposing it.
   * Before buildComposer, ordinary boot shader/first-frame stages own preparation; attachment
   * and its environment remain valid without reading the not-yet-created composer. */
  /** G639 frame floor: every attached sky layer's domes under the page's lights now (a grid crossing's settled lighting, a
   *  new cell PMREM): a layer prepared under another cell's lights linked its dome again on the road (Pine's sky dome, a
   *  524 ms desktop link at its first road frame). No shader change: the same programs, keyed by the lights they draw under. */
  async warmSkyLayers(): Promise<void> {
    if (this._sky === null) return;
    for (const layer of this._sky.attachedLayers()) {
      try { await this.warmSkyLayer(layer); } catch (error: unknown) { console.warn('[sky] layer warm-up stopped', error); }
    }
  }

  async warmSkyLayer(layer: Pick<BackdropLayer, 'prepare'>): Promise<void> {
    const composer = this._composer;
    if (composer === null) return;
    // A live page spaces the layer's links and uploads by drawn frames, as warmSceneRoots does (sp-o284).
    if (this.frameCount === 0) { await layer.prepare(this.renderer, this.camera, composer.inputBuffer); return; }
    const { waitForDrawnFrame, LIVE_UPLOAD_BUDGET } = await import('../render/precompile');
    const current = (): boolean => !this.levelScope.disposed && this._composer === composer;
    await layer.prepare(this.renderer, this.camera, composer.inputBuffer, () => waitForDrawnFrame(this.engineScope, () => this.frameCount, current),
      LIVE_UPLOAD_BUDGET);
  }

  /** Hide newly constructed models from this owner's asynchronous preparation until entry, on every browser.
   * The existing whole-world warm-up still sees them under the camera. Early boot has no live composer to draw.
   * The returned identity group is owned by the supplied scope. (sp-o6: unstaged on Chromium, a region's weapons built
   * mid-afterKit drew on the live camera between construction tasks, uploading their textures inside a travel frame,
   * the likely source of the Pine road's 200 ms draw-time upload of two 1024² bitmaps; staged, the warm-up uploads them.) */
  stageViewmodels(owner: Scope): THREE.Group | null {
    if (this._composer === null || this.frameCount === 0) return null;
    return this.viewmodel.stage(owner);
  }

  /** Prepare newly streamed roots before exposure, using the allocated composer target.
   * Early boot retains ordinary whole-world preparation. Streamed views share the entered-frame
   * owner lifetime, so retirement fences every pending draw and link. Opt-in geometry preparation
   * also first-draws connected, hidden roots through the native parked-draw path before exposure. */
  async warmSceneRoots(roots: readonly THREE.Object3D[], current: () => boolean, futureLighting?: THREE.Object3D,
    options?: { readonly drawGeometry: true }): Promise<void> {
    const composer = this._composer;
    // Ordinary streaming/equipment keeps its whole-world boot preparation.
    // Explicit geometry preparation may borrow an already allocated target.
    if (composer === null) {
      if (options?.drawGeometry === true) throw new Error('Streamed geometry needs a prepared composer');
      return;
    }
    if (this.frameCount === 0 && options?.drawGeometry !== true) return;
    const { prepareSceneRoots, waitForDrawnFrame, LIVE_UPLOAD_BUDGET } = await import('../render/precompile');
    await boundEntryWarmup(this.levelScope, async withinBound => {
      const live = (): boolean => withinBound() && current() && this._composer === composer;
      // Forced hidden loader draws also increment frameCount. Only the
      // opt-in geometry path distinguishes covered work from live draws;
      // existing shader-only callers keep their original barrier.
      const pause = options?.drawGeometry === true
        ? (): Promise<void> => this.frameCount > 0 && this.frameGate() && pagePresentation.state === 'play'
          ? waitForDrawnFrame(this.levelScope, () => this.frameCount, live) : yieldTask(this.levelScope)
        : this.frameCount > 0 ? () => waitForDrawnFrame(this.levelScope, () => this.frameCount, live) : undefined;
      // before play (no frame drawn yet) the boot's Shaders step builds what the first frame draws and the rest is warmed
      // in play: a region's own warm-up here keeps only its resources then
      // DL21: Developer splits a geometry warm into its prepare and its parked draws (the loader's step 27 runs one a slab
      // part, ~75 ms each on a cold Simulator, serialized)
      const timed = options?.drawGeometry === true && isDev(), started = timed ? diagnosticNow() : 0;
      await prepareSceneRoots(this.renderer, this.camera, this.rootScene, composer.inputBuffer, roots, live, pause,
        LIVE_UPLOAD_BUDGET, this.frameCount > 0 || options?.drawGeometry === true, futureLighting);
      if (timed) performance.measure('wildshard.warm.geometry-prepare', { start: started, end: diagnosticNow() });
      if (options?.drawGeometry === true) {
        const drawsFrom = diagnosticNow();
        const { warmParkedDraws } = await import('../render/parkedDraws');
        // Before the first game draw the loading card owns task-paced work.
        // In play each native geometry draw crosses the completed-draw fence.
        const drawnPause = pause ?? ((): Promise<void> => yieldTask(this.levelScope));
        for (const root of roots) {
          let complete = false;
          await warmParkedDraws(this.renderer, this.rootScene, this.camera, composer.inputBuffer, root, live, drawnPause,
            { budget: { drawables: 1, newMaterials: 1, bufferBytes: 4_000_000 }, onProgress: (done, total) => { complete = done === total; } });
          // The general parked warmer may leave failed draws to live entry.
          // A strict streamed publication cannot call that prepared.
          if (!complete) throw new Error('Streamed geometry preparation did not complete');
        }
        if (timed) performance.measure('wildshard.warm.geometry-draws', { start: drawsFrom, end: diagnosticNow() });
      }
    });
  }

  private postPreparation: Promise<void> = Promise.resolve();
  /** Link an added display transform before publishing its revised live shader. Initial boot uses its ordinary
   * shader stage. Live additions serialize; entered-frame readiness awaits the latest preparation or its error. */
  preparePostPass(pass: EffectPass): Promise<void> {
    const composer = this._composer;
    if (composer === null || this.frameCount === 0) { pass.recompile(); return Promise.resolve(); }
    const current = (): boolean => !this.levelScope.disposed && this._composer === composer;
    const previous = this.postPreparation;
    const prepare = async (): Promise<void> => {
      try { await previous; } catch { /* A later addition retries the current effect list. */ }
      if (!current()) return;
      const [{ prepareEffectPass, postTriangle }, { runPrecompile, waitForDrawnFrame }] = await Promise.all([
        import('../render/postPreparation'), import('../render/precompile')]);
      const geometry = postTriangle(), mesh = new THREE.Mesh(geometry, pass.fullscreenMaterial), scene = new THREE.Scene();
      const target = pass.renderToScreen ? null : composer.inputBuffer;
      try {
        let published = false;
        while (current() && !published) published = await prepareEffectPass(pass, async material => {
          mesh.material = material;
          await runPrecompile(this.renderer, this.camera, [{ label: engineString('s_178612197e2b'), root: mesh, target: scene, rt: target }], 1,
            undefined, undefined, current, false, () => waitForDrawnFrame(this.engineScope, () => this.frameCount, current));
        }, material => {
          mesh.material = material;
          const prior = this.renderer.getRenderTarget(), face = this.renderer.getActiveCubeFace(), mip = this.renderer.getActiveMipmapLevel();
          this.renderer.setRenderTarget(target);
          try { this.renderer.compile(mesh, this.camera, scene); }
          finally { this.renderer.setRenderTarget(prior, face, mip); }
        }, current);
      } finally { geometry.dispose(); }
    };
    const work = prepare();
    this.postPreparation = work;
    return work;
  }

  private _entryPreparation: EntryPreparation | null = null;
  /** S1: the boot's entered roots whose exterior (road) variants wait for play (`warmDeferredEntryRoots`) */
  private deferredEntryRoots: { readonly owner: Scope; readonly roots: readonly THREE.Object3D[] }[] = [];
  /** Last entered-frame preparation's running phase, measured work counts and scalar timings. Painted waits are
   * included; no content resources are retained. The root identifies the exact destination. */
  get entryPreparation(): Readonly<EntryPreparation> | null { return this._entryPreparation; }

  /** Prepare an entered frame's new world/depth/post programs before its owner publishes readiness.
   * Initial boot uses the ordinary shaders/firstFrame stages for its final draw. If its composer already exists,
   * `before` can lend the page compiler a head start; it never adds crossing-only first draws. No simulation tick,
   * camera turn or caster rechunking runs here; the final zero-delta composer draw warms its real pass targets.
   * A retained view may supply its whole future root, including sibling authored lights outside the bound scene.
   * `before` (the caller's last preparation, e.g. a region's sky build) runs first, inside the same owner lifetime:
   * it may prepare already-built roots while other content constructs, then await that content before returning.
   * Early roots and whole-page programs share this owner. Final complete inventory gates readiness;
   * elapsed time cannot reveal an incomplete entry. Real work failures and owner retirement still reject.
   * D188 (Jake's G815, shipped): `arrivalAt` (where the crossing reveals the player, render space) prepares only
   * the destination content within ARRIVAL_RADIUS of it before the reveal; the rest sits out live draws (a frame gate)
   * until `warmArrivalRest` has linked and first-drawn it after the reveal, nearest first. */
  async warmEnteredFrame(owner: Scope, futureRoot?: THREE.Object3D,
    before?: (prepare: (roots: readonly THREE.Object3D[], exteriorPrograms?: boolean) => Promise<void>, prepareFrame: (environment?: THREE.Texture | null) => Promise<void>) => Promise<void> | void,
    arrivalAt?: THREE.Vector3): Promise<void> {
    const composer = this._composer;
    const arrival = arrivalAt !== undefined && futureRoot !== undefined && futureRoot !== this.rootScene && this.frameCount > 0
      ? { at: arrivalAt.clone(), radius: ARRIVAL_RADIUS } : undefined;
    if (composer === null) { await before?.(() => Promise.resolve(), () => Promise.resolve()); return; }
    const trace: EntryPreparation = { root: (futureRoot ?? this.scene).uuid, owner: owner.name,
      completed: false, phase: before === undefined ? 'post-preparation' : 'before-warm', progress: null, stages: [] };
    this._entryPreparation = trace;
    const enter = (phase: string): void => { trace.phase = phase; trace.progress = null; };
    await boundEntryWarmup(owner, async current => {
      if (before !== undefined) {
        await before(async (roots, exteriorPrograms = true) => {
          const started = diagnosticNow();
          enter('early-scene-programs');
          await this.warmEnteredRoots(owner, composer, roots, futureRoot, current, exteriorPrograms);
          trace.stages.push({ phase: 'early-scene-programs', elapsedMs: diagnosticNow() - started, units: roots.length, endAt: diagnosticNow() });
          enter('before-warm');
        }, async (environment) => {
          const started = diagnosticNow();
          enter('early-frame-programs');
          await this.prepareEnteredPrograms(owner, composer, current, futureRoot, arrival,
            (phase, elapsedMs, units) => { trace.stages.push({ phase: `early-frame:${phase}`, elapsedMs, units, endAt: diagnosticNow() }); },
            (done, total, detail) => { trace.progress = { done, total, detail }; }, environment);
          trace.stages.push({ phase: 'early-frame-programs', elapsedMs: diagnosticNow() - started, units: 1, endAt: diagnosticNow() });
          enter('before-warm');
        });
        if (!current()) throw new Error('Shader warm-up owner left');
        enter('post-preparation');
      }
      // Boot's normal shader/firstFrame stages still own its complete inventory
      // and first draws. An early composer lends only the compiler above; doing
      // the crossing warm-up here would add parked/offscreen frame variants.
      if (this.frameCount === 0) { trace.completed = true; return; }
      for (;;) {
        const pending = this.postPreparation;
        await pending;
        if (!current()) throw new Error('Shader warm-up owner left');
        if (this.postPreparation === pending) break;
      }
      enter('shaders-and-composer');
      await this.warmEnteredStages(owner, composer, trace, current, futureRoot, enter, arrival);
    });
  }

  /** Early roots share the enclosing entry's owner and cannot publish readiness. */
  private async warmEnteredRoots(owner: Scope, composer: EffectComposer, roots: readonly THREE.Object3D[],
    futureLighting: THREE.Object3D | undefined, current: () => boolean, exteriorPrograms = true): Promise<void> {
    // The installing scene lends its PMREM; program lights/fog come from the page the renderer actually draws.
    const scene = this.rootScene, futureEnvironment = this.scene.environment;
    const { prepareSceneRoots, waitForDrawnFrame, LIVE_UPLOAD_BUDGET } = await import('../render/precompile');
    const live = (): boolean => current() && this._composer === composer;
    const pause = this.frameCount > 0 ? () => waitForDrawnFrame(owner, () => this.frameCount, live) : undefined;
    // S1: at boot (no frame yet) the roots' scene programs are the Shaders step's (drawn only) and their exterior (road)
    // variants, which draw only once the player leaves the cell, link in play (`warmDeferredEntryRoots`, after control)
    const boot = this.frameCount === 0;
    if (boot && exteriorPrograms) this.deferredEntryRoots.push({ owner, roots });
    await prepareSceneRoots(this.renderer, this.camera, scene, composer.inputBuffer, roots, live, pause,
      LIVE_UPLOAD_BUDGET, !boot, futureLighting, futureEnvironment ?? undefined, exteriorPrograms && !boot);
  }

  /**
   * S1: link the exterior (road) variants of the roots the boot's entry left for play (`warmEnteredRoots`), nearest first,
   * in live slices spaced by drawn frames, as an entered frame's own roots link (G639: without them the first road frame
   * linked each environment's variant, 150-270 ms each). Roots whose owner has left are dropped. Call once control is up.
   * Background callers may add an idle opportunity after each required completed draw.
   */
  async warmDeferredEntryRoots(current: () => boolean, idle?: () => Promise<boolean>): Promise<void> {
    const pending = this.deferredEntryRoots;
    this.deferredEntryRoots = [];
    const composer = this._composer;
    if (composer === null) return;
    const { prepareSceneRoots, waitForDrawnFrame, LIVE_UPLOAD_BUDGET } = await import('../render/precompile');
    for (const { owner, roots } of pending) {
      if (owner.disposed || owner.disposing) continue;
      const live = (): boolean => current() && !owner.disposed && !owner.disposing && this._composer === composer;
      if (!live()) return;
      const pause = async (): Promise<void> => {
        await waitForDrawnFrame(owner, () => this.frameCount, live);
        if (idle !== undefined && !await idle()) throw new Error('Shader warm-up owner left');
      };
      await prepareSceneRoots(this.renderer, this.camera, this.rootScene, composer.inputBuffer, roots, live,
        pause, LIVE_UPLOAD_BUDGET, false, undefined, undefined, true,
        this.camera.getWorldPosition(new THREE.Vector3()));
    }
  }

  /**
   * RP4: link the road (exterior) variants of an entered grid cell's content, as the boot's entry roots' are
   * (`warmDeferredEntryRoots`: nearest first, spaced by drawn frames, dropped once `owner` leaves). Past its sky layer's half
   * weight the road draws the cell with the page's own environment (none on a grid page), not the cell's PMREM: without
   * these, every program of the cell linked in one frame 2 m before its edge (Driftwood's west edge: about 17 links, 2.5 to
   * 4.3 s in Chromium). `roots` are not registered exterior roots (those are left out of the road's variants).
   */
  async warmExteriorRoots(owner: Scope, roots: readonly THREE.Object3D[], current: () => boolean): Promise<void> {
    this.deferredEntryRoots.push({ owner, roots });
    if (this.frameCount === 0) return; // the boot's own in-play warm-up takes it (finish.ts)
    // one loop at a time: a second entry joins the queue behind the first, never a parallel warm-up in the same frames
    const run = this.exteriorWarm.catch(() => undefined).then(() => this.warmDeferredEntryRoots(current));
    this.exteriorWarm = run;
    await run;
  }
  /** RP4: the running road-variant warm-up (`warmExteriorRoots`), which the next one waits behind */
  private exteriorWarm: Promise<void> = Promise.resolve();

  /**
   * D188 (G815): after an arrival's reveal, what it left (`rest`, gated out of live draws) is linked and first-drawn
   * nearest the player first: the whole remaining program inventory under the live slice budget, then the rest's 1×1
   * draws a live budget a completed frame, each slice released to the live draw as it lands. The owner leaving (or a
   * failure) releases the gate: the content then draws as before, building on first sight.
   */
  private async warmArrivalRest(owner: Scope, composer: EffectComposer, root: THREE.Object3D, rest: readonly THREE.Object3D[],
    at: THREE.Vector3, environment: THREE.Texture | null): Promise<void> {
    const gate = this.frameDrawRanges.gate(owner, rest), started = diagnosticNow();
    const live = (): boolean => !owner.disposed && !owner.disposing && this._composer === composer;
    try {
      const { precompileLevel, waitForDrawnFrame, liveWarmPacing, LIVE_PRECOMPILE_SLICE_MS } = await import('../render/precompile');
      const { warmParkedDraws, LIVE_PARKED_BUDGET } = await import('../render/parkedDraws');
      const pause = (): Promise<void> => waitForDrawnFrame(owner, () => this.frameCount, live);
      while (live() && !root.visible) await pause();
      if (!live()) return;
      await precompileLevel(this, undefined, { sliceMs: LIVE_PRECOMPILE_SLICE_MS, current: live, owner, nearest: true, ...liveWarmPacing() });
      const wanted = new Set(rest);
      await warmParkedDraws(this.renderer, this.rootScene, this.camera, composer.inputBuffer, root, live, pause,
        { budget: LIVE_PARKED_BUDGET, environment, include: object => wanted.has(object), nearest: at, onDrawn: objects => { gate.release(objects); } });
      if (isDev()) performance.measure('wildshard.arrival-rest', { start: started, end: diagnosticNow() });
    } catch (error: unknown) {
      if (live()) console.warn('[arrival] the after-reveal warm-up stopped; the rest draws as it is seen', error);
    } finally { gate.release(rest); }
  }

  /** The same complete program inventory may run before content finishes. It never draws or publishes readiness;
   * final preparation repeats discovery so late play content and changed variants remain mandatory. */
  private async prepareEnteredPrograms(owner: Scope, composer: EffectComposer, current: () => boolean,
    futureRoot: THREE.Object3D | undefined, arrival: EntryArrival | undefined, onStage: (phase: string, elapsedMs: number, units: number) => void,
    progress: (done: number, total: number, detail: string) => void, futureEnvironment: THREE.Texture | null = this.scene.environment): Promise<void> {
    const futureLighting = futureRoot ?? this.scene;
    const isolateImageUploads = navigator.userAgent.includes('AppleWebKit') && !/Chrome|Chromium|Edg/.test(navigator.userAgent);
    const { precompileLevel, waitForDrawnFrame, arrivalPrograms, LIVE_UPLOAD_BUDGET, LIVE_PRECOMPILE_SLICE_MS } = await import('../render/precompile');
    const live = (): boolean => current() && this._composer === composer;
    if (this.frameCount === 0) {
      // Only completed world materials can overlap construction. Post, shadow
      // and offscreen jobs need the final page state and keep their normal step.
      // PL6: with what the first frame's warm turns show, so those world programs build here, not in the shader step
      await precompileLevel(this, progress, {current: live, owner, onStage, chunkCasters: false, sliceMs: 12, sceneOnly: true, drawnOnly: true,
        turns: this.warmTurnYaws(), futureLighting, ...(futureEnvironment === null ? {} : {futureEnvironment})});
      return;
    }
    const pause = this.frameCount > 0 ? () => waitForDrawnFrame(owner, () => this.frameCount, live) : undefined;
    const uploadBudget = isolateImageUploads ? LIVE_UPLOAD_BUDGET : undefined;
    const sliceMs = this.frameCount > 0 ? LIVE_PRECOMPILE_SLICE_MS : undefined;
    // Camera equipment leaves with its owner, so its road variants are never needed.
    const leaving = this.viewmodel.staged(owner);
    await precompileLevel(this, progress, { chunkCasters: false, current: live, owner, futureLighting, isolateImageUploads, onStage, drawnOnly: this.frameCount === 0,
      ...(arrival === undefined || futureRoot === undefined ? {} : { arrival: arrivalPrograms(futureRoot, arrival.at, arrival.radius) }),
      ...(leaving === undefined ? {} : { leaving: [leaving] }), ...(sliceMs === undefined ? {} : { sliceMs }),
      ...(futureEnvironment === null ? {} : { futureEnvironment }), ...(pause === undefined ? {} : { pause }), ...(uploadBudget === undefined ? {} : { uploadBudget }) });
  }

  private async warmEnteredStages(owner: Scope, composer: EffectComposer, trace: EntryPreparation,
    current: () => boolean, futureRoot: THREE.Object3D | undefined, enter: (phase: string) => void, arrival?: EntryArrival): Promise<void> {
    const futureScene = this.scene;
    const futureEnvironment = futureScene.environment;
    const progress = (done: number, total: number, detail: string): void => { trace.progress = { done, total, detail }; };
    const onStage = (phase: string, elapsedMs: number, units: number): void => {
      trace.stages.push({ phase, elapsedMs, units, endAt: diagnosticNow() });
      if (phase === 'compile') enter('shader-links');
      else if (phase === 'link') enter('texture-uploads');
    };
    const isolateImageUploads = navigator.userAgent.includes('AppleWebKit') && !/Chrome|Chromium|Edg/.test(navigator.userAgent);
    const { warmComposerFrame, waitForDrawnFrame, entryFrameExclusions,
      parkedMatricesFrozen, freezeParkedMatrices } = await import('../render/precompile');
    // G580 T2 (Developer): the parked destination's static matrices are not recomputed every frame while it waits hidden
    const thaw = futureRoot !== undefined && futureRoot !== this.rootScene && !futureRoot.visible && parkedMatricesFrozen() ? freezeParkedMatrices(futureRoot, { shown: 'skip' }) : undefined;
    try {
    const shaderStart = diagnosticNow();
    const bootDrawn = this.frameCount === 0;
    await warmComposerFrame(composer, this.renderer,
      () => this.prepareEnteredPrograms(owner, composer, current, futureRoot, arrival, onStage, progress), current);
    onStage('shaders-and-composer', diagnosticNow() - shaderStart, 1);
    const { warmParkedDraws, warmOffscreenPasses, HELD_PARKED_BUDGET, HELD_WEBKIT_PARKED_BUDGET, LIVE_PARKED_BUDGET } = await import('../render/parkedDraws');
    // WebKit first draws can block despite cheap JavaScript submissions. Pace cold
    // bindings one per completed frame; bounded copies share that already-warmed layout.
    // G808: held at the wall, a WebKit slice may upload 2 MiB of new buffers (same pipeline fences).
    const drawBudget = isolateImageUploads && this.frameCount > 0 ? { budget: buildHeld() ? HELD_WEBKIT_PARKED_BUDGET : LIVE_PARKED_BUDGET }
      : buildHeld() ? { budget: HELD_PARKED_BUDGET } : {};
    // Held, off WebKit (pipelines build outside the main thread): several planned slices may share a completed frame's
    // draw while held frames keep the 30 fps floor (Pine's afterPlay idled 3.2 s at one slice a frame); WebKit keeps its fences.
    const widen = !isolateImageUploads && buildHeld() ? { widen: { max: 8, frameMs: 1000 / 30 + 2, bytes: HELD_PARKED_BUDGET.bufferBytes ?? 6 * 1024 * 1024 } } : {};
    const drawnPause = this.frameCount > 0 ? () => waitForDrawnFrame(owner, () => this.frameCount, current) : (): Promise<void> => new Promise(resolve => { this.engineScope.raf(() => { this.engineScope.timeout(0, resolve); }); });
    // Camera models live outside the parked world. Compilation linked them, but
    // their staged group and equipment roots still hide their first buffer draws.
    const stagedModels = this.viewmodel.staged(owner);
    if (stagedModels !== undefined) {
      enter('parked-viewmodels');
      const start = diagnosticNow();
      const drawn = await warmParkedDraws(this.renderer, this.rootScene, this.camera, composer.inputBuffer, stagedModels, current,
        drawnPause, { ...drawBudget, onProgress: (done, total) => { progress(done, total, `${done} / ${total} held models warmed`); }, environment: futureEnvironment, revealChildren: true, ...(futureRoot === undefined ? {} : { lightingRoot: futureRoot }) });
      onStage('parked-viewmodels', diagnosticNow() - start, drawn);
    }
    // op-hitch31: a parked root's first draws (pipelines, buffers) were the entry frame's whole cost (Sky Reach 900 ms
    // desktop, up to 1011 ms Simulator, in `activate`); draw it a few objects a frame into a 1×1 scissor first.
    if (futureRoot !== undefined && futureRoot !== this.rootScene && !futureRoot.visible && !bootDrawn) {
      enter('parked-draws');
      const start = diagnosticNow();
      // Every submission waits for a completed game frame; a CPU construction
      // budget cannot measure pending native pipeline work.
      // D188: an arrival first-draws only its set now; the rest is gated out of live draws and warmed after the reveal
      const keep = arrival === undefined ? undefined : (await import('../render/precompile')).arrivalSet(futureRoot, arrival.at, arrival.radius);
      const drawn = await warmParkedDraws(this.renderer, this.rootScene, this.camera, composer.inputBuffer, futureRoot, current,
        drawnPause, { ...drawBudget, ...widen, onProgress: (done, total) => { progress(done, total, `${done} / ${total} scene draws warmed`); },
          onPlan: (original, selected) => { onStage('parked-slices-original', 0, original); onStage('parked-slices-selected', 0, selected); }, environment: futureEnvironment,
          ...(keep === undefined ? {} : { include: keep }) });
      onStage('parked-draws', diagnosticNow() - start, drawn);
      if (keep !== undefined && arrival !== undefined) {
        const rest: THREE.Object3D[] = [];
        // the parked root itself is hidden while it waits: walk its children, each by its own visibility
        for (const child of futureRoot.children) child.traverseVisible(object => { if (Reflect.get(object, 'material') !== undefined && !keep(object)) rest.push(object); });
        onStage('arrival-deferred', 0, rest.length);
        if (rest.length > 0) void this.warmArrivalRest(owner, composer, futureRoot, rest, arrival.at, futureEnvironment);
      }
    }
    // op-hitch37: a registered offscreen pass (Nalati's look bake) built its casters' pipelines on its first real
    // update, after entry; draw each once into a 1×1 stand-in of its target first.
    enter('offscreen-draws');
    const offscreenStart = diagnosticNow();
    const passes = await warmOffscreenPasses(this.renderer, this.rootScene, current, drawnPause, entryFrameExclusions(this.rootScene, futureRoot),
      (done, total) => { progress(done, total, `${done} / ${total} render passes warmed`); }, drawBudget.budget);
    onStage('offscreen-draws', diagnosticNow() - offscreenStart, passes);
    trace.completed = true;
    } finally { thaw?.(); }
  }

  /** DL23 (J198): the boot shaders step's census, exactly what `firstFrame`'s parked warm will draw (`firstFrameDrawables`
   *  over the same root and camera), so no program of it links synchronously inside a parked draw. */
  async firstFrameCensus(): Promise<(object: THREE.Object3D) => boolean> {
    const { firstFrameDrawables } = await import('../render/parkedDraws');
    return firstFrameDrawables(this.rootScene, this.camera);
  }

  /**
   * The first frames, as a step: every visible drawable's first draw (its pipelines, buffers and shadow-depth variants)
   * a slice at a time into a 1×1 scissor, then the world draw, the warm turns, and the full composer one pass at a time
   * (screen-quad shaders compileAsync cannot reach). LS7 (J188): each unit is counted only once a GPU fence says the GPU
   * finished it, so the loading bar moves on completed work; the next unit is already submitted by then (FencedUnits),
   * so the fences cost the GPU no idle frames (waiting on each one cost about 1.5 s on Sunscar Dunes). Unsplit, the world draw and the
   * composer draw were each one GPU flush: 2.0 s and 3.3 s on Sunscar Dunes in headless Chromium (SwiftShader), with
   * the page's main thread blocked in the canvas read-back for both.
   */
  async firstFrame(onProgress?: (done: number, total: number, detail: string) => void, narrow = false): Promise<void> {
    // every wait here, fence or frame, settles when the game's scope is disposed; the finally releases every queued sync
    const units = new FencedUnits(this.renderer.getContext(), this.engineScope);
    try { await this.firstFrameUnits(units, onProgress, narrow); } finally { units.dispose(); }
  }

  private async firstFrameUnits(units: FencedUnits, onProgress: ((done: number, total: number, detail: string) => void) | undefined, narrow: boolean): Promise<void> {
    const frame = (): Promise<void> => units.frame(); // rAF alone resumes before the paint
    // Large instanced worlds may request culling before the first draw and fewer warm views.
    const tracedBoot = bootTraceActive();
    const checkpoint = (operation: string): void => { if (tracedBoot) recordGpuCheckpoint(this.renderer, operation); };
    const warmTurns = this.renderKnobs().warmTurns ?? WARM_TURNS;
    const passes = this.composer.passes.filter(pass => pass.enabled);
    const splitPost = !passes.some(pass => pass instanceof MaskPass || pass instanceof ClearMaskPass);
    const postUnits = splitPost ? passes.length : 1;
    let draws = 0, credited = 0;
    // each boot draw is its shadow maps, one a unit, then the view (fencedDraw)
    const perDraw = this.shadowCasters(this.camera).length + 1;
    // LS8: the world's first draws count by drawable, each credited when the fence after its slice signals, so a slice
    // narrowed after a slow one (FIRST_DRAW_NARROW) changes no total. Each unit weighs its kind's measured seconds (J204).
    const W = FIRST_FRAME_SECONDS, fullDraw = (perDraw - 1) * W.shadowMap + W.view;
    const firstView = narrow ? FIRST_VIEW_UNITS * W.viewPart : 0, firstMap = narrow && perDraw > 1 ? (FIRST_MAP_PARTS - 1) * W.mapPart : 0;
    const total = (): number => draws * W.drawable + firstView + firstMap + fullDraw * (1 + warmTurns) + postUnits * W.postPass;
    const drawUnits = (base: number, label: string) => (done: number, detail: string): void => {
      onProgress?.(base + Math.min(done, perDraw - 1) * W.shadowMap + (done >= perDraw ? W.view : 0), total(), `${label} · ${detail}`);
    };
    await frame();
    checkpoint('cull:before');
    if (this.level.boot.cullBeforeFirstDraw === true) this.lookStrategy?.frame?.(0.016, 0);
    checkpoint('cull:after');
    // into the composer's input buffer, not the canvas: the canvas target would be a second set of program variants
    const target = (this.composer as unknown as { inputBuffer?: THREE.WebGLRenderTarget }).inputBuffer ?? null;
    // The world's first draws, a slice of drawables at a time into a 1×1 scissor: the GPU builds each new pipeline
    // there, and the full-size draws below only rasterize. The step counts fenced GPU submissions: a slice, a shadow
    // map, a view or a post pass is one unit, counted once the GPU has completed it.
    if (target !== null) {
      const { warmParkedDraws } = await import('../render/parkedDraws');
      checkpoint(`shadow-maps:allocated:${String(this.allocateShadowMaps(this.camera))}`);
      let submitted = 0, drew = false;
      checkpoint('world-pipelines:before');
      await warmParkedDraws(this.renderer, this.rootScene, this.camera, target, this.rootScene, () => !this.engineScope.disposed,
        // a pause after a drawn slice fences it; the bounds pauses before the first slice only yield a frame
        async () => {
          if (!drew) { await frame(); return; }
          drew = false;
          const warmed = submitted;
          await units.submit(() => {
            credited = warmed * W.drawable;
            onProgress?.(credited, total(), `${String(warmed)} / ${String(draws)} draws warmed`);
          });
        },
        // a narrowed plan reports again: the count already credited stands
        { onPlan: (_original, selected) => { onProgress?.(credited, total(), `${String(selected)} world slices`); },
          onProgress: (done, count) => { drew ||= done > submitted; submitted = done; draws = count; },
          // no widening when narrow: D12 merges slices by new material only, and three new layouts of one material (the
          // view-model swords and arms) shared one 2.3 s SwiftShader frame
          ...(narrow ? { budget: FIRST_DRAW_NARROW.budget } : { narrow: FIRST_DRAW_NARROW }) });
      checkpoint('world-pipelines:submitted');
    }
    const drawables = draws * W.drawable, world = drawables + firstView + firstMap;
    if (narrow) {
      checkpoint('first-view:before');
      await this.firstViewParts(this.camera, target, units, (k) => {
        onProgress?.(drawables + k * W.viewPart, total(), `world view ${String(k)} / ${String(FIRST_VIEW_UNITS)}`);
      });
    }
    units.mark(() => { onProgress?.(drawables + firstView, total(), 'world + shadows'); });
    checkpoint('world:before');
    await this.fencedDraw(this.camera, target, units, drawUnits(world, 'world + shadows'), firstMap === 0 ? undefined : (k) => {
      onProgress?.(drawables + firstView + k * W.mapPart, total(), `world + shadows · shadow map 1 part ${String(k)} / ${String(FIRST_MAP_PARTS)}`);
    });
    checkpoint('world:submitted');
    // E153: the world once facing each way, so a turn finds every pipeline built (warmTurn)
    const yaws = this.warmTurnYaws();
    for (let k = 1; k <= yaws.length; k++) {
      const label = `world, turned ${String(k * 360 / WARM_TURNS)}°`;
      await this.warmTurn(yaws[k - 1] ?? 0, target, units, drawUnits(world + k * fullDraw, label));
    }
    const postFrom = world + fullDraw * (1 + warmTurns);
    this.lookStrategy?.frame?.(0.016, 0);
    checkpoint('post:before');
    if (!splitPost) {
      if (tracedBoot) traceBootPasses(this.composer.passes, checkpoint, () => { this.composer.render(0.016); });
      else this.composer.render(0.016);
      checkpoint('post:submitted');
      await units.submit(() => { onProgress?.(postFrom + W.postPass, total(), 'post chain'); });
    } else {
      // EffectComposer.render's own loop (postprocessing 6.39: render, depth blit, swap), a pass per completed fence
      const composer = this.composer, renderer = this.renderer;
      let input = composer.inputBuffer, output = composer.outputBuffer;
      for (const [i, pass] of passes.entries()) {
        checkpoint(`pass:${String(i)}:${pass.name}:before`);
        pass.render(renderer, input, output, 0.016, false);
        if (pass.needsDepthBlit && Reflect.get(composer, 'depthRenderTarget') !== null) {
          const blit: unknown = Reflect.get(composer, 'blitDepthBuffer');
          if (typeof blit === 'function') Reflect.apply(blit, composer, [input]);
        }
        if (pass.needsSwap) [input, output] = [output, input];
        checkpoint(`pass:${String(i)}:${pass.name}:submitted`);
        await units.submit(() => { onProgress?.(postFrom + (i + 1) * W.postPass, total(), `post pass ${String(i + 1)} / ${String(postUnits)} · ${pass.name}`); });
      }
    }
    await units.drain();
    checkpoint('post:completed');
  }

  /** The visible shadow-casting lights the next draw from `cam` would render maps for. */
  private shadowCasters(cam: THREE.Camera): { readonly light: THREE.Light; readonly shadow: THREE.LightShadow }[] {
    const lights: { readonly light: THREE.Light; readonly shadow: THREE.LightShadow }[] = [], map = this.renderer.shadowMap;
    if (!map.enabled || (!map.autoUpdate && !map.needsUpdate)) return lights;
    this.rootScene.traverseVisible(object => {
      const shadow: unknown = object instanceof THREE.Light && object.castShadow && object.layers.test(cam.layers) ? Reflect.get(object, 'shadow') : null;
      if (object instanceof THREE.Light && shadow instanceof THREE.LightShadow && (shadow.autoUpdate || shadow.needsUpdate)) lights.push({ light: object, shadow });
    });
    return lights;
  }

  /** LS7: three allocates a light's shadow map only at its first render. Allocate the due maps with no casters (an empty
   *  scene), so the first draws below find them: until then the parked slices had no stand-in to build the casters'
   *  depth pipelines into, and every lit draw was dropped on its unbound shadow sampler (E153), leaving all of it to
   *  the first full draw (1.6 s of one GPU flush on Sunscar Dunes, headless Chromium). The flags are put back. */
  private allocateShadowMaps(cam: THREE.Camera): number {
    const casters = this.shadowCasters(cam), missing = casters.filter(({ shadow }) => shadow.map === null);
    if (missing.length === 0) return 0;
    const map = this.renderer.shadowMap, mapNeeds = map.needsUpdate;
    const flags = casters.map(({ shadow }) => ({ shadow, auto: shadow.autoUpdate, needs: shadow.needsUpdate }));
    try {
      for (const { shadow } of flags) { shadow.autoUpdate = false; shadow.needsUpdate = shadow.map === null; }
      map.needsUpdate = true;
      map.render(missing.map(({ light }) => light), new THREE.Scene(), cam);
    } finally {
      for (const { shadow, auto, needs } of flags) { shadow.autoUpdate = auto; shadow.needsUpdate = needs; }
      map.needsUpdate = mapNeeds;
    }
    return missing.length;
  }

  /**
   * LS11 (J204): `render` of the root scene from `cam` into the 1×1 scissor of `target` (the canvas when null) with
   * `hidden` out of it, so it rasterizes nothing of the view but builds and runs what that draw order meets. Visibility,
   * scissors and the render target are put back; the caller owns the shadow flags.
   */
  private parkedRender(cam: THREE.Camera, target: THREE.WebGLRenderTarget | null, hidden: readonly THREE.Object3D[]): void {
    const r = this.renderer;
    const prev = r.getRenderTarget(), face = r.getActiveCubeFace(), mip = r.getActiveMipmapLevel();
    const scissor = target?.scissor.clone(), scissorTest = target?.scissorTest ?? false;
    const canvasScissor = r.getScissor(new THREE.Vector4()), canvasScissorTest = r.getScissorTest();
    try {
      for (const object of hidden) object.visible = false;
      if (target !== null) { target.scissor.set(0, 0, 1, 1); target.scissorTest = true; }
      else { r.setScissor(0, 0, 1, 1); r.setScissorTest(true); }
      r.setRenderTarget(target);
      r.render(this.rootScene, cam);
    } finally {
      for (const object of hidden) object.visible = true;
      if (target !== null && scissor !== undefined) { target.scissor.copy(scissor); target.scissorTest = scissorTest; }
      r.setScissor(canvasScissor); r.setScissorTest(canvasScissorTest);
      r.setRenderTarget(prev, face, mip);
    }
  }

  /**
   * LS11 (J204): the first full view after the world's slices, drawn as FIRST_VIEW_UNITS growing prefixes of its draw
   * order (opaque by render order and material, as three sorts them, in `FIRST_VIEW_PARTS.opaque` parts, then the
   * transparent in `.transparent` more), each into the 1×1 scissor with the shadow maps held and each a fenced unit.
   * Every draw meets the same draw before it as in the full view, so the GPU's one-time work for that view lands a part at
   * a time instead of in one unit; the parts hide the rest of the order for their own draw only, and every visibility and
   * shadow flag is put back.
   */
  private async firstViewParts(cam: THREE.Camera, target: THREE.WebGLRenderTarget | null, units: FencedUnits,
    onUnit: (done: number) => void): Promise<void> {
    // three's render poses a root camera before it lists the scene: the order is listed from the same pose
    if (cam.parent === null && cam.matrixWorldAutoUpdate) cam.updateMatrixWorld();
    const map = this.renderer.shadowMap, { order, opaque } = firstViewOrder(this.rootScene, cam);
    for (let k = 1; k <= FIRST_VIEW_UNITS; k++) {
      const upto = firstViewCut(k, opaque, order.length, FIRST_VIEW_PARTS);
      const mapAuto = map.autoUpdate, mapNeeds = map.needsUpdate;
      try {
        map.autoUpdate = false; map.needsUpdate = false;
        this.parkedRender(cam, target, order.slice(upto).filter(object => object.visible));
      } finally { map.autoUpdate = mapAuto; map.needsUpdate = mapNeeds; }
      await units.submit(() => { onUnit(k); });
    }
  }

  /**
   * LS7: one boot draw of the world split at its real seams, each unit waiting on the GPU fence before the next: every
   * shadow map the draw is due to render, alone (the view goes into a 1×1 scissor of its target, so it rasterizes
   * nothing), then the view with those maps held. The same maps and the same view as one `render`; on Sunscar Dunes in
   * headless Chromium the unsplit first draw was one 1.75–2.1 s GPU flush.
   * LS11 (J204): with `onMapPart`, the first map is drawn first as FIRST_MAP_PARTS - 1 growing prefixes of the scene's
   * casters (in the order the shadow pass meets them), each a fenced unit reported to `onMapPart`, then whole as before.
   */
  private async fencedDraw(cam: THREE.Camera, target: THREE.WebGLRenderTarget | null, units: FencedUnits,
    onUnit: (done: number, detail: string) => void, onMapPart?: (done: number) => void): Promise<void> {
    const r = this.renderer, map = r.shadowMap;
    const flags = this.shadowCasters(cam).map(({ shadow }) => ({ shadow, auto: shadow.autoUpdate, needs: shadow.needsUpdate }));
    const prev = r.getRenderTarget(), face = r.getActiveCubeFace(), mip = r.getActiveMipmapLevel();
    const mapAuto = map.autoUpdate, mapNeeds = map.needsUpdate;
    const casters = onMapPart !== undefined && flags.length > 0 ? casterOrder(this.rootScene) : [];
    // LS11: a map this draw touched (a caster prefix included) stays due again unless the whole draw completes
    const touched = new Set<THREE.LightShadow>();
    let drawn = false;
    try {
      for (const [i, { shadow }] of flags.entries()) {
        const drawMap = (hidden: readonly THREE.Object3D[]): void => {
          for (const other of flags) { other.shadow.autoUpdate = false; other.shadow.needsUpdate = other.shadow === shadow; }
          map.needsUpdate = true; touched.add(shadow);
          this.parkedRender(cam, target, hidden);
        };
        if (i === 0 && onMapPart !== undefined) {
          for (let k = 1; k < FIRST_MAP_PARTS; k++) {
            drawMap(casters.slice(Math.round(casters.length * k / FIRST_MAP_PARTS)).filter(object => object.visible));
            await units.submit(() => { onMapPart(k); });
          }
        }
        drawMap([]);
        await units.submit(() => { onUnit(i + 1, `shadow map ${String(i + 1)} / ${String(flags.length)}`); });
      }
      // every map due this pose is drawn: the view draws with them held
      for (const { shadow } of flags) { shadow.autoUpdate = false; shadow.needsUpdate = false; }
      if (flags.length > 0) { map.autoUpdate = false; map.needsUpdate = false; }
      r.setRenderTarget(target);
      r.render(this.rootScene, cam);
      drawn = true;
    } finally {
      r.setRenderTarget(prev, face, mip);
      for (const { shadow, auto, needs } of flags) { shadow.autoUpdate = auto; shadow.needsUpdate = !drawn && (needs || touched.has(shadow)); }
      map.autoUpdate = mapAuto; map.needsUpdate = !drawn && (mapNeeds || touched.size > 0);
    }
    await units.submit(() => { onUnit(flags.length + 1, 'view'); });
  }

  /** The yaws (radians, from where the player looks) the first frame's warm turns draw: the boot's shader warm-up links
   *  what they show before the frame (`precompileLevel`'s `turns`). */
  warmTurnYaws(): number[] {
    return Array.from({ length: this.renderKnobs().warmTurns ?? WARM_TURNS }, (_, i) => (i + 1) * Math.PI * 2 / WARM_TURNS);
  }

  /**
   * E153: one draw of the world turned by `turn` (radians) from where the player looks, through a 100° square view, with
   * the shadows placed for that view. The precompile links every program, but the GPU builds a program's pipeline for each
   * target, blend state and vertex layout only at its first draw (Metal: ANGLE's render-pipeline states, WebKit / iOS
   * build them on the draw). The boot's one frame drew only what faces the spawn, so turning around built the rest in
   * play — the waterfall behind the pier, a caster's depth variant in a cascade: 25–35 ms hitches on the M5 with a cold
   * shader cache, several times that on a phone. Four quarter-turns at 100° cover the circle.
   */
  private async warmTurn(turn: number, target: THREE.WebGLRenderTarget | null, units: FencedUnits,
    onUnit: (done: number, detail: string) => void): Promise<void> {
    const cam = this.camera, sky = this._sky;
    const q = cam.quaternion.clone(), fov = cam.fov, aspect = cam.aspect;
    const yaw = new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
    try {
      cam.fov = 100; cam.aspect = 1; cam.updateProjectionMatrix(); sky?.csm.updateFrustums();
      cam.quaternion.setFromEuler(new THREE.Euler(0, yaw + turn, 0, 'YXZ'));
      cam.updateMatrixWorld(true);
      sky?.warmShadows();
      // the boot's loop has not started: nothing else draws or moves the camera while the turn's units wait on the GPU
      await this.fencedDraw(cam, target, units, onUnit);
    } finally {
      cam.quaternion.copy(q); cam.fov = fov; cam.aspect = aspect; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
      sky?.csm.updateFrustums();
      sky?.warmShadows();
    }
  }

  /** RT3: frame pacing on a slow software rasterizer (slowGpuPacing.ts); null everywhere else. */
  private slowPacing: SlowGpuPacing | null = null;
  /** The pending cost probe of the last drawn frame: its start, or null when none is in flight. */
  private pacedStart: number | null = null;
  private pacedProbe: MessageChannel | null = null;
  /** The pacing state on a slow software rasterizer, for proofs; null on any other GPU. */
  get pacing(): Readonly<SlowGpuPacing> | null { return this.slowPacing; }
  /** RT3: pace this page's frames to a slow software rasterizer (finish.ts, after its shaders step measured the GPU slow).
   *  A real GPU keeps its tier's scale unpaced (slowGpuPacingFor). Idempotent. */
  paceSlowGpu(): void {
    if (this.slowPacing !== null || this.dead) return;
    const pacing = slowGpuPacingFor(true, webglRendererName(this.renderer.getContext()), this.renderer.getPixelRatio());
    if (pacing === null) return;
    const channel = new MessageChannel();
    this.slowPacing = pacing; this.pacedProbe = channel;
    // the first task after the frame: the frame's rAF work, its read-back and whatever input it held up have all run
    channel.port1.onmessage = () => {
      const start = this.pacedStart;
      this.pacedStart = null;
      if (start === null || this.dead || this.app.clock.mode === 'capture') return;
      pacing.measured(start, diagnosticNow() - start); // a new scale waits for the next drawn frame (takeRatio)
    };
    this.engineScope.onDispose(() => { channel.port1.onmessage = null; channel.port1.close(); channel.port2.close(); this.pacedProbe = null; });
  }
  private measurePacedFrame(start: number): void {
    if (this.pacedStart !== null || this.pacedProbe === null) return;
    this.pacedStart = start;
    this.pacedProbe.port2.postMessage(0);
  }

  /** QA row 25: a Developer pixel pick waiting for the next drawn frame */
  private pickedRatio: number | null = null;
  /** MG2: Low / High applies to this page: the phone tier with no explicit render scale, as it booted (a render-scale pick
   *  waiting for its reload does not switch Low off early) */
  // MG8: Settings ▸ Graphics ▸ Pixel density replaces the boot-time render scale on a phone (Jake ~23:45: one pixel control)
  private readonly phoneGraphics: boolean = TIER === 'phone';
  resize(): void { this.fitSize(); this.kickLoop(); }
  /** NB5 (renderBudget.ts): the desktop's pixel budget and dynamic resolution, on the tier's own scale only: never a phone
   *  (MG8's Pixel density; Jake 2026-10-20, no dynamic resolution on the phone), a Developer's pixel pick or a player's saved
   *  render scale (Settings ▸ Graphics, gfxPrefs.dpr) */
  private budget: RenderBudget | null = null;
  private budgetOn(): boolean { return !this.phoneGraphics && activeDevPixels() === null && gfxPrefs.dpr === 'auto'; }
  /** The drawing buffer's pixel ratio the page wants now: the budget's on the desktop's own scale, else drawingPixelRatio. */
  private wantedRatio(): number {
    const base = drawingPixelRatio(window.devicePixelRatio, TIER_CONFIG.dpr, this.phoneGraphics);
    if (!this.budgetOn()) { this.budget = null; return base; }
    const ceiling = budgetCeiling(window.innerWidth, viewportHeight(), window.devicePixelRatio, base);
    if (this.budget === null) this.budget = new RenderBudget(ceiling);
    else if (this.budget.ceiling !== ceiling) this.budget.resize(ceiling);
    return this.budget.ratio;
  }
  private fitSize(): void {
    const w = window.innerWidth, h = viewportHeight();
    // a new window size moves the budget's ceiling (a smaller ratio lands now: this resize redraws anyway)
    if (this.budget !== null) { const ratio = this.wantedRatio(); if (ratio !== this.renderer.getPixelRatio()) this.renderer.setPixelRatio(ratio); }
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.compositionChanged = true;
    this._composer?.setSize(w, h); // a resize can land before buildComposer() / buildSky()
    this._sky?.csm.updateFrustums();
  }

  /** The page frame (the systems' step and the draw), built once: by start(), or before it by stepFrame (the boot's
   *  shader warm-up poses the view before the loop starts). */
  private frame: { readonly draw: (now: number | undefined, forced: boolean) => void; readonly parked: () => void } | null = null;
  private pageFrame(): { readonly draw: (now: number | undefined, forced: boolean) => void; readonly parked: () => void } {
    if (this.frame !== null) return this.frame;
    this.app.scheduler.configure(this.level.tiers?.[TIER]?.ticks);
    const composer = this.composer, sky = this.sky; // both built before the first frame (buildComposer reads the sky)
    this.clock.start();
    this.fixedAcc = 0; this.firstFixedStep = true;
    // (A timer-driven loop was tried for iOS Low Power Mode: timers are throttled to ~30 ms there too. rAF it is.)
    // PresentationLoop owns the only world request and cancels it while covered.
    // One chain only: every animation-frame callback of a frame gets the same timestamp, so a second chain (kickLoop
    // restarting a loop that was merely paused) finds its frame taken and ends there.
    let lastNow = -1, lastRun = diagnosticNow();
    // The frame cap (tier.ts frameCapFps; G876: 60 on mobile). The animation frame still comes every vsync; draw only
    // once 1/cap has passed since the last draw, less a slack under one vsync of the fastest display (4 ms < 8.3 ms
    // at 120 Hz) to absorb timestamp jitter. Mobile draws every vsync at 60 Hz, every second at 120 Hz, and every
    // available callback at 30 Hz (iOS Low Power). A skipped vsync does nothing, including the clock: dt and fixed
    // steps account for the whole interval, and input includes everything since the previous draw.
    let lastDrawn = -Infinity;
    const loop = (now:number|undefined, forceFrame:boolean) => {
      if (now !== undefined) { if (now === lastNow) return; lastNow = now; }
      if (this.dead) return; // a core system died (faults.ts): the fatal modal is up, nothing more to draw
      lastRun = diagnosticNow();
      // RT3: on a GPU the shaders step measured slow, the last frame's spacing (slowGpuPacing.ts) leaves the main thread to
      // worker messages and input; like a capped vsync, a skipped one does nothing. A capture draws at the tier's own
      // scale on its own clock: no spacing, and any lowered scale restored
      const capture = this.app.clock.mode === 'capture';
      if (capture) { this.slowPacing?.restore(); this.budget?.restore(); }
      const pacing = capture ? null : this.slowPacing;
      if (pacedSkip(pacing, lastRun, this.pacedStart, forceFrame, buildHeld())) return;
      // G782: held at a cell's wall with build slices running, skip vsyncs up to the 30 fps held floor (framePacing.ts);
      // like a capped vsync, a skipped one does nothing, so the drawn frame's dt is the whole interval
      if (!forceFrame && heldDrawDeferred()) return;
      const cap = frameCapFps();
      if (cap > 0 && !forceFrame) {
        const anchor = frameCapAnchor(lastDrawn, now ?? lastRun, cap);
        if (anchor === null) return;
        lastDrawn = anchor;
      }
      if (this.hold) { this.clock.getDelta(); return; } // the context is lost / being rebuilt (GpuRecovery.ts): a draw now would re-link every program in one stall
      if (!forceFrame && !this.frameGate()) { this.clock.getDelta(); return; } // keep the clock moving so the next frame's dt is sane
      this.renderer.info.reset();
      const liveDt = Math.min(0.1, this.clock.getDelta());
      const realDt = this.app.clock.delta(liveDt);
      const t = this.app.clock.mode === 'capture' ? this.app.clock.real + realDt : this.clock.elapsedTime;
      // Visual hit-stop never changes simulation clocks, input, fixed steps or gameplay updates.
      let scale = 1;
      if (this.stopLeft > 0) { this.stopLeft -= realDt; scale = HIT_STOP_SCALE; }
      this.app.clock.timeScale = 1;
      this.app.clock.tick(liveDt);
      worldTime.scale = scale; worldTime.realDt = realDt; worldTime.t = t;
      const dt = realDt;
      this._frameTime += dt;
      this.frameNo++;
      this.app.events.beginFrame();
      this.app.scheduler.beginFrame(this.app.clock.paused ? 0 : dt, this.app.equipmentHost?.player.position);
      // the dev fps panel's timing rows (src/shared/engine/core/frameCost.ts): each system timed by its label only while the panel is open
      const on = frameCost.on;
      if (on) frameCost.begin();
      this.app.cpu.begin();
      // each system in its own try/catch (faults.ts): one that throws is counted, reported and, if it keeps at it, switched off
      this.runPhase('input', dt, t);
      this.runFixed(dt);
      this.runPhase('update', dt, t);
      this.runPhase('late', dt, t);
      if (this.isDead()) return; // a core system died in this frame's steps
      const renderAt = diagnosticNow();
      try {
        // RT3: a new render scale lands in the frame that draws (stepFrame draws nothing): never in the task that decided it,
        // whose cleared canvas nothing would replace
        // QA row 25: a Developer pixel pick (core/devPixels.ts) holds against the software pacing's scale while it is set
        const paced = this.stepOnly ? null : this.slowPacing?.takeRatio() ?? null, picked = this.stepOnly ? null : this.pickedRatio;
        if (picked !== null) this.pickedRatio = null;
        const budgeted = this.stepOnly ? null : this.budget?.takeRatio() ?? null;
        const ratio = picked ?? (paced !== null && activeDevPixels() === null ? paced : null) ?? (this.budgetOn() ? budgeted : null);
        if (ratio !== null) { this.renderer.setPixelRatio(ratio); this.fitSize(); }
        sky.update(realDt);
        // planet + sun disc travel with the camera so they stay "infinitely" far
        sky.clouds?.position.copy(this.camera.position); sky.planet.position.copy(this.camera.position).addScaledVector(sky.planetDir, 1700); sky.sunDisc.position.copy(this.camera.position).addScaledVector(sky.raysDir, 1500);
        // FR5 (G869): a rays-only disc is parentless and GodRaysEffect draws it with matrixAutoUpdate off: compose it here,
        // or the rays come from the world origin (E398's painted sun never reached the rays)
        sky.sunDisc.updateMatrix();
        const lookStart = this.app.cpu.enabled ? diagnosticNow() : 0;
        try { this.lookStrategy?.frame?.(realDt, t); }
        finally { if (this.app.cpu.enabled && this.lookStrategy?.frame !== undefined) this.app.cpu.record(this.app.cpu.ticket(this.levelScope), diagnosticNow() - lookStart); }
        cullPlaced(this.camera); // placed models' per-copy culling and LODs for this view (src/client/engine/models/place.ts; nothing when none cull)
        if (this.stepOnly) { this.app.cpu.end(); if (on) frameCost.end(realDt * 1000, renderAt - lastRun, 0, 0); return; } // stepFrame: no draw
        // D178 (G813): a held crossing view pauses the post chain: the AO pass sits this draw out, and the bloom, rays and
        // volumetric effects composite their last frame (skipWhileTransparent); the scene and colour passes, and so every
        // material's and the colour pass's program keys, are unchanged
        this.postHeld = this.frameDrawRanges.holding();
        const ao = this.postHeld ? this.post?.ao ?? null : null, aoOn = ao?.enabled ?? false;
        if (ao !== null) ao.enabled = false;
        try { this.frameDrawRanges.draw(this.rootScene, this.camera, composer, realDt); }
        finally { if (ao !== null) ao.enabled = aoOn; }
        noteDrawnEnvironment(this.rootScene.environment); // what the frame lit with, for view-root warm-ups (drawnEnvironment.ts)
        if (this.compositionChanged && this.compositionObservers.size > 0) {
          const bytes = this.composerAllocationResources().reduce((sum, row) => sum + row.bytes, 0);
          for (const read of this.compositionObservers) read(bytes);
          this.compositionChanged = false;
        }
        if (exploreEntryPending() && !this.renderer.getContext().isContextLost()) recordExploreFrame();
      } catch (e) { this.fault(this.renderSystem, e); return; }
      this.flushEvents('render');
      if (this.captures.length > 0) this.flushCaptures();
      const done = diagnosticNow(), work = done - lastRun;
      noteFrameDrawn(done, now, cap, cap > 0 && Number.isFinite(lastDrawn) ? lastDrawn : undefined); // Builds share the cap recovery deadline; actual rAF still measures display cadence.
      this.app.cpu.end();
      if (pacing !== null) this.measurePacedFrame(lastRun);
      // NB5: dynamic resolution reads the drawn frame's interval (uncapped play only: a cap or a capture sets its own pace)
      else if (this.budget !== null && !capture && cap === 0 && !forceFrame && !this.app.clock.paused) this.budget.measured(liveDt * 1000);
      this.workMs[this.frameI] = work;
      this.frameRafTime = now ?? null;
      this.frameCount++;
      this.drawCheck.afterDraw(this.frameCount); // QA 2026-11-13 row 6: a world that draws nothing is reported (drawCheck.ts)
      this.updateMs[this.frameI] = renderAt - lastRun; this.renderMs[this.frameI] = done - renderAt;
      if (on) frameCost.end(realDt * 1000, renderAt - lastRun, done - renderAt, cap > 0 ? 1000 / cap : 0);
      // QA row 31: play's sustained fps (a paused game's frames are not play)
      if (!this.app.clock.paused) sustainedFrames.frame(done, realDt * 1000, renderAt - lastRun, done - renderAt, cap > 0 ? 1000 / cap : 0);
      else sustainedFrames.frame(done, Infinity, 0, 0, 0);
      this.lastFrame.calls = this.renderer.info.render.calls; this.lastFrame.triangles = this.renderer.info.render.triangles;
      this.frameMs[this.frameI] = realDt * 1000; this.frameI = (this.frameI + 1) % this.frameMs.length;
      this.stats.frames++; this.stats.acc += realDt;
      if (this.stats.acc >= 0.5) { this.stats.fps = Math.round(this.stats.frames / this.stats.acc); this.stats.frames = 0; this.stats.acc = 0; }
    };
    this.frame = { draw: loop, parked: () => { this.clock.getDelta(); lastDrawn = -Infinity; } };
    return this.frame;
  }

  start(): void {
    const frame = this.pageFrame();
    this.renderer.info.autoReset = false; // the composer renders several passes per frame: count the whole frame
    // Returning from the background: draw one frame at once (bypassing the gate). The 1–2 s of black on an
    // iOS app switch is iOS restoring a suspended standalone web app before any of this runs — investigated
    // and accepted (overlay / mirror / hidden canvas / wake lock / keep-alive audio made no difference).
    this.engineScope.listen(this.canvas, 'webglcontextlost', () => { this.gl.lostAt = diagnosticNow(); this.gl.events++; console.warn('[gl] context lost'); });
    this.engineScope.listen(this.canvas, 'webglcontextrestored', () => { this.gl.restoredAt = diagnosticNow(); console.warn('[gl] context restored after', Math.round(this.gl.restoredAt - this.gl.lostAt), 'ms'); });
    const driver=new PresentationLoop(this.engineScope,pagePresentation,frame);
    this.kickLoop=()=>{driver.wake();};
    this.app.ui.bindPresentation(this.engineScope,this.kickLoop);
    for(const state of ['play','explore','practice','playground','capture'] as const)this.app.onEnter(state,this.kickLoop,this.engineScope);
    this.primeFrame=()=>{if(!this.dead)driver.primeFrame();};
    this.hiddenFrame=()=>{if(!this.dead)driver.hiddenFrame();};
    this.app.ui.bindStill(this.engineScope,()=>{driver.stillFrame();});
    setLoopState('running');
    driver.wake();
  }

  /** Stop the page engine and release its renderer and scopes. */
  dispose(): void {
    this.dead = true;
    this.levelScope.dispose();
    this.engineScope.dispose();
    this.rootScene.traverse((o) => { (o as Partial<THREE.Mesh>).geometry?.dispose(); });
    try { this._composer?.dispose(); } catch (e) { console.warn('[level] the composer did not dispose', e); }
    try { this.lookStrategy?.dispose?.(); } catch (e) { console.warn('[level] the render strategy did not dispose', e); }
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.rootScene.clear();
  }
}
