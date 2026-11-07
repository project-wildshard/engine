/**
 * Hit-driven motion for a practice dummy (E285): damped springs, no clips.
 *
 * The figure stands on its post. A hit rocks the upper body away from the blow at the pelvis (a 2-axis spring, about
 * 1.2 Hz, lightly damped: it wobbles home over a second or so), the spine and chest follow through behind it, the head
 * and both arm chains hang off the chest as loose secondary springs that lag every swing of their parent and settle.
 * A headshot snaps the head back hard; a bolt punches the chest more than it rocks the post; a charged blow rocks it
 * most. Idle is a faint, slow drift of two incommensurate sines, not a metronome.
 *
 * All angles are small rotations about the dummy's own axes (model space: +X its left-to-right, +Y up, +Z its front,
 * facing the player). `DummyPose` turns them into bone rotations for whatever skeleton the figure has: the humanoid
 * one, the first five-bone export or the procedural figure (a missing joint's swing folds into its neighbour).
 * Fixed 120 Hz sub-steps, no allocation per frame. Visual only: the Rapier solids and hit volumes never move.
 */
import * as THREE from 'three';
import { DUMMY_JOINTS, type DummyJoint, type DummyJoints } from './TrainingDummy';

const JOINT_INDEX = Object.fromEntries(DUMMY_JOINTS.map((j, i) => [j, i])) as Record<DummyJoint, number>;
const STEP = 1 / 120;
const MAX_DT = 0.1;

/** One 3-axis angular spring: angle, velocity and last acceleration (children read it as their inertial drive). */
class Spring {
  x = 0; y = 0; z = 0;
  vx = 0; vy = 0; vz = 0;
  ax = 0; ay = 0; az = 0;
  private readonly k: number;
  private readonly c: number;
  private readonly limit: number;
  constructor(k: number, c: number, limit: number) {
    this.k = k;
    this.c = c;
    this.limit = limit;
  }
  /** ω rad/s natural frequency, ζ damping ratio */
  static of(omega: number, zeta: number, limit: number): Spring { return new Spring(omega * omega, 2 * zeta * omega, limit); }
  step(h: number, fx: number, fy: number, fz: number): void {
    this.ax = fx - this.k * this.x - this.c * this.vx;
    this.ay = fy - this.k * this.y - this.c * this.vy;
    this.az = fz - this.k * this.z - this.c * this.vz;
    this.vx += this.ax * h; this.vy += this.ay * h; this.vz += this.az * h;
    this.x += this.vx * h; this.y += this.vy * h; this.z += this.vz * h;
    // a soft stop: past the limit the swing loses its outward speed, so no hit can fold the figure over
    const L = this.limit;
    if (this.x > L) { this.x = L; if (this.vx > 0) this.vx *= -0.3; } else if (this.x < -L) { this.x = -L; if (this.vx < 0) this.vx *= -0.3; }
    if (this.z > L) { this.z = L; if (this.vz > 0) this.vz *= -0.3; } else if (this.z < -L) { this.z = -L; if (this.vz < 0) this.vz *= -0.3; }
    if (this.y > L) { this.y = L; if (this.vy > 0) this.vy *= -0.3; } else if (this.y < -L) { this.y = -L; if (this.vy < 0) this.vy *= -0.3; }
  }
  kick(x: number, y: number, z: number): void { this.vx += x; this.vy += y; this.vz += z; }
  get energy(): number { return Math.abs(this.x) + Math.abs(this.y) + Math.abs(this.z) + 0.1 * (Math.abs(this.vx) + Math.abs(this.vy) + Math.abs(this.vz)); }
}

/** saturate an impulse: small hits scale linearly, the largest stop growing (a charged iron blow must not fold it) */
function soft(v: number, max: number): number { return max * Math.tanh(v / max); }

export interface DummyHit {
  /** hit point relative to the dummy's feet, metres, model axes */
  px: number; py: number; pz: number;
  /** horizontal push direction (unit, model axes) */
  dx: number; dz: number;
  /** 0.3 … 3: the blow's weight after the dummy's own mass (straw is light, steel heavy) */
  weight: number;
  headshot: boolean;
}

export class DummyMotion {
  /** the post / pelvis: the whole upper figure rocks on it */
  readonly rock: Spring = Spring.of(7.4, 0.26, 0.5);
  /** spine and chest follow-through, relative to their parent */
  readonly spine: Spring = Spring.of(12, 0.34, 0.3);
  readonly chest: Spring = Spring.of(15, 0.34, 0.25);
  /** the head on the neck: stiff, but a headshot snaps it */
  readonly head: Spring = Spring.of(14, 0.27, 0.7);
  /** each arm: a loose pendulum at the shoulder, a stiffer elbow and a light hand */
  readonly armL: Spring = Spring.of(6.2, 0.15, 0.7);
  readonly armR: Spring = Spring.of(6.2, 0.15, 0.7);
  readonly foreL: Spring = Spring.of(9, 0.14, 0.6);
  readonly foreR: Spring = Spring.of(9, 0.14, 0.6);
  readonly handL: Spring = Spring.of(13, 0.2, 0.45);
  readonly handR: Spring = Spring.of(13, 0.2, 0.45);
  /** which side of the figure (model X sign) the Left* bones hang on: rigs differ (Blender's LeftArm sat at −X) */
  leftSign = -1;
  private acc = 0;
  private time: number;
  private readonly phase1: number;
  private readonly phase2: number;

  constructor(seed: number) {
    this.phase1 = seed * 2.39996; this.phase2 = seed * 4.1234 + 1.1;
    this.time = seed * 7.3;
  }

  /** A hit's impulses. Called at the moment of the hit; the springs take it from there. */
  hit(h: DummyHit): void {
    const w = h.weight;
    // the lever: a blow high on the chest rocks the post more than one at the hips
    const lever = 0.55 + 0.55 * Math.min(1.2, Math.max(0, (h.py - 0.85) / 0.75));
    // rotate the figure's top toward the push: axis = up × push = (dz, 0, -dx)
    const ax = h.dz, az = -h.dx;
    // twist from an off-centre blow: τy = (p × d).y
    const twist = h.pz * h.dx - h.px * h.dz;
    // every hit is a punch into the body (a bolt is only this); a melee blow's knock-back follows through shove()
    // a headshot spends the blow on the neck: the body rocks half as much
    const rockI = soft(0.85 * w * lever, 2.8) * (h.headshot ? 0.5 : 1), chestI = soft(2.4 * w, 4) * (h.headshot ? 0.6 : 1);
    const twistI = soft(twist * 4.5 * w, 3);
    this.rock.kick(ax * rockI, twistI * 0.25, az * rockI);
    this.spine.kick(ax * chestI * 0.6, twistI * 0.5, az * chestI * 0.6);
    this.chest.kick(ax * chestI * 0.4, twistI * 0.35, az * chestI * 0.4);
    if (h.headshot) {
      const headI = soft(7 * w, 10.5);
      this.head.kick(ax * headI, twistI * 0.6, az * headI);
    } else {
      this.head.kick(ax * chestI * 0.25, 0, az * chestI * 0.25);
    }
    // the arm on the struck side swings hardest; the other gets a smaller direct kick (the chest's lag drives both)
    const side = Math.abs(h.px) > 0.12 ? Math.sign(h.px) : Math.sign(-h.dx) || 1;
    const armI = soft(1.2 * w, 3) * (h.headshot ? 0.5 : 1);
    const near = side === this.leftSign ? this.armL : this.armR, far = near === this.armL ? this.armR : this.armL;
    // a hanging arm swings the other way round from an upright part for the same push, hence the minus
    near.kick(-ax * armI, 0, -az * armI + side * armI * 0.35);
    far.kick(-ax * armI * 0.3, 0, -az * armI * 0.3);
  }

  /**
   * A melee blow's knock-back, on top of its hit: the whole figure rocks away along the push, more the harder the move
   * staggers (Sword/Sabre: light 0, the combo's third 0.25, charged 1) and the lighter the figure.
   */
  shove(py: number, dx: number, dz: number, strength: number, mass: number): void {
    const lever = 0.55 + 0.55 * Math.min(1.2, Math.max(0, (py - 0.85) / 0.75));
    const I = soft((0.65 + 2.1 * strength) * lever / mass, 4);
    this.rock.kick(dz * I, 0, -dx * I);
    const arms = soft(0.9 * (0.3 + strength) / mass, 2.4);
    this.armL.kick(-dz * arms, 0, dx * arms); this.armR.kick(-dz * arms, 0, dx * arms);
  }

  /** true while anything is visibly moving (the pose applier can skip idle frames it has already written) */
  get settled(): boolean {
    return this.rock.energy + this.spine.energy + this.chest.energy + this.head.energy + this.armL.energy + this.armR.energy < 0.004;
  }

  update(dt: number): void {
    this.acc += Math.min(MAX_DT, Math.max(0, dt));
    while (this.acc >= STEP) { this.acc -= STEP; this.sub(STEP); }
  }

  private sub(h: number): void {
    this.time += h;
    const t = this.time;
    // idle: a faint, slow drift — two incommensurate periods, well under a degree
    const kRock = 7.4 * 7.4; // the rock spring's stiffness: the drift force is a fraction of a degree of it
    const drift = 0.0045 * kRock;
    const fx = drift * (Math.sin(t * 0.37 + this.phase1) + 0.6 * Math.sin(t * 0.61 + this.phase2));
    const fz = drift * 0.8 * (Math.sin(t * 0.29 + this.phase2) + 0.5 * Math.sin(t * 0.83 + this.phase1));
    const r = this.rock, s = this.spine, c = this.chest;
    r.step(h, fx, 0, fz);
    // each child is driven by its parent's angular acceleration (it lags the swing and overshoots it)
    s.step(h, -0.45 * r.ax, -0.3 * r.ay, -0.45 * r.az);
    const cax = r.ax + s.ax, cay = r.ay + s.ay, caz = r.az + s.az;
    c.step(h, -0.35 * cax, -0.3 * cay, -0.35 * caz);
    const tax = cax + c.ax, tay = cay + c.ay, taz = caz + c.az;
    this.head.step(h, -0.55 * tax, -0.35 * tay, -0.55 * taz);
    armChain(h, this.armL, this.foreL, this.handL, tax, tay, taz);
    armChain(h, this.armR, this.foreR, this.handR, tax, tay, taz);
  }

  /** Write each logical joint's model-space rotation (x, y, z radians) into `out` (DUMMY_JOINTS order, 3 per joint). */
  write(out: Float32Array): void {
    out.fill(0);
    const r = this.rock, s = this.spine, c = this.chest, hd = this.head;
    put(out, 'pelvis', r.x, r.y, r.z);
    put(out, 'spine', s.x, s.y, s.z);
    put(out, 'chest', c.x, c.y, c.z);
    put(out, 'neck', hd.x * 0.4, hd.y * 0.4, hd.z * 0.4);
    put(out, 'head', hd.x * 0.6, hd.y * 0.6, hd.z * 0.6);
    put(out, 'leftShoulder', this.armL.x * 0.2, 0, this.armL.z * 0.2);
    put(out, 'leftUpperArm', this.armL.x * 0.8, this.armL.y, this.armL.z * 0.8);
    put(out, 'leftForeArm', this.foreL.x, 0, this.foreL.z);
    put(out, 'leftHand', this.handL.x, 0, this.handL.z);
    put(out, 'rightShoulder', this.armR.x * 0.2, 0, this.armR.z * 0.2);
    put(out, 'rightUpperArm', this.armR.x * 0.8, this.armR.y, this.armR.z * 0.8);
    put(out, 'rightForeArm', this.foreR.x, 0, this.foreR.z);
    put(out, 'rightHand', this.handR.x, 0, this.handR.z);
  }
}

function armChain(h: number, arm: Spring, fore: Spring, hand: Spring, tax: number, tay: number, taz: number): void {
  arm.step(h, -0.85 * tax, -0.2 * tay, -0.85 * taz);
  fore.step(h, -0.6 * (tax + arm.ax), 0, -0.6 * (taz + arm.az));
  hand.step(h, -0.4 * (tax + arm.ax + fore.ax), 0, -0.4 * (taz + arm.az + fore.az));
}

function put(out: Float32Array, joint: DummyJoint, x: number, y: number, z: number): void {
  const i = JOINT_INDEX[joint] * 3;
  out[i] = x; out[i + 1] = y; out[i + 2] = z;
}


/** Where a joint's swing goes when the skeleton lacks that bone: the first joint present in its list. */
const FOLD: Readonly<Partial<Record<DummyJoint, readonly DummyJoint[]>>> = {
  pelvis: ['pelvis', 'spine', 'chest'], spine: ['spine', 'chest', 'pelvis'], chest: ['chest', 'spine', 'pelvis'],
  neck: ['neck', 'head'], head: ['head', 'neck'],
  leftShoulder: ['leftShoulder', 'leftUpperArm'], leftUpperArm: ['leftUpperArm', 'leftShoulder'],
  leftForeArm: ['leftForeArm'], leftHand: ['leftHand'],
  rightShoulder: ['rightShoulder', 'rightUpperArm'], rightUpperArm: ['rightUpperArm', 'rightShoulder'],
  rightForeArm: ['rightForeArm'], rightHand: ['rightHand'],
};

interface Driven {
  object: THREE.Object3D;
  rest: THREE.Quaternion;
  /** the parent's rest orientation in the figure's model space, and its inverse */
  frame: THREE.Quaternion;
  frameInv: THREE.Quaternion;
  /** logical joints whose swing lands on this bone */
  sources: number[];
  /** a thigh under a driven pelvis: the index of that parent in `driven`, to undo its swing (the legs stay on the post) */
  counter: number;
  x: number; y: number; z: number;
}

const _q = new THREE.Quaternion(), _d = new THREE.Quaternion(), _e = new THREE.Euler();
const _rootInv = new THREE.Quaternion();

/** Applies DummyMotion's model-space angles to a figure's bones, preserving each bone's rest rotation. */
export class DummyPose {
  private readonly driven: Driven[] = [];
  private readonly angles = new Float32Array(DUMMY_JOINTS.length * 3);

  constructor(root: THREE.Object3D, joints: DummyJoints) {
    root.updateMatrixWorld(true);
    root.getWorldQuaternion(_rootInv).invert();
    const byObject = new Map<THREE.Object3D, Driven>();
    const make = (object: THREE.Object3D): Driven => {
      let d = byObject.get(object);
      if (d) return d;
      const frame = new THREE.Quaternion();
      if (object.parent) object.parent.getWorldQuaternion(frame);
      frame.premultiply(_rootInv);
      d = { object, rest: object.quaternion.clone(), frame, frameInv: frame.clone().invert(), sources: [], counter: -1, x: 0, y: 0, z: 0 };
      byObject.set(object, d); this.driven.push(d);
      return d;
    };
    for (const joint of DUMMY_JOINTS) {
      const order = FOLD[joint];
      if (!order) continue;
      const target = order.map((j) => joints[j]).find((o) => o !== undefined);
      if (target) make(target).sources.push(JOINT_INDEX[joint]);
    }
    for (const thigh of ['leftThigh', 'rightThigh'] as const) {
      const bone = joints[thigh];
      const parent = bone?.parent;
      if (!bone || !parent) continue;
      const p = byObject.get(parent);
      if (!p || p.sources.length === 0) continue;
      make(bone).counter = this.driven.indexOf(p);
    }
  }

  /** model-X sign of the Left* arm (−1 when the rig has none) */
  static leftSign(root: THREE.Object3D, joints: DummyJoints): number {
    const arm = joints.leftUpperArm ?? joints.leftShoulder;
    if (!arm) return -1;
    root.updateMatrixWorld(true);
    const p = arm.getWorldPosition(new THREE.Vector3());
    root.worldToLocal(p);
    return p.x > 0 ? 1 : -1;
  }

  apply(motion: DummyMotion, additive = false, gain = 1): void {
    const a = this.angles;
    motion.write(a);
    for (const d of this.driven) {
      let x = 0, y = 0, z = 0;
      for (const s of d.sources) { x += a[s * 3] ?? 0; y += a[s * 3 + 1] ?? 0; z += a[s * 3 + 2] ?? 0; }
      d.x = x * gain; d.y = y * gain; d.z = z * gain;
    }
    for (const d of this.driven) {
      let { x, y, z } = d;
      const parent = d.counter >= 0 ? this.driven[d.counter] : undefined;
      if (parent) { x -= parent.x; y -= parent.y; z -= parent.z; }
      // q = frame⁻¹ · D · frame · rest: D is the model-space swing, expressed in the parent's rest frame
      _d.setFromEuler(_e.set(x, y, z, 'YXZ'));
      _q.copy(d.frameInv).multiply(_d).multiply(d.frame).multiply(additive ? d.object.quaternion : d.rest);
      d.object.quaternion.copy(_q);
    }
  }
}
