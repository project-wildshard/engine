/**
 * One frame for the grid (SHARD-PLATFORM SF19a, re-aimed by G158; on for everyone since Jake's G175 pick, E450): inside
 * EXPERIMENTAL Wildshard the shard you stand in owns the whole frame, and on the road the neutral road look does (`frameModel.ts`). There is no per-pixel region and no shard-id
 * buffer: one look per frame, blended across 16 m at the cell edge.
 *
 * - **One clock, one sky, one sun**: the home look's backdrop is the world clock and draws the one dome and key light;
 *   the engine chain's tone mapping, bloom and vignette stay on.
 * - **The owner's air on everything**: before the scene draws, the scene fog's colour is the owner's air (the home
 *   look's live fog, a neighbour owner's declared haze, the neutral road air, by the owners' weights); every far proxy,
 *   near view and impostor hazes mildly toward it (G631, `GRID_HAZE`), all drawn to the 6 km far plane (G607).
 * - **The owner's grade on every pixel**: the home look's grade effects (saturation, contrast, split tone, the learned
 *   LUT) fade with the home's weight (their blend opacity), and one small effect appended to the engine's one colour
 *   pass applies the rest of the frame's grade (a neighbour owner's declared exposure / saturation / contrast / tint,
 *   the road's G75 grey-blue) uniformly. No extra pass, no extra target.
 * - **The road's sky and sun** (G165, Jake: "A, road light over everything"; G242's "grid dawn"): on the road the home look's
 *   sky and key light give way to the road's own dawn dome and low sun (`roadSky.ts`, the road owner's first stack: a base
 *   layer on the page's sky rig), and its air is the road's dawn air, so neighbours and sky alike sit under the road look; a
 *   shard's own sky and light show only once you are inside its cell (blended across the edge band).
 * - **Live regions** (`frameLook.ts`, E452): an admitted neighbour runtime contributes its own fog object and grade while
 *   resident; what its weather writes into that fog is its air (then the base goes back), its level's grade replaces the
 *   declared one. Still one fog, one dome, one sun.
 * - **A region's whole grade chain** (G232): on a neutral page shell (G226's owned home) the page's own grade effects carry
 *   the live owner region's grade instead of fading to nothing: inside its cell they hold its level's saturation,
 *   brightness, contrast and split tone (its runtime and its sky clock then drive them as standalone), and two effects
 *   compiled once at install, right after the page's split tone, add its look layer's S-curve and vibrance and its learned
 *   LUT (a neutral LUT until a region brings one; a LUT swap is a uniform, never a recompile). All of it fades with the
 *   owner's weight across the edge band, and the page's values go back when the region leaves the frame.
 * - **A cinematic region's shafts, fringe and grain** (SF63 follow-up): the shell runs the clean chain, so the three
 *   effects only the cinematic chain has are compiled into its colour pass at install, neutral (`regionCinematic.ts`); a
 *   carried region on the cinematic chain turns them on by its weight, its clock drives the shafts, and the march's target
 *   is allocated only while it carries them.
 * - **A region's own composite** (SF63 / G158, `ExtendLook.cell`): a resident region whose look declares its post composite
 *   puts its display after the shell's tone mapping (like a 'replace' chain's display transform) and its side passes before
 *   the colour pass; they run only while it carries the frame, and its weight fades its display in and the tone mapping out.
 *   A composite that is its whole colour chain (`LookCellComposite.replaces` 'chain', op-look30) also fades every other
 *   effect of the page's colour pass out by that weight (bloom, vignette, fringe, the grades, the LUT, the frame's grade),
 *   so inside its cell its display alone shades the frame, as standalone, blended back across the edge band.
 * - **Owner stacks** (`FrameStack`): each owner may hang a stack on the frame that is told its weight every frame. The
 *   home's grade fade is the first; SF59's per-shard post stacks (catalogue effects as data) hang here the same way.
 * Select a shard never builds this (grid page mode only).
 */
import { Color, Data3DTexture, NoColorSpace, PerspectiveCamera, SRGBColorSpace, Uniform, UnsignedByteType, Vector3, WebGLRenderTarget, type Camera, type Scene, type Texture } from 'three';
import { BlendFunction, Effect, EffectAttribute, EffectPass, LookupTexture, LUT3DEffect, type EffectComposer, type Pass } from 'postprocessing';
import type { Scope } from '@wildshard/engine/app/scope';
import { GradeLookEffect, type GradeEffect } from '@wildshard/engine/core/Grade';
import { LUT_SIZE } from '@wildshard/engine/render/lut';
import { CAMERA_FOV } from '@wildshard/engine/core/config';
import type { LookCellPost } from '@wildshard/engine/render/look';
import { RoadSky, type RoadSkyPage } from './roadSky';
import { FAR_RING, GRID_HAZE } from '../../../shared/game/grid/farProxy';
import { bindFrameLook, type FrameLookContribution, type FramePost, type FrameSkyLayer, type RegionChain, type RegionPost } from './frameLook';
import { NEUTRAL_GRADE, ROAD_SKY, dominantOwner, edgeDistance, frameFog, frameGrade, frameOwners, type FrameCell, type FullGrade, type RegionGrade, type RegionWeights } from './frameModel';

/** What the frame reads from the page: the scene and camera, the engine's composer and its grade effects (late-bound). */
export interface GridFrameHost {
  readonly scene: Scene;
  readonly camera: Camera;
  /** the engine's composer (throws before it is built: the frame then retries next frame) */
  readonly composer: () => EffectComposer;
  /** the engine chain's grade effects (null for a level whose look builds its own chain) */
  readonly post: () => FramePostEffects | null;
  /** the one sun's direction (a carried cinematic region's shafts start from it; absent: they wait for its clock) */
  readonly sunDir?: () => Vector3;
  /** a cinematic chain's shafts, fringe and grain for the shell's colour pass (the engine's `RegionCinematic`; absent: none) */
  readonly cinematic?: () => FrameCinematic;
  /** the page's scene pass draws into the depth slices (E142): its scene target's depth is the world's */
  readonly slices?: () => boolean;
  /** G242: the page's sky rig, which takes the road's dome and key light as its base layer (absent: the dome alone, no sun) */
  readonly sky?: () => RoadSkyPage | null;
  /** G321: the camera's projection changed (the frame's lens blend): refit what derives from it (the shadow cascades) */
  readonly refit?: () => void;
  /** G343: how far the eye stands above the player's feet, metres (absent: 0, the eye at the player) */
  readonly lift?: () => number;
  /** Prepare a revised colour shader before its next live draw (absent: ordinary synchronous boot). */
  readonly prepareDisplay?: (pass: EffectPass) => Promise<void>;
}

/**
 * G343: a cell's own sky owns the horizon around the player (G321): what stands outside the cell dithers away past the
 * near road, as on SHARD SELECT. An eye lifted far above the player (Explore's free camera, the hero camera over a cell)
 * is no longer standing in that horizon: between `near` and `far` metres above the feet the ownership hands back to the
 * grid, so the road and the neighbours draw as from the road. A play camera stays within a few metres of the feet (a
 * hover is the feet's own height), so what a player sees never changes.
 */
export const HORIZON_LIFT = { near: 40, far: 80 } as const;
/** The share of the horizon a cell's sky keeps with the eye `lift` metres above the feet (1 at the player, 0 up high). */
export function horizonLiftShare(lift: number): number {
  const t = Math.min(1, Math.max(0, (lift - HORIZON_LIFT.near) / (HORIZON_LIFT.far - HORIZON_LIFT.near)));
  return 1 - t * t * (3 - 2 * t);
}
/** The engine chain's grade effects the frame fades, and on a neutral shell writes a region's grade into (G232). */
export interface FramePostEffects {
  readonly grade: Effect & Pick<GradeEffect, 'set' | 'hold'>;
  readonly saturation: Effect & { saturation: number };
  readonly contrast: Effect & { brightness: number; contrast: number };
  /** SF63: the chain's bloom, vignette and god rays (null: the chain has none), whose knobs a carried region's chain sets */
  readonly bloom?: Effect & { intensity: number; readonly luminanceMaterial: { threshold: number; smoothing: number } };
  readonly vignette?: Effect & { darkness: number };
  readonly rays?: Effect | null;
  /** SF63: the scene's AO pass (null: the page draws none), whose strength a carried region's chain sets */
  readonly ao?: { readonly configuration: { intensity: number }; enabled: boolean } | null;
  /** SF63: the chain's tone mapping, which a carried 'replace' chain's own display transform takes over by the weight */
  readonly tone?: Effect;
}

/** The carried shafts, fringe and grain (the engine's `RegionCinematic`, `regionCinematic.ts`), as the frame drives them. */
export interface FrameCinematic {
  readonly place: (effects: Effect[], grainAfter: Effect, hasConvolution: boolean) => () => void;
  readonly depthFrom: (source: { readonly pass: Texture | null; readonly scene: WebGLRenderTarget | null }) => void;
  readonly warm: () => void;
  readonly port: (instance: string) => NonNullable<FramePost['vol']>;
  readonly forget: (instance: string) => void;
  readonly take: (instance: string, start: { readonly strength: number; readonly sunColor: readonly [number, number, number]; readonly sunDir?: Vector3 | undefined; readonly fog?: Color | undefined }) => void;
  readonly weight: (w: number, grainVisible?: boolean) => void;
  readonly release: () => void;
  /** G321 part 5: god rays for a page whose chain has none (null: none), and a region whose chain draws rays taking them */
  readonly rays?: Effect | null;
  readonly takeRays?: (instance: string) => void;
  readonly state: () => FrameCinematicState;
  readonly dispose: () => void;
}
/** Its readout: carrier, weight, shafts' opacity and strength, fringe offset, grain opacity, march target, depth source. */
export interface FrameCinematicState {
  readonly carrier: string | null; readonly weight: number; readonly vol: readonly [number, number]; readonly chroma: number; readonly grain: number;
  readonly target: readonly [number, number] | null; readonly depth: 'pass' | 'scene' | 'none'; readonly sceneDepth: boolean;
}

/** The frame's readout (tests, the harness, the board). */
export interface GridFrameState {
  readonly installed: boolean;
  /** how many of the home look's grade effects fade with its weight */
  readonly faded: number;
  /** the owner holding most of the frame (null: the road look) */
  readonly owner: string | null;
  readonly highway: number;
  readonly weights: Readonly<Record<string, number>>;
  readonly air: readonly [number, number, number];
  /** the frame's own grade on top of the home's: exposure, saturation, contrast, then the tint */
  readonly grade: readonly [number, number, number, number, number, number];
  /** the road sky's drawn opacity (G165: 1 on the road, 0 inside a cell) */
  readonly roadSky: number;
  /** G223: the regions' own skies laid over the one sky (instance → its readout); empty with the Debug row on A */
  readonly skies: Readonly<Record<string, ReturnType<FrameSkyLayer['state']>>>;
  /**
   * G321: the camera's vertical field of view as drawn, the road's, and each live region's own (its kit's last write, else
   * the boot camera's `CAMERA_FOV`, as a standalone boot of it starts)
   */
  readonly lens: { readonly fov: number; readonly road: number; readonly regions: Readonly<Record<string, number>> };
  /** G321: how much of the frame the live regions' own skies own (their weights' sum): the road's void floor fades by it */
  readonly horizon: number;
  /**
   * G232: the region whose whole grade chain the page's grade carries (null: none), its weight, whether its LUT is drawn,
   * and the page's grade values as drawn: saturation, brightness, contrast, curve, vibrance
   */
  readonly chain: { readonly owner: string | null; readonly weight: number; readonly lut: boolean; readonly values: readonly [number, number, number, number, number];
    /** SF63: the page chain's knobs as drawn: bloom intensity, threshold, smoothing, vignette darkness, god rays' opacity, AO strength (0 while its pass is skipped) (−1: none) */
    readonly post: readonly [number, number, number, number, number, number];
    /** SF63 follow-up: a cinematic region's shafts, fringe and grain in the page's colour pass (null: not installed) */
    readonly fx: FrameCinematicState | null;
    /** op-look30: how far the page's colour effects are faded out for a whole-chain composite (0: drawn, 1: its display alone) */
    readonly bypass: number };
}

/**
 * Something an owner hangs on the frame (SF59's post stack is one): told the owner's weight (0..1) once per frame, before
 * the scene draws. A stack at weight 0 must cost nothing visible.
 */
export interface FrameStack { readonly weight: (w: number) => void; readonly dispose?: () => void }

/** The frame's grade, one small effect at the end of the colour pass: exposure, saturation, contrast, tint, uniform. */
export class FrameGradeEffect extends Effect {
  /** x exposure (stops), y saturation, z contrast */
  readonly grade: Vector3;
  /** linear RGB multiplier (white = none) */
  readonly tint: Vector3;
  constructor() {
    const grade = new Vector3(NEUTRAL_GRADE.exposure, NEUTRAL_GRADE.saturation, NEUTRAL_GRADE.contrast), tint = new Vector3(1, 1, 1);
    super('GridFrameGrade', /* glsl */`
      uniform vec3 uGrade;
      uniform vec3 uTint;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb * exp2(uGrade.x);
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = max(mix(vec3(l), c, uGrade.y), 0.0);
        c = max((c - 0.214) * uGrade.z + 0.214, 0.0); // pivot: mid grey in linear light
        outputColor = vec4(c * uTint, inputColor.a);
      }`, { blendFunction: BlendFunction.SRC, uniforms: new Map<string, Uniform>([['uGrade', new Uniform(grade)], ['uTint', new Uniform(tint)]]) });
    this.grade = grade; this.tint = tint;
  }
  /** Set the grade. */
  set(grade: RegionGrade): void {
    this.grade.set(grade.exposure, grade.saturation, grade.contrast);
    const tint = grade.tint ?? [1, 1, 1]; this.tint.set(tint[0], tint[1], tint[2]);
  }
}

/**
 * Fade effects with a weight through their blend opacity (the home look's grade under the frame). An opacity someone
 * else wrote since the last frame becomes the new full value; dispose puts every full value back.
 */
export function opacityFade(effects: readonly Effect[]): FrameStack & { readonly dispose: () => void } {
  const read = (u: Uniform): number => { const v: unknown = u.value; return typeof v === 'number' ? v : 1; };
  const entries = effects.map((effect) => ({ opacity: effect.blendMode.opacity, full: read(effect.blendMode.opacity), written: Number.NaN }));
  return {
    weight: (w) => {
      for (const e of entries) {
        const now = read(e.opacity);
        if (now !== e.written) e.full = now;
        e.written = e.full * w; e.opacity.value = e.written;
      }
    },
    dispose: () => { for (const e of entries) e.opacity.value = e.full; },
  };
}

/** A 33³ RGBA8 identity LUT, the texture type every learned LUT has (`world/lut.ts`), so a swap never changes the defines. */
export function neutralLut(): LookupTexture {
  const n = LUT_SIZE, data = new Uint8Array(n * n * n * 4);
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
    const i = ((b * n + g) * n + r) * 4;
    data[i] = Math.round((r / (n - 1)) * 255); data[i + 1] = Math.round((g / (n - 1)) * 255); data[i + 2] = Math.round((b / (n - 1)) * 255); data[i + 3] = 255;
  }
  const lut = new LookupTexture(data, n);
  lut.type = UnsignedByteType; lut.colorSpace = NoColorSpace; lut.name = 'grid-frame-neutral-lut'; lut.needsUpdate = true;
  return lut;
}
/** A LUT the frame's compiled LUT effect can sample by a uniform swap: the same size, type and domain as the neutral one. */
export function swappableLut(lut: Texture): boolean {
  if (!(lut instanceof Data3DTexture) || lut.type !== UnsignedByteType) return false;
  const { width, height, depth } = lut.image;
  if (width !== LUT_SIZE || height !== LUT_SIZE || depth !== LUT_SIZE) return false;
  return !(lut instanceof LookupTexture) || (lut.domainMin.x === 0 && lut.domainMin.y === 0 && lut.domainMin.z === 0 && lut.domainMax.x === 1 && lut.domainMax.y === 1 && lut.domainMax.z === 1);
}

/** Every entry an Effect: the narrowing keeps the array itself, never a copy. */
function isEffectList(list: unknown): list is Effect[] {
  return Array.isArray(list) && list.every((e) => e instanceof Effect);
}

/**
 * The effects of an EffectPass (its list is private in the typings; read at run time and checked). It is the pass's own
 * live array, so an effect pushed into it is drawn on the next recompile (a filtered copy dropped the frame grade).
 */
export function passEffects(pass: EffectPass): Effect[] | null {
  const found: unknown = Reflect.get(pass, 'effects');
  return isEffectList(found) ? found : null;
}

/**
 * SF63: a carried region's engine chain knobs on the page's same effects: bloom's intensity, threshold and smoothing, the
 * vignette's darkness, the god rays' opacity and the AO strength (a region whose own frame draws no AO fades the page's
 * out, and at full weight the pass is skipped), each moved from the page's value toward the region's by the owner weight
 * every frame (all uniforms and a pass's `enabled`: nothing compiles). The region's clock may drive the rays' opacity itself (`FramePost.rays`):
 * a value written since the last frame is the region's own and is kept. `restore` puts the page's values back. Null when
 * the region carries no knobs (a 'replace' look).
 */
export function chainKnobs(post: FramePostEffects, knobs: RegionPost | undefined, pageRays?: number): { readonly weight: (w: number) => void; readonly restore: () => void } | null {
  if (knobs === undefined) return null;
  const bloom = post.bloom, vignette = post.vignette, rays = post.rays ?? null, ao = post.ao ?? null;
  const read = (u: Uniform): number => { const v: unknown = u.value; return typeof v === 'number' ? v : 1; };
  // `pageRays` (G321 part 5): the page's own rays value when the rays are carried ones (0: the page draws none), never read
  // back from an effect a region's clock may have written first
  const page = { intensity: bloom?.intensity ?? 0, threshold: bloom?.luminanceMaterial.threshold ?? 0, smoothing: bloom?.luminanceMaterial.smoothing ?? 0,
    darkness: vignette?.darkness ?? 0, rays: rays === null ? 0 : pageRays ?? read(rays.blendMode.opacity), ao: ao?.configuration.intensity ?? 0, aoOn: ao?.enabled ?? false };
  // the rays' full value: the region's chain's own, or what its clock wrote since the last frame
  let raysOwn = knobs.rays, raysWritten = Number.NaN;
  const mix = (a: number, b: number, w: number): number => a + (b - a) * w;
  return {
    weight: (w) => {
      if (bloom !== undefined) {
        bloom.intensity = mix(page.intensity, knobs.bloomIntensity, w);
        bloom.luminanceMaterial.threshold = mix(page.threshold, knobs.bloomThreshold, w);
        bloom.luminanceMaterial.smoothing = mix(page.smoothing, knobs.bloomSmoothing, w);
      }
      if (vignette !== undefined) vignette.darkness = mix(page.darkness, knobs.vignette, w);
      if (rays !== null) {
        const now = read(rays.blendMode.opacity);
        if (!Number.isNaN(raysWritten) && now !== raysWritten) raysOwn = now;
        raysWritten = mix(page.rays, raysOwn, w); rays.blendMode.opacity.value = raysWritten;
      }
      if (ao !== null && !knobs.ao) { ao.configuration.intensity = mix(page.ao, 0, w); ao.enabled = page.aoOn && w < 0.999; }
    },
    restore: () => {
      if (bloom !== undefined) { bloom.intensity = page.intensity; bloom.luminanceMaterial.threshold = page.threshold; bloom.luminanceMaterial.smoothing = page.smoothing; }
      if (vignette !== undefined) vignette.darkness = page.darkness;
      if (rays !== null) rays.blendMode.opacity.value = page.rays;
      if (ao !== null) { ao.configuration.intensity = page.ao; ao.enabled = page.aoOn; }
    },
  };
}

/** The page's colour effects faded out for a whole-chain composite (op-look30, `chainBypass`). */
export interface ChainBypass {
  /** the effects it fades, in the pass's order */
  readonly effects: readonly Effect[];
  /** fade them out by `w` (0: as their writers left them, 1: none drawn): the frame's last write before the draw */
  readonly apply: (w: number) => void;
  /** put back each opacity this wrote, unless someone wrote it since (the frame's first step, before any writer) */
  readonly restore: () => void;
  /** the weight last applied */
  readonly weight: () => number;
  /** the opacities and blend functions back as they were */
  readonly dispose: () => void;
}

/**
 * op-look30: the page's colour effects faded out by a whole-chain composite's weight. An effect that blends SRC ignores its
 * opacity, so it blends NORMAL instead (NORMAL at opacity 1 draws what SRC drew; the change recompiles with the placement
 * that built this) and its full value stays 1 whatever its opacity reads (what SRC drew). Opacities are written last
 * before the draw and put back first in the next frame, so the page's own fades (`opacityFade`, the rays' clock) never
 * read a faded value back as their own.
 */
export function chainBypass(effects: readonly Effect[]): ChainBypass {
  const read = (u: Uniform): number => { const v: unknown = u.value; return typeof v === 'number' ? v : 1; };
  const entries = effects.map((effect) => {
    const src = effect.blendMode.blendFunction === BlendFunction.SRC;
    if (src) effect.blendMode.blendFunction = BlendFunction.NORMAL;
    return { effect, src, opacity: effect.blendMode.opacity, own: Number.NaN, written: Number.NaN };
  });
  let applied = 0;
  const restore = (): void => {
    for (const e of entries) { if (!Number.isNaN(e.written) && read(e.opacity) === e.written) e.opacity.value = e.own; e.written = Number.NaN; }
  };
  return {
    effects,
    apply: (w) => {
      applied = Math.min(1, Math.max(0, w));
      for (const e of entries) {
        if (!e.src && applied === 0) continue; // as its writers left it
        e.own = read(e.opacity);
        e.written = (e.src ? 1 : e.own) * (1 - applied); e.opacity.value = e.written;
      }
    },
    restore,
    weight: () => applied,
    dispose: () => { restore(); for (const e of entries) if (e.src) e.effect.blendMode.blendFunction = BlendFunction.SRC; },
  };
}

/** three's tone-mapping chunk, which a colour pass may include once (op-frame22) */
const TONE_CHUNK = /#include\s*<tonemapping_pars_fragment>/u;

interface FrameAirWork {
  readonly home:{instance:string|null;fog:[number,number,number]};
  readonly airs:Map<string,readonly [number,number,number]>;readonly rows:Map<string,[number,number,number]>;
}
/** The live one frame. Built by the grid session for every host with a frame (G175); disposed with the level scope. */
export class GridFrame {
  private readonly host: GridFrameHost;
  private readonly cells: readonly FrameCell[];
  private readonly homeInstance: string | null;
  private readonly half: number;
  private readonly band: number | undefined;
  private readonly feet: () => { readonly x: number; readonly z: number };
  private readonly hazes = new Map<string, readonly [number, number, number]>();
  private readonly grades = new Map<string, RegionGrade>();
  /** live regions' contributions (instance → its look), and the airs the owners bring this frame */
  private readonly live = new Map<string, FrameLookContribution>();
  private readonly owned = new Map<string, RegionGrade>();
  private readonly airWork:FrameAirWork[]=[];
  private frameRetired=false;
  /** G223: live regions' own skies (instance → its layer) */
  private readonly skies = new Map<string, FrameSkyLayer>();
  /** owner (an instance, or null for the road) → its stacks */
  private readonly stacks = new Map<string | null, Set<FrameStack>>();
  private readonly effect = new FrameGradeEffect();
  /** G232: a carried region's look layer and learned LUT, after the page's split tone (shell pages only) */
  private readonly lookEffect = new GradeLookEffect();
  private readonly neutral = neutralLut();
  private readonly lutEffect = new LUT3DEffect(this.neutral, { inputColorSpace: SRGBColorSpace, tetrahedralInterpolation: true });
  /** the page's grade effects (set at install on a shell page: chains are carried) and their fade by the carried weight */
  private chainPost: FramePostEffects | null = null;
  private chainFade: FrameStack | null = null;
  private carrier: { readonly instance: string; readonly chain: RegionChain; readonly restore: () => void; readonly knobs: ((w: number) => void) | null } | null = null;
  private chainWeight = 0;
  private chainLut = false;
  /** SF63 follow-up: a cinematic region's shafts, fringe and grain, compiled into the shell's colour pass at install */
  private cine: FrameCinematic | null = null;
  /** G321 part 5: the chain's god rays are the carried ones (`FrameCinematic.rays`), at 0 on the page */
  private carriedRays = false;
  /** SF63: the shell's colour pass and its effect list (set at install), where a resident region's display transform goes */
  private colour: { readonly composer: EffectComposer; readonly pass: EffectPass; readonly effects: Effect[]; readonly tone: Effect } | null = null;
  /** SF63 / G158: each resident region's own composite side passes (`ExtendLook.cell`), before the colour pass */
  private readonly cellPasses = new Map<string, readonly Pass[]>();
  /** SF63: each resident region's own display transform (a 'replace' chain's), placed after the page's tone mapping */
  private readonly displays = new Map<string, Effect>();
  /** op-look30: the resident regions whose composite is their whole colour chain (`replaces` 'chain') */
  private readonly wholes = new Set<string>();
  /** op-look30: the page's colour effects a whole-chain carrier fades out (built while one is resident and the pass installed) */
  private bypass: ChainBypass | null = null;
  private readonly roadSky = new RoadSky();
  /** G321: each live region's own field of view, and the road's (`lens`) */
  private readonly lenses = new Map<string, number>();
  private roadFov = Number.NaN;
  private lensWritten = Number.NaN;
  /** G321: what fades by how much the regions' own skies own the frame (the road's void floor), and that share as told */
  private readonly horizons = new Set<(owned: number, cell: FrameCell | null) => void>();
  private skyShare = 0;
  /** the eye's height above the feet when the scene last drew (G343) */
  private drawnLift = 0;
  /** G321 part 4: the cell whose own sky owns most of the frame (null on the road) */
  private skyCell: FrameCell | null = null;
  private readonly restore: (() => void)[] = [];
  private faded = 0;
  private installed = false;
  private weights: RegionWeights = { cells: new Map(), highway: 0 };
  private graded: FullGrade = { ...NEUTRAL_GRADE, tint: [1, 1, 1] };
  private readonly air = new Color();
  private readonly homeFog = new Color();
  private readonly written = new Color(Number.NaN, Number.NaN, Number.NaN);
  private readonly eye = new Vector3();

  constructor(options: { host: GridFrameHost; scope: Scope; cells: readonly FrameCell[]; home: FrameCell; homeIsFrame?: boolean; half: number; band?: number; feet: () => { readonly x: number; readonly z: number } }) {
    const { host, scope, home } = options;
    this.host = host; this.cells = options.cells; this.homeInstance = options.homeIsFrame === false ? null : home.instance; this.half = options.half; this.band = options.band; this.feet = options.feet;
    this.weights = { cells: new Map([[home.instance, 1]]), highway: 0 };
    // the scene fog is the owner's air while the scene draws (the backdrop has written its own by then)
    const prev = host.scene.onBeforeRender.bind(host.scene);
    host.scene.onBeforeRender = (...args) => { this.beforeScene(); prev(...args); };
    // SF88c: the grid's whole sightline inside the camera's far plane (a standalone boot's 2600 m covers one cell); back on dispose
    const lens = host.camera instanceof PerspectiveCamera ? host.camera : null, standaloneFar = lens?.far ?? 0;
    if (lens !== null) { lens.far = FAR_RING.drawDistance; lens.updateProjectionMatrix(); }
    // G165: the road's own sky, its opacity the road's weight
    const detachSky = this.roadSky.attach(host);
    this.stack(null, { weight: (w) => { this.roadSky.weight(w); } });
    this.lookEffect.blendMode.opacity.value = 0; this.lutEffect.blendMode.opacity.value = 0;
    const unbind = bindFrameLook(host.scene, { contribute: (instance, look) => this.contribute(instance, look), sky: (instance, layer) => this.sky(instance, layer),
      owned: (instance, weight) => this.stack(instance, { weight }),
      composite: (instance, post, replaces) => this.composite(instance, post, replaces),
      post: (instance?: string): FramePost | null => (this.chainPost === null ? null : { hueSat: this.chainPost.saturation, rays: this.chainPost.rays ?? null,
        vol: instance === undefined || this.cine === null ? null : this.cine.port(instance) }) });
    scope.onDispose(() => {
      this.frameRetired=true;this.airWork.length=0;
      unbind(); this.live.clear(); this.skies.clear();
      host.scene.onBeforeRender = prev; this.uninstall(); this.effect.dispose(); this.lookEffect.dispose(); this.lutEffect.dispose(); this.neutral.dispose();
      this.cine?.dispose(); this.cine = null;
      for (const display of this.displays.values()) display.dispose();
      this.displays.clear();
      for (const passes of this.cellPasses.values()) for (const p of passes) p.dispose();
      this.cellPasses.clear();
      detachSky(); this.roadSky.dispose();
      if (lens !== null) { lens.far = standaloneFar; lens.updateProjectionMatrix(); }
      for (const set of this.stacks.values()) for (const stack of set) stack.dispose?.();
      this.stacks.clear();
    });
  }

  /** A neighbour's declared look (its haze and grade), as its far proxy arrives (or before): what it brings as owner. */
  declare(instance: string, look: { readonly haze: { readonly colour: readonly [number, number, number] }; readonly grade?: RegionGrade | undefined }): void {
    if (instance === this.homeInstance) return;
    this.hazes.set(instance, look.haze.colour);
    this.grades.set(instance, look.grade ?? NEUTRAL_GRADE);
  }

  /**
   * A live region's look as its cell's owner (`frameLook.ts`): its fog object's colour as written each frame is the
   * owner's air, its grade replaces the declared one. Returns the release (the declared look applies again).
   */
  contribute(instance: string, look: FrameLookContribution): () => void {
    if (instance === this.homeInstance) throw new Error('The home look is the frame itself; only a neighbour region contributes');
    if (this.live.has(instance)) throw new Error(`Grid frame already has a live look for ${instance}`);
    this.live.set(instance, look);
    this.lenses.set(instance, CAMERA_FOV); // G321: its camera starts as a standalone boot of it starts
    const declared = this.hazes.get(instance);
    if (declared !== undefined) look.fog?.color.setRGB(...declared); // start from the base (else its own colour until the first draw)
    // SF63: its own display transform joins the shell's colour pass while it is resident (one recompile now, as it loads,
    // and one as it unloads; crossing its edge only moves opacities)
    const make = look.chain?.post?.display;
    if (make !== undefined) { const display = make(); display.blendMode.opacity.value = 0; this.displays.set(instance, display); this.placeDisplay(display, true); }
    return () => {
      if (this.live.get(instance) !== look) return;
      this.live.delete(instance); this.lenses.delete(instance);
      if (this.carrier?.instance === instance) this.drop(); // at once: its LUT may be freed right after
      this.cine?.forget(instance);
      const display = this.displays.get(instance);
      if (display !== undefined) {
        this.displays.delete(instance);
        const colour = this.colour, i = colour?.effects.indexOf(display) ?? -1;
        if (colour !== null && i !== -1) { colour.effects.splice(i, 1); colour.pass.recompile(); }
        display.dispose();
      }
      const passes = this.cellPasses.get(instance);
      if (passes !== undefined) { this.cellPasses.delete(instance); for (const p of passes) { this.colour?.composer.removePass(p); p.dispose(); } }
    };
  }

  /**
   * A live region's own sky (`regionSky.ts`, G223): told its cell's owner weight each frame (1 inside, blended across the
   * edge band, 0 on the road). Returns the release.
   */
  sky(instance: string, layer: FrameSkyLayer): () => void {
    if (instance === this.homeInstance) throw new Error('The home look owns the one sky; only a neighbour region lays its own over it');
    if (this.skies.has(instance)) throw new Error(`Grid frame already has a sky for ${instance}`);
    this.skies.set(instance, layer);
    const unstack = this.stack(instance, { weight: (w) => { layer.weight(w); } });
    return () => { if (this.skies.get(instance) === layer) this.skies.delete(instance); unstack(); layer.weight(0); };
  }

  /**
   * A live region's own post composite (SF63 / G158, `ExtendLook.cell`): its display after the shell's tone mapping, its side
   * passes before the colour pass (both placed now, one recompile, or at the install), run and faded in by its weight
   * while it carries the frame. `replaces` 'chain' (op-look30): its display is the whole colour chain, so the page's other
   * colour effects fade out by its weight too. Returns the release, which removes and frees them.
   */
  composite(instance: string, post: LookCellPost, replaces: 'chain' | 'tone' = 'tone'): () => void {
    if (!this.live.has(instance)) throw new Error(`Grid frame has no live look for ${instance} to composite`);
    if (this.displays.has(instance) || this.cellPasses.has(instance)) throw new Error(`Grid frame already has a display for ${instance}`);
    const display = post.display, passes = [...(post.passes ?? [])];
    // op-frame22: the shell's tone mapping already includes three's tone-mapping chunk; a second copy in the merged colour
    // pass redefines it, the pass never compiles and the frame freezes on its last image (Sky Reach's first composite)
    if (TONE_CHUNK.test(display.getFragmentShader())) throw new Error(`Grid frame refuses ${instance}'s display: three's tone-mapping chunk is already in the colour pass`);
    display.blendMode.blendFunction = BlendFunction.NORMAL; display.blendMode.opacity.value = 0;
    for (const p of passes) p.enabled = false;
    this.displays.set(instance, display); this.cellPasses.set(instance, passes);
    if (replaces === 'chain') { this.wholes.add(instance); this.rebypass(); }
    this.placePasses(passes); this.placeDisplay(display, true);
    if (this.carrier?.instance === instance) this.drop(); // taken again next frame, with its composite
    return () => {
      if (this.displays.get(instance) !== display) return;
      if (this.carrier?.instance === instance) this.drop();
      this.displays.delete(instance); this.cellPasses.delete(instance);
      const colour = this.colour, i = colour?.effects.indexOf(display) ?? -1;
      if (colour !== null && i !== -1) colour.effects.splice(i, 1);
      if (this.wholes.delete(instance)) this.rebypass(); // with the same recompile
      if (colour !== null && i !== -1) colour.pass.recompile();
      for (const p of passes) colour?.composer.removePass(p);
      display.dispose(); for (const p of passes) p.dispose();
    };
  }

  /** a composite's side passes right before the colour pass (nothing before the install: the install places them) */
  private placePasses(passes: readonly Pass[]): void {
    const colour = this.colour;
    if (colour === null) return;
    for (const p of passes) if (!colour.composer.passes.includes(p)) colour.composer.addPass(p, colour.composer.passes.indexOf(colour.pass));
  }

  /**
   * G321: be told, each frame, how much of the frame the live regions' own skies own (the sum of their cells' weights,
   * 0..1): inside a cell whose shard draws its own sky its backdrop owns the horizon, so the road's void floor fades by it.
   * `cell` is the cell whose own sky owns most of it (null on the road; op-sky43: what stands outside it fades). Returns the
   * release.
   */
  horizon(fade: (owned: number, cell: FrameCell | null) => void): () => void {
    this.horizons.add(fade); fade(this.skyShare, this.skyCell);
    return () => { this.horizons.delete(fade); };
  }

  /** Hang a stack on an owner (an instance, or null for the road look); it is told that owner's weight each frame. */
  stack(owner: string | null, stack: FrameStack): () => void {
    let set = this.stacks.get(owner);
    if (set === undefined) { set = new Set(); this.stacks.set(owner, set); }
    set.add(stack);
    return () => { if (this.stacks.get(owner)?.delete(stack) === true) stack.dispose?.(); };
  }

  /** Once per frame (the page's late phase): the owners from the player's feet, then the install once the composer exists. */
  frame(): void {
    const at = this.feet();
    this.weights = frameOwners(this.cells, at.x, at.z, this.half, this.band);
    this.bypass?.restore(); // the writers below see their own values
    if (this.chainPost !== null) this.carry(at);
    this.graded = frameGrade(this.weights, this.homeInstance, this.ownerGrades());
    this.effect.set(this.graded);
    for (const [owner, set] of this.stacks) {
      const w = owner === null ? this.weights.highway : this.weights.cells.get(owner) ?? 0;
      for (const stack of set) stack.weight(w);
    }
    this.lens();
    let owned = 0, top = 0, cell: FrameCell | null = null;
    for (const instance of this.skies.keys()) {
      const w = this.weights.cells.get(instance) ?? 0; owned += w;
      if (w > top) { top = w; cell = this.cells.find((c) => c.instance === instance) ?? null; }
    }
    this.skyShare = Math.min(1, owned) * horizonLiftShare(this.drawnLift); this.skyCell = cell;
    for (const fade of this.horizons) fade(this.skyShare, this.skyCell);
    if (!this.installed) this.install();
    this.bypass?.apply(this.carrier !== null && this.wholes.has(this.carrier.instance) ? this.chainWeight : 0);
  }

  private install(): void {
    let composer: EffectComposer;
    try { composer = this.host.composer(); } catch { return; } // not built yet: next frame
    this.installed = true;
    const post = this.host.post();
    if (post === null) return; // a level that builds its own chain: the air still follows the owner, the grade stays the home's
    for (const pass of composer.passes) {
      if (!(pass instanceof EffectPass)) continue;
      const effects = passEffects(pass);
      if (effects === null || !effects.includes(post.saturation)) continue;
      const home = effects.filter((effect) => effect === post.saturation || effect === post.contrast || effect === post.grade || effect instanceof LUT3DEffect);
      this.faded = home.length;
      let unstack: () => void;
      if (this.homeInstance === null) {
        // neutral shell: every cell supplies its own grade. Its grade effects carry a live owner region's (G232), by its
        // weight; the shell's own LUT stays out; the region's look layer and LUT go right after the split tone
        const own: Effect[] = [post.saturation, post.contrast, post.grade];
        const carried = opacityFade(home.filter((effect) => own.includes(effect))), rest = opacityFade(home.filter((effect) => !own.includes(effect)));
        carried.weight(0); rest.weight(0);
        this.chainFade = carried; this.chainPost = post;
        const at = Math.max(...own.map((effect) => effects.indexOf(effect))) + 1;
        effects.splice(at, 0, this.lookEffect, this.lutEffect);
        // SF63 follow-up: a cinematic region's shafts, fringe and grain, neutral until one carries them
        const unplace = this.placeCinematic(composer, pass, effects);
        // G321 part 5: a shell whose chain leaves its god rays out carries a region's in the rays placed with them
        const carriedRays = (post.rays ?? null) === null ? this.cine?.rays ?? null : null;
        if (carriedRays !== null && effects.includes(carriedRays)) { this.chainPost = { ...post, rays: carriedRays }; this.carriedRays = true; }
        // SF63: a 'replace' region's display transform takes over the tone mapping by its weight: the tone mapping blends
        // (NORMAL at opacity 1 draws exactly what SRC drew) and the regions resident before the install are placed now
        const tone = post.tone, toneBlend = tone?.blendMode.blendFunction;
        if (tone !== undefined && effects.includes(tone)) {
          tone.blendMode.blendFunction = BlendFunction.NORMAL;
          this.colour = { composer, pass, effects, tone };
          for (const display of this.displays.values()) this.placeDisplay(display, false);
          for (const passes of this.cellPasses.values()) this.placePasses(passes);
        }
        unstack = () => {
          this.drop(); this.chainPost = null; this.chainFade = null; this.carriedRays = false; carried.dispose(); rest.dispose();
          for (const effect of [this.lookEffect, this.lutEffect, ...this.displays.values()]) { const i = effects.indexOf(effect); if (i !== -1) effects.splice(i, 1); }
          if (tone !== undefined && toneBlend !== undefined) { tone.blendMode.blendFunction = toneBlend; tone.blendMode.opacity.value = 1; }
          for (const passes of this.cellPasses.values()) for (const p of passes) composer.removePass(p);
          this.colour = null;
          unplace();
        };
      } else {
        const fade = opacityFade(home);
        unstack = this.stack(this.homeInstance, fade);
      }
      effects.push(this.effect);
      this.rebypass();
      this.restore.push(() => { unstack(); this.bypass?.dispose(); this.bypass = null; const i = effects.indexOf(this.effect); if (i !== -1) effects.splice(i, 1); pass.recompile(); });
      pass.recompile();
      return;
    }
  }

  /**
   * The cinematic chain's shafts, fringe and grain in the shell's colour pass (`regionCinematic.ts`): placed now, compiled by
   * the install's one recompile, the march's program warmed. Returns the removal.
   */
  private placeCinematic(composer: EffectComposer, pass: EffectPass, effects: Effect[]): () => void {
    const cine = this.host.cinematic?.();
    if (cine === undefined) return () => undefined;
    const convolution = effects.some((effect) => (effect.getAttributes() & EffectAttribute.CONVOLUTION) !== 0);
    const unplace = cine.place(effects, this.lutEffect, convolution);
    const scene: unknown = this.host.slices?.() === true ? composer.inputBuffer : null;
    cine.depthFrom({ pass: pass.getDepthTexture(), scene: scene instanceof WebGLRenderTarget ? scene : null });
    cine.warm();
    this.cine = cine;
    return () => { unplace(); cine.release(); };
  }

  /** a display transform right after the page's tone mapping (nothing before the install: the install places it) */
  private placeDisplay(display: Effect, recompile: boolean): void {
    const colour = this.colour;
    if (colour === null || colour.effects.includes(display)) return;
    colour.effects.splice(colour.effects.indexOf(colour.tone) + 1, 0, display);
    if (recompile) void this.prepareDisplay(colour.pass);
  }

  private async prepareDisplay(pass: EffectPass): Promise<void> {
    try {
      if (this.host.prepareDisplay === undefined) pass.recompile();
      else await this.host.prepareDisplay(pass);
    } catch (error) { console.warn('[grid] display preparation failed', error); }
  }

  /**
   * op-look30: (re)build the fade of the page's colour effects for a whole-chain composite: every effect of the shell's
   * colour pass but the tone mapping (faded by `take`) and the regions' displays, while a whole-chain region is resident and
   * the pass is installed (the callers recompile next). Nothing resident: the effects are as they were.
   */
  private rebypass(): void {
    const colour = this.colour, displays = new Set(this.displays.values());
    const page = colour === null || this.wholes.size === 0 ? [] : colour.effects.filter((effect) => effect !== colour.tone && !displays.has(effect));
    const now = this.bypass?.effects ?? [];
    if (page.length === now.length && page.every((effect, i) => effect === now[i])) return; // the same effects: nothing to redo
    this.bypass?.dispose(); this.bypass = page.length === 0 ? null : chainBypass(page);
  }

  /** the owners' grades: a live region's own over its declared one; neutral for one whose whole chain is carried */
  private ownerGrades(): ReadonlyMap<string, RegionGrade> {
    if (this.live.size === 0) return this.grades;
    this.owned.clear();
    this.grades.forEach((grade,instance)=>{this.owned.set(instance,grade);});
    this.live.forEach((look,instance)=>{
      if(this.chainPost!==null&&look.chain!==undefined)this.owned.set(instance,NEUTRAL_GRADE);
      else if(look.grade!==undefined)this.owned.set(instance,look.grade);
    });
    return this.owned;
  }

  /** G232: the live region with the most weight that brings a chain carries the page's grade, faded by its weight. */
  private carry(at: { readonly x: number; readonly z: number }): void {
    let best: string | null = null, top = 0, chain: RegionChain | null = null;
    for (const [instance, look] of this.live) {
      const w = look.chain === undefined ? 0 : this.weights.cells.get(instance) ?? 0;
      if (w > top && look.chain !== undefined) { best = instance; top = w; chain = look.chain; }
    }
    if (this.carrier !== null && this.carrier.instance !== best) this.drop();
    if (best !== null && chain !== null && this.carrier === null) this.take(best, chain);
    this.chainWeight = top;
    this.chainFade?.weight(top);
    this.carrier?.knobs?.(top);
    const cell = best === null ? undefined : this.cells.find(row => row.instance === best);
    // G725: colour may blend across the edge; film grain belongs only to the actual cell interior.
    this.cine?.weight(top, cell !== undefined && edgeDistance(cell, at.x, at.z, this.half) <= 0);
    this.lookEffect.blendMode.opacity.value = top;
    const lut = this.carrier?.chain.lut() ?? null, drawn = lut !== null && swappableLut(lut);
    this.lutUniform(drawn ? lut : this.neutral);
    this.lutEffect.blendMode.opacity.value = drawn ? top : 0;
    this.chainLut = drawn;
  }

  /** the compiled LUT effect samples another LUT of the same kind: a uniform, so the pass never recompiles */
  private lutUniform(lut: Texture): void {
    const u = this.lutEffect.uniforms.get('lut');
    if (u !== undefined && u.value !== lut) u.value = lut;
  }

  /** a region takes the page's grade: the page's values are held, its level's chain written (its clocks drive them on) */
  private take(instance: string, chain: RegionChain): void {
    const post = this.chainPost;
    if (post === null) return;
    const saturation = post.saturation.saturation, brightness = post.contrast.brightness, contrast = post.contrast.contrast, undoGrade = post.grade.hold();
    const g = chain.grade, rgb = (c: readonly [number, number, number]): [number, number, number] => [c[0], c[1], c[2]];
    post.saturation.saturation = g.saturation; post.contrast.brightness = g.brightness; post.contrast.contrast = g.contrast;
    post.grade.set({ shadowTint: rgb(g.shadowTint), highTint: rgb(g.highTint), lift: rgb(g.lift), gain: rgb(g.gain), gamma: g.gamma });
    this.lookEffect.set(chain.look);
    const knobs = chainKnobs(post, chain.post, this.carriedRays ? 0 : undefined), display = this.displays.get(instance) ?? null, tone = this.colour?.tone ?? null;
    // SF63 follow-up: a cinematic chain's shafts, fringe and grain, its clock driving the shafts
    const volumetric = chain.post?.volumetric;
    if (volumetric !== undefined) this.cine?.take(instance, { strength: volumetric.strength, sunColor: volumetric.sunColor, sunDir: this.host.sunDir?.(), fog: this.live.get(instance)?.fog?.color });
    // G321 part 5: a region whose chain draws god rays takes the carried ones (their depth), the knobs turning their opacity
    if (this.carriedRays && (chain.post?.rays ?? 0) > 0) this.cine?.takeRays?.(instance);
    // SF63: its own display transform in by the weight, the page's tone mapping out
    // SF63 / G158: its own composite's side passes run only while it carries the frame
    const passes = this.cellPasses.get(instance) ?? [];
    const fade = display === null || tone === null ? null : (w: number): void => { display.blendMode.opacity.value = w; tone.blendMode.opacity.value = 1 - w; for (const p of passes) p.enabled = w > 0; };
    this.carrier = { instance, chain, knobs: knobs === null && fade === null ? null : (w) => { knobs?.weight(w); fade?.(w); }, restore: () => {
      knobs?.restore(); fade?.(0);
      post.saturation.saturation = saturation; post.contrast.brightness = brightness; post.contrast.contrast = contrast; undoGrade();
    } };
  }

  /** the carrying region leaves the frame: the page's grade values back, its look layer and LUT neutral and off */
  private drop(): void {
    const carrier = this.carrier;
    if (carrier === null) return;
    this.carrier = null;
    carrier.restore();
    this.cine?.release();
    this.lookEffect.set({ curve: 0, vibrance: 0 }); this.lookEffect.blendMode.opacity.value = 0;
    this.lutUniform(this.neutral); this.lutEffect.blendMode.opacity.value = 0;
    this.chainFade?.weight(0); this.chainWeight = 0; this.chainLut = false;
  }

  private uninstall(): void { for (const undo of this.restore.splice(0).reverse()) undo(); this.faded = 0; }

  /** Before the scene draws: the scene fog becomes the owner's air. */
  private beforeScene(): void {
    const work:FrameAirWork=this.airWork.pop()??{home:{instance:this.homeInstance,fog:[0,0,0]},airs:new Map(),rows:new Map()};
    try{this.beforeSceneWithWork(work);}
    finally{work.airs.clear();if(!this.frameRetired)this.airWork.push(work);}
  }
  private beforeSceneWithWork(work:FrameAirWork):void{
    // G343: the eye as drawn (a free camera is placed after the frame's late phase): the next frame's horizon reads it
    this.drawnLift = this.host.lift?.() ?? 0;
    const live = this.host.scene.fog?.color ?? null;
    // the backdrop rewrites the fog each frame; if it did not, keep the home value it wrote last
    if (live !== null && !live.equals(this.written)) this.homeFog.copy(live);
    const home=work.home;home.fog[0]=this.homeFog.r;home.fog[1]=this.homeFog.g;home.fog[2]=this.homeFog.b;
    work.rows.forEach((_row,instance)=>{if(!this.live.has(instance))work.rows.delete(instance);});
    let hazes: ReadonlyMap<string, readonly [number, number, number]> = this.hazes;
    if (this.live.size > 0) {
      // a live region's air is what its runtime wrote into its own fog this frame; the base goes back for the next frame
      this.hazes.forEach((colour,instance)=>{work.airs.set(instance,colour);});
      this.live.forEach((look,instance)=>{
        const fog=look.fog;if(fog===undefined||fog===null)return;
        const r=fog.color.r,g=fog.color.g,b=fog.color.b;let colour=work.rows.get(instance);
        if(colour===undefined){colour=[r,g,b];work.rows.set(instance,colour);}else{colour[0]=r;colour[1]=g;colour[2]=b;}
        work.airs.set(instance,colour);fog.color.setRGB(...(this.hazes.get(instance)??home.fog));
      });
      hazes=work.airs;
    }
    const [r, g, b] = frameFog(this.weights, home, hazes, ROAD_SKY.air);
    this.air.setRGB(r, g, b);
    GRID_HAZE.colour.value.copy(this.air).convertLinearToSRGB(); // G631: every far material hazes toward the owner's air
    if (live !== null) { live.copy(this.air); this.written.copy(this.air); }
    this.roadSky.frame(this.host.camera.getWorldPosition(this.eye), this.air);
  }

  /**
   * G321: the camera each owner draws with. A live region's kit (equipped inside its cell) writes the field of view its own
   * standalone boot would (a sword's Hor+ widening, a level's `camera.portraitFov`), or never touches it (Sky Reach's fan:
   * the boot camera's `CAMERA_FOV`); the road's kit writes the road's. A write since the frame's own last one belongs to the
   * owner holding the frame; the camera then draws the owners' fields of view blended by their weights, so the road's wider
   * sword view never carries into a cell, and leaving puts the road's back exactly (its writer's cache still matches).
   */
  private lens(): void {
    const camera = this.host.camera;
    if (!(camera instanceof PerspectiveCamera)) return;
    if (Number.isNaN(this.roadFov)) this.roadFov = camera.fov;
    if (camera.fov !== this.lensWritten) {
      const top = dominantOwner(this.weights);
      if (top !== null && this.lenses.has(top)) this.lenses.set(top, camera.fov); else this.roadFov = camera.fov;
    }
    let fov = 0, rest = 1;
    for (const [instance, own] of this.lenses) { const w = this.weights.cells.get(instance) ?? 0; fov += w * own; rest -= w; }
    fov += Math.max(0, rest) * this.roadFov;
    if (Math.abs(fov - camera.fov) > 1e-4) { camera.fov = fov; camera.updateProjectionMatrix(); this.host.refit?.(); }
    this.lensWritten = camera.fov;
  }

  /** the page's grade values as drawn (saturation, brightness, contrast, curve, vibrance; zeros before install) */
  private chainValues(): readonly [number, number, number, number, number] {
    const post = this.chainPost, look = this.lookEffect.values, r = (n: number): number => Math.round(n * 1e4) / 1e4;
    return post === null ? [0, 0, 0, 0, 0] : [r(post.saturation.saturation), r(post.contrast.brightness), r(post.contrast.contrast), r(look.curve), r(look.vibrance)];
  }

  /** the page chain's knobs as drawn (bloom intensity, threshold, smoothing, vignette, rays, AO; −1 where the chain has none) */
  private postValues(): readonly [number, number, number, number, number, number] {
    const post = this.chainPost, r = (n: number | undefined): number => (n === undefined ? -1 : Math.round(n * 1e4) / 1e4);
    const rays: unknown = post?.rays?.blendMode.opacity.value;
    return [r(post?.bloom?.intensity), r(post?.bloom?.luminanceMaterial.threshold), r(post?.bloom?.luminanceMaterial.smoothing), r(post?.vignette?.darkness), r(typeof rays === 'number' ? rays : undefined),
      r(post?.ao ? (post.ao.enabled ? post.ao.configuration.intensity : 0) : undefined)];
  }

  /** The readout. */
  state(): GridFrameState {
    const round = (n: number): number => Math.round(n * 1000) / 1000, g = this.graded;
    return {
      installed: this.installed, faded: this.faded, owner: dominantOwner(this.weights), highway: round(this.weights.highway),
      weights: Object.fromEntries([...this.weights.cells].map(([k, w]) => [k, round(w)])),
      air: [round(this.air.r), round(this.air.g), round(this.air.b)],
      grade: [round(g.exposure), round(g.saturation), round(g.contrast), round(g.tint[0]), round(g.tint[1]), round(g.tint[2])],
      roadSky: round(this.roadSky.drawn),
      skies: Object.fromEntries([...this.skies].map(([k, layer]) => [k, layer.state()])),
      lens: { fov: round(this.host.camera instanceof PerspectiveCamera ? this.host.camera.fov : 0), road: round(this.roadFov), regions: Object.fromEntries([...this.lenses].map(([k, f]) => [k, round(f)])) },
      horizon: round(this.skyShare),
      chain: { owner: this.carrier?.instance ?? null, weight: round(this.chainWeight), lut: this.chainLut, values: this.chainValues(), post: this.postValues(), fx: this.cine?.state() ?? null,
        bypass: round(this.bypass?.weight() ?? 0) },
    };
  }
}
