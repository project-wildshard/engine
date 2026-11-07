import { app } from '../app/runtime';
import { engineString } from '../../../shared/engine/strings';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Interactable } from '../../../shared/engine/world/interact/types';
import { isMesh } from '../combat/view/ranged';
import { TIER_CONFIG } from '../core/tier';
import { LightPool } from '../fx/LightPool';
import { itemPickupFloor, ITEM_PICKUP_HOVER as HOVER } from '../../../shared/engine/world/interact/pickup';
import { Drop } from '../../../shared/engine/physics/bodies';
import type { Renderer } from '../render/renderer';

/**
 * ItemPickup (exported as WeaponPickup too) — an item lying in the world for the player to find, presented like
 * art/pickups/round-1/pickup-A-bubble.png and then some: the item floats HOVER m over the floor point (bobbing ±BOB on a BOB_PERIOD sine,
 * yawing YAW_RATE), inside a translucent sphere (SPHERE_R × 2 = 1.3 m Ø) with a bright Fresnel rim and an inner haze that
 * BREATHE (±25 % on a PULSE_PERIOD cycle, out of phase with the bob); two thin rings orbit the sphere on tilted axes,
 * counter-rotating; a sigil (crisp ring + faint outer ring with 24 ticks) turns slowly on the floor under a soft light
 * pool; MOTES motes spiral upward around the sphere on helices with short fading trails, one in eight a bright spark
 * that flashes; a PointLight lights the item and the room and the item itself carries a faint tier-coloured emissive.
 *
 * Approach: within NEAR_DIST the pulse runs ×NEAR_PULSE and the rings tilt toward the player; within the prompt radius
 * the rim goes ×1.5 and `onNear(true)` fires (main.ts → `audio.pickupHum(true)`), `onNear(false)` on leaving.
 * Pickup (E / USE → `take()`): the sphere collapses inward over COLLAPSE_TIME, then a shockwave ring (r 0.2 → 2.5 m over
 * SHOCK_TIME), BURST_MOTES motes flung outward under gravity and a ×3 light flash; then everything is removed (the
 * PointLight is a `LightPool` light: released dark, never removed — B7).
 *
 *   const drop = new WeaponPickup({ scene, item: rifle.displayModel(), position: floorPoint, tier: 'common', prompt: 'Take AR-15' });
 *   interactables.push(drop.interactable);   // the door / harvest prompt path shows "[E] Take AR-15" within `radius`
 *   drop.onPickup = () => { weapons.unlock('rifle'); … };  drop.onNear = (on) => audio.pickupHum(on);
 *   game.onUpdate((dt, t) => drop.update(dt, t, game.renderer, game.camera));
 *
 * `tier` sets the colour — the user's rule: BLUE (#8fe3ff) orb = items, PURPLE (#c38fff) orb = rare skins — the same
 * effect otherwise, so the rare-skins pickups reuse this class. Everything is tone-mapped by the post chain (AgX in the
 * composer, so a material's `toneMapped` flag does nothing): the orb uses a deeper cyan than the HUD's #8fe3ff so it
 * survives the mapping. Cheap on purpose: every sprite (motes + trails + burst) lives in ONE Points, the rings share one
 * material, the sigil is one merged geometry, and the update loop allocates nothing.
 */

type PickupTier = 'common' | 'rare' | 'legendary';
/** legendary = the GOLD orb of a boss reward (src/client/game/Boss.ts) */
const TIER_COLOUR: Record<PickupTier, number> = { common: 0x8fe3ff, rare: 0xc38fff, legendary: 0xffcf5a };
/** the orb's own colour: the tier colour pushed toward saturation — the post chain's AgX tone map washes a bright
 *  #8fe3ff to white, a deeper cyan / violet at the same energy stays cyan / violet */
const ORB_COLOUR: Record<PickupTier, number> = { common: 0x35d4ff, rare: 0xa862ff, legendary: 0xffa018 };

interface ItemPickupOptions {
  scene: THREE.Scene;
  /** the world-space model (origin near its centre; the AR-15's `displayModel()`) */
  item: THREE.Object3D;
  /** the floor point under the orb */
  position: THREE.Vector3;
  tier?: PickupTier;
  /** the interact prompt after "[E]" ("Take AR-15") */
  prompt?: string;
  /** interact radius (m, measured from the eye to a point a little above the item) */
  radius?: number;
  /** item tilt (rad, muzzle / tip up) and scale */
  tilt?: number; scale?: number;
  /** a drop (PHYSICS P7-L2: a legendary's loot): it pops out TOSS_UP m over `position` with this velocity (m/s), falls,
   *  bounces and settles as a short-lived body on whatever is under it, then sits there like any other pickup */
  toss?: { x: number; y: number; z: number };
  /** false: the item keeps its own look (no tier-coloured emissive) — an item on a material the world shares (the island's
   *  low-poly one: a trophy drop, E314) must not tint everything drawn with it. Default true */
  glow?: boolean;
  /** the source of the pickup's cosmetic draws (its bob phase, its motes, the burst), uniform in [0, 1). Default
   *  `Math.random`. A shard whose frames must not move with how many three.js objects were made before the pickup (each
   *  object's uuid draws four `Math.random` values, so one more model loaded at boot shifts every later draw) passes its
   *  own seeded generator. */
  random?: () => number;
}

const SPHERE_R = 0.65;
/** a tossed drop starts this far over its `position` (out of the carcass, not under the ground) */
const TOSS_UP = 1.0;
const BOB = 0.06, BOB_PERIOD = 2.2, YAW_RATE = THREE.MathUtils.degToRad(25);
const PULSE_PERIOD = 1.6, PULSE_DEPTH = 0.25, PULSE_PHASE = 0.9; // breathing, out of phase with the bob
const RIM = 3.0, HAZE = 0.18, LIGHT = 8, LIGHT_DIST = 4, ITEM_EMISSIVE = 0.15;
const MODEL_SCALE = 1.15, TILT = THREE.MathUtils.degToRad(20);
const RING_R = SPHERE_R + 0.03, RING_TUBE = 0.004, RING_TILT = [THREE.MathUtils.degToRad(23), THREE.MathUtils.degToRad(-41)], RING_RATE = [THREE.MathUtils.degToRad(40), THREE.MathUtils.degToRad(-65)];
const SIGIL_R = 0.55, SIGIL_OUTER_R = 0.8, SIGIL_TICKS = 24, SIGIL_RATE = THREE.MathUtils.degToRad(8), POOL_R = 0.9;
const MOTES = 60, TRAIL = 3, TRAIL_DT = 0.055, SPARK_EVERY = 8, BURST_MOTES = 80;
const NEAR_DIST = 3.5, NEAR_PULSE = 1.8, NEAR_TILT = 0.55;
const COLLAPSE_TIME = 0.12, SHOCK_TIME = 0.35, SHOCK_R0 = 0.2, SHOCK_R1 = 2.5, FLASH_TIME = 0.15, BURST_LIFE = 1.1;
const RENDER_ORDER = 20; // after the world's transparents (mist, halos), before the viewmodel's depth clear (999)
const SPRITES = MOTES * (1 + TRAIL) + BURST_MOTES;

const SPHERE_VERT = /* glsl */`
  varying vec3 vN; varying vec3 vV; varying float vY;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vY = position.y;
    gl_Position = projectionMatrix * mv;
  }`;
const SPHERE_FRAG = /* glsl */`
  uniform vec3 uColor; uniform float uTime; uniform float uAlpha; uniform float uRim; uniform float uHaze;
  varying vec3 vN; varying vec3 vV; varying float vY;
  void main() {
    float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    float rim = pow(f, 3.5) * uRim;                                   // bright edge, a little wider than a hairline
    float fill = uHaze * (0.85 + 0.15 * sin(uTime * 1.7 + vY * 6.0)); // inner haze, breathing
    float band = smoothstep(0.02, 0.0, abs(fract(vY * 1.3 - uTime * 0.12) - 0.5) - 0.48) * 0.08; // a faint scanline drifting up
    gl_FragColor = vec4(uColor * (rim + fill + band), uAlpha);
  }`;
const MOTE_VERT = /* glsl */`
  attribute float aSize; attribute float aAlpha; attribute vec3 aColor; varying float vA; varying vec3 vC; uniform float uScale;
  void main() { vA = aAlpha; vC = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uScale / max(0.05, -mv.z); gl_Position = projectionMatrix * mv; }`;
const MOTE_FRAG = /* glsl */`
  varying float vA; varying vec3 vC;
  void main() { vec2 d = gl_PointCoord - 0.5; float r = dot(d, d) * 4.0; if (r > 1.0 || vA <= 0.001) discard; float a = (1.0 - r) * (1.0 - r) * vA; gl_FragColor = vec4(vC * (1.0 + a * 1.5), a); }`;

/** radial light pool: bright centre fading to nothing at the edge */
function makePoolTexture(): THREE.CanvasTexture {
  const S = 128, cvs = document.createElement('canvas'); cvs.width = cvs.height = S;
  const ctx = cvs.getContext('2d');
  if (ctx === null) throw new Error('makePoolTexture: no 2d canvas context');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.7)'); g.addColorStop(0.35, 'rgba(255,255,255,0.28)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cvs); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let poolTex: THREE.CanvasTexture | null = null;

/** the floor sigil: a crisp ring, a faint outer ring and 24 tick marks, one geometry in the XZ plane (y up) */
function makeSigil(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const inner = new THREE.RingGeometry(SIGIL_R - 0.012, SIGIL_R + 0.012, 64); parts.push(inner);
  const outer = new THREE.RingGeometry(SIGIL_OUTER_R - 0.004, SIGIL_OUTER_R + 0.004, 96); parts.push(outer);
  for (let i = 0; i < SIGIL_TICKS; i++) {
    const a = (i / SIGIL_TICKS) * Math.PI * 2, long = i % 6 === 0;
    const tick = new THREE.PlaneGeometry(0.012, long ? 0.09 : 0.05);
    tick.translate(0, SIGIL_OUTER_R - (long ? 0.065 : 0.045), 0); tick.rotateZ(a);
    parts.push(tick);
  }
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false);
  g.rotateX(-Math.PI / 2);
  return g;
}

const _size = new THREE.Vector2(), _eye = new THREE.Vector3(), _to = new THREE.Vector3(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);
const _q2 = new THREE.Quaternion(), _qIdentity = new THREE.Quaternion(), _xAxis = new THREE.Vector3(1, 0, 0);

/** an item lying in the world in a glowing orb, taken with USE (also exported as WeaponPickup) */
export class ItemPickup {
  readonly group: THREE.Group = new THREE.Group();
  /** Public prompt view; a subclass may wrap it while the orb keeps its original proximity/take state. */
  readonly interactable: Interactable;
  private readonly pickupInteraction: Interactable;
  readonly tier: PickupTier;
  onPickup?: (() => void) | undefined;
  /** the player stepped inside (true) / out of (false) the prompt radius — main.ts plays the hum */
  onNear?: ((inside: boolean) => void) | undefined;
  taken = false;
  private scene: THREE.Scene;
  private holder = new THREE.Group();
  private sphere: THREE.Mesh; private sphereMat: THREE.ShaderMaterial;
  private rings = new THREE.Group(); private ringPivots: THREE.Object3D[] = []; private ringGeo: THREE.TorusGeometry; private ringMat: THREE.MeshBasicMaterial;
  private sigil: THREE.Mesh; private sigilMat: THREE.MeshBasicMaterial;
  private pool: THREE.Mesh; private poolMat: THREE.MeshBasicMaterial;
  private shock: THREE.Mesh; private shockMat: THREE.MeshBasicMaterial;
  private light: THREE.PointLight;
  // sprites: motes [0, MOTES), their trails [MOTES, MOTES * (1 + TRAIL)), burst motes after that — one Points
  private points: THREE.Points; private moteMat: THREE.ShaderMaterial;
  private pos = new Float32Array(SPRITES * 3); private size = new Float32Array(SPRITES); private alpha = new Float32Array(SPRITES); private col = new Float32Array(SPRITES * 3);
  private posAttr: THREE.BufferAttribute; private sizeAttr: THREE.BufferAttribute; private alphaAttr: THREE.BufferAttribute;
  private mAngle = new Float32Array(MOTES); private mRadius = new Float32Array(MOTES); private mY = new Float32Array(MOTES); private mRise = new Float32Array(MOTES); private mSpin = new Float32Array(MOTES); private mSpark = new Uint8Array(MOTES); private mSize = new Float32Array(MOTES);
  private hist = new Float32Array(MOTES * TRAIL * 3); private histTimer = 0;
  private bVel = new Float32Array(BURST_MOTES * 3); private bLife = new Float32Array(BURST_MOTES);
  private pulse = 0; private bob = Math.random() * Math.PI * 2;
  private near = false; private approach = 0;
  private burstT = -1;
  private disposed = false;
  /** in flight (a tossed drop, PHYSICS P7-L2) until it lands; null once it lies still */
  private drop: Drop | null = null;
  private glowing = new Map<THREE.MeshStandardMaterial, { colour: THREE.Color; intensity: number }>();
  private orb: THREE.Color; private sparkCol = new THREE.Color();
  private uTime: THREE.IUniform<number> = { value: 0 }; private uRim: THREE.IUniform<number> = { value: RIM }; private uHaze: THREE.IUniform<number> = { value: HAZE }; private uScale: THREE.IUniform<number> = { value: 400 };

  private readonly random: () => number;

  constructor(opts: ItemPickupOptions) {
    this.random = opts.random ?? ((): number => Math.random());
    if (opts.random !== undefined) this.bob = opts.random() * Math.PI * 2;
    this.scene = opts.scene;
    this.tier = opts.tier ?? 'common';
    const colour = this.orb = new THREE.Color(ORB_COLOUR[this.tier]);
    this.sparkCol.copy(colour).lerp(new THREE.Color(1, 1, 1), 0.7);
    let at: THREE.Vector3;
    if (opts.toss) {
      const p = opts.position, d = new Drop(app.bodies, this, { x: p.x, y: p.y + TOSS_UP, z: p.z }, opts.toss, app.physics);
      at = new THREE.Vector3(d.floor.x, d.floor.y, d.floor.z);
      if (!d.landed) this.drop = d;
    } else at = settle(opts.position);
    this.group.position.copy(at);
    // the item: tilted (muzzle / tip up), a little over life size, spun by the holder
    const item = opts.item;
    item.rotation.x = opts.tilt ?? TILT; item.rotation.z = 0.12;
    item.scale.setScalar(opts.scale ?? MODEL_SCALE);
    this.holder.add(item);
    this.holder.position.y = HOVER;
    // the sphere: Fresnel rim + haze, additive, no depth write so the item inside and the wall behind show through
    this.sphereMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: colour }, uTime: this.uTime, uAlpha: { value: 1 }, uRim: this.uRim, uHaze: this.uHaze },
      vertexShader: SPHERE_VERT, fragmentShader: SPHERE_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide, toneMapped: false,
    });
    this.sphere = new THREE.Mesh(new THREE.SphereGeometry(SPHERE_R, 48, 32), this.sphereMat);
    this.sphere.position.y = HOVER; this.sphere.renderOrder = RENDER_ORDER + 1;
    // two orbit rings on tilted pivots, counter-rotating; the pivots' parent leans toward the player when close
    this.ringMat = new THREE.MeshBasicMaterial({ color: colour.clone().multiplyScalar(1.7), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
    const ringGeo = this.ringGeo = new THREE.TorusGeometry(RING_R, RING_TUBE, 6, 96); ringGeo.rotateX(Math.PI / 2); // a ring in the XZ plane
    for (let i = 0; i < 2; i++) {
      const pivot = new THREE.Object3D(); pivot.rotation.z = RING_TILT[i] ?? 0;
      const ring = new THREE.Mesh(ringGeo, this.ringMat); ring.renderOrder = RENDER_ORDER + 3;
      pivot.add(ring); this.rings.add(pivot); this.ringPivots.push(pivot);
    }
    this.rings.position.y = HOVER;
    // sprites: motes + trails + burst, one Points
    for (let i = 0; i < MOTES; i++) this.spawnMote(i, true);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', (this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage)));
    g.setAttribute('aSize', (this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage)));
    g.setAttribute('aAlpha', (this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage)));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, HOVER, 0), SHOCK_R1 + 1);
    this.moteMat = new THREE.ShaderMaterial({ uniforms: { uScale: this.uScale }, vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.points = new THREE.Points(g, this.moteMat);
    this.points.renderOrder = RENDER_ORDER + 2; this.points.frustumCulled = false;
    for (let i = 0; i < SPRITES; i++) { const c = i < MOTES && this.mSpark[i] === 1 ? this.sparkCol : colour; this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b; }
    // floor: sigil (crisp ring + outer ring + ticks) turning slowly over a soft light pool; a short-range point light
    this.sigilMat = new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false });
    this.sigil = new THREE.Mesh(makeSigil(), this.sigilMat);
    this.sigil.position.y = 0.014; this.sigil.renderOrder = RENDER_ORDER + 1;
    poolTex ??= makePoolTexture();
    this.poolMat = new THREE.MeshBasicMaterial({ map: poolTex, color: colour, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
    this.pool = new THREE.Mesh(new THREE.PlaneGeometry(POOL_R * 2, POOL_R * 2), this.poolMat);
    this.pool.rotation.x = -Math.PI / 2; this.pool.position.y = 0.01; this.pool.renderOrder = RENDER_ORDER;
    // the pickup shockwave: a flat ring scaled out from SHOCK_R0 to SHOCK_R1
    this.shockMat = new THREE.MeshBasicMaterial({ color: colour.clone().multiplyScalar(1.5), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false });
    this.shock = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 64), this.shockMat);
    this.shock.rotation.x = -Math.PI / 2; this.shock.position.y = HOVER; this.shock.visible = false; this.shock.renderOrder = RENDER_ORDER + 4;
    // from the scene's LightPool (B7): never added / removed mid-play, so taking the item does not recompile every lit program
    this.light = LightPool.for(this.scene).acquire(colour, LIGHT, LIGHT_DIST, 2);
    this.light.position.set(at.x, at.y + HOVER, at.z);
    // the item glows faintly with the orb's colour while it sits inside (materials are shared with the viewmodel: restored on pickup)
    if (opts.glow !== false) item.traverse((o) => {
      if (!isMesh(o)) return;
      const m = o.material;
      if (Array.isArray(m) || !(m instanceof THREE.MeshStandardMaterial) || this.glowing.has(m)) return;
      this.glowing.set(m, { colour: m.emissive.clone(), intensity: m.emissiveIntensity });
      m.emissive.set(TIER_COLOUR[this.tier]); m.emissiveIntensity = ITEM_EMISSIVE;
    });
    this.group.add(this.holder, this.sphere, this.rings, this.points, this.sigil, this.pool, this.shock);
    this.scene.add(this.group);
    // the prompt loop measures from the CAMERA (eye height): the interact point sits a little above the item so the
    // radius reads as ground distance, like the door's `FLOOR + 1.0` point
    const radius = opts.radius ?? 1.8;
    this.pickupInteraction = this.interactable = { position: new THREE.Vector3(at.x, at.y + HOVER + 0.5, at.z), radius, label: opts.prompt ?? engineString('s_81326a54c09c'), onInteract: () => this.take() };
  }

  /** the prompt text after "[E]" */
  get prompt(): string { return this.pickupInteraction.label; }
  set prompt(v: string) { this.pickupInteraction.label = v; }

  /** a mote on its helix: angle, radius 0.5–0.75 m (just outside the sphere), rising from the bottom */
  private spawnMote(i: number, anywhere: boolean): void {
    const ang = this.random() * Math.PI * 2; this.mAngle[i] = ang;
    const rad = 0.5 + this.random() * 0.25; this.mRadius[i] = rad;
    const y = HOVER + (anywhere ? (this.random() - 0.5) * 2 : -1) * SPHERE_R * 1.05; this.mY[i] = y;
    this.mRise[i] = 0.16 + this.random() * 0.14;
    this.mSpin[i] = (0.9 + this.random() * 0.8) * (i % 2 ? 1 : -1);
    const spark = i % SPARK_EVERY === 0 ? 1 : 0; this.mSpark[i] = spark;
    this.mSize[i] = (spark ? 0.05 : 0.03) + this.random() * 0.025;
    const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    for (let k = 0; k < TRAIL; k++) { const h = (i * TRAIL + k) * 3; this.hist[h] = x; this.hist[h + 1] = y; this.hist[h + 2] = z; }
  }

  /** pick it up: the item vanishes, the orb collapses then bursts, `onPickup` fires; a no-op the second time */
  take(): void {
    if (this.taken) return;
    this.taken = true;
    this.drop?.dispose(); this.drop = null;
    this.pickupInteraction.radius = 0;
    this.holder.visible = false;
    this.unglow();
    if (this.near) { this.near = false; this.onNear?.(false); }
    this.burstT = 0;
    this.onPickup?.();
  }

  /** put the item's materials back the way they were (they are the viewmodel's) */
  private unglow(): void {
    for (const [m, o] of this.glowing) { m.emissive.copy(o.colour); m.emissiveIntensity = o.intensity; }
    this.glowing.clear();
  }

  /** remove it from the scene and free its GPU resources (also used by `?weapon=rifle`, which unlocks the rifle at load) */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.taken = true; this.pickupInteraction.radius = 0;
    this.drop?.dispose(); this.drop = null;
    this.unglow();
    if (this.near) { this.near = false; this.onNear?.(false); }
    this.scene.remove(this.group); // the light is not in it: it goes back to the pool, dark (a light-count change recompiles)
    LightPool.for(this.scene).release(this.light);
    this.sphere.geometry.dispose(); this.sphereMat.dispose(); this.points.geometry.dispose(); this.moteMat.dispose();
    this.ringGeo.dispose(); this.ringMat.dispose();
    this.sigil.geometry.dispose(); this.sigilMat.dispose(); this.pool.geometry.dispose(); this.poolMat.dispose(); this.shock.geometry.dispose(); this.shockMat.dispose();
  }

  update(dt: number, t: number, renderer?: Renderer, camera?: THREE.PerspectiveCamera): void {
    if (this.disposed) return;
    if (renderer && camera) { renderer.getDrawingBufferSize(_size); this.uScale.value = _size.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)); }
    this.uTime.value = t;
    if (this.burstT >= 0) { this.stepBurst(dt); return; }
    if (this.drop) this.fly(this.drop, dt);

    // approach: the eye's distance to the orb (the prompt radius is measured the same way)
    let dist = 99;
    if (camera) { _eye.setFromMatrixPosition(camera.matrixWorld); _to.subVectors(_eye, this.pickupInteraction.position); dist = _to.length(); }
    const inside = dist <= this.pickupInteraction.radius;
    if (inside !== this.near) { this.near = inside; this.onNear?.(inside); }
    // draw distance by tier (tier.ts): the item model is ~10 draws + its shadow casters, the orb 6 more — the AR-15 sits
    // inside cabin 1 and was drawn from every corner of the chunk. The light stays (a changing light count recompiles).
    const orbOn = dist < TIER_CONFIG.pickupOrbDist;
    this.holder.visible = dist < TIER_CONFIG.pickupItemDist;
    const onFloor = orbOn && this.drop === null; // the floor sigil and light pool wait until a tossed drop has landed
    // the eye inside the bubble (E296: the iron sword's orb sits by the hold stair; a fight backs you into it) draws no shell
    // over the whole view — its centre is HOVER over the floor point, the prompt point 0.5 m higher
    const inOrb = dist < SPHERE_R + 0.8 && Math.hypot(_to.x, _to.y + 0.5, _to.z) < SPHERE_R + 0.1;
    this.sphere.visible = orbOn && !inOrb; this.rings.visible = orbOn && !inOrb; this.points.visible = orbOn; this.sigil.visible = onFloor; this.pool.visible = onFloor;
    const nearK = dist < NEAR_DIST ? 1 : 0;
    this.approach += (nearK - this.approach) * Math.min(1, dt * 3);

    // breathing + bob (out of phase); faster when the player is close
    this.pulse += (dt * Math.PI * 2 / PULSE_PERIOD) * (1 + (NEAR_PULSE - 1) * this.approach);
    this.bob += dt * Math.PI * 2 / BOB_PERIOD;
    const breath = 1 + Math.sin(this.pulse + PULSE_PHASE) * PULSE_DEPTH;
    const rimK = inside ? 1.5 : 1;
    this.uRim.value = RIM * breath * rimK;
    this.uHaze.value = HAZE * breath;
    this.holder.position.y = HOVER + Math.sin(this.bob) * BOB;
    this.holder.rotation.y += YAW_RATE * dt;
    this.poolMat.opacity = 0.45 + Math.sin(this.pulse + PULSE_PHASE) * 0.12;
    this.light.intensity = LIGHT * (1 + Math.sin(this.pulse + PULSE_PHASE) * 0.2) * rimK;
    this.sigil.rotation.y += SIGIL_RATE * dt;
    this.sigilMat.opacity = 0.75 + Math.sin(this.pulse) * 0.15;

    // rings: counter-rotate on their tilted pivots; the whole pair leans toward the player when close
    for (let i = 0; i < 2; i++) { const pivot = this.ringPivots[i]; if (pivot !== undefined) pivot.rotation.y += (RING_RATE[i] ?? 0) * dt * (1 + 0.5 * this.approach); }
    if (camera && this.approach > 0.001) {
      _to.set(_eye.x - this.group.position.x, 0, _eye.z - this.group.position.z);
      if (_to.lengthSq() > 1e-4) {
        // yaw the pair so its +Z faces the player, then lean it toward them by NEAR_TILT × approach
        _q.setFromAxisAngle(_up, Math.atan2(_to.x, _to.z)).multiply(_q2.setFromAxisAngle(_xAxis, NEAR_TILT * this.approach));
        this.rings.quaternion.slerp(_q, Math.min(1, dt * 2.5));
      }
    } else this.rings.quaternion.slerp(_qIdentity, Math.min(1, dt * 2.5));
    this.ringMat.opacity = 0.75 + Math.sin(this.pulse * 1.5) * 0.15 + 0.1 * this.approach;

    if (orbOn) this.stepMotes(dt, t);
  }

  /** a tossed drop in flight: the orb, its light and its prompt ride the body; once it lands they stay there */
  private fly(d: Drop, dt: number): void {
    d.update(dt);
    const f = d.floor;
    this.group.position.set(f.x, f.y, f.z);
    this.light.position.set(f.x, f.y + HOVER, f.z);
    this.pickupInteraction.position.set(f.x, f.y + HOVER + 0.5, f.z);
    if (d.landed) this.drop = null;
  }

  /** motes spiral up their helices; every TRAIL_DT the history shifts and the trail sprites follow; sparks flash */
  private stepMotes(dt: number, t: number): void {
    const pos = this.pos, hist = this.hist;
    this.histTimer += dt;
    const shift = this.histTimer >= TRAIL_DT; if (shift) this.histTimer = 0;
    for (let i = 0; i < MOTES; i++) {
      if (shift) { const h = i * TRAIL * 3; hist.copyWithin(h + 3, h, h + (TRAIL - 1) * 3); hist[h] = pos[i * 3] ?? 0; hist[h + 1] = pos[i * 3 + 1] ?? 0; hist[h + 2] = pos[i * 3 + 2] ?? 0; }
      this.mAngle[i] = (this.mAngle[i] ?? 0) + (this.mSpin[i] ?? 0) * dt; this.mY[i] = (this.mY[i] ?? 0) + (this.mRise[i] ?? 0) * dt;
      const y = ((this.mY[i] ?? 0) - HOVER) / SPHERE_R; // -1 … 1 across the orb's height
      if (y > 1.1) this.spawnMote(i, false);
      const ang = this.mAngle[i] ?? 0, isSpark = (this.mSpark[i] ?? 0) !== 0, msz = this.mSize[i] ?? 0;
      const r = (this.mRadius[i] ?? 0) * (0.9 + 0.1 * Math.cos(y * Math.PI)); // the helix narrows toward the poles
      pos[i * 3] = Math.cos(ang) * r; pos[i * 3 + 1] = this.mY[i] ?? 0; pos[i * 3 + 2] = Math.sin(ang) * r;
      const fade = Math.max(0, 1 - Math.abs(y) * 0.85) * Math.min(1, (y + 1.05) * 4);
      const spark = isSpark ? 0.55 + 0.45 * Math.max(0, Math.sin(t * 9 + i * 1.7)) ** 6 * 3 : 1;
      const ai = 0.9 * fade * Math.min(1.6, spark);
      this.alpha[i] = ai; this.size[i] = msz * (isSpark ? 0.7 + 0.5 * spark : 1);
      for (let k = 0; k < TRAIL; k++) { // trails: smaller, dimmer copies at the previous samples
        const s = MOTES + i * TRAIL + k, h = (i * TRAIL + k) * 3, f = 1 - (k + 1) / (TRAIL + 1);
        pos[s * 3] = hist[h] ?? 0; pos[s * 3 + 1] = hist[h + 1] ?? 0; pos[s * 3 + 2] = hist[h + 2] ?? 0;
        this.alpha[s] = ai * f * 0.55; this.size[s] = msz * (0.35 + 0.4 * f);
      }
    }
    this.posAttr.needsUpdate = true; this.alphaAttr.needsUpdate = true; this.sizeAttr.needsUpdate = true;
  }

  /** the pickup: collapse (COLLAPSE_TIME) → shockwave ring + BURST_MOTES motes flung out under gravity + light flash → dispose */
  private stepBurst(dt: number): void {
    const was = this.burstT; this.burstT += dt;
    const tb = this.burstT;
    if (tb < COLLAPSE_TIME) {
      const p = tb / COLLAPSE_TIME;
      this.sphere.scale.setScalar(1 - p * 0.85); this.uRim.value = RIM * (1 + p * 2); this.uHaze.value = HAZE * (1 + p * 3);
      this.rings.scale.setScalar(1 - p * 0.8); this.light.intensity = LIGHT * (1 + p);
      return;
    }
    if (was < COLLAPSE_TIME) { // the bang: hide the orb, launch the shockwave and the burst motes
      this.sphere.visible = false; this.rings.visible = false; this.sigil.visible = false;
      this.shock.visible = true;
      for (let i = 0; i < MOTES * (1 + TRAIL); i++) this.alpha[i] = 0;
      for (let i = 0; i < BURST_MOTES; i++) {
        const s = MOTES * (1 + TRAIL) + i, a = this.random() * Math.PI * 2, el = (this.random() - 0.35) * Math.PI, sp = 2.2 + this.random() * 3.2;
        this.pos[s * 3] = 0; this.pos[s * 3 + 1] = HOVER; this.pos[s * 3 + 2] = 0;
        this.bVel[i * 3] = Math.cos(a) * Math.cos(el) * sp; this.bVel[i * 3 + 1] = Math.sin(el) * sp + 1.5; this.bVel[i * 3 + 2] = Math.sin(a) * Math.cos(el) * sp;
        this.bLife[i] = BURST_LIFE * (0.6 + this.random() * 0.4);
        this.size[s] = 0.03 + this.random() * 0.04; this.alpha[s] = 1;
        const c = i % 5 === 0 ? this.sparkCol : this.orb; this.col[s * 3] = c.r; this.col[s * 3 + 1] = c.g; this.col[s * 3 + 2] = c.b;
      }
      (this.points.geometry.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
    }
    const ts = tb - COLLAPSE_TIME;
    const ps = Math.min(1, ts / SHOCK_TIME);
    this.shock.scale.setScalar(SHOCK_R0 + (SHOCK_R1 - SHOCK_R0) * (1 - (1 - ps) * (1 - ps)));
    this.shockMat.opacity = 0.9 * (1 - ps);
    if (ps >= 1) this.shock.visible = false;
    const pf = Math.min(1, ts / FLASH_TIME);
    this.light.intensity = LIGHT * 3 * (1 - pf) + LIGHT * Math.max(0, 1 - ts / BURST_LIFE) * 0.4;
    this.poolMat.opacity = 0.9 * Math.max(0, 1 - ts / 0.5);
    let alive = false;
    const vel = this.bVel, pos = this.pos;
    for (let i = 0; i < BURST_MOTES; i++) {
      const s = MOTES * (1 + TRAIL) + i;
      const life0 = this.bLife[i] ?? 0;
      if (life0 <= 0) { this.alpha[s] = 0; continue; }
      alive = true;
      const life = life0 - dt; this.bLife[i] = life;
      const j = i * 3, k = s * 3;
      let vx = (vel[j] ?? 0) * 0.985, vy = (vel[j + 1] ?? 0) - 9.8 * dt, vz = (vel[j + 2] ?? 0) * 0.985;
      const px = (pos[k] ?? 0) + vx * dt, pz = (pos[k + 2] ?? 0) + vz * dt; let py = (pos[k + 1] ?? 0) + vy * dt;
      if (py < 0.01) { py = 0.01; vy *= -0.3; vx *= 0.6; vz *= 0.6; }
      vel[j] = vx; vel[j + 1] = vy; vel[j + 2] = vz; pos[k] = px; pos[k + 1] = py; pos[k + 2] = pz;
      this.alpha[s] = Math.min(1, life / 0.35);
    }
    this.posAttr.needsUpdate = true; this.alphaAttr.needsUpdate = true; this.sizeAttr.needsUpdate = true;
    if (!alive && ps >= 1) this.dispose();
  }
}

/**
 * PHYSICS P7: a drop settles on what is under it — the first world surface (a deck, a cabin floor, a rock, the ground)
 * below the orb's centre, not the terrain height it was handed (a skin dropped by the pier lands on the planks). No
 * physics world (node) or nothing within reach: where it was put.
 */
function settle(p: THREE.Vector3): THREE.Vector3 {
  const at = itemPickupFloor(app.physics, p);
  return new THREE.Vector3(at.x, at.y, at.z);
}

/** the AR-15 was the first item; main.ts constructs it under this name */
export { ItemPickup as WeaponPickup };
