import type { ShardContext } from '../plugin/context';
import { nextDrawnFrame, presenting } from '@wildshard/engine/core/framePacing';
import { loadBakedSky, skyHorizonColor } from '@wildshard/engine/boot/bakedApi';
import type { LookStrategy, SkyBackdropContext, SkyBackdropFactory, SkyBackdropPost, SkyBackdropTargets } from '@wildshard/engine/render/look';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { pageModeValue } from '../shard/pagePolicy';
import { DayCycle, compassDir, type DayCycleClock } from '@wildshard/engine/world/dayCycle';
import type { Game } from '@wildshard/engine/core/Game';
import { fogUniforms, panoramaTint } from '@wildshard/engine/world/Atmosphere';
import { painterlyUniforms, syncPainterlySun } from '@wildshard/engine/world/painterly';
import * as v from 'valibot';
import type { DayLookRow, DayLookSchema } from '@wildshard/format/dayLook';
import type { PaintedSkyRows } from '@wildshard/format/forestWeather';
import { installChannelPrograms } from '../../../shared/game/plugin/channelPrograms';
import { lentLook, pushLentParams } from '../shardfile/lentLooks';
import { publishSkyClock } from '../session/clockSettings';
import { dayLookPresets, type DayLookPreset } from '../../../shared/game/looks/dayLookPresets';
import type { SkyRig } from '@wildshard/engine/world/skyRig';
import { driveDayAir, driveDayLight, runDayClock } from '@wildshard/engine/game/looks/daySky';
import { graphDaySkyBackdrop, graphParamRoots, type DaySkyBody, type DaySkyGraphs } from '@wildshard/engine/game/looks/graphDaySky';
import { overcastOver } from '@wildshard/engine/game/looks/overcast';
import * as THREE from 'three';
import type { KeyedSkyStyle, SkyKeyRow } from '@wildshard/format/keyedSky';

import { keyedSkyDay, type KeyedSkyDay, type SkyPreset } from '../../../shared/game/looks/keyedSkyClock';

/**
 * Client-only day / night presentation from photographic keys (SHARD-PLATFORM M3, look-family rows): the backdrop half of a keyed sky,
 * its clock and every number data (`KeyedSkyStyle`, on the shared day clock `@wildshard/engine/game/looks/dayClock`).
 *
 * THE SKY is a dome drawn from two baked equirect keys at a time (gain-mapped pairs, each key's own sun painted out by the
 * bake), blended by the clock, each turned about the vertical so its sun glow sits on the clock's sun azimuth (the moon key's
 * on the moon), and scaled by a per-preset gain. The dome adds an analytic aureole around the clock's own sun / moon. Both
 * are the shard's look.materials graphs (data/skyLook.ts; the keys lent as they decode, the rest params set each frame): the
 * dome's, and the environment pass's, which renders the blend at the row's declared size and cadence; PMREM turns it into the scene's environment (IBL) in
 * place, so every lit material sees the sky of the hour. The game's graph day sky (`@wildshard/engine/game/looks/graphDaySky`) owns
 * the graphs, the environment, the clock's jumps and the backdrop's lifecycle; this is the sky and its frame. The keys' GPU textures are decoded on demand (the row bounds residency:
 * the two being blended and the next one, decoded ahead); their CPU copies are dropped after upload.
 *
 * THE LIGHT: the scene's CSM lights, hemisphere and fog — never added or removed — driven by the keyed presets: the sun's
 * colour and intensity, the hemisphere fill, the fog's colour (each key's horizon, measured at decode) and density, the
 * fog's sun in-scatter, the volumetric shafts, the god rays, the cloud layer and the far ridges' haze. The light body is the
 * sun by day and the moon by night, faded out at the swap; the shadow direction moves in 0.25° steps (a shadow map that
 * turns a hair every frame crawls). Nothing here changes a program: uniforms, light intensities / colours and texture
 * uniforms only.
 *
 * THE WEATHER lays multipliers over the blended preset (`KeyedSky.mod`, written by the shard's weather every frame), and the
 * look loop a layer over every preset (`KeyedSky.look`); the presets' own numbers are never edited.
 */

/** A key's file URLs (the row's `keyFiles`, `{id}` replaced by the key's id): the colour JPEG and its gain map. */
function skyKeyFiles(style: KeyedSkyStyle, key: SkyKeyRow): { color: string; gain: string } {
  return { color: style.keyFiles.color.replaceAll('{id}', key.id), gain: style.keyFiles.gain.replaceAll('{id}', key.id) };
}

const tmpC = new THREE.Color();
let uploadTurn: Promise<void> = Promise.resolve();

/** one decoded key: its GPU texture (CPU copy dropped after upload) and its horizon colour */
interface Resident { tex: THREE.DataTexture; horizon: THREE.Color; used: number; /** GPU bytes (RGBA16F 8 a texel, RGB9_E5 4) */ bytes: number }

/**
 * The weather's hook on the clock: multipliers laid over the keyed presets after they are blended — the presets' own
 * numbers are never edited. Identity ({ overcast 0, fog × 1 }) is the clock exactly as it was.
 */
export interface SkyWeather {
  /** 0 … 1 the cloud deck: the sun and moon hidden (light, shafts, rays, disc, aureole), the sky and its IBL dimmed and
   *  greyed, the far haze and the fog greyed and thickened, the cloud layer full, colour drained, lamps lit early */
  overcast: number;
  /** × the fog's distance / height densities */
  fogDist: number;
  fogHeight: number;
  /** 0 … 1 a ground fog: the fog's colour paled toward a cool white (a mist, not a haze) */
  mist: number;
}

/** How a keyed sky is built on one page. */
export interface KeyedSkyOptions {
  /** the phone's stepped IBL refresh: one PMREM level a frame */
  readonly envSteps: boolean;
  /** decoded keys as RGB9_E5 (half the GPU bytes) */
  readonly packKeys: boolean;
  /** a 512×256 environment equirect (a 128 cube) instead of 1024×512 */
  readonly smallEnv: boolean;
}

/** The sky's two graphs' texture lender (the dome's and the environment pass's); their params are the `keyed sky` channels. */
interface KeyedSkyGraphs { readonly lend: (name: string, texture: THREE.Texture) => void }

class KeyedSky {
  readonly clock: DayCycle<SkyPreset>;
  get phase(): number { return this.clock.phase; }
  night = 0;
  dusk = 0;
  dawn = 0;
  lamps = 0;
  /** the weather's multipliers (see SkyWeather); identity = no weather */
  readonly mod: SkyWeather = { overcast: 0, fogDist: 1, fogHeight: 1, mist: 0 };
  /** the look loop's layer over every preset (a shard without one leaves the identity): × the volumetric in-scatter, × the
   *  distance fog, + the grade saturation, × the sky's fill (IBL + hemisphere), × the dome by day — the presets' numbers
   *  untouched */
  readonly look = { vol: 1, fogDist: 1, sat: 0, ambient: 1, sky: 1 };
  /** the dome (the host adds it and keeps it on the camera) */
  readonly dome: THREE.Mesh;
  /** the environment pass: the same sky, one texel per direction of an equirect */
  readonly envScene: THREE.Scene = new THREE.Scene();
  readonly envCam: THREE.OrthographicCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly envEquirect: THREE.WebGLRenderTarget;
  private readonly style: KeyedSkyStyle;
  /** the two keys the graphs blend */
  private readonly u = { tA: { value: null as THREE.Texture | null }, tB: { value: null as THREE.Texture | null } };
  /** the keys' blend, turns (radians) and gains and the deck: the `keyed sky` channels' numeric owner (generators/skyChannels.ts
   *  turns them, the glow, the grey and the flat colour into both graphs' params) */
  readonly keys = { mix: 0, turnA: 0, turnB: 0, gainA: 1, gainB: 1, overcast: 0 };
  /** the blended preset (the channels read its glow) and the fog colour (their flat colour) */
  cur: SkyPreset;
  readonly fog: { readonly color: THREE.Color };
  private sun = new THREE.Vector3();
  private moon = new THREE.Vector3();
  private fogCol = new THREE.Color();
  /** the air's frame (`driveDayAir`), refilled every frame */
  private readonly air = { fog: this.fogCol, body: this.sun, cloudBody: this.sun, fade: 0, above: 0, discScale: 1, haloK: 1 };
  private resident = new Map<string, Resident>();
  private loading = new Map<string, Promise<Resident | null>>();
  private blobs = new Map<string, Promise<{ color: Blob; gain: Blob }>>();
  private frame = 0;
  private disposed = false;
  private readonly day: KeyedSkyDay;
  private readonly renderer: SkyBackdropContext['renderer'];
  private readonly scene: THREE.Scene;
  private readonly opts: KeyedSkyOptions;
  private readonly graphs: KeyedSkyGraphs;
  private readonly product: ShardFolder;

  constructor(product: ShardFolder, day: KeyedSkyDay, renderer: SkyBackdropContext['renderer'], scene: THREE.Scene, opts: KeyedSkyOptions, dome: THREE.Mesh, env: THREE.Material, graphs: KeyedSkyGraphs) {
    this.product = product;
    const style = day.style;
    this.day = day; this.renderer = renderer; this.scene = scene; this.opts = opts; this.graphs = graphs;
    this.style = style;
    const curves = day.spec.curves;
    this.clock = runDayClock(day, style.cycleMinutes * 60, { ...curves, lamps: (p) => Math.max(curves.lamps(p), style.response.overcastLamps * this.mod.overcast) });
    const first = day.presets[style.frames[0]?.[1] ?? ''];
    if (first === undefined) throw new Error('keyed sky: no keyframes');
    this.cur = day.clone(first);
    this.fog = { color: this.fogCol };
    // the environment graph drawn as the GLSL program was: no depth, untouched by the material's tone map (the post chain grades it)
    env.depthTest = false; env.toneMapped = false;
    this.dome = dome;
    // the environment pass: the same sky, one texel per direction of a 1024×512 equirect (PMREM's cube is a quarter of its
    // width: 256); `smallEnv`: 512×256 → a 128 cube, PMREM's three cube-UV targets 768×1024 → 384×512 RGBA16F (~−16.5 MB)
    const envW = opts.smallEnv ? style.response.environment.smallWidth : style.response.environment.width;
    this.envEquirect = new THREE.WebGLRenderTarget(envW, envW / 2, { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.envEquirect.texture.mapping = THREE.EquirectangularReflectionMapping;
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const quad = new THREE.Mesh(tri, env);
    quad.frustumCulled = false;
    this.envScene.add(quad);
  }

  /** a key is lent to the graphs (the environment waits for one) */
  get ready(): boolean { return this.u.tA.value !== null; }

  /** decode the keys around the clock's phase (a jump, the boot) */
  async prepare(): Promise<void> {
    const [a, b] = this.segment(this.phase);
    await Promise.all([this.ensure(a[1].key), this.ensure(b[1].key)]);
  }

  /** the clock's frame (the host's `drive`): every knob at the phase; `snap` at a jump */
  drive(T: SkyBackdropTargets | null, post: SkyBackdropPost | null, snap: boolean): void {
    if (!snap) this.frame++;
    this.apply(T, post, snap);
  }

  /** after an in-place WebGL restore (GpuRecovery): the keys' CPU copies are gone (the host decodes them again) */
  dropKeys(): void {
    for (const r of this.resident.values()) r.tex.dispose();
    this.resident.clear();
  }

  /** Free the keys (the host frees the dome, the environment pass and the environment); decodes in flight drop theirs. */
  dispose(): void {
    this.disposed = true;
    this.dropKeys(); this.blobs.clear();
    this.u.tA.value = null; this.u.tB.value = null;
  }

  /** The GPU bytes the resident keys hold now / at most (three at the decoded size). */
  keyBytes(): number { let bytes = 0; for (const r of this.resident.values()) bytes += r.bytes; return bytes; }
  keyCeiling(): number { return this.style.response.residentKeys * Math.max(0, ...[...this.resident.values()].map((r) => r.bytes)); }

  /** the keyframes around phase p: [a, b] and the blend t */
  private segment(p: number): [readonly [number, SkyPreset], readonly [number, SkyPreset], number] {
    return this.clock.segment(p);
  }

  private keyRow(k: string): KeyedSkyStyle['keys'][string] {
    const row = this.style.keys[k];
    if (row === undefined) throw new Error(`keyed sky: no key ${k}`);
    return row;
  }

  private blobsOf(k: string): Promise<{ color: Blob; gain: Blob }> {
    let b = this.blobs.get(k);
    if (b === undefined) {
      const files = skyKeyFiles(this.style, this.keyRow(k));
      const get = async (url: string): Promise<Blob> => { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.blob(); };
      b = Promise.all([get(files.color), get(files.gain)]).then(([color, gain]) => ({ color, gain }));
      b.catch(() => { this.blobs.delete(k); });
      this.blobs.set(k, b);
    }
    return b;
  }

  /** decode key k to a GPU texture (once; at most 3 resident, least recently used dropped) */
  private ensure(k: string): Promise<Resident | null> {
    const have = this.resident.get(k);
    if (have) return Promise.resolve(have);
    let p = this.loading.get(k);
    if (p === undefined) {
      p = this.texture(k).then(({ tex, horizon }) => {
          if (this.disposed) { tex.dispose(); return null; }
          tex.wrapS = THREE.RepeatWrapping;
          this.renderer.initTexture(tex);
          tex.image.data = null;
          const r: Resident = { tex, horizon, used: this.frame, bytes: tex.image.width * tex.image.height * (this.opts.packKeys ? 4 : 8) };
          this.resident.set(k, r); this.evict(); return r;
      }).catch((e: unknown) => { console.warn(`[keyed sky] key ${k} did not load`, e); return null; }).finally(() => { this.loading.delete(k); });
      this.loading.set(k, p);
    }
    return p;
  }

  private async texture(k: string): Promise<{ tex: THREE.DataTexture; horizon: THREE.Color }> {
    if (this.opts.packKeys) {
      const row = this.style.packedKeys?.[k];
      if (row === undefined) throw new Error(`Missing built sky key: ${k}`);
      const bytes = await this.product.file(row.file);
      const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream('gzip'));
      const buffer = await new Response(stream).arrayBuffer();
      if (buffer.byteLength !== row.width * row.height * 6) throw new Error(`Invalid built sky key: ${k}`);
      if (presenting()) { uploadTurn = uploadTurn.then(() => nextDrawnFrame()); await uploadTurn; }
      const tex = new THREE.DataTexture(new Uint16Array(buffer), row.width, row.height, THREE.RGBFormat, THREE.HalfFloatType);
      tex.internalFormat = 'RGB9_E5'; tex.colorSpace = THREE.LinearSRGBColorSpace;
      tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false; tex.flipY = true; tex.needsUpdate = true; tex.name = row.file;
      return { tex, horizon: new THREE.Color(...row.horizon) };
    }
    const { color, gain } = await this.blobsOf(k);
    const urls = { color: URL.createObjectURL(color), gain: URL.createObjectURL(gain) };
    try { const tex = await loadBakedSky(urls); return { tex, horizon: skyHorizonColor(tex) }; }
    finally { URL.revokeObjectURL(urls.color); URL.revokeObjectURL(urls.gain); }
  }

  private evict(): void {
    while (this.resident.size > this.style.response.residentKeys) {
      let oldest: string | null = null, t = Infinity;
      for (const [k, r] of this.resident) if (r.used < t && r.tex !== this.u.tA.value && r.tex !== this.u.tB.value) { t = r.used; oldest = k; }
      if (oldest === null) return;
      this.resident.get(oldest)?.tex.dispose();
      this.resident.delete(oldest);
    }
  }

  /** the turn (radians) that puts key k's sun glow on the direction `body` */
  private rot(k: string, body: THREE.Vector3): number {
    return (this.keyRow(k).sunU - 0.5) * 2 * Math.PI - Math.atan2(body.z, body.x);
  }

  /** `snap`: move the shadow light to the exact phase now (boot, a Time of day pick), not in SHADOW_STEP steps */
  private apply(T: SkyBackdropTargets | null, post: SkyBackdropPost | null, snap: boolean): void {
    const p = this.phase, DAY = this.style.dayFraction, day0 = this.day, response = this.style.response;
    const [a, b, t] = this.segment(p);
    this.clock.key(this.cur);
    const C = this.cur;
    const ov = weatherOver(C, this.mod, this.style);
    C.vol *= this.look.vol; C.fogDist *= this.look.fogDist; C.sat += this.look.sat;
    const fill = 1 + (this.look.ambient - 1) * (1 - day0.nightAt(p)); // by day: the night's moonlight is its own
    C.env *= fill; C.hemiI *= fill;
    day0.sunAt(p, this.sun);
    day0.moonAt(p, this.moon);
    const day = p < DAY;
    // ── the sky keys: two textures, each turned so its glow sits on the body it was shot around ──
    const ra = this.resident.get(a[1].key), rb = this.resident.get(b[1].key);
    const glowBody = (k: string): THREE.Vector3 => (k === this.style.moonKey ? this.moon : this.sun);
    if (ra) ra.used = this.frame;
    if (rb) rb.used = this.frame;
    const A = ra ?? rb, B = rb ?? ra;
    const k = this.keys;
    k.overcast = ov;
    if (A && B) {
      this.u.tA.value = A.tex; this.u.tB.value = B.tex;
      this.graphs.lend('keyA', A.tex); this.graphs.lend('keyB', B.tex);
      k.mix = ra && rb ? t : 0;
      k.turnA = this.rot(ra ? a[1].key : b[1].key, glowBody(ra ? a[1].key : b[1].key));
      k.turnB = this.rot(rb ? b[1].key : a[1].key, glowBody(rb ? b[1].key : a[1].key));
      const dim = 1 - response.domeDim * ov; // the deck: the sky's brightness under it
      k.gainA = (ra ? a[1].bg : b[1].bg) * dim; k.gainB = (rb ? b[1].bg : a[1].bg) * dim;
      this.fogCol.copy(A.horizon).multiplyScalar(k.gainA).lerp(tmpC.copy(B.horizon).multiplyScalar(k.gainB), k.mix);
      const m = Math.max(this.fogCol.r, this.fogCol.g, this.fogCol.b, 1e-3);
      if (m > response.horizonCeiling) this.fogCol.multiplyScalar(response.horizonCeiling / m);
      if (ov > 0) tintHorizon(this.fogCol, response.overcastHorizon, ov);
      const mist = Math.min(1, Math.max(0, this.mod.mist));
      if (mist > 0) tintHorizon(this.fogCol, response.mistHorizon, mist);
      // the look loop's sky (by day): the dome — and so the IBL rendered from it — × look.sky; the fog colour above stays
      const skyK = 1 + (this.look.sky - 1) * (1 - day0.nightAt(p));
      k.gainA *= skyK; k.gainB *= skyK;
    }
    if (!ra || !rb) void Promise.all([this.ensure(a[1].key), this.ensure(b[1].key)]);
    // decode the key after this segment ahead of time (its upload lands mid-segment, not on the transition)
    const [, next] = this.segment((b[0] + response.prefetch) % 1);
    if (!this.resident.has(next[1].key) && !this.loading.has(next[1].key)) void this.ensure(next[1].key);

    // ── the light body: the sun by day, the moon by night, faded out at the swap ──
    const lightDir = day ? this.sun : this.moon;
    this.night = day0.nightAt(p);
    this.dusk = Math.max(this.night, 1 - THREE.MathUtils.smoothstep(this.sun.y, this.style.dusk[0], this.style.dusk[1]));
    this.dawn = day0.dawnAt(p);
    this.lamps = Math.max(C.lamps, this.night);
    if (!T) return;
    const fade = driveDayLight(T, day0, p, this.sun, this.moon, C, 1, response.shadowStep * Math.PI / 180, snap);
    // the shadow's depth: full by day, the style's `nightShadow` by night (a uniform: no program changes; ≤ 4 cascades)
    const shade = 1 + (this.style.nightShadow - 1) * this.night;
    for (let i = 0; i < Math.min(T.lights.length, 4); i++) { const l = T.lights[i]; if (l !== undefined) l.shadow.intensity = shade; }
    T.sunColor.copy(C.light).multiplyScalar(Math.max(response.minLight, fade * C.lightI / response.lightBase));
    // the disc (the god-ray source) and its corona: the moon is smaller and comes and goes by size, not colour (a darkened
    // disc reads as a black dot on the dusk sky); neither shows through the ground
    const air = this.air;
    air.body = lightDir; air.cloudBody = day || this.night < 0.5 ? this.sun : this.moon; air.fade = fade; air.haloK = day ? 1 : fade;
    air.above = THREE.MathUtils.smoothstep(lightDir.y, ...response.above);
    air.discScale = (day ? 1 : response.moonDisc * Math.max(1e-3, fade)) * Math.max(1e-3, 1 - ov);
    driveDayAir(T, post, this.scene, C, air);
  }
}

/** lay the weather over the blended preset (in place: the fog's multipliers, then the style's overcast rows); returns the
 *  overcast it applied */
function tintHorizon(color: THREE.Color, row: KeyedSkyStyle['response']['overcastHorizon'], amount: number): void {
  const luma = (color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722) * row.luma;
  color.lerp(tmpC.setRGB(luma * row.tint[0], luma * row.tint[1], luma * row.tint[2]), amount * row.amount);
}

function weatherOver(C: SkyPreset, mod: SkyWeather, style: KeyedSkyStyle): number {
  C.fogDist *= mod.fogDist; C.fogHeight *= mod.fogHeight;
  return overcastOver(C, style.overcast, mod.overcast);
}


const skies = new WeakMap<SkyRig, KeyedSky>();
/** The keyed sky a backdrop built on this sky rig (the shard's weather and transitions read it). */
export function keyedSkyOf(sky: SkyRig): KeyedSky | null { return skies.get(sky) ?? null; }

/** What a page's weather reads from its sky (G474): the clock it runs on and the owners its channel rows may write. */
export interface SkyFace { readonly clock: DayCycleClock; readonly owners: ReadonlyMap<string, unknown> }
/** The page weather's view of a keyed backdrop: its clock and weather multipliers (`mod`); null for any other sky. */
export function skyFaceOf(sky: SkyRig): SkyFace | null {
  const keyed = skies.get(sky);
  return keyed === undefined ? null : { clock: keyed.clock, owners: new Map<string, unknown>([['mod', keyed.mod]]) };
}

/**
 * A shard's sky backdrop from its keyed-sky row, on the game's graph day sky: the clock at the URL's / Settings' time, its
 * first two keys decoded, the look loop's layer applied. The declared options select packed keys and, on the phone, a
 * half-size environment.
 */
/** A keyed-sky look from declared rows (G571, the manifest's `render: { platform: 'keyed' }`): the engine's chain under the
 *  shard's keyed day / night sky (its look/keyed-sky section), its channels, its dome / env looks; the page-mode trim (`trim`, its policy
 *  row) packs the keys and halves the environment, read when the level asks for its look. */
export function keyedSkyRender(product: ShardFolder, rows: { readonly channels: string;
  readonly looks: { readonly dome: string; readonly env: string }; readonly trim: { readonly shard: boolean; readonly grid: boolean } }): LookStrategy {
  const trim = pageModeValue(rows.trim);
  return { compose: () => ({}), backdrop: keyedSkyBackdrop(product.section('look/keyed-sky'), { packKeys: trim, smallEnv: trim, channels: rows.channels }, { product, ...rows.looks }) };
}

export function keyedSkyBackdrop(input: unknown, options: { readonly packKeys: boolean; readonly smallEnv: boolean; readonly channels: string }, looks: { readonly product: ShardFolder; readonly dome: string; readonly env: string }): SkyBackdropFactory {
  const day = keyedSkyDay(input), dome = day.style.dome;
  if (options.packKeys) for (const id of Object.keys(day.style.keys)) {
    const row = day.style.packedKeys?.[id];
    if (row === undefined || !looks.product.hasFile(row.file)) throw new Error(`Missing built sky key: ${id}`);
  }
  // the dome first of the opaque pass, depth untouched: everything draws over it
  return graphDaySkyBackdrop({ name: 'keyed sky', source: looks.product.shardfile, ids: [looks.dome, looks.env], dome: { graph: looks.dome, radius: dome.radius, segments: dome.segments, order: -1000, name: dome.name }, channels: options.channels, build: async (context, g: DaySkyGraphs, mesh): Promise<DaySkyBody<SkyPreset>> => {
    const { sky, scene, renderer, level, tier, look } = context;
    const opts: KeyedSkyOptions = { envSteps: level.tiers?.[tier]?.envSteps === true, packKeys: options.packKeys, smallEnv: tier === 'phone' && options.smallEnv };
    const keyed = new KeyedSky(looks.product, day, renderer, scene, opts, mesh, g.material(looks.env), {
      lend: (name, texture) => { g.setTexture(looks.dome, name, texture); g.setTexture(looks.env, name, texture); } });
    await keyed.prepare();
    skies.set(sky, keyed);
    if (look) Object.assign(keyed.look, { vol: look.vol, fogDist: look.fogDist, sat: look.sat, ambient: look.ambient, sky: look.sky });
    day.sunAt(keyed.phase, sky.sunDir);
    return {
      clock: keyed.clock, follow: true, horizon: new THREE.Color(...level.sky.fogSunColor),
      owners: new Map<string, unknown>([['keys', keyed.keys], ['preset', keyed.cur], ['fog', keyed.fog]]),
      // the 2-second IBL refresh, with `envSteps` one PMREM level a frame (E142, the 30-fps-at-2× lane); a jump refreshes whole
      environment: { source: { kind: 'equirect', scene: keyed.envScene, camera: keyed.envCam, target: keyed.envEquirect }, refresh: { every: day.style.response.environment.refresh, stepped: opts.envSteps, ready: () => keyed.ready } },
      drive: (T, post, snap) => { keyed.drive(T, post, snap); },
      prepare: () => keyed.prepare(),
      rebuild: () => { keyed.dropKeys(); },
      // a disposed sky leaves the rig it was registered on (only if it is still the one there)
      dispose: () => { if (skies.get(sky) === keyed) skies.delete(sky); keyed.dispose(); },
      bytes: () => keyed.keyBytes(),
      ceiling: () => keyed.keyCeiling(),
    };
  } });
}

/** The fields a painted sky writes to the rig; a painted look's schema declares at least these. */
const PAINTED_LOOK = { keyColor: 'colour', keyIntensity: 'number', shadeTint: 'colour', rimColor: 'colour', hemiSky: 'colour', hemiGround: 'colour',
  hemiIntensity: 'number', envIntensity: 'number', fogColor: 'colour', fogSunColor: 'colour', fogDist: 'number', fogHeightDensity: 'number',
  cloudSun: 'colour', cloudLight: 'colour', planetLight: 'colour', planetOpacity: 'number', disc: 'number', moon: 'number', saturation: 'number' } as const;
type PaintedSchema = typeof PAINTED_LOOK;
function paintedSchema(schema: DayLookSchema): schema is DayLookSchema & PaintedSchema { return Object.entries(PAINTED_LOOK).every(([field, kind]) => schema[field] === kind); }
const object = (value: unknown): boolean => typeof value === 'object' && value !== null;
const PaintedFile = v.object({ shapes: v.record(v.string(), v.unknown()), sky: v.object({
  day: v.record(v.string(), v.union([v.number(), v.array(v.number())])), schema: v.custom<DayLookSchema>(object), initial: v.custom<DayLookRow<PaintedSchema>>(object) }) });
/** A painted sky's frame reading: the weather's numbers this frame and whether the eye is indoors. */
export interface PaintedReading { readonly overcast: number; readonly rain: number; readonly wet: number; readonly flash: number; readonly indoors: boolean }
export interface PaintedSky extends SkyFace {
  /** the look it painted this frame (the file's fields with the sun's and the key light's directions) and its dome */
  readonly look: DayLookPreset<PaintedSchema> & { readonly sunDir: THREE.Vector3; readonly keyDir: THREE.Vector3 };
  readonly dome: THREE.Mesh;
  /** the clock, the keyed look, the weather's layer, the rig and the re-grade */
  readonly frame: (dt: number, reading: PaintedReading) => void;
}
/**
 * A painted sky (rows `PaintedSkyRows`, a painted panorama's), the keyed sky's second kind: the rows' hour clock
 * (`?time=` an hour or a part of the day, `?clock=0` paused: the harness's), the day key keyed and sampled into a day-look
 * preset, the weather laid over it, then written to the rig — the key light and the painterly sun, shade and rim, the
 * hemisphere, the environment and the fog, the cloud and planet light, the disc and its corona (a moon smaller and
 * cooler) — the dome kept on the camera and the panorama's re-grade (`panoramaTint`). Uniforms, colours and intensities only.
 */
export async function paintedSky(product: ShardFolder, game: Game, sky: SkyRig, rows: PaintedSkyRows, params: URLSearchParams, brightness: number, source?: ShardContext): Promise<PaintedSky> {
  const scope = source?.scope, runtime = source?.game.runtime, world = runtime?.world;
  const scene = game.scene, owner = game.levelScope, read = product.json;
  const live = (): void => {
    if (source !== undefined && (scope === undefined || scope.disposed || scope.disposing || owner.disposed || owner.disposing || source.scope !== scope || source.product !== product
      || source.game.runtime !== runtime || runtime?.world !== world || world?.game !== game || world.sky !== sky
      || game.scene !== scene || game.levelScope !== owner || product.json !== read)) throw new Error('Painted weather owner left or changed');
  };
  live();
  const clock = new DayCycle(rows.clock), time = params.get('time');
  if (time !== null) { const hour = Number.parseFloat(time); if (Number.isFinite(hour)) void clock.set(hour); else if (isClockName(time)) void clock.set(time); }
  clock.paused = params.get('clock') === '0';
  // R12: its runtime's day cycle while entered (session/clockSettings.ts): Settings ▸ Time and the day badge turn this sky
  if (scope !== undefined) publishSkyClock(scope, clock);
  const input = await product.json(rows.file); live();
  const file = v.parse(PaintedFile, input), schema = file.sky.schema;
  if (!paintedSchema(schema)) throw new Error('Painted sky schema lacks its rig fields');
  const day = file.sky.day, key = structuredClone(day), kit = dayLookPresets<PaintedSchema>(schema), channels = product.shardfile.clientChannels;
  const create = (): PaintedSky['look'] => ({ ...kit.live(file.sky.initial), sunDir: new THREE.Vector3(0, 1, 0), keyDir: new THREE.Vector3(0, 1, 0) });
  const base = create(), look = create(), dayFog = game.scene.fog instanceof THREE.Fog ? game.scene.fog.color.clone() : new THREE.Color(...[day[rows.from.fog] ?? 0].flat());
  const shade = painterlyUniforms.uPShade.value, rim = painterlyUniforms.uPRimColor.value;
  day[rows.from.fog] = [dayFog.r, dayFog.g, dayFog.b]; day[rows.from.shade] = [shade.r, shade.g, shade.b]; day[rows.from.rim] = [rim.r, rim.g, rim.b];
  const owners = new Map<string, unknown>([['day', day], ['key', key], ['clock', { get elevation() { return clock.sunElevation; } }],
    ['base', { fogDist: fogUniforms.fogDistDensity.value, fogHeightDensity: fogUniforms.fogHeightDensity.value, brightness }], ['look', base]]);
  for (const [field, value] of Object.entries(key)) if (Array.isArray(value)) owners.set(`key.${field}`, {
    get x() { return value[0] ?? 0; }, set x(n: number) { value[0] = n; }, get y() { return value[1] ?? 0; }, set y(n: number) { value[1] = n; }, get z() { return value[2] ?? 0; }, set z(n: number) { value[2] = n; },
  });
  const keys = installChannelPrograms(channels, rows.lanes.key, owners), sample = installChannelPrograms(channels, rows.lanes.sample, owners);
  const shape = file.shapes[rows.dome.shape]; if (shape === undefined) throw new Error(`Missing painted sky shape: ${rows.dome.shape}`);
  const dome = new THREE.Mesh(new THREE.BufferGeometryLoader().parse(shape), lentLook(rows.dome.look));
  dome.frustumCulled = false; dome.renderOrder = rows.dome.order; dome.name = 'sky-dome'; game.scene.add(dome); game.scene.background = null;
  const domeParams = graphParamRoots(channels, rows.lanes.dome, [rows.dome.look]);
  const domeLane = installChannelPrograms(channels, rows.lanes.dome, new Map<string, unknown>([...domeParams.roots, ['look', look]]));
  const weather = installChannelPrograms(channels, rows.lanes.weather, new Map([['look', look]]));
  const tintParams = graphParamRoots(channels, rows.lanes.tint, rows.tint), t = panoramaTint;
  const tintLane = installChannelPrograms(channels, rows.lanes.tint, new Map<string, unknown>([...tintParams.roots, ['look', look],
    ['tint', { key: t.key.value, light: t.light.value, veilColour: t.veilColour.value, moon: t.moon, veil: t.veil, flash: t.flash }]]));
  const keyLight = day[rows.from.light], lit = { overcast: 0, rain: 0, flash: 0, waterRain: 0, dayFog: 0.2126 * dayFog.r + 0.7152 * dayFog.g + 0.0722 * dayFog.b,
    dayKey: Math.max(0.1, typeof keyLight === 'number' ? keyLight : 0) };
  const disc = sky.sunDisc, discColor = disc.material instanceof THREE.MeshBasicMaterial ? disc.material.color.clone() : new THREE.Color(), discScale = disc.scale.x;
  const halo = disc.children.find((child): child is THREE.Sprite => child instanceof THREE.Sprite), haloScale = halo?.scale.clone();
  const m = rows.moon, moonDisc = new THREE.Color(...m.disc), tint = new THREE.Color();
  game.levelScope.onDispose(() => { dome.removeFromParent(); dome.geometry.dispose(); });
  return { clock, look, dome, owners: new Map<string, unknown>([['look', look]]),
    frame(dt, w) {
      clock.update(dt);
      keys.evaluate({ time: 0, delta: 0, values: {} }); sample.evaluate({ time: 0, delta: 0, values: {} });
      compassDir(clock.sunAzimuth, clock.sunElevation, base.sunDir);
      if (base.moon > 0) compassDir(clock.moonAzimuth, clock.moonElevation, base.keyDir); else base.keyDir.copy(base.sunDir);
      kit.lerp(look, base, base, 0); look.sunDir.copy(base.sunDir); look.keyDir.copy(base.keyDir);
      weather.evaluate({ time: 0, delta: dt, values: { overcast: w.overcast, flash: w.flash, rain: w.rain, wet: w.wet } });
      sky.setKeyLight(look.keyDir, look.keyColor, look.keyIntensity); syncPainterlySun(sky);
      painterlyUniforms.uPShade.value.copy(look.shadeTint); painterlyUniforms.uPRimColor.value.copy(look.rimColor);
      sky.hemi.color.copy(look.hemiSky); sky.hemi.groundColor.copy(look.hemiGround); sky.hemi.intensity = look.hemiIntensity;
      game.scene.environmentIntensity = look.envIntensity; if (game.scene.fog instanceof THREE.Fog) game.scene.fog.color.copy(look.fogColor);
      fogUniforms.fogSunColor.value.copy(look.fogSunColor); fogUniforms.fogDistDensity.value = look.fogDist; fogUniforms.fogHeightDensity.value = look.fogHeightDensity;
      sky.setCloudLight(look.cloudSun, look.cloudLight); sky.setPlanetLight(look.planetLight, look.planetOpacity);
      const moon = look.moon > 0;
      disc.visible = look.disc > .01; if (disc.material instanceof THREE.MeshBasicMaterial) disc.material.color.copy(tint.copy(discColor).lerp(moonDisc, look.moon)).multiplyScalar(look.disc * (moon ? m.gain : 1));
      disc.scale.setScalar(discScale * (moon ? m.scale : 1)); if (halo && haloScale) { halo.scale.copy(haloScale).multiplyScalar(moon ? m.halo : 1); halo.material.opacity = look.disc * (moon ? m.haloOpacity : 1); }
      domeLane.evaluate({ time: 0, delta: dt, values: { flash: w.flash * rows.flash } }); pushLentParams(domeParams); dome.position.copy(game.camera.position);
      lit.overcast = w.overcast; lit.rain = w.rain; lit.flash = w.flash; lit.waterRain = w.indoors ? 0 : w.rain;
      tintLane.evaluate({ time: 0, delta: dt, values: lit }); pushLentParams(tintParams);
    },
  };
}
const CLOCK_NAMES = ['dawn', 'day', 'noon', 'golden', 'dusk', 'night', 'midnight'] as const;
function isClockName(name: string): name is (typeof CLOCK_NAMES)[number] { return (CLOCK_NAMES as readonly string[]).includes(name); }
