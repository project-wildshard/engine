import { HORIZON_RADIUS as CONTENT_HORIZON_RADIUS } from '@wildshard/format/contentBounds';
/**
 * The painted horizon of the low-poly shard (Driftwood Isle — DRIFTWOOD-REMASTER X4, the film matte-painting trick):
 * a 360° band of far sea stacks, distant islands with palms, cloud banks sitting on the sea and sea haze, painted with
 * codex image_gen over real in-game captures at six headings and stitched into one seamless strip
 * (`art/driftwood-isle/round-9-horizon/`). Day + moonlit night versions; the sky's own palette tints and hazes it.
 *
 *   const matte = new HorizonMatte(sky).build();   // null-safe: builds nothing unless the sky backdrop has a palette
 *   scene.add(matte.mesh);
 *   await matte.load(undefined, true);             // under the loading card (DL17: whole at control)
 *   game.onUpdate((dt) => matte.update(dt, camera, dayNight?.night ?? 0));
 *
 * - **mesh**: one open cylinder (128 × 8 quads) of radius `RADIUS` that follows the camera on XZ and stays at sea level,
 *   so the painted horizon row lands on the ocean's own horizon from any eye height. Rows map linearly to elevation
 *   the strips' `elMin` … `elMax` (y = sea + R·tan e). Inside the camera's far plane (2600 m) up to the top edge.
 * - **draw**: unlit, fogless, transparent, depth-tested (terrain / props in front hide it) with no depth write;
 *   renderOrder −16 — after the dome (−20), before the cumulus (−15), the planet (−12 / −11) and the sea (4), so the 3D
 *   clouds and the planet stay in front and the sea covers everything below its own horizon line. One draw call.
 * - **look**: the day texture × the cumulus' lit colour relative to midday (golden hour warms it, dusk dims it), faded into
 *   the night texture by the clock's `night`, then hazed toward the dome's live horizon colour near the sea and lit by
 *   the sun glow — so it rides every day / night preset without a third texture. The alpha fades into the sky at the top.
 * - **textures**: the shard's strips (its manifest's `horizonStrips`): two 4096 × 512 WebPs with alpha
 *   (`public/assets/horizon/<slug>-{day,night}.webp`, made by scripts/horizon-matte/ with `--shard <slug>`), fetched while
 *   the level loads and shown whole at control (DL17); a later `load()` fades the band in over ~1.5 s. A shard without strips builds nothing; Pine Hollow's
 *   photoreal strips are drawn at infinity by PaintedHorizon (below), not by this class. Always on — the user locked it in (E78); the `?matte=0` switch is gone (E136).
 */
import * as THREE from 'three';
import { tierUrl } from '../boot/bytes';
import { ktx2Texture, readTexturePixelsAsync, prepareCompressedTexture } from '../core/ktx2';
import type { SkyRig as Sky } from './skyRig';
import { fogUniforms } from './Atmosphere';
import { activeLevel } from '../../../shared/engine/level/selection';
import { TIER } from '../core/tier';

/** the band's radius (m): inside the camera's far plane (2600) even at the top edge (R / cos 24° ≈ 2520) */
const RADIUS = CONTENT_HORIZON_RADIUS;
/** the band's radius: the sea (Ocean.ts) fades out just inside it, so the painted islands stand on its far edge (E125) */
export const HORIZON_RADIUS: typeof CONTENT_HORIZON_RADIUS = RADIUS;
const FADE_IN = 1.5;

/**
 * A shard's painted horizon: its day / night strips and the elevation range their rows cover, bottom → top (degrees,
 * seen from the sea surface at RADIUS) — the `strip` of scripts/horizon-matte/configs/<slug>.json.
 */
export interface HorizonStrips {
  day: string; night: string; elMin: number; elMax: number;
  /** half-size copies for the phone tier */
  phone?: { day: string; night: string };
  /** the texels hold scene-linear light ÷ this (scripts/horizon-matte/encode.py: a PBR shard's painting, AgX-inverted) */
  scale?: number;
}

/** the shard's painted horizon, or null when it has none */
export function horizonStrips(level: { slug: string; horizonStrips?: HorizonStrips }): HorizonStrips | null { return level.horizonStrips ?? null; }
/** the level's painted horizon, or null when it has none */
export function levelHorizonStrips(level: { id: string; horizonStrips?: HorizonStrips | undefined }): HorizonStrips | null { return level.horizonStrips ?? null; }

export class HorizonMatte {
  mesh: THREE.Mesh | null = null;
  private fade = 0;
  private loaded = false;
  private ready = false;
  private readonly u = {
    tDay: { value: placeholder() },
    tNight: { value: placeholder() },
    uFade: { value: 0 },
    uNightMix: { value: 0 },
    uHorizon: { value: new THREE.Color() },
    uCloudLit: { value: new THREE.Color() },
    uSunGlow: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uMiddayLit: { value: new THREE.Color() },
    uHorizonV: { value: 0 },   // the painted horizon row, set from the strips in build()
    uGain: { value: 1.1 },
    uNightGain: { value: 0.72 },  // the painted moonlight sits a little bright against the night dome
  };

  private sky: Sky;
  private seaLevel: number;
  private strips: HorizonStrips | null;
  /** `strips`: the painting to show — the active shard's by default; null builds nothing */
  constructor(sky: Sky, seaLevel = 0, strips: HorizonStrips | null = levelHorizonStrips(activeLevel())) {
    this.sky = sky;
    this.seaLevel = seaLevel;
    this.strips = strips;
  }

  build(): this {
    const st = this.sky.backdrop?.palette;
    const strips = this.strips;
    if (!st || !strips) return this;
    this.u.uHorizonV.value = -strips.elMin / (strips.elMax - strips.elMin);
    // share the dome's live palette uniforms (the backdrop's clock writes them): read-only here
    this.u.uHorizon = st.uHorizon; this.u.uCloudLit = st.uCloudLit; this.u.uSunGlow = st.uSunGlow; this.u.uSunDir = st.uSunDir;
    this.u.uMiddayLit.value.copy(st.middayLit);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false, depthTest: true, fog: false, side: THREE.BackSide,
      vertexShader: /* glsl */`
        varying vec2 vUv; varying vec3 vW;
        void main() {
          vUv = uv;
          vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tDay; uniform sampler2D tNight;
        uniform float uFade; uniform float uNightMix; uniform float uHorizonV; uniform float uGain; uniform float uNightGain;
        uniform vec3 uHorizon; uniform vec3 uCloudLit; uniform vec3 uSunGlow; uniform vec3 uSunDir; uniform vec3 uMiddayLit;
        varying vec2 vUv; varying vec3 vW;
        void main() {
          vec4 d = texture2D(tDay, vUv);
          vec4 n = texture2D(tNight, vUv);
          vec3 tint = clamp(uCloudLit / uMiddayLit, 0.0, 1.6);                 // golden hour warms, dusk dims the painted light
          vec3 col = mix(d.rgb * tint * uGain, n.rgb * uNightGain, uNightMix);
          float a = mix(d.a, n.a, uNightMix);
          float above = vUv.y - uHorizonV;                                      // 0 on the painted horizon line
          col = mix(col, uHorizon, mix(0.22, 0.4, uNightMix) * (1.0 - smoothstep(0.0, 0.2, above))); // sea haze melts the feet into the dome's horizon
          vec3 dir = normalize(vW - cameraPosition);
          float s = max(dot(dir, uSunDir), 0.0);
          col += uSunGlow * (pow(s, 8.0) * 0.3) * (1.0 - uNightMix * 0.7);       // the dome's sun glow reaches over the band
          a *= 1.0 - smoothstep(0.9, 0.99, vUv.y);                              // never a hard top edge (the key already fades it)
          a *= smoothstep(0.0, 0.05, vUv.y);                                    // nor a bottom one (the sea covers it anyway)
          gl_FragColor = vec4(col, a * uFade);
        }`,
    });
    mat.name = 'horizonMatte';
    const mesh = new THREE.Mesh(bandGeometry(strips.elMin, strips.elMax), mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -16; // visible from the start at alpha 0: its program compiles with the rest at boot, never mid-play
    mesh.name = 'horizon-matte';
    this.mesh = mesh;
    return this;
  }

  /**
   * fetch + decode both paintings; resolves once both are decoded. `instant` (the loader's own call, DL17: before
   * control) shows the band whole at once and rejects when the paintings fail (the level is not complete without them);
   * otherwise it fades in over FADE_IN and a failure leaves the band off. `replaces`: geometry the painting stands in
   * for, hidden as the band shows; it stays the fallback when a later load fails.
   */
  async load(replaces?: THREE.Object3D, instant = false): Promise<void> {
    const strips = this.strips;
    if (!this.mesh || !strips || this.loaded) return;
    this.loaded = true;
    try {
      const [day, night] = await Promise.all([loadTexture(strips.day), loadTexture(strips.night)]);
      this.u.tDay.value = day; this.u.tNight.value = night;
      this.ready = true;
      // `instant`: loaded under the loading card (DL17), the band is whole at control, with no fade-in after it
      if (instant) { this.fade = 1; this.u.uFade.value = 1; }
      if (replaces) replaces.visible = false;
    } catch (e) {
      // the loader's own load (DL17): a level without its horizon is not complete at control, so the boot fails visibly
      if (instant) throw new Error(`Horizon paintings did not load: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
      console.warn('[horizon-matte] paintings not loaded; the band stays off', e);
    }
  }

  /** every frame: follow the camera on XZ, fade in, set the day / night mix (0 = day … 1 = night) */
  update(dt: number, camera: THREE.Camera, night: number): void {
    const m = this.mesh;
    if (!m) return;
    m.position.set(camera.position.x, this.seaLevel, camera.position.z);
    if (this.ready && this.fade < 1) { this.fade = Math.min(1, this.fade + dt / FADE_IN); this.u.uFade.value = this.fade * this.fade * (3 - 2 * this.fade); }
    this.u.uNightMix.value = night;
  }
}

/** an open cylinder, u = azimuth (0 → +X, 0.25 → +Z), v = elevation elMin → elMax; viewed from inside */
function bandGeometry(elMin: number, elMax: number): THREE.BufferGeometry {
  const SEG = 128, ROWS = 8, d2r = Math.PI / 180;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let r = 0; r <= ROWS; r++) {
    const v = r / ROWS;
    const y = RADIUS * Math.tan((elMin + (elMax - elMin) * v) * d2r);
    for (let s = 0; s <= SEG; s++) {
      const u = s / SEG, a = u * Math.PI * 2;
      pos.push(Math.cos(a) * RADIUS, y, Math.sin(a) * RADIUS);
      uv.push(u, v);
    }
  }
  for (let r = 0; r < ROWS; r++) for (let s = 0; s < SEG; s++) {
    const a = r * (SEG + 1) + s, b = a + 1, c = a + SEG + 1, e = c + 1;
    idx.push(a, c, b, b, c, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function placeholder(): THREE.Texture {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  t.needsUpdate = true;
  return t;
}

/** A painting's image, through fetch: a level's download answers a read there, and an `<img>` would move the file over the
 *  network again beside its part (DL25). The decode stays the image element's, so its pixels and orientation stand. */
async function loadImageTexture(url: string): Promise<THREE.Texture> {
  const response = await fetch(tierUrl(url));
  if (!response.ok) throw new Error(`${String(response.status)} ${url}`);
  const local = URL.createObjectURL(await response.blob());
  try { return await new THREE.TextureLoader().loadAsync(local); } finally { URL.revokeObjectURL(local); }
}

async function loadTexture(url: string): Promise<THREE.Texture> {
  // E157: the KTX2 stand-in when there is one (Y-flipped at encode like TextureLoader's flipY; its mips come with the file)
  const k = await ktx2Texture(url);
  const t = k ?? await loadImageTexture(url);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;           // the strip is seamless at the 0 / 360° wrap
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  t.generateMipmaps = k === null;
  t.needsUpdate = true;
  return prepareCompressedTexture(t);
}

/**
 * The photoreal shard's painted horizon (Pine Hollow, PINE-HOLLOW-REMASTER PH-L5): far boreal country — rolling forested
 * ridges in aerial perspective, the snow-capped range to the north, lakes and valley mist — painted with codex image_gen
 * over the clock's own sky seen from the fire lookout's deck (six chained edits, stitched and keyed:
 * `art/pine-hollow/round-10-horizon/`, scripts/horizon-matte/ `--shard pine-hollow`). Day + moonlit night, same silhouettes.
 *
 *   const far = new PaintedHorizon(strips).build();   // Horizon.ts builds it on Pine Hollow instead of the ridge rings
 *   group.add(far.mesh); … far.load() after boot; far.update(dt, fogColor, night) every frame
 *
 * - **at infinity**: the mesh is a unit sleeve around the eye (elMax down to the nadir) whose vertex shader drops it on the
 *   far plane (z = w) and uses only the view's rotation, so it never parallaxes, sits behind everything and shows only
 *   where nothing else was drawn: past the slab's edge and over the terrain's skyline. The horizon row is the eye's level
 *   from any height (the Hollow's floor or the lookout's deck). Fogless, unlit, one draw, no depth write.
 * - **look**: the textures hold scene-linear light (encode.py inverted the post chain's AgX), so the painting tone-maps back to
 *   itself. The day painting is tinted by the clock's far haze and light relative to midday (golden hour warms it, dusk
 *   dims it) and cross-fades into the night painting on the clock's `night`. Toward and below the horizon it drifts into the
 *   live fog colour with the fog's own sun in-scatter — the same haze Atmosphere.ts' `fogEdge` thickens the slab's last
 *   metres into, so the 3D edge, the haze under it and the painted valleys read as one band (Nalati N19's method).
 * - **before the paintings load** (and if they fail) the band still draws the haze below the horizon: never the dome's
 *   underside, never the old white cloud sea.
 */
export class PaintedHorizon {
  mesh: THREE.Mesh | null = null;
  private fade = 0;
  private loaded = false;
  private ready = false;
  /** the weather's veil (PH-L10, src/shards/pine-hollow/world/weather.ts): x a rain deck over the whole band, y the dawn fog on its low rows */
  readonly veil: {value:THREE.Vector2} = { value: new THREE.Vector2(0, 0) };
  private readonly u = {
    tDay: { value: placeholder() },
    tNight: { value: placeholder() },
    uFade: { value: 0 },
    uNight: { value: 0 },
    uScale: { value: 1 },
    uElMin: { value: 0 },
    uElMax: { value: 1 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uFog: { value: new THREE.Color(0.5, 0.58, 0.74) },
    /** the paintings' bottom rows averaged (texel units): what lies under the strip, looking steeply down past the slab */
    uFloorDay: { value: new THREE.Color(0, 0, 0) },
    uFloorNight: { value: new THREE.Color(0, 0, 0) },
    fogSunDir: fogUniforms.fogSunDir,
    fogSunColor: fogUniforms.fogSunColor,
    uVeil: this.veil,
  };

  private strips: HorizonStrips;
  constructor(strips: HorizonStrips) {
    this.strips = strips;
  }

  build(): this {
    const st = this.strips;
    this.u.uScale.value = st.scale ?? 1;
    this.u.uElMin.value = st.elMin; this.u.uElMax.value = st.elMax;
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false, depthTest: true, fog: false, side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        varying vec3 vDir; varying float vU;
        void main() {
          vDir = position; vU = uv.x;
          vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
          gl_Position = p.xyww; // on the far plane: behind everything, drawn only where nothing else is
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tDay; uniform sampler2D tNight;
        uniform float uFade; uniform float uNight; uniform float uScale; uniform float uElMin; uniform float uElMax;
        uniform vec3 uTint; uniform vec3 uFog; uniform vec3 fogSunDir; uniform vec3 fogSunColor; uniform vec3 uFloorDay; uniform vec3 uFloorNight;
        uniform vec2 uVeil;
        varying vec3 vDir; varying float vU;
        void main() {
          vec3 d = normalize(vDir);
          float el = degrees(asin(clamp(d.y, -1.0, 1.0)));
          vec2 uv = vec2(vU, clamp((el - uElMin) / (uElMax - uElMin), 0.0, 1.0));
          // under the painting's bottom row (looking steeply down past the slab): the bottom rows' own blur, the valley floor
          float under = smoothstep(uElMin + 2.0, uElMin - 4.0, el);
          vec4 day = texture2D(tDay, uv);
          vec3 night = texture2D(tNight, uv).rgb;
          day.rgb = mix(day.rgb, uFloorDay, under); night = mix(night, uFloorNight, under);
          vec3 land = mix(day.rgb * uTint, night, uNight) * uScale;
          // the fog's colour this way (Atmosphere.ts' sun in-scatter): the painted haze is the terrain's haze
          vec3 haze = mix(uFog, fogSunColor, pow(max(dot(d, fogSunDir), 0.0), 6.0) * 0.7);
          // aerial perspective: the far skyline breathes a little of the live haze (the land below already holds its own)
          float h = 0.12 * (1.0 - smoothstep(0.0, 6.0, el)) * smoothstep(-3.0, 0.0, el) + 0.03 * under;
          // the weather (PH-L10): a rain deck veils the whole band, the dawn fog the valleys under the far peaks
          h = 1.0 - (1.0 - h) * (1.0 - uVeil.x) * (1.0 - uVeil.y * (1.0 - smoothstep(-1.0, 4.0, el)));
          land = mix(land, haze, clamp(h, 0.0, 1.0));
          float below = 1.0 - smoothstep(-0.5, 0.0, el);        // under the horizon: always opaque (the land, or the haze)
          vec3 col = mix(land, mix(haze, land, uFade), below);
          gl_FragColor = vec4(col, max(day.a * uFade, below));
        }`,
    });
    mat.name = 'paintedHorizon';
    const mesh = new THREE.Mesh(sleeveGeometry(st.elMax), mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -16; // after the dome (−1000) and the sun disc, before the cloud layer (−10): the clouds pass in front
    mesh.name = 'painted-horizon';
    this.mesh = mesh;
    return this;
  }

  /** fetch + decode both paintings; the band fades in once both are decoded. `instant`: loaded under the loading card
   *  (DL17), the band is whole at control with no fade-in after it, and a failed painting refuses the load */
  async load(instant = false): Promise<void> {
    if (!this.mesh || this.loaded) return;
    this.loaded = true;
    const st = this.strips, src = TIER === 'phone' && st.phone ? st.phone : st;
    try {
      const [day, night] = await Promise.all([loadTexture(src.day), loadTexture(src.night)]);
      this.u.tDay.value = day; this.u.tNight.value = night;
      await Promise.all([floorOf(day, this.u.uFloorDay.value), floorOf(night, this.u.uFloorNight.value)]);
      this.ready = true;
      if (instant) { this.fade = 1; this.u.uFade.value = 1; }
    } catch (e) {
      if (instant) throw new Error(`Painted horizon did not load: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
      console.warn('[painted-horizon] paintings not loaded; the haze band stays', e);
    }
  }

  /**
   * every frame: the fog's live colour, the clock's night (0 day … 1 night) and its far haze / light (horizonLight's
   * uHazeCol, uSeaSun) for the day painting's tint
   */
  update(dt: number, fog: THREE.Color, night: number, far: THREE.Color, light: THREE.Color): void {
    if (this.ready && this.fade < 1) { this.fade = Math.min(1, this.fade + dt / FADE_IN); this.u.uFade.value = this.fade * this.fade * (3 - 2 * this.fade); }
    this.u.uFog.value.copy(fog);
    this.u.uNight.value = night;
    // relative to midday (PineDayNight's day preset: far 0.55 / 0.64 / 0.8, light 1 / 0.96 / 0.9)
    const t = this.u.uTint.value;
    t.setRGB(Math.min(far.r / 0.55, 1.5), Math.min(far.g / 0.64, 1.5), Math.min(far.b / 0.8, 1.5));
    t.r *= 0.65 + 0.35 * Math.min(light.r / 1.0, 1.2); t.g *= 0.65 + 0.35 * Math.min(light.g / 0.96, 1.2); t.b *= 0.65 + 0.35 * Math.min(light.b / 0.9, 1.2);
  }
}

/** the mean linear colour of a painting's bottom 4 % (a 32 × 4 canvas read, once at load; a compressed painting's is a GPU
 *  read that waits on a fence, not the main thread) */
async function floorOf(tex: THREE.Texture, out: THREE.Color): Promise<void> {
  let px: Uint8Array | Uint8ClampedArray;
  if (tex instanceof THREE.CompressedTexture) { // E157: no pixels to draw — read the bottom 4 % back through the GPU
    const all = await readTexturePixelsAsync(tex, 32, 100);
    if (!all) return;
    px = all.subarray(96 * 32 * 4);
  } else {
    const img = tex.image as CanvasImageSource & { width: number; height: number };
    const c = document.createElement('canvas'); c.width = 32; c.height = 4;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return;
    g.drawImage(img, 0, img.height * 0.96, img.width, img.height * 0.04, 0, 0, 32, 4);
    px = g.getImageData(0, 0, 32, 4).data;
  }
  let r = 0, gg = 0, b = 0;
  for (let i = 0; i < px.length; i += 4) { r += (px[i] ?? 0) / 255; gg += (px[i + 1] ?? 0) / 255; b += (px[i + 2] ?? 0) / 255; }
  const n = px.length / 4;
  out.setRGB(r / n, gg / n, b / n, THREE.SRGBColorSpace); // sRGB-encoded texels → the working (linear) space, like the sampler
}

/** a unit sleeve round the eye from `top` degrees down to the nadir, u = azimuth (0 → +X, 0.25 → +Z); viewed from inside */
function sleeveGeometry(top: number): THREE.BufferGeometry {
  const SEG = 128, d2r = Math.PI / 180;
  const rows = [top, top / 2, 0, -6, -12, -20, -30, -45, -70, -89.5];
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (const el of rows) {
    const c = Math.cos(el * d2r), y = Math.sin(el * d2r);
    for (let s = 0; s <= SEG; s++) {
      const u = s / SEG, a = u * Math.PI * 2;
      pos.push(Math.cos(a) * c, y, Math.sin(a) * c);
      uv.push(u, 0);
    }
  }
  for (let r = 0; r < rows.length - 1; r++) for (let s = 0; s < SEG; s++) {
    const a = r * (SEG + 1) + s, b = a + 1, c = a + SEG + 1, e = c + 1;
    idx.push(a, b, c, b, e, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
