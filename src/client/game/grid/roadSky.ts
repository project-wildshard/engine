/**
 * The road's own sky and key light (SHARD-PLATFORM SF19a / SF19b; Jake's G165 pick "A, road light over everything",
 * `art/grid/round-17-road-view/board.jpg`; restyled by his G242 pick B, "grid dawn", `art/grid/round-26-road-sky/B-grid-dawn.jpg`):
 * outside the cell you stand in, everything is under the road look, sky and sun included; a shard's own sky and light show
 * only once you are inside it. The frame (`frame.ts`) hangs this on the road owner, told the road's weight every frame.
 *
 * - **The dome**: one camera-centred shader dome, no textures (`ROAD_SKY`): a dawn gradient whose horizon is the frame's air
 *   (so far proxies haze into it), a thin cyan horizon line and a faint cyan grid round the horizon that echoes the HUD and
 *   the VR void; below the horizon, the void's blue-violet (G630). Unlit, fogless, depth-tested (all geometry stays in front), one draw while visible, drawn over the page's
 *   sky pieces (render order −20 … −10) and under every region's own sky (−9.9 … −9.1) and every world transparent (≥ 0).
 * - **The key light**: a low warm dawn sun, its fill, its fog in-scatter and its environment intensity, which the road owns
 *   instead of keeping the page's (the home shard's) sun.
 * - **One layer on the page's one sky** (`SkyRig.layerBackdrop({ base: true })`, `backdropLayer.ts`): the dome and the key
 *   light are a base layer, applied before every region's own sky and weighted by the share the regions leave, so across a
 *   cell's 16 m edge band the road blends straight into that shard's own sky and light (G232), and at road weight 0 the
 *   page and the region are exactly what they were without it. Nothing compiles at a crossing: the dome's one program is
 *   warmed once the page can compile it (its composer built), and the blend is a constant blend alpha and uniforms.
 * - **No page sky rig** (a test page, the first frames before the sky is built): the dome alone is drawn on the scene by the
 *   road's weight, with no key light, until the layer can be laid.
 */
import { BackSide, Color, ConstantAlphaFactor, CustomBlending, Fog, Mesh, OneMinusConstantAlphaFactor, ShaderMaterial, SphereGeometry, Vector3, type Object3D, type Scene } from 'three';
import { ROAD_SKY } from './frameModel';
import { FAR_RING } from '../../../shared/game/grid/farProxy';

/** the dome's radius (m): past every far proxy across the grid's sightline, inside the grid camera's far plane (SF88c) */
const RADIUS = FAR_RING.domeRadius;
/** the render order: after the page's sky pieces (−20 … −10), before every region's own sky (−9.9 … −9.1); `BASE_SKY_ORDER` */
export const ROAD_SKY_ORDER = -9.95;
/** below this weight the dome is not drawn */
const OFF = 0.001;

/** The page's one sky layer the road lays its dome and key light on (the engine's `BackdropLayer`, structurally). */
export interface RoadSkyLayer {
  readonly holder: Scene;
  readonly attach: (backdrop: RoadSkyBackdrop) => void;
  weight: number;
  readonly state: () => { readonly applied: number };
  readonly dispose: () => void;
}
/** The page's sky rig as the road reads it: a base layer (`SkyRig.layerBackdrop`), and a way to compile a hidden object. */
export interface RoadSkyPage {
  readonly layerBackdrop: (options: { readonly air?: () => Fog | null; readonly base?: boolean }) => RoadSkyLayer | null;
  /** compile an object's programs now (the dome, before it is first seen); absent: it compiles at its first draw */
  readonly warm?: (object: Object3D) => void;
}
/** What the road sky reads from the frame's host: the scene, and the page's sky rig (absent or throwing: none yet). */
export interface RoadSkyHost { readonly scene: Object3D; readonly sky?: () => RoadSkyPage | null }

/** A direction from compass degrees (the engine's `compassDir`: azimuth from +z toward −x, elevation up). */
export function roadSunDir(azimuth: number, elevation: number, out: Vector3 = new Vector3()): Vector3 {
  const az = azimuth * Math.PI / 180, el = elevation * Math.PI / 180;
  return out.set(-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
}

interface Rgb { readonly setRGB: (r: number, g: number, b: number) => unknown }
/** The parts of a sky clock's targets (the engine's `SkyBackdropTargets`) the road's key light writes. */
export interface RoadKeyTargets {
  readonly sunDir: Vector3; readonly sunColor: Rgb; readonly lightDirection: Vector3;
  readonly lights: readonly { readonly color: Rgb; intensity: number }[];
  readonly hemi: { readonly color: Rgb; readonly groundColor: Rgb; intensity: number };
  readonly fog: { readonly color: Rgb };
  readonly fogU: { readonly fogSunDir: { readonly value: Vector3 }; readonly fogSunColor: { readonly value: Rgb } };
  readonly cloud: { readonly uSunDir: { readonly value: Vector3 }; readonly uSunColor: { readonly value: Rgb } };
  readonly far: { readonly uHazeCol: { readonly value: Rgb }; readonly uSeaSunDir: { readonly value: Vector3 } };
  readonly planet: { readonly uSunDir: { readonly value: Vector3 } };
}

/** The road's key light, written once into the layer's own targets (it is a fixed dawn: nothing turns it). */
export class RoadSkyBackdrop {
  readonly lut = null;
  /** the dome: the layer keeps it on the camera */
  readonly clouds: Mesh;
  constructor(dome: Mesh) { this.clouds = dome; }

  bind(t: RoadKeyTargets): void {
    const S = ROAD_SKY, sun = roadSunDir(S.sun.azimuth, S.sun.elevation);
    t.sunDir.copy(sun); t.sunColor.setRGB(...S.sun.colour); t.lightDirection.copy(sun).negate();
    for (const light of t.lights) { light.color.setRGB(...S.sun.colour); light.intensity = S.sun.intensity; }
    t.hemi.color.setRGB(...S.hemi.sky); t.hemi.groundColor.setRGB(...S.hemi.ground); t.hemi.intensity = S.hemi.intensity;
    t.fog.color.setRGB(...S.air);
    t.fogU.fogSunDir.value.copy(sun); t.fogU.fogSunColor.value.setRGB(...S.fogSun);
    t.cloud.uSunDir.value.copy(sun); t.cloud.uSunColor.value.setRGB(...S.sun.colour);
    t.far.uHazeCol.value.setRGB(...S.air); t.far.uSeaSunDir.value.copy(sun);
    t.planet.uSunDir.value.copy(sun);
  }
  update(): void { /* a fixed dawn */ }
  rebuild(): void { /* no textures, no targets */ }
  gpuBytes(): number { return 0; }
}

export class RoadSky {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private readonly uniforms = {
    uAir: { value: new Color(...ROAD_SKY.air) }, uMid: { value: new Color(...ROAD_SKY.mid) }, uZenith: { value: new Color(...ROAD_SKY.zenith) },
    uLine: { value: new Color(...ROAD_SKY.line) }, uGrid: { value: new Color(...ROAD_SKY.grid) }, uGridStrength: { value: ROAD_SKY.gridStrength },
    uVoid: { value: new Color(...ROAD_SKY.void) },
    uSunDir: { value: roadSunDir(ROAD_SKY.sun.azimuth, ROAD_SKY.sun.elevation) }, uGlow: { value: new Color(...ROAD_SKY.sun.glow) },
  };
  private host: RoadSkyHost | null = null;
  private layer: RoadSkyLayer | null = null;
  /** the page's warm-up, until it has compiled the dome (it throws while the page's composer is not built) */
  private warmUp: ((object: Object3D) => void) | null = null;
  private warmTries = 0;
  /** the road's air as its layer's clock writes it (the frame reads `ROAD_SKY.air` itself; the page fog is left alone) */
  private readonly air = new Fog(new Color(...ROAD_SKY.air), 1, 1e6);
  private w = 0;
  private disposed = false;

  constructor() {
    this.material = new ShaderMaterial({
      uniforms: this.uniforms, side: BackSide, transparent: true, depthWrite: false, depthTest: true, fog: false,
      // the weight is a constant blend alpha (the layer's way too), so the drawn sky never needs a second program
      blending: CustomBlending, blendSrc: ConstantAlphaFactor, blendDst: OneMinusConstantAlphaFactor, blendAlpha: 0,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform vec3 uAir; uniform vec3 uMid; uniform vec3 uZenith; uniform vec3 uLine; uniform vec3 uGrid; uniform float uGridStrength;
        uniform vec3 uSunDir; uniform vec3 uGlow; uniform vec3 uVoid;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y, up = max(h, 0.0);
          // dawn: the air at the horizon, a lavender band, a clear blue zenith; the low sun's glow toward it
          vec3 col = mix(uAir, uMid, smoothstep(0.01, 0.26, up));
          col = mix(col, uZenith, smoothstep(0.16, 0.85, up));
          float s = max(dot(d, uSunDir), 0.0);
          col += uGlow * (0.22 * pow(s, 6.0) + 0.55 * pow(s, 48.0));
          // the faint grid round the horizon: a line every 4 degrees of azimuth, rows at even steps of tan(elevation);
          // each line one screen pixel wide (the azimuth's screen rate is analytic: no seam where atan wraps), faded out
          // where the lines crowd under a pixel, above ~14 degrees and below the horizon
          float r = max(length(d.xz), 1e-4);
          float az = atan(d.z, d.x) * (90.0 / 6.2831853), daz = max(length(fwidth(d.xz)) / r * (90.0 / 6.2831853), 1e-5);
          float el = h / r * 30.0, del = max(fwidth(el), 1e-5);
          float gx = abs(fract(az + 0.5) - 0.5) / daz, gy = abs(fract(el + 0.5) - 0.5) / del;
          float grid = 1.0 - min(min(gx, gy), 1.0);
          float fade = (1.0 - smoothstep(0.02, 0.25, up)) * step(0.0, h) * (1.0 - smoothstep(0.2, 0.45, max(daz, del)));
          col += uGrid * (grid * uGridStrength * fade);
          // the thin cyan horizon line, a hairline just above the horizon with a soft glow
          float fh = max(fwidth(h), 1e-5), off = abs(h - 0.008);
          float line = 1.0 - smoothstep(0.5 * fh, 1.5 * fh + 0.0008, off);
          col += uLine * (0.9 * line + 0.22 * exp(-off * 70.0));
          // G630: below the horizon (past the grid floor, inside the 6 km far plane) the void's blue-violet, from the air
          gl_FragColor = vec4(h < 0.0 ? mix(uAir, uVoid, smoothstep(0.0, 0.03, -h)) : col, 1.0);
        }`,
    });
    this.mesh = new Mesh(new SphereGeometry(RADIUS, 48, 24), this.material);
    this.mesh.name = 'road-sky'; this.mesh.frustumCulled = false; this.mesh.renderOrder = ROAD_SKY_ORDER; this.mesh.visible = false;
  }

  /** Hang on the frame's host: drawn on its scene until the page's sky rig can take it as a layer. Returns the removal. */
  attach(host: RoadSkyHost): () => void {
    this.host = host;
    host.scene.add(this.mesh);
    this.lay();
    return () => { this.dispose(); };
  }

  /** The road's weight (0..1): the dome's opacity and the key light's share; at 0 neither is drawn nor moved. */
  weight(w: number): void {
    this.w = Number.isFinite(w) ? Math.min(1, Math.max(0, w)) : 0;
    if (this.layer === null) this.lay();
    if (this.warmUp !== null) this.warm();
    if (this.layer !== null) { this.layer.weight = this.w; return; }
    this.material.blendAlpha = this.w; this.mesh.visible = this.w > OFF;
  }

  /** Before the scene draws: centre on the camera; the horizon is the frame's air (the road's own on the road). */
  frame(camera: Vector3, air: Color): void {
    this.mesh.position.copy(camera);
    this.uniforms.uAir.value.copy(air);
  }

  /** The dome's drawn opacity (the readout): the layer's applied share, or the weight it is drawn at alone. */
  get drawn(): number {
    if (this.layer !== null) return this.layer.state().applied;
    return this.mesh.visible ? this.material.blendAlpha : 0;
  }
  /** whether the dome and key light are a layer on the page's sky rig (false: the dome alone) */
  get layered(): boolean { return this.layer !== null; }

  /** the page's sky rig takes the dome and the key light as its base layer, once it is built */
  private lay(): void {
    const host = this.host;
    if (host === null || this.disposed || host.sky === undefined) return;
    let page: RoadSkyPage | null;
    try { page = host.sky(); } catch { return; } // not built yet: next frame
    if (page === null) return;
    const layer = page.layerBackdrop({ base: true, air: () => this.air });
    if (layer === null) return; // the rig's sky is not built yet: next frame
    this.mesh.removeFromParent();
    layer.holder.add(this.mesh);
    layer.holder.environmentIntensity = ROAD_SKY.env;
    layer.attach(new RoadSkyBackdrop(this.mesh));
    this.layer = layer;
    layer.weight = this.w;
    this.warmUp = page.warm ?? null;
  }

  /** compile the hidden dome now, into the target it is drawn to; retried each frame until the page can (then given up: it compiles at its first draw) */
  private warm(): void {
    const warmUp = this.warmUp;
    if (warmUp === null) return;
    const shown = this.mesh.visible;
    this.mesh.visible = true;
    try { warmUp(this.mesh); this.warmUp = null; } catch (error) {
      if (++this.warmTries >= 600) { this.warmUp = null; console.warn('[road sky] the dome was not warmed', error); }
    } finally { this.mesh.visible = shown; }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.layer !== null) { this.layer.dispose(); this.layer = null; }
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose(); this.material.dispose();
  }
}
