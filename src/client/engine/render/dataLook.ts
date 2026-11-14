/**
 * A look as data (SHARD-PLATFORM SF10b): a gradient sky, the engine's distance fog, the key light and the ambient as
 * ordered day keys sampled on the engine clock, plus an optional 33³ colour LUT. The engine owns every program here:
 * the data carries colours and numbers only, never shader source or a closure.
 *
 *   const look = dataLook({ day: DATA_LOOK_DAY, dayOverride: null, keys, lut: null });   // a LookStrategy
 *
 * Keys sit on a normalised day (0 = midnight, 0.5 = noon) and wrap: between the last key and the first the look blends
 * across midnight. The sun's direction is the clock's; a key sets its colour and intensity only.
 */
import * as THREE from 'three';
import type { PaintedNumbers } from '@wildshard/format/paintedLook';
import { BlendFunction, Effect, LookupTexture, ToneMappingMode } from 'postprocessing';
import { DEFAULT_NORMALIZED_DAY, normalizedDayClock, DayCycle } from '../../../shared/engine/world/dayCycle';
import type { EngineEffects, LookStrategy, SkyBackdropTargets, TerrainPainter } from './look';
import { LUT_SIZE, fetchLut } from './lut';
import { PATCH_ORDER, patchShader, setInheritedPatch, type ShaderSource } from './shaderPatches';
import { Scope } from '../../../shared/engine/app/scope';
import { curveAt, type Curve } from '@wildshard/format/materials';
import type { GraphBudget, GraphIr } from '@wildshard/format/materialGraph';
import { loadLookGraphCompiler } from './graphBackend';
import { LOOK_SKY_BUDGET } from '@wildshard/format/look-sky';
import { EmissiveLook } from './families/emissive';
import { familyMaterial } from './families/registry';
import { ToonLook } from './families/toon';
import { LOOK_RIM_PATCH, bounceLight, environmentScene, lampLights, lightPools, rimPatch } from './lookLight';
import { ExposureEffect, lampHalos, lookMotes, tickGlow } from './lookRender';
import type { LookMotes, LookShadow, LookVignette } from '@wildshard/format/look-render';
import type { LookBounce, LookEnvironment, LookLamp, LookPools, LookRim } from '@wildshard/format/look-light';
import { tierPmremGenerator } from './pmremSize';

type Rgb = readonly [number, number, number];
const mesh = (object: THREE.Object3D): object is THREE.Mesh => object instanceof THREE.Mesh;

/** One day key: what the sky, fog, key light and ambient look like at `time` (0–1 of a day). */
export interface LookKey {
  readonly time: number;
  /** the dome's colour straight up and at the horizon (the fog's colour should meet `horizon`) */
  readonly sky: { readonly zenith: Rgb; readonly horizon: Rgb };
  /** Exponential density per metre, or zero density plus linear near/far distances in metres. */
  readonly fog: { readonly colour: Rgb; readonly density: number; readonly near?: number | undefined; readonly far?: number | undefined };
  /** the key light's colour and intensity; its direction is the clock's sun */
  readonly sun: { readonly colour: Rgb; readonly intensity: number };
  /** the hemisphere ambient's sky and ground colours and intensity */
  readonly ambient: { readonly sky: Rgb; readonly ground: Rgb; readonly intensity: number };
}

/** The engine clock a data look runs on: real minutes per day, the start (0–1 of a day) and the sun's arc in degrees. */
export interface LookDay { readonly minutes: number; readonly start: number; readonly maxElevation: number; readonly azimuth: number }

/** The clock a data look gets when its data names none: a 12-minute day from noon, the sun 60° high at 35° azimuth. */
export const DATA_LOOK_DAY: LookDay = DEFAULT_NORMALIZED_DAY;

/** A data look: its clock, an optional fixed time of day, its ordered keys (at least one) and the LUT file's URL. */
export interface DataLookSpec {
  readonly day: LookDay;
  /** a fixed time of day (0–1): the clock starts there and is paused; null runs the clock from `day.start` */
  readonly dayOverride: number | null;
  readonly keys: readonly LookKey[];
  /** a 33³ × RGBA8 LUT (render/lut.ts format), applied last in the grade; null for none */
  readonly lut: string | Uint8Array | null;
  /**
   * its light settings as they resolved at load (LF1-4, `render/lookLight.ts`): a rim patched into every lit material, the
   * light pools' decal draw and the fog program's height density; absent: none of them
   */
  readonly light?: {
    readonly rim: LookRim | null; readonly pools: LookPools | null; readonly heightFogDensity: number;
    /** B2: real lamps, a warm bounce and a sky-derived environment; absent or null: none */
    readonly lamps?: readonly LookLamp[] | null; readonly bounce?: LookBounce | null; readonly environment?: LookEnvironment | null;
    /** TEMPLATES-CLEANROOM M4: the sun's shadow look and glow motes; absent or null: the engine's shadows, no motes */
    readonly shadow?: LookShadow | null; readonly motes?: LookMotes | null;
  };
  /** B2 (`look.grade.tone` neutral): the Neutral display curve in place of the engine's AgX */
  readonly neutral?: boolean;
  /** M4.7 (`look.grade.tone` aces): the ACES filmic curve in place of the engine's AgX */
  readonly aces?: boolean;
  /** M4.7: `look.grade.exposure` in stops ahead of the tone curve (absent or 0: none), its vignette and bloom radius */
  readonly exposure?: number;
  readonly vignette?: LookVignette | null;
  readonly bloomRadius?: number | null;
  /**
   * SHARD-SOURCE AP14 (`look.sky`): the dome's painted sky, an unlit material graph over the dome's direction
   * (`normalize(positionLocal)`), compiled on the page's renderer with the backdrop in place of the gradient. The
   * environment (`light.environment`) is filtered from the same dome, so reflections show the painted sky. Absent or
   * null: the gradient of the keys' zenith and horizon.
   */
  readonly sky?: GraphIr | null;
}

/** A sampled look: plain numbers, blended between the two keys around a time of day. */
export interface LookSample {
  zenith: THREE.Color; horizon: THREE.Color; fog: THREE.Color; fogDensity: number; fogNear: number | null; fogFar: number | null;
  sun: THREE.Color; sunIntensity: number; ambientSky: THREE.Color; ambientGround: THREE.Color; ambientIntensity: number;
}

/** An empty sample to fill with `sampleLook`. */
export function lookSample(): LookSample {
  return { zenith: new THREE.Color(), horizon: new THREE.Color(), fog: new THREE.Color(), fogDensity: 0, fogNear: null, fogFar: null, sun: new THREE.Color(), sunIntensity: 0,
    ambientSky: new THREE.Color(), ambientGround: new THREE.Color(), ambientIntensity: 0 };
}

const wrap = (t: number): number => t - Math.floor(t);
const mixRgb = (out: THREE.Color, a: Rgb, b: Rgb, f: number): THREE.Color => out.setRGB(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);

/**
 * The look at `time` (0–1 of a day, wrapped) into `out`: a linear blend of the keys either side, wrapping across
 * midnight. Keys must be ordered by time and non-empty (the format's rules); colours blend in their stored space.
 */
export function sampleLook(keys: readonly LookKey[], time: number, out: LookSample = lookSample()): LookSample {
  const first = keys[0], last = keys[keys.length - 1];
  if (first === undefined || last === undefined) throw new Error('[look] a data look needs at least one key');
  const t = wrap(time);
  let a = last, b = first, span = 1 - last.time + first.time, along = t >= last.time ? t - last.time : t + 1 - last.time;
  for (let i = 0; i + 1 < keys.length; i++) {
    const k0 = keys[i], k1 = keys[i + 1];
    if (k0 !== undefined && k1 !== undefined && t >= k0.time && t < k1.time) { a = k0; b = k1; span = k1.time - k0.time; along = t - k0.time; break; }
  }
  const f = span > 1e-9 ? Math.min(1, Math.max(0, along / span)) : 0;
  mixRgb(out.zenith, a.sky.zenith, b.sky.zenith, f); mixRgb(out.horizon, a.sky.horizon, b.sky.horizon, f);
  mixRgb(out.fog, a.fog.colour, b.fog.colour, f); out.fogDensity = a.fog.density + (b.fog.density - a.fog.density) * f;
  out.fogNear = a.fog.near === undefined || b.fog.near === undefined ? null : a.fog.near + (b.fog.near - a.fog.near) * f;
  out.fogFar = a.fog.far === undefined || b.fog.far === undefined ? null : a.fog.far + (b.fog.far - a.fog.far) * f;
  mixRgb(out.sun, a.sun.colour, b.sun.colour, f); out.sunIntensity = a.sun.intensity + (b.sun.intensity - a.sun.intensity) * f;
  mixRgb(out.ambientSky, a.ambient.sky, b.ambient.sky, f); mixRgb(out.ambientGround, a.ambient.ground, b.ambient.ground, f);
  out.ambientIntensity = a.ambient.intensity + (b.ambient.intensity - a.ambient.intensity) * f;
  return out;
}


/**
 * SHARD-SOURCE AP17: what a data look takes in place (`LookStrategy.liveLook`, driven by `wildshard watch` through engine's
 * dev hook v2): its spec as a fresh build would read it, plus the engine bloom's intensity and threshold (the level grade's
 * at boot). The keys, the sun's arc, exposure, tone, vignette and bloom go live; the light rows and the LUT must not change.
 */
export interface LiveLook extends Omit<DataLookSpec, 'lut'> {
  readonly lut: string | null;
  readonly bloom: { readonly intensity: number; readonly threshold: number; readonly radius: number | null };
}
/** The engine clock for a data look (an hour clock with one day-long segment, the sun on the day's arc). */
export function dataLookClock(day: LookDay, dayOverride: number | null): DayCycle {
  return normalizedDayClock(day, dayOverride);
}

/** The engine's gradient dome: radius 600 m, drawn first, unfogged, kept on the camera by Game (the backdrop's `clouds`). */
function gradientDome(): { dome: THREE.Mesh<THREE.SphereGeometry, THREE.Material>; zenith: THREE.Color; horizon: THREE.Color } {
  const zenith = new THREE.Color(), horizon = new THREE.Color();
  const material = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uZenith: { value: zenith }, uHorizon: { value: horizon } },
    vertexShader: 'varying float vH; void main() { vH = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uZenith; uniform vec3 uHorizon; varying float vH; void main() { gl_FragColor = vec4(mix(uHorizon, uZenith, clamp(vH, 0.0, 1.0)), 1.0); }' });
  material.name = 'engine.look.dome';
  const dome = new THREE.Mesh(new THREE.SphereGeometry(600, 24, 12), material);
  dome.name = 'look-dome'; dome.renderOrder = -1; dome.frustumCulled = false;
  return { dome, zenith, horizon };
}

/**
 * AP14: a look's painted sky on the dome: its graph compiled (by `compile`, the page's look-graph compiler) as an unlit
 * material drawn on the inside of the sphere, first, unfogged and writing no depth, as the gradient's material is (the
 * old material is freed).
 */
export function paintDome(dome: THREE.Mesh<THREE.SphereGeometry, THREE.Material>, sky: GraphIr, compile: (ir: GraphIr, opts: { readonly budget: GraphBudget }) => { readonly material: THREE.Material }): void {
  const { material } = compile(sky, { budget: LOOK_SKY_BUDGET });
  material.side = THREE.BackSide; material.depthWrite = false; material.name = 'engine.look.sky';
  if ('fog' in material) material.fog = false;
  dome.material.dispose(); dome.material = material;
}

async function lutTexture(url: string | Uint8Array | null): Promise<LookupTexture | null> {
  if (url === null) return null;
  const data = typeof url === 'string' ? await fetchLut(url) : Uint8Array.from(url);
  if (data === null) return null;
  if (data.length !== LUT_SIZE ** 3 * 4) throw new Error('Invalid admitted look LUT');
  const lut = new LookupTexture(data, LUT_SIZE);
  lut.type = THREE.UnsignedByteType; lut.colorSpace = THREE.NoColorSpace; lut.name = 'look-lut'; lut.needsUpdate = true;
  return lut;
}

const NEUTRAL_FRAGMENT = `
vec3 neutralCurve(vec3 color) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = vec4(neutralCurve(inputColor.rgb), inputColor.a);
}
`;

/**
 * The NEUTRAL tone curve (Khronos PBR Neutral, three's `NeutralToneMapping` at exposure 1) as a grid cell's display: the
 * page's colour pass already holds a ToneMappingEffect, and a second one includes three's tone-mapping chunk twice
 * ('toneMappingExposure' redefinition), so the merged pass would never compile; this is the same curve under its own name.
 */
export class NeutralToneEffect extends Effect {
  constructor() { super('NeutralToneEffect', NEUTRAL_FRAGMENT, { blendFunction: BlendFunction.NORMAL }); }
}

const ACES_FRAGMENT = `
uniform float uExposure;
vec3 acesFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  const mat3 inputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 outputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  vec3 color = outputMat * acesFit(inputMat * (inputColor.rgb * uExposure / 0.6));
  outputColor = vec4(clamp(color, 0.0, 1.0), inputColor.a);
}
`;

/**
 * M4.7 (review MUST): the ACES filmic curve (three's `ACESFilmicToneMapping`) as a grid cell's display, with the look's
 * exposure folded in, for the reason `NeutralToneEffect` exists: a cell never runs `compose`, so the page chain's tone
 * mode and the spliced `ExposureEffect` never reach it.
 */
export class AcesToneEffect extends Effect {
  constructor(stops: number) {
    super('AcesToneEffect', ACES_FRAGMENT, { blendFunction: BlendFunction.NORMAL, uniforms: new Map([['uExposure', new THREE.Uniform(2 ** stops)]]) });
  }
}

/** a data look's grid-cell display: its own tone curve, when it names one (Neutral, or ACES with its exposure) */
function cellTone(spec: { readonly neutral?: boolean; readonly aces?: boolean; readonly exposure?: number }): { readonly cell: { readonly replaces: 'tone'; readonly build: () => { display: Effect } } } | Record<string, never> {
  if (spec.aces === true) { const stops = spec.exposure ?? 0; return { cell: { replaces: 'tone', build: () => ({ display: new AcesToneEffect(stops) }) } }; }
  return spec.neutral === true ? { cell: { replaces: 'tone', build: () => ({ display: new NeutralToneEffect() }) } } : {};
}

/**
 * A level look from data: the engine's clean chain, the gradient dome, the engine fog, key light and ambient turned by
 * the keys on the engine clock, and the LUT last in the grade. Nothing is patched into another material.
 */
export function dataLook(spec: DataLookSpec): LookStrategy {
  if (spec.keys.length === 0) throw new Error('[look] a data look needs at least one key');
  const linear = spec.keys[0]?.fog.near !== undefined;
  // the keys the frame samples: a `liveKeys` call (sharddev `watch`, through engine's dev hook) replaces them in place
  let keys = spec.keys;
  // the mist's GLSL is in the linear fog only when the look declares it (LF1-4): off, the shader text is as before
  const mist = (spec.light?.heightFogDensity ?? 0) > 0;
  const fog = { wsLookFogNear: new THREE.Uniform(0), wsLookFogFar: new THREE.Uniform(1), wsLookFogEnabled: new THREE.Uniform(0) };
  const patchFog = (shader: ShaderSource): void => {
    if (shader.uniforms['wsLookFogNear'] !== undefined) return;
    Object.assign(shader.uniforms, fog);
    const patched = shader.fragmentShader.replace('#include <fog_fragment>', `
      #ifdef USE_FOG
      if (wsLookFogEnabled > 0.5) {
        float amount = clamp((length(vFogWorldPos - cameraPosition) - wsLookFogNear) / (wsLookFogFar - wsLookFogNear), 0.0, 1.0);
${mist ? `
        {
          // LF1-4: the fog program's height term (look.light.heightFog) over the linear fog: mist pooled low. The optical
          // depth along the ray is density x length x mean of exp(-falloff (y - height)), written as a difference of two
          // bounded exponentials (no 0 x inf at a high camera over a steep falloff)
          float mistA = max(fogHeightFalloff * (cameraPosition.y - fogHeight), -20.0), mistB = max(fogHeightFalloff * (vFogWorldPos.y - fogHeight), -20.0);
          float mistMean = abs(mistB - mistA) > 1e-3 ? (exp(-mistA) - exp(-mistB)) / (mistB - mistA) : exp(-mistA);
          float mist = 1.0 - exp(-fogHeightDensity * mistMean * length(vFogWorldPos - cameraPosition));
          amount = 1.0 - (1.0 - amount) * (1.0 - clamp(mist, 0.0, 1.0));
        }` : ''}
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, amount);
      } else {
        #include <fog_fragment>
      }
      #endif`);
    shader.fragmentShader = `#ifdef USE_FOG\nuniform float wsLookFogNear; uniform float wsLookFogFar; uniform float wsLookFogEnabled;\n#endif\n${patched}`;
  };
  const owned: { dome: THREE.Mesh<THREE.SphereGeometry, THREE.Material> | null; lut: LookupTexture | null; pools: THREE.Object3D | null; rim: boolean;
    lamps: ReturnType<typeof lampLights> | null; bounce: ReturnType<typeof bounceLight> | null; environment: THREE.WebGLRenderTarget | null;
    glow: THREE.Object3D[] | null; fx: EngineEffects | null; exposure: ExposureEffect | null; clock: DayCycle | null;
    chain: { vignette: { offset: number; darkness: number }; radius: number } | null } = { dome: null, lut: null, pools: null, rim: false, lamps: null, bounce: null, environment: null, glow: null,
    fx: null, exposure: null, clock: null, chain: null };
  // AP17: what `liveLook` last set (the light rows and the LUT are compared with the build's, never set)
  let day = spec.day, dayOverride = spec.dayOverride;
  const fixedOf = (light: DataLookSpec['light'], lut: unknown): string => JSON.stringify({ light: light ?? null, lut: typeof lut === 'string' || lut === null ? lut : 'bytes' });
  const fixed = fixedOf(spec.light, spec.lut);
  const shadow = spec.light?.shadow ?? null;
  const bounceRow = spec.light?.bounce ?? null;
  // the bounce exists from the backdrop on (it follows the clock's sun there); compose adds it to the scene
  if (bounceRow !== null) owned.bounce = bounceLight(bounceRow);
  return {
    ...cellTone(spec),
    liveKeys: (next) => {
      // a fog kind change (exponential to linear, or back) changes the fog patch's shader text: that needs a new look
      if (next.length === 0 || next.some((key) => (key.fog.near !== undefined) !== linear)) return false;
      keys = next;
      return true;
    },
    liveLook: (next) => {
      const { fx, clock, chain } = owned;
      // check everything first: a refusal changes nothing
      if (fx === null || clock === null || chain === null) return false;
      if (next.keys.length === 0 || next.keys.some((key) => (key.fog.near !== undefined) !== linear)) return false;
      // the light rows and the LUT are built once; an exposure on a chain built without one, a new day length or a new fixed
      // time of day each need a new look
      if (fixedOf(next.light, next.lut) !== fixed || ((next.exposure ?? 0) !== 0 && owned.exposure === null)) return false;
      if (next.day.minutes !== day.minutes || next.dayOverride !== dayOverride) return false;
      keys = next.keys; day = next.day; dayOverride = next.dayOverride;
      Object.assign(clock.spec.sun as { maxElevation: number; azimuthOffset: number }, { maxElevation: next.day.maxElevation, azimuthOffset: next.day.azimuth });
      const exposure = owned.exposure?.uniforms.get('uExposure');
      if (exposure !== undefined) exposure.value = 2 ** (next.exposure ?? 0);
      const tone = next.aces === true ? ToneMappingMode.ACES_FILMIC : next.neutral === true ? ToneMappingMode.NEUTRAL : ToneMappingMode.AGX;
      if (fx.tone.mode !== tone) fx.tone.mode = tone;
      const vignette = next.vignette ?? chain.vignette;
      fx.vignette.offset = vignette.offset; fx.vignette.darkness = vignette.darkness;
      fx.bloom.intensity = next.bloom.intensity; fx.bloom.luminanceMaterial.threshold = next.bloom.threshold;
      fx.bloom.mipmapBlurPass.radius = next.bloom.radius ?? next.bloomRadius ?? chain.radius;
      return true;
    },
    // the sky builds before the composer: the level scope takes the dome and the LUT here
    mode: 'extend', chain: 'clean', compose: ({ engineChain, scene, scope, fx, renderer }) => {
      const rim = spec.light?.rim ?? null, pools = spec.light?.pools ?? null, lamps = spec.light?.lamps ?? null;
      if (rim !== null && !owned.rim) {
        owned.rim = true; scope.onDispose(() => { owned.rim = false; });
        // LF1-4: one rim patch over every lit material, present and later (its values are uniforms: one shader text)
        const patchRim = rimPatch(rim), seen = new Set<THREE.Material>();
        setInheritedPatch(patchRim, { scope, chain: true });
        scene.traverse((object) => {
          if (!mesh(object)) return;
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            if (seen.has(material)) continue;
            seen.add(material); patchShader(material, LOOK_RIM_PATCH, PATCH_ORDER.decorate, patchRim, { scope });
          }
        });
      }
      if (pools !== null && owned.pools === null) {
        // once per look: a composer rebuild (a graphics change) composes again without retiring this scope
        const decal = lightPools(pools);
        owned.pools = decal;
        scene.add(decal); scope.own(decal.geometry); scope.own(decal.material); scope.onDispose(() => { decal.removeFromParent(); decal.dispose(); if (owned.pools === decal) owned.pools = null; });
      }
      if (lamps !== null && owned.lamps === null) {
        // B2: real lamps, once per look like the pools
        const group = lampLights(lamps);
        owned.lamps = group;
        scene.add(group); scope.onDispose(() => { group.removeFromParent(); for (const light of group.children) if (light instanceof THREE.Light) light.dispose(); if (owned.lamps === group) owned.lamps = null; });
      }
      const motes = spec.light?.motes ?? null;
      if (owned.glow === null && ((lamps?.some((lamp) => lamp.halo !== undefined) ?? false) || motes !== null)) {
        // M4.8: the lamps' halos (one instanced draw) and the motes (one points draw), once per look like the lamps
        const glow: (THREE.Mesh | THREE.Points)[] = [];
        const halos = lamps === null ? null : lampHalos(lamps);
        if (halos !== null) glow.push(halos);
        if (motes !== null) glow.push(lookMotes(motes));
        owned.glow = glow;
        for (const draw of glow) { scene.add(draw); scope.own(draw.geometry); scope.own(draw.material as THREE.Material); }
        scope.onDispose(() => { for (const draw of glow) { draw.removeFromParent(); if (draw instanceof THREE.InstancedMesh) draw.dispose(); } if (owned.glow === glow) owned.glow = null; });
      }
      const bounce = owned.bounce;
      if (bounce !== null && bounce.light.parent !== scene) {
        scene.add(bounce.light, bounce.light.target); scope.onDispose(() => { bounce.light.removeFromParent(); bounce.light.target.removeFromParent(); });
      }
      const envRow = spec.light?.environment ?? null;
      if (envRow !== null && owned.environment === null && owned.dome !== null) {
        // B2: sky-derived ambient, filtered once from the dome at the look's start (a clock that runs keeps this one). Built
        // here, not in the backdrop: a grid cell runs only the backdrop and must not hold an unused cube (review MUST 2).
        // The far plane clears the 600 m dome (fromScene's default 100 m clips it to black).
        const made = environmentScene(owned.dome, envRow), pmrem = tierPmremGenerator(renderer);
        let target: THREE.WebGLRenderTarget;
        try { target = pmrem.fromScene(made.scene, 0.02, 0.1, 1000); } finally { pmrem.dispose(); made.dispose(); }
        const before = { environment: scene.environment, intensity: scene.environmentIntensity };
        owned.environment = target;
        scene.environment = target.texture; scene.environmentIntensity = envRow.intensity;
        scope.onDispose(() => {
          if (scene.environment === target.texture) { scene.environment = before.environment; scene.environmentIntensity = before.intensity; }
          target.dispose(); if (owned.environment === target) owned.environment = null;
        });
      }
      if (linear) {
        setInheritedPatch(patchFog, { scope, chain: true });
        const seen = new Set<THREE.Material>();
        scene.traverse((object) => {
          if (!mesh(object)) return;
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            if (seen.has(material)) continue;
            seen.add(material); patchShader(material, 'engine.look.linear-fog', PATCH_ORDER.decorate, patchFog, { scope });
          }
        });
      }
      const { dome, lut } = owned;
      if (dome !== null) { scope.own(dome.geometry); scope.own(dome.material); scope.onDispose(() => { dome.removeFromParent(); }); }
      if (lut !== null) scope.own(lut);
      const chain = engineChain('clean');
      // AP17: the chain as the engine built it, before this look's own vignette and bloom spread, for `liveLook`
      owned.fx = fx; owned.chain = { vignette: { offset: fx.vignette.offset, darkness: fx.vignette.darkness }, radius: fx.bloom.mipmapBlurPass.radius };
      scope.onDispose(() => { if (owned.fx === fx) { owned.fx = null; owned.chain = null; owned.exposure = null; } });
      // B2: the Neutral curve keeps the look's saturated albedo saturated, where AgX would grey it (asked after the clean chain)
      if (spec.neutral === true) fx.tone.mode = ToneMappingMode.NEUTRAL;
      // M4.7: ACES, the look's own vignette and bloom spread, and its exposure ahead of the curve
      if (spec.aces === true) fx.tone.mode = ToneMappingMode.ACES_FILMIC;
      if (spec.vignette !== undefined && spec.vignette !== null) { fx.vignette.offset = spec.vignette.offset; fx.vignette.darkness = spec.vignette.darkness; }
      if (spec.bloomRadius !== undefined && spec.bloomRadius !== null) fx.bloom.mipmapBlurPass.radius = spec.bloomRadius;
      const stops = spec.exposure ?? 0, at = chain.indexOf(fx.tone);
      if (stops !== 0 && at !== -1) { const exposure = new ExposureEffect(stops); scope.own(exposure); chain.splice(at, 0, exposure); owned.exposure = exposure; }
      return { chain };
    },
    // G992: no sun disc or corona over the gradient dome. A 1° disc read as a blurred speck with a halo ("half-assed moon
    // or sun", Jake), and a crisp disc alone as a 3 px dot (art/open-plots/sun-disc-g992/board.jpg); the key light is unchanged.
    sky: { clouds: false, planet: false, sun: { disc: false, halo: false } },
    // M4.7: the look's shadow radius and normal bias (its strength is set on the cascades each frame, below)
    ...(shadow === null ? {} : { shadows: { rig: 'tier' as const, radius: shadow.radius, normalBias: shadow.normalBias } }),
    backdrop: async ({ sky, renderer }) => {
      const clock = dataLookClock(spec.day, spec.dayOverride), now = lookSample();
      owned.clock = clock;
      const { dome, zenith, horizon } = gradientDome();
      // AP14: the painted sky replaces the gradient before the compose filters the environment from the dome
      if (spec.sky !== undefined && spec.sky !== null) paintDome(dome, spec.sky, (await loadLookGraphCompiler(renderer)).compileGraph);
      owned.dome = dome;
      const bounce = owned.bounce;
      let targets: SkyBackdropTargets | null = null, flicker = 0;
      const apply = (): void => {
        sampleLook(keys, clock.hour / 24, now);
        zenith.copy(now.zenith); horizon.copy(now.horizon);
        sky.setKeyLight(clock.sunDir, now.sun, now.sunIntensity);
        bounce?.aim(clock.sunDir);
        if (shadow !== null) for (const light of (sky.csm as { lights?: readonly THREE.DirectionalLight[] } | undefined)?.lights ?? []) light.shadow.intensity = shadow.intensity;
        if (targets === null) return;
        targets.hemi.color.copy(now.ambientSky); targets.hemi.groundColor.copy(now.ambientGround); targets.hemi.intensity = now.ambientIntensity;
        fog.wsLookFogEnabled.value = targets.underwater() ? 0 : Number(linear);
        if (targets.underwater()) return; // Atmosphere.ts owns the fog under water
        targets.fog.color.copy(now.fog);
        if (now.fogNear !== null && now.fogFar !== null) {
          targets.fog.near = now.fogNear; targets.fog.far = now.fogFar;
          fog.wsLookFogNear.value = now.fogNear; fog.wsLookFogFar.value = now.fogFar;
        }
        targets.fogU.fogDistDensity.value = now.fogDensity; targets.fogU.fogHeightDensity.value = spec.light?.heightFogDensity ?? 0;
        targets.fogU.fogSunColor.value.copy(now.sun);
      };
      sampleLook(keys, clock.hour / 24, now);
      zenith.copy(now.zenith); horizon.copy(now.horizon);
      bounce?.aim(clock.sunDir);
      owned.lut = await lutTexture(spec.lut);
      return { clock, horizon: now.fog.clone(), lut: owned.lut, clouds: dome,
        bind: (t) => { targets = t; apply(); },
        update: (dt) => { clock.update(dt); apply(); flicker += dt; owned.lamps?.update?.(flicker); if (owned.glow !== null) tickGlow(owned.glow, flicker); },
        rebuild: () => undefined, attachPost: () => undefined };
    },
  };
}

/*
 * A painted look (SHARD-PLATFORM G345): a level whose sky is its own painted dome and dressing, declared as rows the
 * engine interprets: a painter's light (rim, warm bounce, shade floor), a distance haze that takes a per-heading colour
 * strip (gold toward the sun, cooler away), the NEUTRAL tone curve, a fixed key light and the level's LUT. The level
 * builds only its dome and its dressing; the engine owns their lifetimes, the compose, the backdrop and the grid cell.
 */

/** A direction's three components (world, unit). */
export interface LookVec3 { readonly x: number; readonly y: number; readonly z: number }
const vec3Glsl = (values: readonly number[]): string => `vec3(${values.map((n) => n.toFixed(4)).join(',')})`;

/**
 * A painter's light: terms on a lit material's light sum, after three's own lights. `bounce` (a soft wrap from the
 * anti-sun heading lifted by `bounceLift`), `rim` (a sun-coloured fresnel edge, strongest with the sun behind the surface,
 * mostly on vertical faces) and `floor` (no shaded surface below that share of its own albedo); linear colours ×
 * strengths; a black `bounce` or `floor` is left out. `prefix` names its GLSL identifiers; a material opts out with the
 * define `optOut`. The rim's shape is `rimBack` (its share without, then with, the sun behind; absent `[0.2, 0.8]`) and
 * `rimSide` (on a flat, then a vertical face; absent `[0.3, 0.7]`). `lift` (absent: none) adds that share of the surface's
 * base colour with the rim, past the ambient occlusion: an afterglow's cool sky-lit shade (G406, the shared painted look).
 */
export interface PainterLightRow {
  readonly bounce: Rgb; readonly bounceLift: number; readonly rim: Rgb; readonly floor: Rgb; readonly prefix: string; readonly optOut: string;
  readonly rimBack?: readonly [number, number]; readonly rimSide?: readonly [number, number]; readonly lift?: Rgb;
}

const floatGlsl = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));
const black = (c: Rgb): boolean => c.every((n) => n === 0);

/** The painter's light's GLSL (appended to three's `lights_fragment_end`), the sun's direction baked in. */
export function painterLightGlsl(row: PainterLightRow, sun: LookVec3): string {
  const p = row.prefix, bounce = new THREE.Vector3(-sun.x, row.bounceLift, -sun.z).normalize();
  const [back0, back1] = row.rimBack ?? [0.2, 0.8], [side0, side1] = row.rimSide ?? [0.3, 0.7];
  const edge = row.lift === undefined
    ? `reflectedLight.directDiffuse += material.diffuseColor * ${vec3Glsl(row.rim)} * ${p}Rim;`
    : `reflectedLight.directDiffuse += diffuseColor.rgb * ( ${vec3Glsl(row.lift)} + ${vec3Glsl(row.rim)} * ${p}Rim );`;
  const bounceLine = black(row.bounce) ? '' : `
  reflectedLight.indirectDiffuse += material.diffuseColor * ${vec3Glsl(row.bounce)} * ${p}Wrap;`;
  const floorLine = black(row.floor) ? '' : `
  reflectedLight.indirectDiffuse = max( reflectedLight.indirectDiffuse, material.diffuseColor * ${vec3Glsl(row.floor)} );`;
  // a graph program (WS_GRAPH, the GLSL back-end) lights itself, as a node graph did: a lit graph's lighting stage carries
  // its own painted light, so the page's would land twice (Sky Reach's islands drew 11-30 % brighter)
  return `
#if !defined( ${row.optOut} ) && !defined( WS_GRAPH )
{
  vec3 ${p}L = normalize( ( viewMatrix * vec4( ${vec3Glsl([sun.x, sun.y, sun.z])}, 0.0 ) ).xyz );
  vec3 ${p}B = normalize( ( viewMatrix * vec4( ${vec3Glsl(bounce.toArray())}, 0.0 ) ).xyz );
  vec3 ${p}Up = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
  float ${p}NV = clamp( dot( geometryNormal, geometryViewDir ), 0.0, 1.0 );
  float ${p}Back = clamp( dot( -geometryViewDir, ${p}L ), 0.0, 1.0 );
  float ${p}Side = 1.0 - abs( dot( geometryNormal, ${p}Up ) );
  float ${p}Rim = pow( 1.0 - ${p}NV, 3.0 ) * ( ${floatGlsl(back0)} + ${floatGlsl(back1)} * ${p}Back * ${p}Back ) * ( ${floatGlsl(side0)} + ${floatGlsl(side1)} * ${p}Side );
  ${edge}
  float ${p}Wrap = clamp( ( dot( geometryNormal, ${p}B ) + 0.45 ) / 1.45, 0.0, 1.0 );${bounceLine}${floorLine}
}
#endif
`;
}

/**
 * The painter's light on one material only (a look whose light reaches its props, not the page's every lit material:
 * an afterglow edge), appended after its `lights_fragment_end`; removed with `scope`.
 * A null material installs the same patch in the page's shared lighting chunk.
 */
export function painterLightPatch(material: THREE.Material | null, row: PainterLightRow, sun: LookVec3, scope?: Scope): void {
  const glsl = painterLightGlsl(row, sun);
  if (material === null) { THREE.ShaderChunk.lights_fragment_end += glsl; return; }
  patchShader(material, `${row.prefix}.painterLight`, PATCH_ORDER.decorate, (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>${glsl}`);
  }, scope === undefined ? {} : { scope });
}

const installedLight = new Set<string>();
/** The painter's light as a look's `lighting` rig: patched into three's chunk once a page (a shard switch reloads it). */
export function painterLight(row: PainterLightRow, sun: LookVec3): { install: () => void } {
  return { install: () => {
    const glsl = painterLightGlsl(row, sun);
    if (installedLight.has(glsl)) return;
    installedLight.add(glsl); painterLightPatch(null, row, sun);
  } };
}

/**
 * A heading haze: the distance fog takes the colour of a strip sampled by the heading you look along (`strip`: sRGB 0..1
 * r, g, b per heading from −z round through +x, multiplied by `tint`), starting at `near`, full at `far`, never over
 * `max`; the air toward the sun goes gold over distance by `sunHaze`. `name` keys its patch, `prefix` its GLSL names.
 */
export interface HeadingHazeRow { readonly strip: readonly number[]; readonly tint: Rgb; readonly near: number; readonly far: number; readonly max: number; readonly sunHaze: number; readonly name: string; readonly prefix: string }

/** GLSL: the heading (0..1, 0 = −z, a quarter = +x) of a direction, as a heading strip reads it. */
export const headingGlsl = (prefix: string): string => `float ${prefix}Heading(vec3 v){ return fract(atan(v.x, -v.z) / 6.2831853 + 1.0); }`;

/**
 * A strip of values round the compass as a texture a heading reads (n × 1, wrapping in u, linear): `samples` holds
 * `stride` numbers per heading, an sRGB colour (stride 3, linearised) or a raw value into red (stride 1, green and blue
 * 0); `map` reworks each linear rgb in place before it is stored; `half` stores half floats, else bytes (clamped to 1).
 */
export interface HeadingTextureRow {
  readonly samples: readonly number[]; readonly stride: 1 | 3; readonly half: boolean;
  readonly map?: ((rgb: [number, number, number]) => void) | undefined; readonly name?: string | undefined;
}

/** A heading strip's texture (see `HeadingTextureRow`). */
export function headingTexture(row: HeadingTextureRow): THREE.DataTexture {
  const n = row.samples.length / row.stride, c = new THREE.Color(), rgb: [number, number, number] = [0, 0, 0], at = (i: number): number => row.samples[i] ?? 0;
  const data = row.half ? new Uint16Array(n * 4) : new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    if (row.stride === 3) { c.setRGB(at(i * 3), at(i * 3 + 1), at(i * 3 + 2), THREE.SRGBColorSpace); rgb[0] = c.r; rgb[1] = c.g; rgb[2] = c.b; } else { rgb[0] = at(i); rgb[1] = 0; rgb[2] = 0; }
    row.map?.(rgb);
    for (let k = 0; k < 3; k++) data[i * 4 + k] = row.half ? THREE.DataUtils.toHalfFloat(rgb[k] ?? 0) : Math.round(Math.min(1, rgb[k] ?? 0) * 255);
    data[i * 4 + 3] = row.half ? THREE.DataUtils.toHalfFloat(1) : 255;
  }
  const tex = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat, row.half ? THREE.HalfFloatType : THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  if (row.name !== undefined) tex.name = row.name;
  return tex;
}

/** The heading haze's strip as a texture: its sRGB strip linearised and multiplied by its tint, in bytes. */
export function headingStrip(row: HeadingHazeRow): THREE.DataTexture {
  const [r, g, b] = row.tint;
  return headingTexture({ samples: row.strip, stride: 3, half: false, map: (rgb) => { rgb[0] *= r; rgb[1] *= g; rgb[2] *= b; } });
}

/** The heading haze's fragment patch (three's `fog_fragment` replaced), reading the strip `strip`. */
export function headingHaze(row: HeadingHazeRow, sun: LookVec3): (shader: ShaderSource, strip: THREE.Texture) => void {
  const p = row.prefix, near = row.near.toFixed(1), span = (row.far - row.near).toFixed(1), max = row.max.toFixed(2), gold = row.sunHaze.toFixed(2);
  const s = `${sun.x.toFixed(4)},${sun.y.toFixed(4)},${sun.z.toFixed(4)}`, guard = `${p.toUpperCase()}_HAZE`;
  const fog = `#ifdef USE_FOG\n vec3 ${p}V=vFogWorldPos-cameraPosition; gl_FragColor.rgb=mix(gl_FragColor.rgb,texture2D(${p}Haze,vec2(${p}Heading(${p}V),0.5)).rgb,clamp((length(${p}V)-${near})/${span},0.0,1.0)*${max});\n float ${p}Sun=pow(max(dot(normalize(${p}V),vec3(${s})),0.0),24.0); gl_FragColor.rgb=mix(gl_FragColor.rgb,vec3(1.0,0.8,0.52),${p}Sun*clamp((length(${p}V)-15.0)/160.0,0.0,1.0)*${gold});\n#endif`;
  const head = `#ifndef ${guard}\n#define ${guard}\nuniform sampler2D ${p}Haze;\n${headingGlsl(p)}\n#endif\n`;
  return (shader, strip) => {
    shader.uniforms[`${p}Haze`] = { value: strip };
    shader.fragmentShader = head + shader.fragmentShader.replace('#include <fog_fragment>', fog);
  };
}

/** A painted look's dome (its sky layer) and the heading strip its haze reads (null on a painted-strip sky). */
export interface PaintedSky { readonly dome: THREE.Mesh<THREE.BufferGeometry, THREE.Material>; readonly strip: THREE.Texture | null }
/** A painted look's dressing: the sky pieces that stand in the world (a sea of cloud, the sun's glow) and their tick. */
export interface PaintedDressing { readonly group: THREE.Group; readonly update: (dt: number) => void; /** its textures, freed with the look's */ readonly textures: readonly THREE.Texture[] }
/**
 * What a painted look's dressing builder is handed (it runs once, when the backdrop is built, on the page's renderer).
 * `graph` compiles a material graph (an SF59 IR, validated first) on that renderer through the lazy graph back-end: the
 * material is the dressing's own, like every material it builds, and is freed with the dressing (the look's compose scope
 * standalone, the grid cell's layer otherwise); `textures` resolves the graph's texture params to textures the caller keeps
 * (list them in the dressing's `textures` to have the look free them). On a grid cell's layer a graph material is drawn in
 * its level's frame like any dressing piece (`BackdropLayer`'s frame defines).
 */
export interface PaintedDressingContext {
  readonly graph: (ir: GraphIr, textures?: (ref: string) => THREE.Texture) => Promise<THREE.Material>;
}

/** How a painted strip samples: wrapping in heading (no seam at heading 0), clamped in elevation, magnified so unmipped. */
export interface PaintedStripSampler {
  readonly wrapS: THREE.Wrapping; readonly wrapT: THREE.Wrapping; readonly mips: boolean;
  readonly minFilter: THREE.MinificationTextureFilter; readonly magFilter: THREE.MagnificationTextureFilter;
}
/** Loads one painted image as an sRGB texture named `name`, sampled as `sampler`; null (after warning `warn`) when it cannot be had. */
export type PaintedLoad = (url: string, name: string, warn: string, sampler: PaintedStripSampler) => Promise<THREE.Texture | null>;
const STRIP_SAMPLER: PaintedStripSampler = { wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, mips: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };

/**
 * A painted-strip sky as rows: two seamless 360° strips (x = heading, each `{ key, url }`, its texture named
 * `${tag}.${key}`, a failed one warning `${fault} ${key} not loaded:`) as the emissive family's sky (`name`; `maps` name
 * the two stages in its entry) over the strip's `elevation`s, blended by the look's state across `window`, the first stage
 * at `firstGain` and held `hold` s; the live sky is freed with a scope named `scope`.
 */
export interface PaintedStripRow {
  readonly name: string; readonly maps: readonly [string, string];
  readonly elevation: readonly [number, number]; readonly window: readonly [number, number]; readonly firstGain: readonly [number, number]; readonly hold: number;
  readonly strips: readonly [{ readonly key: string; readonly url: string }, { readonly key: string; readonly url: string }];
  readonly tag: string; readonly fault: string; readonly scope: string;
}

/** A painted-strip sky's family entry: the emissive family's sky over its two stages. */
export function paintedStripEntry(row: PaintedStripRow): unknown {
  return { family: 'emissive', sky: { maps: row.maps, elevation: row.elevation, window: row.window, firstGain: row.firstGain, hold: row.hold } };
}

/** Both strips decoded, or null when either cannot be had (the one that loaded is freed: the dome keeps its stand-in). */
async function loadPaintedStrips(row: PaintedStripRow, load: PaintedLoad): Promise<readonly [THREE.Texture, THREE.Texture] | null> {
  const [a, b] = await Promise.all(row.strips.map(({ key, url }) => load(url, `${row.tag}.${key}`, `${row.fault} ${key} not loaded:`, STRIP_SAMPLER)));
  if (a && b) return [a, b];
  a?.dispose(); b?.dispose();
  return null;
}

/** The live strip sky: the emissive family material over the two strips (owned by `scope`) and the feed of its blend. */
function paintedStripSky(row: PaintedStripRow, strips: readonly [THREE.Texture, THREE.Texture], state: number, scope: Scope): { readonly material: THREE.Material; readonly blend: (state: number) => void } {
  const clamp = (n: number): number => Math.min(1, Math.max(0, n)), look = new EmissiveLook({ blend: clamp(state) });
  const material = familyMaterial(paintedStripEntry(row), { toon: new ToonLook(), emissive: look, scope, textures: (ref) => {
    const t = ref === row.maps[0] ? strips[0] : ref === row.maps[1] ? strips[1] : undefined;
    if (t === undefined) throw new Error(`${row.name}: no texture ${ref}`);
    return t;
  } });
  scope.own(material);
  let fed = look.params.blend;
  return { material, blend: (next) => {
    const blend = clamp(next);
    if (blend !== fed) { fed = blend; look.set({ blend }); }
  } };
}

/**
 * A painted look's sky: a dome over a heading strip (`dome`, absent a 900 m back-faced sphere in the fog's colour that
 * writes no depth; its haze `haze` patched into every world material, reading the same strip; `graph`, when given, is the dome's material as an SF59 graph, compiled with the backdrop on the page's
 * renderer like the dressing's, from the heading strip; the dome's own material stands in until then), or two painted
 * strips (`strips`, decoded by `load`) on a sphere that stands in the fog's colour until they load (a strip that fails to
 * load is a page fault: the stand-in stays).
 */
export type PaintedSkySpec =
  | { readonly haze: HeadingHazeRow; readonly dome?: (strip: THREE.Texture) => THREE.Mesh<THREE.BufferGeometry, THREE.Material>
    readonly graph?: (strip: THREE.Texture) => { readonly ir: GraphIr; readonly textures: (ref: string) => THREE.Texture } }
  | { readonly strips: PaintedStripRow; readonly load: PaintedLoad };

/**
 * A state the look's light follows each frame (0 … 1: a quest's dusk), on the format's curves: the key's colour lerps to
 * `deep` and its intensity rides `curves.key`, the sky fill `fill`, the fog's sun tint `fogSun`, the far rings' haze
 * `farHaze`, the aerial fog per metre `aerialFog`; a painted-strip sky blends its stages by it.
 */
export interface PaintedState {
  readonly value: { readonly value: number };
  readonly deep: number | Rgb;
  readonly curves: { readonly key: Curve; readonly fill: Curve; readonly fogSun: Curve; readonly farHaze: Curve; readonly aerialFog: Curve };
}

/** A painted look's rows and the builders the level keeps (its dome and its dressing, each made once on first ask). */
export interface PaintedLookSpec {
  /** the textures the look loaded up front: the look frees them unless a compose takes them (absent: none) */
  readonly textures?: readonly THREE.Texture[];
  readonly sky: PaintedSkySpec;
  /** the sky pieces in the world, built once with the backdrop (absent: none); see `PaintedDressingContext` */
  readonly dressing?: (ctx: PaintedDressingContext) => PaintedDressing | Promise<PaintedDressing>;
  /** the painter's light on every lit material (absent: three's lights only) */
  readonly light?: PainterLightRow;
  /** the key light: its direction, its colour (an sRGB hex or linear rgb) and intensity */
  readonly sun: { readonly dir: LookVec3; readonly colour: number | Rgb; readonly intensity: number };
  /** the scene fog's colour, near and far (the scene's own fog edited in place: a new Fog would orphan the one the backdrop bound) */
  readonly fog: { readonly color: number; readonly near: number; readonly far: number };
  /** the horizon's colour (absent: the fog's) */
  readonly horizon?: number;
  /** the NEUTRAL tone curve, a grid cell carrying its own NEUTRAL display (absent: the engine's tone) */
  readonly neutral?: boolean;
  /** the god rays' source (degrees, the engine compass): the painted sun, its disc kept out of the frame (absent: none) */
  readonly rays?: { readonly azimuth: number; readonly elevation: number };
  readonly clock: () => DayCycle;
  /** the clock is held, never advanced: the light is the state's, not the hour's */
  readonly hold?: boolean;
  /** the state the light follows (absent: a fixed key) */
  readonly state?: PaintedState;
  /** the shard grade (absent: none) */
  readonly lut?: () => Promise<LookupTexture | null>;
  /** the level's own ground painter, and its tick after the light each frame (absent: the engine's ground) */
  readonly terrain?: { readonly build: TerrainPainter['build']; readonly update?: () => void };
}

/** Admitted static painted-look numbers. */
export type DuskLookRow = PaintedNumbers;
/** Bind an admitted painted look to image, graph, live dusk and optional terrain/dressing owners. */
export function paintedLookFromRow(row: DuskLookRow, ports: Pick<PaintedLookSpec, 'textures' | 'dressing' | 'lut' | 'terrain'> & {
  readonly load: PaintedLoad; readonly state?: PaintedState['value']; readonly graph?: Extract<PaintedSkySpec, { haze: HeadingHazeRow }>['graph'];
}): LookStrategy {
  if (row.state !== undefined && ports.state === undefined) throw new Error('A dusk look requires live state');
  const { sky, clock, state, light, lightScope, ...look } = row, { state: value, load, graph, ...resources } = ports;
  return paintedLook({ ...look, ...resources, ...(lightScope === 'page' ? { light } : {}), clock: () => new DayCycle(clock),
    sky: sky.kind === 'strips' ? { strips: sky.row, load } : { haze: sky.row, ...(graph === undefined ? {} : { graph }) },
    ...(state === undefined || value === undefined ? {} : { state: { ...state, value } }) });
}

/** a painted look's built dressing and every node in it (the compose's world patch leaves them alone) */
interface BuiltDressing { readonly own: PaintedDressing; readonly meshes: ReadonlySet<THREE.Object3D> }

const lookColour = (c: number | Rgb): THREE.Color => (typeof c === 'number' ? new THREE.Color(c) : new THREE.Color(c[0], c[1], c[2]));

/**
 * A painted look (see above): the clean chain (under the NEUTRAL curve when `neutral`), the dome as the backdrop's sky
 * layer, the dressing in the world, a heading sky's haze patched into every scene material (a grid cell's region's, as
 * `worldPatch`), the painter's light, the key light (fixed, or riding the state's curves with the fill, the fog's sun
 * tint, the far haze and the aerial fog) and the level's own ground painter.
 */
export function paintedLook(spec: PaintedLookSpec): LookStrategy {
  const pending = new Set(spec.textures), skySpec = spec.sky, state = spec.state;
  const sunDir = new THREE.Vector3(spec.sun.dir.x, spec.sun.dir.y, spec.sun.dir.z), haze = 'haze' in skySpec ? headingHaze(skySpec.haze, spec.sun.dir) : null;
  let sky: PaintedSky | null = null, dressing: BuiltDressing | null = null;
  let painted: { readonly scope: Scope; readonly blend: (state: number) => void; readonly textures: readonly THREE.Texture[] } | null = null;
  const makeSky = (): PaintedSky => {
    if ('haze' in skySpec) {
      const strip = headingStrip(skySpec.haze), dome = skySpec.dome?.(strip)
        ?? new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(new THREE.SphereGeometry(900, 64, 32), new THREE.MeshBasicMaterial({ color: spec.fog.color, side: THREE.BackSide, depthWrite: false, fog: false }));
      pending.add(strip);
      dome.renderOrder = -10; dome.frustumCulled = false;
      sky = { dome, strip };
      return sky;
    }
    // 120 m: the dome draws first with no depth test, so its size never occludes; at 300 m the far plane clipped it (an arc)
    const dome = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(new THREE.SphereGeometry(120, 48, 24), new THREE.MeshBasicMaterial({ color: spec.fog.color, side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false }));
    dome.renderOrder = -1000; dome.frustumCulled = false;
    sky = { dome, strip: null };
    return sky;
  };
  // a painted-strip sky stands in from the start (its strips load with the backdrop)
  if (!('haze' in skySpec)) makeSky();
  // the dressing and a graph dome are built once, by the backdrop (it has the page's renderer, and runs before the compose)
  const graphOn = (renderer: THREE.WebGLRenderer): PaintedDressingContext['graph'] => async (ir, textures) => {
    const { compileGraph } = await loadLookGraphCompiler(renderer);
    return compileGraph(ir, textures === undefined ? {} : { textures }).material;
  };
  let building: Promise<BuiltDressing | null> | null = null, domeGraph: Promise<void> | null = null;
  const makeDressing = (renderer: THREE.WebGLRenderer): Promise<BuiltDressing | null> => {
    const build = spec.dressing;
    if (build === undefined) return Promise.resolve(null);
    building ??= (async () => {
      const own = await build({ graph: graphOn(renderer) }), meshes = new Set<THREE.Object3D>(); own.group.traverse((node) => { meshes.add(node); });
      for (const texture of own.textures) pending.add(texture);
      const built: BuiltDressing = { own, meshes };
      dressing = built;
      return built;
    })();
    return building;
  };
  const freePainted = (): void => { if (painted) { painted.scope.dispose(); for (const t of painted.textures) t.dispose(); painted = null; } };
  const worldPatch: NonNullable<LookStrategy['worldPatch']> = (material, scope) => {
    // a graph (an SF59 graph's classic GLSL program) carries its own fog: the haze is a classic fog-chunk patch, a graph's
    // fog the epilogue's
    if (haze === null || !('haze' in skySpec) || Reflect.get(material, 'isGraphShaderMaterial') === true) return;
    const { strip } = sky ?? makeSky();
    if (strip !== null) patchShader(material, skySpec.haze.name, PATCH_ORDER.decorate, (shader) => { haze(shader, strip); }, { scope });
  };
  const parts = (group: THREE.Object3D): { geometry: THREE.BufferGeometry; material: THREE.Material }[] => {
    const out: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];
    group.traverse((node) => { if (mesh(node)) for (const material of Array.isArray(node.material) ? node.material : [node.material]) out.push({ geometry: node.geometry, material }); });
    return out;
  };
  const rays = spec.rays === undefined ? {} : { rays: { azimuth: spec.rays.azimuth, elevation: spec.rays.elevation } };
  return { mode: 'extend', chain: 'clean',
    ...(spec.neutral === true ? { cell: { replaces: 'tone', build: () => ({ display: new NeutralToneEffect() }) } } as const : {}),
    dispose: () => { for (const texture of pending) texture.dispose(); pending.clear(); },
    // `c.fx` builds the cinematic chain when nothing is built yet: the clean chain is asked first, `fx` only after it
    compose: (c) => {
      const { scene, scope } = c, chain = c.engineChain('clean');
      for (const texture of pending) scope.own(texture);
      pending.clear();
      if (spec.neutral === true) c.fx.tone.mode = ToneMappingMode.NEUTRAL;
      const { dome, strip } = sky ?? makeSky(); if (strip !== null) scope.own(strip);
      scope.own(dome.geometry); scope.own(dome.material);
      scope.onDispose(() => { dome.removeFromParent(); scene.fog = null; freePainted(); });
      // the scene's own fog is edited in place: a new Fog would orphan the one the backdrop bound
      if (scene.fog instanceof THREE.Fog) { scene.fog.color.set(spec.fog.color); scene.fog.near = spec.fog.near; scene.fog.far = spec.fog.far; }
      else scene.fog = new THREE.Fog(new THREE.Color(spec.fog.color), spec.fog.near, spec.fog.far);
      const pieces = dressing;
      if (pieces !== null) {
        if (pieces.own.group.parent === null) scene.add(pieces.own.group);
        for (const part of parts(pieces.own.group)) { scope.own(part.geometry); scope.own(part.material); }
        scope.onDispose(() => { pieces.own.group.removeFromParent(); });
      }
      if (haze !== null) scene.traverse((object) => {
        if (!mesh(object) || object === dome || pieces?.meshes.has(object) === true) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) worldPatch(material, scope);
      });
      return { chain };
    },
    ...(spec.light === undefined ? {} : { lighting: painterLight(spec.light, spec.sun.dir) }),
    ...(haze === null ? {} : { worldPatch }),
    sky: { clouds: false, planet: false, sun: { disc: false, halo: false, ...rays } },
    backdrop: async ({ sky: rig, renderer }) => {
      const own = sky ?? makeSky(), strip = own.strip;
      if ('haze' in skySpec && skySpec.graph !== undefined && strip !== null) {
        const made = skySpec.graph(strip);
        domeGraph ??= (async () => {
          const material = await graphOn(renderer)(made.ir, made.textures), standIn = own.dome.material;
          own.dome.material = material; standIn.dispose();
        })();
        await domeGraph;
      }
      if ('strips' in skySpec) {
        const strips = await loadPaintedStrips(skySpec.strips, skySpec.load);
        if (strips !== null) {
          const standIn = own.dome.material, scope = new Scope(skySpec.strips.scope), live = paintedStripSky(skySpec.strips, strips, state?.value.value ?? 0, scope);
          own.dome.material = live.material; standIn.dispose(); painted = { scope, blend: live.blend, textures: strips };
        }
      }
      const clock = spec.clock(), key = lookColour(spec.sun.colour), fog = new THREE.Color(spec.fog.color), lut = spec.lut === undefined ? null : await spec.lut();
      const pieces = (dressing ?? await makeDressing(renderer))?.own ?? null, deep = state === undefined ? null : lookColour(state.deep), keyNow = new THREE.Color();
      let air: (() => THREE.Fog | null) | null = null, live: SkyBackdropTargets | null = null;
      const base = { hemi: 1, fogSun: new THREE.Color(), haze: new THREE.Color() };
      return { clock, horizon: new THREE.Color(spec.horizon ?? spec.fog.color), lut, clouds: own.dome, ...(pieces === null ? {} : { dressing: pieces.group }),
        // Hide the disc mesh too: `sun.disc: false` only hides its material, and three still uploads the geometry of a
        // visible mesh whose material is hidden. A look with `rays` keeps it: the sky built it as the god rays' source only,
        // out of the frame (E398), and a hidden source draws no rays.
        bind: (targets) => {
          if (spec.rays === undefined) targets.disc.visible = false;
          air = () => (targets.underwater() ? null : targets.fog); live = targets;
          base.hemi = targets.hemi.intensity; base.fogSun.copy(targets.fogU.fogSunColor.value); base.haze.copy(targets.far.uHazeCol.value);
        },
        update: (dt: number) => {
          if (spec.hold !== true) clock.update(dt);
          if (state === undefined || deep === null) rig.setKeyLight(sunDir, key, spec.sun.intensity);
          else {
            // a pinned clock (the Explorer's hold or light preset) shows the look's base state, never live play's (G639
            // live red: Signal's finished quest held its key at 5 %, so every Model Explorer card drew black)
            const s = clock.pinned ? 0 : state.value.value, curves = state.curves;
            rig.setKeyLight(sunDir, keyNow.copy(key).lerp(deep, s), spec.sun.intensity * curveAt(curves.key, s));
            painted?.blend(s);
            if (live) {
              live.hemi.intensity = base.hemi * curveAt(curves.fill, s);
              live.fogU.fogSunColor.value.copy(base.fogSun).multiplyScalar(curveAt(curves.fogSun, s));
              live.far.uHazeCol.value.copy(base.haze).multiplyScalar(curveAt(curves.farHaze, s));
              live.fogU.fogDistDensity.value = curveAt(curves.aerialFog, s);
            }
          }
          spec.terrain?.update?.();
          air?.()?.color.copy(fog); pieces?.update(dt);
        },
        rebuild: () => undefined, attachPost: () => undefined,
        // a grid cell's layer frees what it drew (standalone the compose owns the dome and its strip)
        dispose: () => {
          own.dome.removeFromParent(); own.dome.geometry.dispose(); own.dome.material.dispose(); own.strip?.dispose(); freePainted();
          if (pieces !== null) { pieces.group.removeFromParent(); for (const part of parts(pieces.group)) { part.geometry.dispose(); part.material.dispose(); } }
        } };
    },
    ...(spec.terrain === undefined ? {} : { terrainPainter: { build: spec.terrain.build } }),
  };
}
