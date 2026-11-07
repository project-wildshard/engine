/**
 * A second sky backdrop laid over a page's own by a weight (SHARD-PLATFORM G223, SF19a's one frame): a grid region whose
 * level's sky is a whole backdrop (a day clock driving a key dome, a PMREM environment, the lights, fog and haze), not
 * keys a region can hand over, draws that sky on the page's ONE sky rig while you are inside its cell, and blends it with
 * the page's own across the 16 m edge band.
 *
 * - **Its own targets**: the layered backdrop is bound to a private copy of the rig's targets (`SkyBackdropTargets`), so
 *   its clock writes only those. Each frame the page's own backdrop runs first and writes the shared state as always;
 *   then the layer runs its clock and moves every shared value it lights (the key light, the fill, the fog uniforms, the
 *   sun disc and halo, the cloud and far-haze uniforms, the environment intensity) toward its own by the weight; the
 *   environment texture swaps at half weight (a PMREM cube cannot be mixed). At the start of the next frame every value
 *   it moved is put back exactly before anything else runs, so the page's backdrop always finds its own state, and at
 *   weight 0 the shared state is the page's to the bit.
 * - **Its air**: given a fog object of its own (`air`, a grid region's fog: the one frame reads it as the owner's air and
 *   blends it by the owners' weights), the layer's clock writes its fog colour there and leaves the scene fog alone;
 *   without one it blends the scene fog's colour like the rest.
 * - **Its dome**: whatever the backdrop adds to the layer's `holder` scene (its sky dome) moves to the page scene (its
 *   `clouds` layer kept on the camera, as the page keeps its own), drawn
 *   after the page's own sky pieces (render order −20 … −10) and before the grid road sky (−9), its pieces in the order
 *   the backdrop draws them on its own (its opaque dome, then its cloud ring: `layerOrders`), depth-tested (the dome
 *   sits past every world thing), with a constant blend alpha of the weight; at weight 0 it is hidden and its clock is
 *   not run (no cost outside the cell).
 * - **Its own sky layer** (`SkyBackdrop.clouds`, SHARD-PLATFORM G321): a backdrop that hands its dome over as `clouds` (as
 *   standalone, where `SkyRig.build` attaches it to the page scene) has it joined to the holder at `attach`, so it is drawn
 *   like a dome it added itself. Kept on the camera, it is scaled out to at least `LAYER_DOME_REACH` of the camera's far
 *   plane: drawn depth-tested after the world (not first with no depth test, as a standalone dome may be), a 120 m dome
 *   would cover every world thing past 120 m. Its shading reads directions only, so the scale changes nothing it paints.
 * - **Its start** (G321): before the backdrop is built its targets take its level's own declared light (`seedLayerTargets`,
 *   as a standalone `SkyRig.build` starts from it), so a value its clock never writes (a fixed sky that only sets its key
 *   light) blends toward its own level's, never toward a copy of the page's light from when the layer was laid.
 * - **Its key light** (G321): a backdrop's `sky.setKeyLight` calls land on the layer's targets (`layerKeyedSky`), never
 *   straight on the page's shared light (where the blend then overwrote them with the layer's stale copy).
 * - **Its sun disc and halo**: hidden on its own targets (its look's `sky.sun` off, or its clock hiding them), the page's
 *   are hidden from half weight on, like the environment swap.
 * - **Its world-anchored sky pieces** (`SkyBackdrop.dressing`, G321: a cloud sea, cloud puffs, a sun glow): drawn in the
 *   page scene in its level's own frame at its region's origin (`origin`): their programs read the view and the camera
 *   shifted by the origin (`wsLayerView`, `wsLayerOrigin`), so a piece that reads world positions in its shader (a puff
 *   billboarded on its own attribute, a sea wound round a fixed point) draws exactly as standalone; each one's output is
 *   faded by the weight (`wsLayerFade`: its alpha, or its whole colour where it blends `One`), and the pieces keep their
 *   own render order and blending. Hidden, and not drawn, at weight 0. An SF59 graph's classic program takes the same
 *   defines (it is built on three's stock chunks).
 * - **Its dispose**: the dome leaves the page scene, the backdrop's own `dispose` frees its textures and targets, and the
 *   last frame's moved values go back at the next update.
 *
 * The post effects a backdrop drives (`attachPost`) stay the page's: a layered backdrop is never handed them.
 *
 * **An environment-only layer** (SHARD-PLATFORM G321 part 5, `environment`): a level with no backdrop whose standalone page
 * lights with its default sky's environment (its painted sky, PMREM-filtered) and whose world draws, lights and fogs the rest
 * of its sky itself (its own light swap holds the page's). The layer then moves nothing but the environment: the texture,
 * swapped at half weight like any layer's, and its intensity, read from `environment.intensity` (the level's clock writes it
 * where its own page would) and blended by the weight. Every light, fog, disc and cloud value stays whoever wrote it.
 *
 * **A base layer** (SHARD-PLATFORM G242, `base: true`): a sky that stands in for the page's own backdrop by its weight (the
 * grid road's dome and key light, outside every cell). It is applied first, before every other layer, and its dome is drawn
 * under theirs (`BASE_SKY_ORDER`), at a weight taken from the share the other layers leave (`applyLayers`): its weight `w`
 * becomes `w / (1 − S)`, `S` the other layers' weights, capped at 1. With the owners' weights summing to 1 (a grid frame), the
 * shared state and the drawn sky are then exactly `w · base + Σ wᵢ · layerᵢ + (1 − w − S) · page`: across a cell's edge band
 * the road blends straight into the region's own sky, with nothing of the page's showing through. At weight 0 it is off
 * like any layer, so inside a cell the page and the region's layer are exactly what they were without it.
 */
import {
  Box3, BufferGeometry, Color, ConstantAlphaFactor, CustomBlending, DirectionalLight, Fog, HemisphereLight, Material, Matrix4, Mesh,
  MeshBasicMaterial, OneFactor, OneMinusConstantAlphaFactor, Scene, Sprite, SpriteMaterial, Vector3, type Camera, type Object3D, type PerspectiveCamera, type WebGLRenderTarget,
} from 'three';
import { PATCH_ORDER, patchShader } from '../render/shaderPatches';
import type { Scope } from '../../../shared/engine/app/scope';
import { resourceScope } from '../../../shared/engine/app/resources';
import { noteEnvironment } from '../render/drawnEnvironment';
import { ownSceneTree } from '../app/sceneOwnership';
import { ownPostSampler } from '../render/uploadOwnership';
import type { AssetService } from '../app/assets';
import type { SkyBackdrop, SkyBackdropTargets } from '../render/look';
import type { Renderer } from '../render/renderer';
import { prepareSceneRoots, type UploadBudget } from '../render/precompile';
import type { AtmosphereSpec, SkySpec } from '../../../shared/engine/level/data';
import { compassDir } from '../../../shared/engine/world/dayCycle';

/**
 * the layered dome's render order: after the page's sky pieces (−20 … −10), before the grid road sky (−9); a backdrop
 * whose dome has several pieces spreads them over ±0.4 around it in its own draw order (`layerOrders`)
 */
export const LAYER_SKY_ORDER = -9.5;
/**
 * a base layer's dome render order (G242): after the page's sky pieces (−20 … −10), before every other layer's band
 * (−9.9 … −9.1); several pieces spread over ±0.04 around it
 */
export const BASE_SKY_ORDER = -9.95;
/** below this weight the layer is off: hidden, its clock not run, nothing moved */
const OFF = 0.001;
/**
 * G321: the least horizontal radius a layered backdrop's camera-kept dome (`SkyBackdrop.clouds`) is drawn at, as a share of
 * the camera's far plane (3300 m on the grid's 4400 m camera, inside the road dome's 4200 m): past every world thing it
 * must not cover, since the layer draws it depth-tested after the world
 */
export const LAYER_DOME_REACH = 0.75;

/**
 * What a layer runs of a backdrop: a level's whole `SkyBackdrop` fits, and so does a fixed sky that only binds its own light
 * and draws a dome (G242's road sky; no clock, no post).
 */
export type LayeredSkyBackdrop = Pick<SkyBackdrop, 'lut' | 'bind' | 'update' | 'rebuild'> & Partial<Pick<SkyBackdrop, 'clouds' | 'dressing' | 'dispose' | 'gpuBytes' | 'environmentPass'>>;

/** One shared value the layer moves: held before it writes, blended toward its own, put back at the next frame. */
interface Slot { readonly save: () => void; readonly blend: (w: number) => void; readonly undo: () => void }

function colour(real: () => Color, own: Color): Slot {
  const held = new Color();
  return { save: () => { held.copy(real()); }, blend: (w) => { real().lerp(own, w); }, undo: () => { real().copy(held); } };
}
/** a direction: lerped and renormalised (the far side of a swap falls back to the layer's own) */
function direction(real: Vector3, own: Vector3): Slot {
  const held = new Vector3();
  return {
    save: () => { held.copy(real); },
    blend: (w) => { real.lerp(own, w); if (real.lengthSq() > 1e-10) real.normalize(); else real.copy(own); },
    undo: () => { real.copy(held); },
  };
}
function scalar(get: () => number, set: (v: number) => void, own: () => number): Slot {
  let held = 0;
  return { save: () => { held = get(); }, blend: (w) => { const v = get(); set(v + (own() - v) * w); }, undo: () => { set(held); } };
}
function vector(real: Vector3, own: Vector3): Slot {
  const held = new Vector3();
  return { save: () => { held.copy(real); }, blend: (w) => { real.lerp(own, w); }, undo: () => { real.copy(held); } };
}

/** a visibility the layer takes over from half weight on (a hidden sun disc or halo; a mesh cannot be half drawn) */
function shown(real: { visible: boolean }, own: { readonly visible: boolean }): Slot {
  let held = true;
  return { save: () => { held = real.visible; }, blend: (w) => { if (w >= 0.5 && !own.visible) real.visible = false; }, undo: () => { real.visible = held; } };
}

/**
 * FR5: a rays-only sun (its look's `sky.sun` has the disc off and `rays` on, E398) from half weight on: the page's disc is
 * kept as the god rays' source only, as standalone `SkyBackdropView` keeps it: visible, out of the page scene (never drawn
 * in the frame; the rays pass draws it in its own light scene), at `dir` while it holds (null: the blended light's sun).
 */
function raysSource(real: Mesh, dir: Vector3 | null, held: { dir: Vector3 | null; on: boolean }): Slot {
  let parent: Object3D | null = null, visible = true;
  return {
    save: () => { parent = real.parent; visible = real.visible; },
    blend: (w) => { if (w < 0.5) return; real.visible = true; real.removeFromParent(); held.dir = dir; held.on = true; },
    undo: () => { if (parent !== null && real.parent !== parent) parent.add(real); real.visible = visible; held.dir = null; held.on = false; },
  };
}

const basicColour = (mesh: Mesh): Color | null => (mesh.material instanceof MeshBasicMaterial ? mesh.material.color : null);

/** a mesh's materials (none for any other node) */
function meshMaterials(node: Object3D): Material[] {
  if (!(node instanceof Mesh)) return [];
  const list: unknown = node.material;
  return (Array.isArray(list) ? list : [list]).filter((m): m is Material => m instanceof Material);
}

/** the half-width of the band the layer's meshes are spread over, around `LAYER_SKY_ORDER` (inside −10 … −9) */
const LAYER_SKY_BAND = 0.4;
/** a base layer's band around `BASE_SKY_ORDER` (inside −10 … −9.9) */
const BASE_SKY_BAND = 0.04;

/**
 * Each mesh of the backdrop's dome its render order inside the layer's band, keeping the order the backdrop drew in on
 * its own (SF63): everything it drew opaque first (by its own render order), then its transparents (by theirs). The layer
 * draws them all as transparents; with one shared order three's back-to-front sort (by each geometry's bounding-sphere
 * centre) put an off-centre cloud ring ahead of the dome it sits in, and the dome, drawn after at full weight, covered it.
 * A single key keeps exactly `LAYER_SKY_ORDER`.
 */
function layerOrders(roots: readonly Object3D[], centre: number, band: number): Map<Object3D, number> {
  const keyed: { readonly node: Object3D; readonly key: number }[] = [];
  for (const root of roots) {
    root.traverse((node) => {
      const materials = meshMaterials(node);
      if (materials.length === 0) return;
      // opaque before transparent whatever the render order (three's two lists), then the backdrop's own order
      const transparent = materials.some((m) => m.transparent);
      keyed.push({ node, key: node.renderOrder + (transparent ? 1e6 : 0) });
    });
  }
  const keys = [...new Set(keyed.map((k) => k.key))].sort((a, b) => a - b);
  const rank = new Map(keys.map((key, i) => [key, centre - band + (2 * band * (i + 0.5)) / keys.length]));
  return new Map(keyed.map(({ node, key }) => [node, rank.get(key) ?? centre]));
}

/** the dressing programs' uniforms (`levelFrameSource`): the view and camera in the level's frame, and the weight */
const DRESS_VIEW = 'wsLayerView', DRESS_ORIGIN = 'wsLayerOrigin', DRESS_FADE = 'wsLayerFade';
const MAIN = /\bvoid\s+main\s*\(\s*(?:void\s*)?\)/;
/** a source's own text after its `#version` line, if it has one (which must stay first) */
function prepend(source: string, text: string): string {
  const version = /^[ \t]*#version[^\n]*\n/u.exec(source);
  return version === null ? text + source : version[0] + text + source.slice(version[0].length);
}
/**
 * G321: a dressing program's stage read in its level's own frame (exposed for tests): its view, model-view and camera
 * position become the level frame's (the page's view times the origin's translation, the camera less the origin); the
 * fragment stage's output is faded by the layer's weight: its alpha, or (`whole`, a piece that blends `One` of its source)
 * its whole colour.
 */
export function levelFrameSource(source: string, stage: 'vertex' | 'fragment', whole = false): string {
  const own = `uniform mat4 ${DRESS_VIEW};\nuniform vec3 ${DRESS_ORIGIN};\n${stage === 'fragment' ? `uniform float ${DRESS_FADE};\n` : ''}`
    + `#define viewMatrix ${DRESS_VIEW}\n${stage === 'vertex' ? `#define modelViewMatrix (${DRESS_VIEW} * modelMatrix)\n` : ''}#define cameraPosition (cameraPosition - ${DRESS_ORIGIN})\n`;
  if (stage === 'vertex') return prepend(source, own);
  if (!MAIN.test(source)) throw new Error('Layer dressing: a fragment stage without main()');
  return `${prepend(source.replace(MAIN, 'void wsLayerMain()'), own)}\nvoid main() { wsLayerMain(); gl_FragColor${whole ? '' : '.a'} *= ${DRESS_FADE}; }\n`;
}

/** G321 part 5: an environment-only layer's intensity source (`BackdropLayer`'s `environment` option). */
export interface LayerEnvironmentOnly {
  /** the environment intensity the level's own page would draw at now (its clock's, else its declared `envIntensity`) */
  readonly intensity: () => number;
}

/** What the layer reads: the rig's live targets and the page scene it draws into. */
export interface BackdropLayerHost {
  readonly targets: SkyBackdropTargets;
  readonly scene: Scene;
}

/** A layered backdrop's readout (tests, captures, the census). */
export interface BackdropLayerState {
  readonly weight: number; readonly drawn: boolean; readonly attached: boolean; readonly disposed: boolean; readonly bytes: number;
  /** the weight it was last applied at (a base layer's share of what the other layers leave; 0 when off) */
  readonly applied: number;
}

export class BackdropLayer {
  /** the scene the backdrop factory is handed: its dome and its environment land here, never on the page scene */
  readonly holder: Scene = new Scene();
  /** the private targets the layered backdrop is bound to */
  readonly targets: SkyBackdropTargets;
  private readonly slots: Slot[];
  private readonly domes: Object3D[] = [];
  private readonly materials: { blendAlpha: number }[] = [];
  /** SF63: sky pieces kept on the camera (`follow`: a level's gas giant), faded through their own opacity uniform */
  private readonly followers: { readonly piece: Object3D; readonly dir: Vector3; readonly dist: number; readonly opacity: { value: number } }[] = [];
  private readonly host: BackdropLayerHost;
  private readonly scope: Scope;
  private readonly assets: Pick<AssetService, 'isAcquired'>;
  private backdrop: LayeredSkyBackdrop | null = null;
  /** G321: its camera-kept dome's horizontal radius and scale as built (0: none), scaled out to `LAYER_DOME_REACH` */
  private domeReach = 0;
  private readonly domeScale = new Vector3(1, 1, 1);
  /** G242: a base layer (applied first, drawn under the others, weighted by the share they leave) */
  readonly base: boolean;
  private weight_ = 0;
  private applied = 0;
  private drawn = false;
  private disposed = false;
  private readonly onDispose: () => void;
  /** G321: where its level's frame stands on the page (its dressing's origin; the page origin without one) */
  private readonly origin: () => Vector3;
  /** G321: its dressing's uniforms: the view in its level's frame, the origin and the weight */
  private readonly dressView = { value: new Matrix4() };
  private readonly dressOrigin = { value: new Vector3() };
  private readonly dressFade = { value: 0 };
  private readonly dressShift = new Matrix4();
  /** FR5: while a rays-only sun holds the page's disc (`raysSource`), where the rays come from (null: the light's sun) */
  private readonly rays: { dir: Vector3 | null; on: boolean } = { dir: null, on: false };

  constructor(host: BackdropLayerHost, options: { readonly air?: () => Fog | null; readonly onDispose: () => void; readonly owner?: Scope; readonly assets?: Pick<AssetService, 'isAcquired'>; readonly base?: boolean; readonly origin?: () => Vector3; readonly environment?: LayerEnvironmentOnly; readonly rays?: Vector3 | true }) {
    this.host = host;
    const zero = new Vector3();
    this.origin = options.origin ?? ((): Vector3 => zero);
    this.base = options.base === true;
    this.scope = (options.owner ?? resourceScope()).child('BackdropLayer');
    // the owner's end is the layer's: its domes leave the page scene and the rig forgets it (live P0: a retired grid
    // region's dome stayed in the page scene and the rig's layers, holding that region's graphs and world)
    this.scope.onDispose(() => { this.dispose(); });
    this.assets = options.assets ?? { isAcquired: () => false };
    ownSceneTree(this.holder, this.scope, this.assets);
    const real = host.targets;
    this.onDispose = options.onDispose;
    const ownFog = new Fog(real.fog.color.clone(), 1, 1e6);
    const air = options.air;
    const discMaterial = new MeshBasicMaterial({ color: basicColour(real.disc)?.clone() ?? new Color(1, 1, 1) });
    const disc = new Mesh(new BufferGeometry(), discMaterial);
    disc.scale.copy(real.disc.scale);
    const halo = real.halo === null ? null : new Sprite(new SpriteMaterial({ color: real.halo.material.color.clone(), opacity: real.halo.material.opacity }));
    if (halo !== null && real.halo !== null) halo.scale.copy(real.halo.scale);
    const cloud = { uSunDir: { value: real.cloud.uSunDir.value.clone() }, uSunColor: { value: real.cloud.uSunColor.value.clone() }, uCloudLit: { value: real.cloud.uCloudLit.value.clone() }, uCloudAlpha: { value: real.cloud.uCloudAlpha.value } };
    const far = { uHazeCol: { value: real.far.uHazeCol.value.clone() }, uSeaSky: { value: real.far.uSeaSky.value.clone() }, uSeaSun: { value: real.far.uSeaSun.value.clone() }, uSeaSunDir: { value: real.far.uSeaSunDir.value.clone() } };
    const planet = { uSunDir: { value: real.planet.uSunDir.value.clone() }, uHaze: { value: real.planet.uHaze.value.clone() }, uCrisp: { value: real.planet.uCrisp.value } };
    const fogU = { fogSunDir: { value: real.fogU.fogSunDir.value.clone() }, fogSunColor: { value: real.fogU.fogSunColor.value.clone() }, fogDistDensity: { value: real.fogU.fogDistDensity.value }, fogHeightDensity: { value: real.fogU.fogHeightDensity.value } };
    const lights = real.lights.map((l) => { const own = new DirectionalLight(l.color.clone(), l.intensity); return own; });
    const hemi = new HemisphereLight(real.hemi.color.clone(), real.hemi.groundColor.clone(), real.hemi.intensity);
    this.targets = {
      sunDir: real.sunDir.clone(), sunColor: real.sunColor.clone(), lights, lightDirection: real.lightDirection.clone(), hemi,
      get fog() { return air?.() ?? ownFog; },
      fogU, underwater: real.underwater, disc, halo, cloud, far, planet, shadowBusy: real.shadowBusy,
    };
    const own = this.targets, holder = this.holder, scene = host.scene, only = options.environment;
    // its environment: the intensity blended by the weight, the PMREM texture swapped at half weight (a cube cannot be mixed)
    const environment: Slot[] = [
      scalar(() => scene.environmentIntensity, (v) => { scene.environmentIntensity = v; }, only?.intensity ?? ((): number => holder.environmentIntensity)),
      ((): Slot => {
        let held: Scene['environment'] = null;
        return { save: () => { held = scene.environment; }, blend: (w) => { if (w >= 0.5 && holder.environment !== null) scene.environment = holder.environment; }, undo: () => { scene.environment = held; } };
      })(),
    ];
    this.slots = only !== undefined ? environment : [
      direction(real.sunDir, own.sunDir), colour(() => real.sunColor, own.sunColor), direction(real.lightDirection, own.lightDirection),
      ...real.lights.flatMap((l, i) => {
        const o = lights[i];
        return o === undefined ? [] : [colour(() => l.color, o.color), scalar(() => l.intensity, (v) => { l.intensity = v; }, () => o.intensity)];
      }),
      colour(() => real.hemi.color, hemi.color), colour(() => real.hemi.groundColor, hemi.groundColor), scalar(() => real.hemi.intensity, (v) => { real.hemi.intensity = v; }, () => hemi.intensity),
      direction(real.fogU.fogSunDir.value, fogU.fogSunDir.value), colour(() => real.fogU.fogSunColor.value, fogU.fogSunColor.value),
      scalar(() => real.fogU.fogDistDensity.value, (v) => { real.fogU.fogDistDensity.value = v; }, () => fogU.fogDistDensity.value),
      scalar(() => real.fogU.fogHeightDensity.value, (v) => { real.fogU.fogHeightDensity.value = v; }, () => fogU.fogHeightDensity.value),
      vector(real.disc.scale, disc.scale),
      ...(basicColour(real.disc) === null ? [] : [colour(() => basicColour(real.disc) ?? discMaterial.color, discMaterial.color)]),
      shown(real.disc, disc),
      ...(options.rays === undefined ? [] : [raysSource(real.disc, options.rays === true ? null : options.rays.clone(), this.rays)]),
      ...(real.halo === null || halo === null ? [] : ((h: Sprite, o: Sprite): Slot[] => [colour(() => h.material.color, o.material.color), vector(h.scale, o.scale),
        scalar(() => h.material.opacity, (v) => { h.material.opacity = v; }, () => o.material.opacity), shown(h, o)])(real.halo, halo)),
      direction(real.cloud.uSunDir.value, cloud.uSunDir.value), colour(() => real.cloud.uSunColor.value, cloud.uSunColor.value), colour(() => real.cloud.uCloudLit.value, cloud.uCloudLit.value),
      scalar(() => real.cloud.uCloudAlpha.value, (v) => { real.cloud.uCloudAlpha.value = v; }, () => cloud.uCloudAlpha.value),
      colour(() => real.far.uHazeCol.value, far.uHazeCol.value), colour(() => real.far.uSeaSky.value, far.uSeaSky.value), colour(() => real.far.uSeaSun.value, far.uSeaSun.value),
      direction(real.far.uSeaSunDir.value, far.uSeaSunDir.value),
      direction(real.planet.uSunDir.value, planet.uSunDir.value), colour(() => real.planet.uHaze.value, planet.uHaze.value),
      scalar(() => real.planet.uCrisp.value, (v) => { real.planet.uCrisp.value = v; }, () => planet.uCrisp.value),
      ...(air === undefined ? [colour(() => real.fog.color, ownFog.color)] : []),
      ...environment,
    ];
  }

  /** The built backdrop (made against `holder` and this layer's `targets`): its dome moves to the page scene, its clock binds here. */
  attach(backdrop: LayeredSkyBackdrop): void {
    if (this.disposed) { backdrop.dispose?.(); throw new Error('Backdrop layer attached after dispose'); }
    if (this.backdrop !== null) throw new Error('Backdrop layer already has a backdrop');
    this.backdrop = backdrop;
    // The grade pass draws this sampler outside the dome subtree; it still belongs to the resident layer.
    if (backdrop.lut !== null && !this.assets.isAcquired(backdrop.lut)) ownPostSampler(backdrop.lut, this.scope);
    // G321: its own sky layer, handed over as `clouds` (standalone `SkyRig.build` attaches it), is drawn like its holder's dome
    const own = backdrop.clouds;
    if (own !== undefined) {
      let inHolder = false;
      for (let node: Object3D | null = own; node !== null; node = node.parent) if (node === this.holder) inHolder = true;
      if (!inHolder) this.holder.add(own);
      const box = new Box3().setFromObject(own);
      this.domeReach = box.isEmpty() ? 0 : (box.max.x - box.min.x) / 2;
      this.domeScale.copy(own.scale);
    }
    const children = this.holder.children.slice();
    const order = this.base ? layerOrders(children, BASE_SKY_ORDER, BASE_SKY_BAND) : layerOrders(children, LAYER_SKY_ORDER, LAYER_SKY_BAND);
    for (const child of children) {
      ownSceneTree(child, this.scope, this.assets);
      this.holder.remove(child);
      child.visible = false;
      child.traverse((node) => {
        node.renderOrder = order.get(node) ?? (this.base ? BASE_SKY_ORDER : LAYER_SKY_ORDER);
        for (const m of meshMaterials(node)) {
          m.transparent = true; m.depthTest = true; m.depthWrite = false;
          m.blending = CustomBlending; m.blendSrc = ConstantAlphaFactor; m.blendDst = OneMinusConstantAlphaFactor; m.blendAlpha = 0;
          m.needsUpdate = true;
          this.materials.push(m);
        }
      });
      this.host.scene.add(child);
      this.domes.push(child);
    }
    // G321: its world-anchored sky pieces, drawn in its level's frame at its region's origin, faded by the weight
    if (backdrop.dressing !== undefined) this.dress(backdrop.dressing);
    backdrop.bind(this.targets);
  }

  /** G321: a backdrop's `dressing` into the page scene, its programs in its level's frame (`levelFrameSource`). */
  private dress(dressing: Object3D): void {
    ownSceneTree(dressing, this.scope, this.assets);
    const view = (camera: Camera): void => {
      const o = this.origin();
      this.dressOrigin.value.copy(o);
      this.dressView.value.multiplyMatrices(camera.matrixWorldInverse, this.dressShift.makeTranslation(o.x, o.y, o.z));
    };
    dressing.traverse((node) => {
      const materials = meshMaterials(node);
      if (materials.length === 0) return;
      const prior = node.onBeforeRender.bind(node);
      node.onBeforeRender = (renderer, scene, camera, geometry, material, group) => { prior(renderer, scene, camera, geometry, material, group); view(camera); };
      for (const m of materials) {
        const whole = m.premultipliedAlpha || (m.blending === CustomBlending && m.blendSrc === OneFactor);
        m.transparent = true;
        patchShader(m, 'layer.dressing', PATCH_ORDER.view + 45, (shader) => {
          shader.uniforms[DRESS_VIEW] = this.dressView; shader.uniforms[DRESS_ORIGIN] = this.dressOrigin; shader.uniforms[DRESS_FADE] = this.dressFade;
          shader.vertexShader = levelFrameSource(shader.vertexShader, 'vertex');
          shader.fragmentShader = levelFrameSource(shader.fragmentShader, 'fragment', whole);
        }, { scope: this.scope, key: (before) => `${before}|layer-dressing:${whole ? 'whole' : 'alpha'}` });
        m.needsUpdate = true;
      }
    });
    dressing.removeFromParent();
    dressing.visible = false;
    this.host.scene.add(dressing);
    this.domes.push(dressing);
  }

  /** Prepare final page variants before this attached layer's first visible frame, on every browser.
   * Borrow the actual materials and page lighting; preserve visibility, parents, blending,
   * uniforms and target. The resident scope fences every painted slice. The page's whole-world
   * warm-up walks visible objects only, so the hidden domes and dressing are prepared here (G321):
   * compiled against the real composer target, each link resolved in its own slice and every
   * image uploaded before the weight shows them. (sp-o284: Chromium's former `compileAsync`
   * against the canvas target left Sky Reach's entry five graph links and the 5562×1024
   * panorama upload in one 183 ms frame.) A live page passes its drawn-frame `pause` and upload budget,
   * so each link and each image upload gets a painted frame of its own: on WebKit the GPU process
   * pays for an upload after the call returns, so a time box alone let the four look images join one
   * 207 ms Simulator frame. */
  async prepare(renderer: Renderer, camera: PerspectiveCamera, target: WebGLRenderTarget | null,
    pause?: () => Promise<void>, uploadBudget?: UploadBudget): Promise<void> {
    if (this.disposed || this.scope.disposed) throw new Error('Backdrop layer left before preparation');
    if (this.backdrop === null) throw new Error('Backdrop layer preparation requires attachment');
    await prepareSceneRoots(renderer, camera, this.host.scene, target, this.domes, () => !this.disposed && !this.scope.disposed, pause, uploadBudget);
  }

  /**
   * SF63: a sky piece that sits `dist` along `dir` from the camera (a level's gas giant, which Game.ts keeps on the camera for
   * the page's own): drawn while the layer draws, in the layer's band after its dome and clouds (in its own pieces' order),
   * with its own blending (a transparent ring cannot take the dome's constant alpha), faded by setting `opacity` to the
   * weight. Owned and freed with the layer.
   */
  follow(piece: Object3D, dir: Vector3, dist: number, opacity: { value: number }): void {
    if (this.disposed) throw new Error('Backdrop layer followed after dispose');
    ownSceneTree(piece, this.scope, this.assets);
    const nodes: Object3D[] = [];
    piece.traverse((node) => { if (meshMaterials(node).length > 0) nodes.push(node); });
    const own = [...new Set(nodes.map((n) => n.renderOrder))].sort((a, b) => a - b), top = (this.base ? BASE_SKY_ORDER + BASE_SKY_BAND : LAYER_SKY_ORDER + LAYER_SKY_BAND) - 0.01;
    for (const node of nodes) node.renderOrder = top - 0.02 * (own.length - 1 - own.indexOf(node.renderOrder));
    piece.visible = this.drawn;
    this.host.scene.add(piece);
    this.domes.push(piece);
    this.followers.push({ piece, dir: dir.clone(), dist, opacity });
  }

  /**
   * G321: a layered backdrop's key light, as `SkyRig.setKeyLight` moves the page's (`layerKeyedSky` routes its calls here):
   * the sun direction and colour, every cascade light's colour and intensity, the shadow direction, and the fog's, cloud
   * layer's and gas giant's sun direction, all on this layer's own targets, blended into the page's by the weight.
   */
  setKeyLight(dir: Vector3, color: Color, intensity: number): void {
    const t = this.targets;
    t.sunDir.copy(dir).normalize(); t.sunColor.copy(color);
    for (const l of t.lights) { l.color.copy(color); l.intensity = intensity; }
    t.lightDirection.copy(t.sunDir).negate();
    t.fogU.fogSunDir.value.copy(t.sunDir); t.cloud.uSunDir.value.copy(t.sunDir); t.planet.uSunDir.value.copy(t.sunDir);
  }

  /** The owner's weight (0..1), read at the next `apply`. */
  set weight(w: number) { this.weight_ = Number.isFinite(w) ? Math.min(1, Math.max(0, w)) : 0; }
  get weight(): number { return this.weight_; }

  /**
   * Once per frame, after the page's own backdrop wrote the shared state: run the layer's clock and move the shared state
   * toward it by the weight. Returns the undo (call it before the page's backdrop runs next), or null when off.
   * `share`: the weight to apply at instead of its own (a base layer's, from `applyLayers`).
   */
  apply(dt: number, camera: PerspectiveCamera, share: number = this.weight_): (() => void) | null {
    const backdrop = this.backdrop, w = Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0;
    const on = backdrop !== null && !this.disposed && w > OFF;
    if (on !== this.drawn) { this.drawn = on; for (const dome of this.domes) dome.visible = on; }
    this.applied = on ? w : 0;
    if (!on) return null;
    // the PMREM this layer swaps in once it weighs half: recorded while it fades in, so the road's views are warmed for it
    // before it does (drawnEnvironment.ts)
    noteEnvironment(this.holder.environment);
    backdrop.update(dt, camera);
    // its own sky layer (a dome and its cloud ring) travels with the camera, as Game.ts keeps the page's `sky.clouds`;
    // left at the page origin, a ring drawn around its own centre sat off-centre and behind the far world (SF63)
    backdrop.clouds?.position.copy(camera.position);
    // G321: drawn depth-tested after the world, a near dome would cover it: scaled out to the layer's reach (directions only)
    const reach = LAYER_DOME_REACH * camera.far;
    if (backdrop.clouds !== undefined && this.domeReach > 0 && this.domeReach < reach) backdrop.clouds.scale.copy(this.domeScale).multiplyScalar(reach / this.domeReach);
    for (const f of this.followers) { f.piece.position.copy(camera.position).addScaledVector(f.dir, f.dist); f.opacity.value = w; }
    for (const m of this.materials) m.blendAlpha = w;
    this.dressFade.value = w;
    for (const slot of this.slots) slot.save();
    for (const slot of this.slots) slot.blend(w);
    return () => { for (let i = this.slots.length - 1; i >= 0; i--) this.slots[i]?.undo(); };
  }

  /** FR5: the god rays' direction while this layer's rays-only sun holds the page's disc; undefined when it does not, null
   *  for the light's own (blended) sun */
  raysDir(): Vector3 | null | undefined { return this.rays.on ? this.rays.dir : undefined; }

  /** after an in-place WebGL restore: the backdrop's own way of rebuilding its textures and environment */
  rebuild(): void { this.backdrop?.rebuild(); }

  /** The GPU bytes the layered backdrop holds now (its own census; 0 when it declares none). */
  bytes(): number { return this.backdrop?.gpuBytes?.() ?? 0; }

  state(): BackdropLayerState {
    return { weight: Math.round(this.weight_ * 1000) / 1000, drawn: this.drawn, attached: this.backdrop !== null, disposed: this.disposed, bytes: this.bytes(), applied: Math.round(this.applied * 1000) / 1000 };
  }

  /** The dome leaves the page scene and the backdrop frees its textures; the rig puts the last frame's values back. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const dome of this.domes) this.host.scene.remove(dome);
    this.domes.length = 0; this.materials.length = 0; this.followers.length = 0;
    this.backdrop?.dispose?.();
    this.backdrop = null;
    const disc = this.targets.disc;
    disc.geometry.dispose();
    if (disc.material instanceof Material) disc.material.dispose();
    this.targets.halo?.material.dispose();
    this.scope.dispose();
    this.onDispose();
  }
}

/**
 * One frame of layers over the page's own sky state (`SkyRig.update`, G223 / G242): every base layer first, at its weight's
 * share of what the other layers leave (`w / (1 − S)`, capped at 1), then the other layers at their own weights, in the order
 * they were laid. Returns the undos in the order they must NOT run: call them last to first before the page's backdrop runs
 * next.
 */
export function applyLayers(layers: Iterable<BackdropLayer>, dt: number, camera: PerspectiveCamera): (() => void)[] {
  const list = [...layers], undo: (() => void)[] = [];
  let taken = 0;
  for (const layer of list) if (!layer.base) taken += layer.weight;
  const left = 1 - Math.min(1, taken);
  for (const layer of list) {
    if (!layer.base) continue;
    const w = layer.weight, share = w <= OFF ? 0 : Math.min(1, w / Math.max(w, left));
    const done = layer.apply(dt, camera, share);
    if (done !== null) undo.push(done);
  }
  for (const layer of list) {
    if (layer.base) continue;
    const done = layer.apply(dt, camera);
    if (done !== null) undo.push(done);
  }
  return undo;
}

/** The parts of a level's sky and atmosphere a layer starts from (`seedLayerTargets`; structural: any level fits). */
export interface LayerLevelLight {
  readonly sky: Pick<SkySpec, 'sunColor' | 'sunIntensity' | 'hemiSky' | 'hemiGround' | 'hemiIntensity' | 'fogSunColor' | 'sun'>;
  readonly atmosphere: Pick<AtmosphereSpec, 'fogDistDensity' | 'fogHeightDensity'>;
}

/**
 * G321: start a layer's own targets from its level's declared light, as a standalone `SkyRig.build` starts the page's: the
 * key light's colour and intensity (and its direction where the level fixes its sun), the hemisphere fill, the fog's sun
 * tint and its distance and height densities. The environment intensity stays the holder scene's 1, as a standalone page
 * with a backdrop keeps it (its level's `envIntensity` is the HDRI path's). Its clock then writes over whatever it drives;
 * what it never writes stays its level's own.
 */
export function seedLayerTargets(layer: BackdropLayer, level: LayerLevelLight): void {
  const { sky: S, atmosphere: A } = level, t = layer.targets;
  t.sunColor.setRGB(...S.sunColor);
  for (const l of t.lights) { l.color.copy(t.sunColor); l.intensity = S.sunIntensity; }
  if (S.sun !== undefined) {
    compassDir(S.sun.azimuth, S.sun.elevation, t.sunDir);
    t.lightDirection.copy(t.sunDir).negate();
    t.fogU.fogSunDir.value.copy(t.sunDir); t.cloud.uSunDir.value.copy(t.sunDir); t.planet.uSunDir.value.copy(t.sunDir);
  }
  t.hemi.color.set(S.hemiSky); t.hemi.groundColor.set(S.hemiGround); t.hemi.intensity = S.hemiIntensity;
  t.fogU.fogSunColor.value.setRGB(...S.fogSunColor);
  t.fogU.fogDistDensity.value = A.fogDistDensity; t.fogU.fogHeightDensity.value = A.fogHeightDensity;
}

/**
 * G321: the page sky as a layered backdrop's factory is handed it (`SkyBackdropContext.sky`): the same sky, except that its
 * `setKeyLight` lands on the layer's own targets (`BackdropLayer.setKeyLight`), so a backdrop that moves the key light
 * through the rig (Sky Reach's fixed sun, Signal Dunes' dimming dusk key, a data look's clock) lights its cell by its
 * weight like every other value its clock writes. Every other member is the page sky's own.
 */
export function layerKeyedSky<S extends object>(sky: S, layer: Pick<BackdropLayer, 'setKeyLight'>): S {
  const setKeyLight = (dir: Vector3, color: Color, intensity: number): void => { layer.setKeyLight(dir, color, intensity); };
  return new Proxy<S>(sky, {
    get: (target, key) => {
      if (key === 'setKeyLight') return setKeyLight;
      const value: unknown = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      const bound: unknown = value.bind(target);
      return bound;
    },
  });
}
