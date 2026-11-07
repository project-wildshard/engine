import * as THREE from 'three';
import { setProgramKey } from '../render/shaderPatches';

export const FX = { shaft: 0, flame: 1, ring: 2, stream: 3, dome: 4, beam: 5, decal: 6, curtain: 7, streak: 8 } as const;
export type FxMode = (typeof FX)[keyof typeof FX];

const FX_VERT = /* glsl */`
varying vec2 vUv; varying vec3 vPos; varying vec3 vN; varying vec3 vV;
void main() {
  vUv = uv; vPos = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const FX_FRAG = /* glsl */`
uniform float uMode; uniform vec3 uColor; uniform float uAlpha; uniform float uTime; uniform vec4 uP;
varying vec2 vUv; varying vec3 vPos; varying vec3 vN; varying vec3 vV;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n21(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
void main() {
  float a = 0.0; vec3 col = uColor;
  float fres = min(abs(dot(normalize(vN), normalize(vV))), 1.0); // ≤ 1: pow(1 − fres) below must never see a negative (NaN → bloom's black square, E91)
  if (uMode < 0.5) {                      // shaft: a soft cone of daylight; motes drift in it
    float edge = pow(fres, 1.6);
    float fall = smoothstep(0.0, 0.25, vUv.y) * (0.55 + 0.45 * vUv.y);
    float motes = step(0.985, h21(floor(vec2(vUv.x * 90.0, vUv.y * 60.0 + uTime * 0.6)))) * 1.5;
    a = edge * fall * (0.8 + 0.2 * n21(vec2(vUv.x * 8.0, vUv.y * 3.0 - uTime * 0.15))) + motes * edge * fall;
  } else if (uMode < 1.5) {               // flame: a flickering tongue on a crossed card (uv.y up)
    float x = (vUv.x - 0.5) * 2.0, y = vUv.y;
    float fl = n21(vec2(x * 3.0 + vPos.x * 7.0, y * 4.0 - uTime * 6.0 + vPos.z * 5.0));
    float w = (1.0 - y) * (0.75 + 0.25 * fl);
    a = smoothstep(w, w * 0.4, abs(x)) * smoothstep(1.0, 0.55, y + fl * 0.25) * smoothstep(0.0, 0.08, y);
    col = mix(uColor, vec3(1.6, 1.3, 0.8), smoothstep(0.5, 0.0, y) * smoothstep(0.6, 0.0, abs(x)));
  } else if (uMode < 2.5) {               // ring: a gold band (uv.y 0 inner → 1 outer), sparkling, uP.x = sharpness
    float band = 1.0 - abs(vUv.y - 0.5) * 2.0;
    float spark = 0.6 + 0.4 * n21(vec2(vUv.x * 160.0, uTime * 5.0));
    a = pow(max(band, 0.0), uP.x) * spark;
  } else if (uMode < 3.5) {               // stream: falling sand (uv.y 0 bottom → 1 top), streaks scroll down
    float s = n21(vec2(vUv.x * 18.0, vUv.y * 5.0 + uTime * 5.5)) * 0.6 + n21(vec2(vUv.x * 43.0, vUv.y * 11.0 + uTime * 9.0)) * 0.4;
    a = smoothstep(0.25, 0.75, s) * (0.35 + 0.65 * pow(fres, 0.8)) * smoothstep(0.0, 0.06, vUv.y);
    col = uColor * (0.75 + 0.5 * s);
  } else if (uMode < 4.5) {               // dome: a gold shield — bright rim, a slow hex shimmer, breathing
    float rim = pow(1.0 - fres, 2.5);
    vec2 g = vec2(vUv.x * 24.0, vUv.y * 12.0); g.x += mod(floor(g.y), 2.0) * 0.5;
    float cell = smoothstep(0.42, 0.5, max(abs(fract(g.x) - 0.5), abs(fract(g.y) - 0.5)));
    float wave = 0.5 + 0.5 * sin(uTime * 2.0 - vUv.y * 9.0);
    a = rim * 0.9 + cell * 0.18 * wave + 0.05;
  } else if (uMode < 5.5) {               // beam: a burning column (uv.y along), a hot core
    float core = pow(fres, 2.0);
    float flick = 0.8 + 0.2 * n21(vec2(vUv.x * 12.0, vUv.y * 6.0 - uTime * 4.0));
    a = core * flick;
    col = mix(uColor, vec3(1.8, 1.6, 1.2), core * 0.6);
  } else if (uMode < 6.5) {               // decal: a soft disc / arc / line on the floor (uv 0..1, uP.x inner radius, uP.y pulse)
    vec2 d = vUv - 0.5; float r = length(d) * 2.0;
    float disc = smoothstep(1.0, 0.8, r) * smoothstep(uP.x - 0.08, uP.x + 0.02, r);
    float pulse = 1.0 - uP.y + uP.y * (0.5 + 0.5 * sin(uTime * 9.0));
    float grain = 0.75 + 0.25 * n21(vUv * 40.0 + uTime);
    a = disc * pulse * grain;
  } else if (uMode < 7.5) {               // curtain: a sheet of pouring sand over a doorway (uv.y 0 bottom)
    float s = n21(vec2(vUv.x * 26.0, vUv.y * 4.0 + uTime * 4.5)) * 0.65 + n21(vec2(vUv.x * 61.0, vUv.y * 9.0 + uTime * 7.0)) * 0.35;
    a = smoothstep(0.2, 0.6, s) * smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.9, vUv.x);
    col = uColor * (0.7 + 0.5 * s);
  } else {                                // streak: a fading gold trail (uv.x along 0 old → 1 new)
    a = smoothstep(0.0, 1.0, vUv.x) * (1.0 - abs(vUv.y - 0.5) * 2.0);
  }
  gl_FragColor = vec4(col, clamp(a * uAlpha, 0.0, 1.0));
}`;

export interface FxMaterial extends THREE.ShaderMaterial {
  uniforms: { uMode: { value: number }; uColor: { value: THREE.Color }; uAlpha: { value: number }; uTime: { value: number }; uP: { value: THREE.Vector4 } };
}
/** the ONE fx program (see the header): `mode` picks the look, `additive` the blending */
export function fxMaterial(mode: FxMode, color: THREE.ColorRepresentation, alpha = 1, additive = true): FxMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: { uMode: { value: mode }, uColor: { value: new THREE.Color(color) }, uAlpha: { value: alpha }, uTime: { value: 0 }, uP: { value: new THREE.Vector4(2, 0, 0, 0) } },
    vertexShader: FX_VERT, fragmentShader: FX_FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  }) as FxMaterial;
  // one program for every ground fx material (the parity probe keys programs by their compiled sources, not this key)
  setProgramKey(m, 'ground-fx');
  return m;
}

/** a flat annulus on the floor (y up), uv.x = around (0..1), uv.y = across the band (0 inner → 1 outer) — the ring fx reads it */
export function annulus(inner: number, outer: number, seg: number, arc: number = Math.PI * 2): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], nrm: number[] = [], idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * arc, c = Math.cos(a), s = Math.sin(a);
    pos.push(c * inner, 0, -s * inner, c * outer, 0, -s * outer);
    uv.push(i / seg, 0, i / seg, 1);
    nrm.push(0, 1, 0, 0, 1, 0);
    if (i < seg) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** most spheres one puff pool holds */
const MAX_PUFFS = 16;
/**
 * A bounded pool of expanding shimmer spheres on the dome mode (additive), made once, parked invisible and driven by
 * uniforms (a mid-fight compile is a multi-second hitch on iOS). `burst` swells the next sphere from `r0` to `r1` over
 * `life` seconds at peak alpha `a`, fading in fast and out on an ease; the oldest is reused when all are in flight.
 */
export class DomePuffs {
  private readonly items: { mesh: THREE.Mesh; mat: FxMaterial; t: number; life: number; r0: number; r1: number; a: number }[] = [];
  private next = 0;
  /** `parent`: what the parked spheres hang under (the world's root) */
  constructor(parent: THREE.Object3D, color: THREE.ColorRepresentation, count = 4, segments: readonly [number, number] = [20, 12], order = 28) {
    if (!Number.isInteger(count) || count < 1 || count > MAX_PUFFS) throw new Error(`[fx] a puff pool of ${String(count)} is outside 1..${String(MAX_PUFFS)}`);
    const geometry = new THREE.SphereGeometry(1, segments[0], segments[1]);
    for (let i = 0; i < count; i++) {
      const mat = fxMaterial(FX.dome, color, 0), mesh = new THREE.Mesh(geometry, mat);
      mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = order; parent.add(mesh);
      this.items.push({ mesh, mat, t: 0, life: 0, r0: 0.5, r1: 3, a: 1 });
    }
  }
  /** a puff at `at`, radius r0 → r1 over `life` s, peak alpha `a` */
  burst(at: THREE.Vector3, r0: number, r1: number, life = 0.7, a = 0.9): void {
    const it = this.items[this.next]; if (it === undefined) return;
    this.next = (this.next + 1) % this.items.length;
    it.mesh.position.copy(at); it.t = 0; it.life = life; it.r0 = r0; it.r1 = r1; it.a = a;
    it.mesh.scale.setScalar(r0); it.mesh.visible = true;
  }
  update(dt: number, t: number): void {
    for (const it of this.items) {
      if (!it.mesh.visible) continue;
      it.t += dt; const k = Math.min(1, it.t / Math.max(0.001, it.life));
      it.mesh.scale.setScalar(it.r0 + (it.r1 - it.r0) * (1 - (1 - k) * (1 - k)));
      it.mat.uniforms.uAlpha.value = it.a * (1 - k) * Math.min(1, it.t * 12);
      it.mat.uniforms.uTime.value = t;
      if (k >= 1) it.mesh.visible = false;
    }
  }
  dispose(): void {
    this.items[0]?.mesh.geometry.dispose(); for (const it of this.items) { it.mesh.removeFromParent(); it.mat.dispose(); } this.items.length = 0;
  }
}
