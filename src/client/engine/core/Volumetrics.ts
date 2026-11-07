import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';
import {
  Uniform, Vector3, Matrix4, Color, type PerspectiveCamera, type Texture, DataTexture, RepeatWrapping, NearestFilter, LinearFilter,
  WebGLRenderTarget, HalfFloatType, ShaderMaterial, Mesh, BufferGeometry, Float32BufferAttribute, Scene, OrthographicCamera,
  type DepthPackingStrategies, BasicDepthPacking,
} from 'three';
import { fogUniforms, volumetricFog } from '../world/Atmosphere';
import type { Renderer } from '../render/renderer';

/** the march's uniforms, typed per slot so the per-frame `.value.copy(...)` calls are checked */
interface MarchUniforms {
  uInvView: Uniform<Matrix4>; uInvProj: Uniform<Matrix4>; uViewProj: Uniform<Matrix4>;
  uCamPos: Uniform<Vector3>; uSunDir: Uniform<Vector3>; uSunColor: Uniform<Color>; uFogColor: Uniform<Color>;
  uHeight: Uniform<number>; uFalloff: Uniform<number>; uDensity: Uniform<number>; uStrength: Uniform<number>;
  uNoise: Uniform<Texture>; uFrame: Uniform<number>;
}

/** the height fog's density the march integrates */
const DENSITY = 0.0045;

/** the march: GLSL shared by the in-place (full-res) effect and the half-res pre-pass */
const MARCH = (steps: number) => /* glsl */`
  uniform mat4 uInvView; uniform mat4 uInvProj; uniform mat4 uViewProj;
  uniform vec3 uCamPos; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uFogColor;
  uniform float uHeight; uniform float uFalloff; uniform float uDensity; uniform float uStrength;
  uniform sampler2D uNoise; uniform float uFrame;

  float fogAt(vec3 p) { return uDensity * exp(-uFalloff * (p.y - uHeight)); }

  vec3 inscatterAt(const in vec2 uv, const in float depth) {
    vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 vp = uInvProj * clip; vp /= vp.w;
    vec3 worldEnd = (uInvView * vec4(vp.xyz, 1.0)).xyz;
    vec3 ray = worldEnd - uCamPos;
    float len = min(length(ray), 120.0);
    vec3 dir = ray / max(length(ray), 1e-3);
    float sunAmt = max(dot(dir, uSunDir), 0.0);
    float phase = 0.15 + 0.85 * pow(sunAmt, 6.0);         // forward-scattering lobe

    const int N = ${steps};
    float jitter = texture2D(uNoise, gl_FragCoord.xy / 64.0 + fract(uFrame * 0.618) ).r;
    float stepLen = len / float(N);
    float t = stepLen * (0.25 + 0.5 * jitter);
    float scatter = 0.0, trans = 1.0;
    for (int i = 0; i < N; i++) {
      vec3 p = uCamPos + dir * t;
      float dens = fogAt(p);
      // shadow test: is the point lit by the sun? project a point 6 m toward the sun and compare depth
      vec4 sp = uViewProj * vec4(p + uSunDir * 6.0, 1.0);
      vec3 sn = sp.xyz / sp.w;
      float lit = 1.0;
      if (abs(sn.x) < 1.0 && abs(sn.y) < 1.0 && sp.w > 0.0) {
        float sceneDepth = readDepth(sn.xy * 0.5 + 0.5);
        float sceneZ = -getViewZ(sceneDepth);
        lit = sceneZ < sp.w - 0.5 ? 0.15 : 1.0;
      }
      float a = dens * stepLen;
      scatter += trans * a * lit;
      trans *= exp(-a);
      t += stepLen;
    }
    // stay subtle away from the sun; the geometry fog already carries the base haze
    return mix(uFogColor * 0.5, uSunColor, phase) * scatter * uStrength * (0.25 + 0.75 * phase);
  }`;

/**
 * Screen-space volumetric light: for every pixel, march the view ray (up to the depth buffer)
 * through the same height-fog field the materials use, accumulating sun in-scatter that is
 * shadowed by a cheap screen-space occlusion test against the depth buffer projected toward
 * the sun. Produces warm light shafts through the canopy and thicker haze in the hollows,
 * with real depth occlusion — the "volumetrics" line in project/archive/2026-10-11-aaa-plan.md.
 */
export class VolumetricsEffect extends Effect {
  private readonly scale: number;
  /**
   * @param steps  ray-march steps (14 desktop, 8 phone)
   * @param scale  < 1 → the march runs in a separate render target of this scale (phone: 0.5) and the
   *               effect only composites it; 1 → the march runs in the effect's own fragment (desktop, as before)
   * @param options `prepass`: the separate target at any scale (a page that parks the march: `setParked`); `parked`: start
   *               parked (no march, a 1×1 target)
   */
  constructor(camera: PerspectiveCamera, blueNoise: Texture, steps = 14, scale = 1, options: { readonly prepass?: boolean; readonly parked?: boolean } = {}) {
    // held as our own typed uniform: the Effect's uniform map is typed loosely (postprocessing's bare `Uniform`)
    const scatter = new Uniform<Texture | null>(null);
    const separate = scale < 1 || options.prepass === true;
    super('VolumetricsEffect', separate
      ? /* glsl */`
        uniform sampler2D tScatter;
        void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
          outputColor = vec4(inputColor.rgb + texture2D(tScatter, uv).rgb, inputColor.a);
        }`
      : /* glsl */`${MARCH(steps)}
        void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
          outputColor = vec4(inputColor.rgb + inscatterAt(uv, depth), inputColor.a);
        }`, {
      blendFunction: BlendFunction.SRC,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>(separate ? [['tScatter', scatter]] : []),
    });
    this.scale = scale;
    this.parked = separate && options.parked === true;
    this.camera = camera;
    this.nearU = new Uniform(camera.near); this.farU = new Uniform(camera.far);
    this.marchUniforms = {
      uInvView: new Uniform(new Matrix4()),
      uInvProj: new Uniform(new Matrix4()),
      uViewProj: new Uniform(new Matrix4()),
      uCamPos: new Uniform(new Vector3()),
      uSunDir: new Uniform(new Vector3(0, 1, 0)),
      uSunColor: new Uniform(new Color(1, 0.7, 0.4)),
      uFogColor: new Uniform(new Color(0.6, 0.65, 0.75)),
      uHeight: new Uniform(-8),
      uFalloff: new Uniform(0.12),
      uDensity: new Uniform(DENSITY),
      uStrength: new Uniform(0.55),
      uNoise: new Uniform(blueNoise),
      uFrame: new Uniform(0),
    };
    if (separate) {
      this.renderTarget = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter });
      scatter.value = this.renderTarget.texture;
      this.marchMat = new ShaderMaterial({
        uniforms: { ...this.marchUniforms, depthBuffer: this.depthU, cameraNear: this.nearU, cameraFar: this.farU },
        defines: { DEPTH_PACKING: '0' },
        depthTest: false, depthWrite: false,
        vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }`,
        fragmentShader: /* glsl */`
          #include <packing>
          uniform sampler2D depthBuffer; uniform float cameraNear; uniform float cameraFar;
          varying vec2 vUv;
          float readDepth(const in vec2 uv) {
            #if DEPTH_PACKING == 3201
              return unpackRGBAToDepth(texture2D(depthBuffer, uv));
            #else
              return texture2D(depthBuffer, uv).r;
            #endif
          }
          #define getViewZ(depth) perspectiveDepthToViewZ(depth, cameraNear, cameraFar)
          ${MARCH(steps)}
          void main() { gl_FragColor = vec4(inscatterAt(vUv, readDepth(vUv)), 1.0); }`,
      });
      const tri = new BufferGeometry();
      tri.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
      this.quad = new Mesh(tri, this.marchMat); this.quad.frustumCulled = false;
      this.marchScene = new Scene(); this.marchScene.add(this.quad);
    } else {
      for (const k of Object.keys(this.marchUniforms) as (keyof MarchUniforms)[]) this.uniforms.set(k, this.marchUniforms[k]);
    }
  }
  private camera: PerspectiveCamera;
  private frame = 0;
  private viewProj = new Matrix4();
  private marchUniforms: MarchUniforms;
  private depthU = new Uniform<Texture | null>(null);
  private nearU: Uniform<number>;
  private farU: Uniform<number>;
  private depthPacking = '0';
  /** the separate march's target; named `renderTarget` so the post warm-up (`postJobs`) compiles the march into it, as
   *  `update` draws it, and not into the composer's screen target (a second, never-drawn sRGB program) */
  private renderTarget: WebGLRenderTarget | null = null;
  private marchMat: ShaderMaterial | null = null;
  private quad: Mesh | null = null;
  private marchScene: Scene | null = null;
  private marchCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  /** parked: no march and a 1×1 target (WebGL zero-fills it: the composite adds nothing); `setParked` */
  private parked = false;
  private readonly size = { width: 1, height: 1 };

  setSun(dir: Vector3, color: Color): void { this.marchUniforms.uSunDir.value.copy(dir); this.marchUniforms.uSunColor.value.copy(color); }
  setFogColor(c: Color): void { this.marchUniforms.uFogColor.value.copy(c); }
  /** the in-scatter's strength (0.55 by default; Pine Hollow's day / night clock keys it) */
  setStrength(s: number): void { this.marchUniforms.uStrength.value = s; }
  /** the in-scatter's strength now */
  strength(): number { return this.marchUniforms.uStrength.value; }
  /** the scattering medium (`ChunkAtmosphere.volumetric`): densest below `height` m, `falloff` per metre above it, overall `strength` */
  setMedium(m: { height: number; falloff: number; density: number; strength: number }): void {
    const u = this.marchUniforms;
    u.uHeight.value = m.height; u.uFalloff.value = m.falloff; u.uDensity.value = m.density; u.uStrength.value = m.strength;
  }

  /** Hold what `setSun`, `setFogColor`, `setStrength` and `setMedium` write; the returned function puts it back. */
  holdLight(): () => void {
    const u = this.marchUniforms;
    const dir = u.uSunDir.value.clone(), sun = u.uSunColor.value.clone(), fog = u.uFogColor.value.clone();
    const height = u.uHeight.value, falloff = u.uFalloff.value, density = u.uDensity.value, strength = u.uStrength.value;
    return () => {
      u.uSunDir.value.copy(dir); u.uSunColor.value.copy(sun); u.uFogColor.value.copy(fog);
      u.uHeight.value = height; u.uFalloff.value = falloff; u.uDensity.value = density; u.uStrength.value = strength;
    };
  }

  override setDepthTexture(depthTexture: Texture, depthPacking: DepthPackingStrategies = BasicDepthPacking): void {
    if (!this.marchMat) return;
    this.depthU.value = depthTexture;
    const packing = String(depthPacking);
    if (this.depthPacking !== packing) { this.depthPacking = packing; this.marchMat.defines['DEPTH_PACKING'] = packing; this.marchMat.needsUpdate = true; }
  }

  override setSize(width: number, height: number): void {
    this.size.width = width; this.size.height = height;
    if (this.parked) return;
    this.renderTarget?.setSize(Math.max(1, Math.round(width * this.scale)), Math.max(1, Math.round(height * this.scale)));
  }

  /**
   * Park the separate march (true): it stops running and its target shrinks to 1×1, freeing its memory (three reallocates a
   * target whose size changes); false sizes it to the last `setSize` again. Nothing recompiles either way.
   */
  setParked(parked: boolean): void {
    if (this.renderTarget === null || this.parked === parked) return;
    this.parked = parked;
    if (parked) this.renderTarget.setSize(1, 1);
    else this.setSize(this.size.width, this.size.height);
  }
  /** the separate march's target size (null: the march runs in place) */
  targetSize(): readonly [number, number] | null { return this.renderTarget === null ? null : [this.renderTarget.width, this.renderTarget.height]; }
  /** Compile the separate march's program now (a page that adds this effect late warms it at install, not at first use). */
  warm(renderer: Renderer): void {
    if (this.marchScene === null || this.renderTarget === null) return;
    // Output colour space / tone mapping participate in the key even for a raw ShaderMaterial.
    // Compile in the march's real target, as update() draws it, rather than the current canvas.
    const previous = renderer.getRenderTarget();
    try { renderer.setRenderTarget(this.renderTarget); renderer.compile(this.marchScene, this.marchCam); }
    finally { renderer.setRenderTarget(previous); }
  }

  override update(renderer: Renderer, inputBuffer?: WebGLRenderTarget): void {
    // an effect added to a pass after its last resize (a page's late install) takes its size from the frame it composites
    if (inputBuffer !== undefined && (inputBuffer.width !== this.size.width || inputBuffer.height !== this.size.height)) this.setSize(inputBuffer.width, inputBuffer.height);
    const cam = this.camera, u = this.marchUniforms;
    u.uInvView.value.copy(cam.matrixWorld);
    u.uInvProj.value.copy(cam.projectionMatrixInverse);
    this.viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    u.uViewProj.value.copy(this.viewProj);
    u.uCamPos.value.copy(cam.position);
    u.uHeight.value = volumetricFog.height ?? fogUniforms.fogHeight.value;
    u.uFalloff.value = volumetricFog.falloff ?? fogUniforms.fogHeightFalloff.value;
    u.uDensity.value = DENSITY;
    u.uFrame.value = (this.frame++ % 64);
    if (this.renderTarget && this.marchMat && this.marchScene && !this.parked) {
      this.nearU.value = cam.near; this.farU.value = cam.far;
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(this.renderTarget);
      renderer.render(this.marchScene, this.marchCam);
      renderer.setRenderTarget(prev);
    }
  }
}

/** 64×64 interleaved-gradient noise: cheap, tileable, good enough to hide 14-step banding. */
export function makeNoiseTexture(): Texture {
  const N = 64, data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = (52.9829189 * ((0.06711056 * x + 0.00583715 * y) % 1)) % 1;
    const i = (y * N + x) * 4; data[i] = data[i + 1] = data[i + 2] = v * 255; data[i + 3] = 255;
  }
  const t = new DataTexture(data, N, N);
  t.wrapS = t.wrapT = RepeatWrapping; t.magFilter = t.minFilter = NearestFilter; t.needsUpdate = true;
  return t;
}
