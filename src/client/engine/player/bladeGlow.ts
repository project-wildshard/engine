/**
 * The sea-glass halo round a held blade (E314, sea glass charm III: "the sword glows at night"). Jake's look review
 * (2026-09-30): "a soft glow + halo — the blade keeps its own colour with an aqua edge / rim and a visible halo, not a solid
 * aqua blade". The first cut drew an aqua shell over the whole blade, which read as a blade made of aqua light; now:
 *   - the halo (this file): one quad facing the eye, laid over the blade as it is SEEN (grip → tip projected onto the plane
 *     through the blade's middle, square to the view ray — the held blade mostly points into the screen, so a quad turned
 *     about the blade itself was seen edge-on), additive with a soft falloff from the blade out, drawn BEFORE the rig
 *     (after the viewmodel's depth clear): the blade and the hands paint over it, so the blade keeps its own colour and the
 *     light shows round it; it breathes (`breath`);
 *   - the edge / rim on the blade itself: the rig's own material (Driftwood's castaway arms, fpArms.ts `toonMaterial`
 *     `blade`), fed the same level through SwordArms.glow — no draw of its own.
 * Cheap on purpose (the phone tier): 2 triangles, one draw, only while the glow is on (by day the quad is hidden: no draw);
 * the vertex shader places the corners from four uniforms, the fragment is a distance to a segment and an exp. No depth
 * test (it is a light over the viewmodel), no fog.
 *
 *   const glow = new BladeGlow(sword.model);       // camera space (the eye at the origin), after the viewmodel's depth clear
 *   glow.set(grip, tip, level, t);                // each frame while level > 0 (grip / tip in the model's space)
 *   glow.hide();                                  // day
 */
import * as THREE from 'three';

/** the charm's sea glass (seaGlassChime.ts's aqua), pushed over 1 so the bloom (where the tier has one) catches it */
const AQUA = new THREE.Color(0x5fe6d8).multiplyScalar(1.5);
/** the halo's reach off the blade's axis (its falloff's 1/e² at ~1.2×), a share of the blade's length (0.52 m: ~12 cm) */
const HALO_R = 0.23;
/** the halo's peak opacity */
const HALO_A = 0.5;

/** position.xy: the quad's corner (x −1 … 1 across, y 0 … 1 from under the guard to past the tip) → the plane's metres */
const VERT = /* glsl */ `
  uniform vec3 uOrigin;
  uniform vec3 uSide;
  uniform vec3 uAxis;
  uniform float uL;
  uniform float uR;
  varying vec2 vP;
  void main() {
    vP = vec2(position.x * uR * 1.6, mix(-0.3 * uR, uL + 1.6 * uR, position.y)); // the quad reaches past the falloff: no edge
    vec3 p = uOrigin + uSide * vP.x + uAxis * vP.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;
/** vP: metres across the seen blade (0 on its axis) and along it (0 the guard … uL the tip) */
const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uL;
  uniform float uR;
  varying vec2 vP;
  void main() {
    float d = length(vec2(vP.x, vP.y - clamp(vP.y, 0.0, uL)));
    float halo = exp(-3.0 * (d / uR) * (d / uR));
    float a = halo * uAlpha * smoothstep(-0.3 * uR, 0.1 * uR, vP.y);
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor, a);
  }`;

let quad: THREE.BufferGeometry | null = null;
function quadGeometry(): THREE.BufferGeometry {
  if (quad) return quad;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  quad = g;
  return g;
}

const _m = new THREE.Vector3(), _g = new THREE.Vector3(), _t = new THREE.Vector3();

export class BladeGlow {
  private readonly halo: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly u = {
    uColor: { value: AQUA }, uAlpha: { value: 0 }, uOrigin: { value: new THREE.Vector3() }, uSide: { value: new THREE.Vector3(1, 0, 0) },
    uAxis: { value: new THREE.Vector3(0, 1, 0) }, uL: { value: 1 }, uR: { value: 0.1 },
  };
  /** this frame's breathing (0.85 … 1): the rig's own edge glow follows it */
  breath = 1;

  constructor(parent: THREE.Object3D) {
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false,
      side: THREE.DoubleSide, // its corners come from uniforms, so which way it winds depends on the blade: never culled
    });
    this.halo = new THREE.Mesh(quadGeometry(), mat);
    this.halo.name = 'blade-glow-halo';
    this.halo.frustumCulled = false; this.halo.castShadow = false; this.halo.receiveShadow = false;
    this.halo.renderOrder = 1001.5; // the viewmodel's transparent queue: after its depth clear (999) and the trail (1001), before the blade (the rigid rig's 1000 is drawn first: its blade gets the glow over it; the animated rigs' 1002+ paint over the halo)
    this.halo.visible = false;
    parent.add(this.halo);
  }

  /** place the halo on the blade (grip → tip, the parent's space, the eye at its origin) at `level` 0…1; `t` (s) makes it breathe */
  set(grip: THREE.Vector3, tip: THREE.Vector3, level: number, t: number): void {
    const len = grip.distanceTo(tip);
    _m.addVectors(grip, tip).multiplyScalar(0.5);
    const depth = _m.length();
    if (len < 1e-4 || depth < 1e-4 || level <= 0.005) { this.hide(); return; }
    _m.divideScalar(depth); // the view ray to the blade's middle
    // grip and tip seen from the eye, on the plane through the middle square to that ray
    const gd = grip.dot(_m), td = tip.dot(_m);
    if (gd < 1e-3 || td < 1e-3) { this.hide(); return; }
    _g.copy(grip).multiplyScalar(depth / gd);
    _t.copy(tip).multiplyScalar(depth / td);
    const u = this.u;
    u.uAxis.value.subVectors(_t, _g);
    const seen = u.uAxis.value.length();
    if (seen < 1e-4) u.uAxis.value.set(0, 1, 0).cross(_m).normalize(); else u.uAxis.value.divideScalar(seen);
    u.uSide.value.crossVectors(u.uAxis.value, _m).normalize();
    u.uOrigin.value.copy(_g);
    u.uL.value = seen;
    u.uR.value = HALO_R * len;
    this.breath = 0.85 + 0.15 * Math.sin(t * 2.1);
    u.uAlpha.value = HALO_A * level * this.breath;
    this.halo.visible = true;
  }

  hide(): void { this.halo.visible = false; }

  get visible(): boolean { return this.halo.visible; }
}
