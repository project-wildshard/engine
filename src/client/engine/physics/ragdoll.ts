/**
 * Ragdolls (project/archive/2026-09-23-physics.md P8): a dying animal's body is handed to the physics world, thrown by the killing hit,
 * and frozen to a static corpse once it has come to rest.
 *
 * Three builds, picked from the rig (src/engine/entities/Animal.ts `startRagdoll`):
 * - **quadruped** (deer, boar, elk, bear — the shared rig of AnimalFactory): capsules on the rig's own bones — the torso
 *   (`body`), the neck (`neck1` → head, `neck2` riding it), the head (a ball), and per leg the upper (`shoulder` / `hip`
 *   → the knee) and the lower bone (`carpus` / `stifle` → the hoof). Spherical joints with limits at the neck, head,
 *   shoulders and hips, revolute knees. The `lite` build (the phone) is 6 bodies: torso, neck with the head on it, one
 *   capsule per leg (the knee stays as it died). Limits are in the bones' own angle space: a bone's bind rotation is
 *   identity, so a body's rotation relative to its parent body IS the bone's local rotation, the angles Animal.ts poses.
 *   A roll torque on the torso (the righting bias, RIGHT_KP) lays it down on its nearest side, legs out, never on its back.
 * - **rigid** (a custom rig with no upright capsule: the crab, Brasscap's Wyrm and bandits): one box body that carries the
 *   whole mesh — the hit throws and tumbles it — while the species' own keyframed death (or skin `die` clip) still folds
 *   the limbs. An upright spring (UP_KP) lays it down on its base: the clip owns the corpse's pose, so the box never
 *   comes to rest on its head or back (TE-ENG11: the Wyrm landed upside down).
 * - **upright** (a standing custom rig: the monkey, the drowned sailor, the captain): one ball at the feet with its
 *   rotations locked — it falls off the deck or out of the palm crown and slides with the hit, and the species' keyframed
 *   death does the kneel and the topple, as before.
 *
 * Bodies are `DEBRIS` (they meet WORLD only: never the player, a creature, a sensor or each other — a corpse can't trip a
 * plate or block the player). Every frame `pose()` writes the bodies' poses back to the mesh and bones, interpolated
 * between the last two fixed steps. Once every body sleeps (or has barely moved for QUIET_T s, or after MAX_T s) the
 * ragdoll freezes: the bodies are removed and the last pose stays as a static corpse.
 *
 * The tier cap (RAGDOLL_CAP: phone 2 live, desktop 6) is per world: past it `spawn()` returns null and the animal
 * dies on its keyframed collapse.
 */
import * as THREE from 'three';
import type { ColliderDesc, ImpulseJoint, RigidBody } from '@dimforge/rapier3d-simd';
import type { Physics } from '../../../shared/engine/physics/Physics';
import { groups } from '../../../shared/engine/physics/groups';
import { castRay } from '../../../shared/engine/physics/query';
import { FIXED_STEP } from '../../../shared/engine/core/fixedStep';
import { TIER } from '../core/tier';

/** live ragdolls per world, per tier (the plan's Budgets: phone ≤ 2, desktop ≤ 6) */
export const RAGDOLL_CAP = { phone: 2, desktop: 6 } as const;

/** the rig numbers a ragdoll is sized from (AnimalDims) */
export interface RagdollDims {
  readonly bodyY: number; readonly bodyHalfLen: number; readonly bodyRadius: number; readonly headRadius: number;
  readonly halfWidth: number; readonly capsuleAxis?: 'z' | 'y';
}

export type RagdollBuild = 'quadruped' | 'rigid' | 'upright';

export interface Vec3Like { readonly x: number; readonly y: number; readonly z: number }

export interface RagdollSpec {
  build: RagdollBuild;
  /** the animal's mesh: the rig's root (its parent has an identity transform — world = local), uniformly scaled by `scale` */
  root: THREE.Object3D;
  bones: Readonly<Record<string, THREE.Bone>>;
  dims: RagdollDims;
  scale: number;
  /** the phone's 6-body quadruped */
  lite: boolean;
  /** world m/s the animal was moving at when it died */
  velocity: Vec3Like;
  /** the killing hit: where, which way (world), how hard (hp) */
  hitPoint: Vec3Like;
  dir: Vec3Like;
  damage: number;
}

/** freeze when every body sleeps, or when none has moved faster than QUIET_V m/s for QUIET_T s, or after MAX_T s */
const QUIET_V = 0.12, QUIET_T = 0.5, MAX_T = 5;
/** a body's spin counts toward QUIET_V at this lever (m): a limb rolling on its own axis is invisible, a swing moves its centre */
const SPIN_LEVER = 0.05;
/** a hit's throw: m/s per hp, clamped */
const THROW_PER_HP = 0.04, THROW_MIN = 0.8, THROW_MAX = 3.5, RIGID_THROW = [2, 2.5] as const;
/**
 * a jointed body's damping: heavy on the spin, so the limbs fold rather than flail and the body settles in ~2.5-3 s
 * (a 32-death sweep over sloped, bumpy ground: p50 2.9 s full / 2.4 s lite, 1 of 32 ran to MAX_T; at 1.2 / 0.1 it
 * was 3.9 s and 9 of 32). Joint motors as friction were worse: they fought the limits and kept the legs wobbling.
 */
const ANG_DAMP = 5, LIN_DAMP = 0.8;
/** the shins (the full build's knees down) spin-damped harder: less of the knee-limit wobble that kept a corpse from going quiet */
const SHIN_DAMP = 10;
/**
 * The righting bias — a quadruped comes to rest on its side, legs out, never on its back. A roll torque on the torso
 * about its long axis toward the nearest side-lying pose (its left / right axis along the ground's normal): a spring
 * RIGHT_KP per radian of roll past RIGHT_BAND, scaled by the whole body's weight × its half width, plus a roll damper
 * RIGHT_KD per rad/s (the spine's friction). Inside the band — up to RIGHT_BAND[0] rad off the flank toward the belly,
 * where the legs prop a body lying on its side, and RIGHT_BAND[1] toward the back — only the damper acts, so at rest it
 * pushes nothing and never presses the legs into the ground. At a third of its strength while the body is still moving
 * faster than RIGHT_SLOW m/s (the fall and the throw stay the hit's), full once it has slowed.
 * A 96-death sweep (deer / boar / bear / elk, full + lite, flat / 15° / 26°, random hits and running deaths, 3 seeds):
 * on the back 15-18 → 0, on the belly 35-53 → 0 (all rest 61-102° off upright); settle p50 2.3-2.9 → 2.35-2.5 s, runs
 * to MAX_T 17-28 → 1-7; the torso's fastest turn after the first second 448 → 164-194 °/s — it lies down, isn't flipped.
 */
const RIGHT_KP = 3, RIGHT_KD = 0.6, RIGHT_SLOW = 0.8, RIGHT_BAND = [0.35, 0.08] as const;
/**
 * The rigid build's upright spring (TE-ENG11): a tilt torque that turns the box's up axis onto the ground's normal, UP_KP
 * per radian of tilt scaled by its weight × its largest half extent (enough to tip it over an edge from its head), and a
 * damper at UP_ZETA of critical on the tilt rate. Yaw stays free. A third of its strength while the body moves faster
 * than RIGHT_SLOW m/s, so the throw and the tumble in the air stay the hit's; it lands and rolls onto its base.
 */
const UP_KP = 3, UP_ZETA = 0.9;
/** rad off the ground's normal a rigid box may freeze at (it rests square on its base; a bump or a stone may prop it) */
const UP_REST = 0.35;

type Limits3 = readonly [readonly [number, number], readonly [number, number], readonly [number, number]];
interface End { bone: string; offset?: readonly [number, number, number] }
interface PartDef {
  bone: string;
  shape: 'torso' | 'segment' | 'ball';
  /** the segment's far end (a descendant bone's origin, or a point in its frame) */
  end?: End;
  /** a ball riding the far end of a segment (the lite neck carries the head) */
  endBall?: boolean;
  radius: (d: RagdollDims) => number;
  mass: number;
  /** index of the parent part (-1 = the root) and the joint to it */
  parent: number;
  joint?: { kind: 'spherical'; limits: Limits3 } | { kind: 'revolute'; limits: readonly [number, number] };
}

const legR = (d: RagdollDims): number => Math.max(0.035, d.bodyRadius * 0.17);
const NECK: Limits3 = [[-0.6, 1.0], [-0.7, 0.7], [-0.35, 0.35]];
const HEAD: Limits3 = [[-0.7, 0.8], [-0.6, 0.6], [-0.3, 0.3]];
const HIP: Limits3 = [[-1.1, 1.1], [-0.25, 0.25], [-0.45, 0.45]];
const KNEE = [-0.05, 1.7] as const;
const LEGS = [['FL_shoulder', 'FL_carpus', 'FL_fetlock'], ['FR_shoulder', 'FR_carpus', 'FR_fetlock'], ['BL_hip', 'BL_stifle', 'BL_hock'], ['BR_hip', 'BR_stifle', 'BR_hock']] as const;
/** the hoof tip in the lowest leg bone's frame (the corpse IK's point before P8) */
const HOOF = [0, -0.11, 0] as const;
/** Rapier's angular joint axes (RawJointAxis AngX / AngY / AngZ); a revolute's free axis is its X */
const ANG_AXES = [3, 4, 5] as const;
/** radians a limit is widened past the pose it died in */
const LIMIT_SLACK = 0.05;

function quadParts(lite: boolean): PartDef[] {
  const parts: PartDef[] = [{ bone: 'body', shape: 'torso', radius: (d) => d.halfWidth, mass: 10, parent: -1 }];
  if (lite) {
    parts.push({ bone: 'neck1', shape: 'segment', end: { bone: 'head' }, endBall: true, radius: (d) => d.headRadius * 0.55, mass: 3, parent: 0, joint: { kind: 'spherical', limits: NECK } });
    for (const [upper, , foot] of LEGS) parts.push({ bone: upper, shape: 'segment', end: { bone: foot, offset: HOOF }, radius: legR, mass: 2, parent: 0, joint: { kind: 'spherical', limits: HIP } });
    return parts;
  }
  parts.push(
    { bone: 'neck1', shape: 'segment', end: { bone: 'head' }, radius: (d) => d.headRadius * 0.55, mass: 2, parent: 0, joint: { kind: 'spherical', limits: NECK } },
    { bone: 'head', shape: 'ball', radius: (d) => d.headRadius, mass: 1.2, parent: 1, joint: { kind: 'spherical', limits: HEAD } },
  );
  for (const [upper, knee, foot] of LEGS) {
    const up = parts.length;
    parts.push(
      { bone: upper, shape: 'segment', end: { bone: knee }, radius: (d) => legR(d) * 1.3, mass: 1.5, parent: 0, joint: { kind: 'spherical', limits: HIP } },
      { bone: knee, shape: 'segment', end: { bone: foot, offset: HOOF }, radius: legR, mass: 0.8, parent: up, joint: { kind: 'revolute', limits: KNEE } },
    );
  }
  return parts;
}

interface Part {
  bone: THREE.Object3D;
  body: RigidBody;
  prevP: THREE.Vector3; prevQ: THREE.Quaternion; curP: THREE.Vector3; curQ: THREE.Quaternion;
}

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _m = new THREE.Matrix4(), _e = new THREE.Euler();
const Y = new THREE.Vector3(0, 1, 0);
const DOWN = { x: 0, y: -1, z: 0 } as const;
const _o = { x: 0, y: 0, z: 0 };
const Q_Y_TO_Z = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);

/** an object's world position + rotation, scale dropped (the rig is uniformly scaled) */
function worldPose(o: THREE.Object3D, p: THREE.Vector3, q: THREE.Quaternion): void { o.matrixWorld.decompose(p, q, _s); }

let alphaClock: (() => number) | null = null;
/**
 * The frame's interpolation factor between fixed steps (`() => game.alpha`). Without it each ragdoll estimates it from
 * the frame dt since it last saw its bodies move — smooth, one step behind.
 */
export function setRagdollClock(fn: (() => number) | null): void { alphaClock = fn; }

export class Ragdoll {
  /** live: bodies in the world; frozen: a static corpse; gone: disposed */
  state: 'live' | 'frozen' | 'gone' = 'live';
  private readonly parts: Part[] = [];
  private readonly joints: ImpulseJoint[] = [];
  private readonly root: THREE.Object3D;
  private readonly build: RagdollBuild;
  private readonly scale: number;
  /** the root part's bone in the mesh's frame (quadruped: the body bone, held there while the mesh follows the torso) */
  private readonly rootLocalP = new THREE.Vector3();
  private readonly rootLocalQInv = new THREE.Quaternion();
  private readonly frozenP = new THREE.Vector3();
  private age = 0; private quietT = 0; private sinceStep = 0;
  /** the righting bias: the whole ragdoll's weight × half width (N·m per unit gain), the side it falls to on a tie (+1: left side up) */
  private rightScale = 0; private rightSide = 1;
  /** the rigid build's upright spring: N·m per radian of tilt and N·m per rad/s of tilt rate (0 for the other builds) */
  private upK = 0; private upD = 0; private upReach = 0;

  private readonly system: Ragdolls;
  constructor(system: Ragdolls, spec: RagdollSpec) {
    this.system = system;
    const { R, world } = system.physics;
    this.root = spec.root; this.build = spec.build; this.scale = spec.scale;
    const s = spec.scale, d = spec.dims;
    spec.root.updateMatrixWorld(true);
    const bone = (name: string): THREE.Object3D => {
      const b = spec.bones[name];
      if (b === undefined) throw new Error(`ragdoll: the rig has no bone '${name}'`);
      return b;
    };
    const dh = new THREE.Vector3(spec.dir.x, 0, spec.dir.z);
    if (dh.lengthSq() < 1e-6) dh.set(0, 0, 1); else dh.normalize();
    const rigid = spec.build === 'rigid', jointed = spec.build === 'quadruped';
    // a small flat body (the crab) is tossed and flipped by any killing blow; the rest take a throw by the damage
    const throwV = THREE.MathUtils.clamp(spec.damage * THROW_PER_HP, rigid ? RIGID_THROW[0] : THROW_MIN, rigid ? RIGID_THROW[1] : THROW_MAX);
    const v = spec.velocity;
    // an upright body only slides (its rotations are locked), so it takes the whole throw
    const k = spec.build === 'upright' ? 1 : 0.6;
    const lin = { x: v.x + dh.x * throwV * k, y: v.y + throwV * (rigid ? 1.3 : 0.25), z: v.z + dh.z * throwV * k };
    // tip over away from the hit: spin about (up × away)
    const spin = new THREE.Vector3().crossVectors(Y, dh).multiplyScalar(throwV * (rigid ? 2.5 : 0.5));
    const bodyDesc = (p: THREE.Vector3, q: THREE.Quaternion) => R.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setRotation(q)
      .setLinvel(lin.x, lin.y, lin.z).setLinearDamping(jointed ? LIN_DAMP : 0.1).setAngularDamping(jointed ? ANG_DAMP : 0.3);
    const collider = (desc: ColliderDesc, mass: number) =>
      desc.setMass(mass).setCollisionGroups(groups('DEBRIS')).setSolverGroups(groups('DEBRIS')).setFriction(0.9).setRestitution(0.05);

    if (spec.build !== 'quadruped') {
      // one body at the mesh root: a box around the body (rigid) or a ball at the feet (upright, rotations locked)
      worldPose(spec.root, _p, _q);
      const desc = bodyDesc(_p, _q);
      if (spec.build === 'upright') desc.lockRotations();
      else desc.setAngvel(spin);
      const body = world.createRigidBody(desc);
      if (spec.build === 'upright') {
        const r = Math.max(0.12, d.halfWidth) * s;
        world.createCollider(collider(R.ColliderDesc.ball(r).setTranslation(0, r, 0), 5).setFriction(0.4), body);
      } else {
        world.createCollider(collider(R.ColliderDesc.cuboid(d.halfWidth * s, d.bodyY * 0.5 * s, Math.max(d.bodyHalfLen, d.bodyRadius) * s).setTranslation(0, d.bodyY * 0.6 * s, 0), 5), body);
      }
      this.parts.push({ bone: spec.root, body, prevP: _p.clone(), prevQ: _q.clone(), curP: _p.clone(), curQ: _q.clone() });
      if (rigid) {
        const reach = Math.max(d.halfWidth, d.bodyY * 0.6, Math.max(d.bodyHalfLen, d.bodyRadius)) * s;
        const inertia = body.principalInertia(), I = Math.max(inertia.x, inertia.y, inertia.z);
        this.upK = UP_KP * body.mass() * 9.81 * reach; this.upReach = reach;
        this.upD = UP_ZETA * 2 * Math.sqrt(this.upK * I);
      }
      return;
    }

    const defs = quadParts(spec.lite);
    const bodyBone = bone('body');
    this.rootLocalP.copy(bodyBone.position);
    this.rootLocalQInv.copy(bodyBone.quaternion).invert();
    for (const def of defs) {
      const b = bone(def.bone);
      worldPose(b, _p, _q);
      const desc = bodyDesc(_p, _q);
      if (def.parent < 0) desc.setAngvel(spin);
      else if (def.joint?.kind === 'revolute') desc.setAngularDamping(SHIN_DAMP);
      const body = world.createRigidBody(desc);
      const r = def.radius(d) * s;
      if (def.shape === 'torso') {
        const half = Math.max(0.02, d.bodyHalfLen * s - r * 0.6);
        world.createCollider(collider(R.ColliderDesc.capsule(half, r).setRotation(Q_Y_TO_Z), def.mass), body);
      } else if (def.shape === 'ball') {
        world.createCollider(collider(R.ColliderDesc.ball(r), def.mass), body);
      } else if (def.end !== undefined) {
        // the segment from this bone to its end, in this body's frame (bones between ride along as they died)
        const e = bone(def.end.bone);
        const off = def.end.offset;
        _m.copy(b.matrixWorld).invert();
        const endLocal = _a.set(off?.[0] ?? 0, off?.[1] ?? 0, off?.[2] ?? 0).applyMatrix4(e.matrixWorld).applyMatrix4(_m).multiplyScalar(s);
        const len = endLocal.length();
        const half = Math.max(0.01, len / 2 - r * 0.5);
        const rot = len > 1e-4 ? _q2.setFromUnitVectors(Y, _b.copy(endLocal).divideScalar(len)) : _q2.identity();
        world.createCollider(collider(R.ColliderDesc.capsule(half, r).setTranslation(endLocal.x / 2, endLocal.y / 2, endLocal.z / 2).setRotation(rot), def.mass), body);
        if (def.endBall === true) {
          const hr = d.headRadius * s;
          world.createCollider(collider(R.ColliderDesc.ball(hr).setTranslation(endLocal.x, endLocal.y, endLocal.z), def.mass * 0.5), body);
        }
      }
      const parent = this.parts[def.parent];
      if (parent !== undefined && def.joint !== undefined) {
        // the joint at this bone's origin: the anchor in the parent body's frame, the origin in this one's
        worldPose(parent.bone, _a, _q2);
        const anchor = _b.copy(_p).sub(_a).applyQuaternion(_q2.invert());
        const jd = def.joint.kind === 'revolute'
          ? R.JointData.revolute({ x: anchor.x, y: anchor.y, z: anchor.z }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
          : R.JointData.spherical({ x: anchor.x, y: anchor.y, z: anchor.z }, { x: 0, y: 0, z: 0 });
        const j = world.createImpulseJoint(jd, parent.body, body, true);
        j.setContactsEnabled(false);
        // limits through the raw set: `createImpulseJoint`'s typed wrapper isn't the spherical / revolute subclass here
        // (and the spherical one has no setLimits at all); the raw call takes any angular axis. No joint motors: a
        // velocity motor as joint friction fought the limits and kept the legs wobbling (settle 2 s → 4-5 s)
        // Each range is widened to take the pose it died in (a grazing deer's head is folded past the resting limits),
        // so the joint never snaps at the first step.
        const raw = world.impulseJoints.raw;
        const lim: readonly (readonly [number, number])[] = def.joint.kind === 'revolute' ? [def.joint.limits] : def.joint.limits;
        const died = _e.setFromQuaternion(_q2.multiply(_q), 'XYZ');   // _q2 = the parent's rotation⁻¹ (above)
        const at = [died.x, died.y, died.z];
        lim.forEach(([lo, hi], i) => {
          const axis = ANG_AXES[i], a = at[i] ?? 0;
          if (axis === undefined) return;
          raw.jointSetLimits(j.handle, axis, Math.min(lo, a - LIMIT_SLACK), Math.max(hi, a + LIMIT_SLACK));
        });
        this.joints.push(j);
      }
      this.parts.push({ bone: b, body, prevP: _p.clone(), prevQ: _q.clone(), curP: _p.clone(), curQ: _q.clone() });
    }
    // the hit lands on the torso where it struck: the off-centre part of the throw spins it
    const torso = this.parts[0];
    if (torso !== undefined) {
      const m = torso.body.mass() * throwV * 0.3;
      torso.body.applyImpulseAtPoint({ x: dh.x * m, y: 0, z: dh.z * m }, spec.hitPoint, true);
      let mass = 0;
      for (const p of this.parts) mass += p.body.mass();
      this.rightScale = mass * 9.81 * d.halfWidth * s;
      // it tips away from the hit, so the flank that faced the hit ends up on top
      const r = torso.body.rotation();
      this.rightSide = _a.set(1, 0, 0).applyQuaternion(_q.set(r.x, r.y, r.z, r.w)).dot(dh) > 0 ? -1 : 1;
    }
  }

  /** how many rigid bodies it has (0 once frozen) */
  get bodies(): number { return this.state === 'live' ? this.parts.length : 0; }

  /** The torso's (or the single body's) world position — the corpse's place for loot / harvest. */
  rootPosition(out: THREE.Vector3): THREE.Vector3 {
    const p = this.parts[0];
    return p === undefined ? out.copy(this.root.position) : out.copy(p.curP);
  }

  /**
   * Every frame (dt = the frame's scaled seconds): write the bodies' poses to the mesh and bones, interpolated between
   * the last two fixed steps; freeze once it has settled. A frozen ragdoll re-places the mesh where it froze (the fade's
   * sink offsets it from there).
   */
  pose(dt: number): void {
    if (this.state === 'gone') return;
    if (this.state === 'frozen') { this.root.position.copy(this.frozenP); return; }
    this.age += dt; this.sinceStep += dt;
    let stepped = false, fastest = 0, asleep = true;
    for (const part of this.parts) {
      const b = part.body, t = b.translation(), r = b.rotation();
      if (t.x !== part.curP.x || t.y !== part.curP.y || t.z !== part.curP.z || r.w !== part.curQ.w || r.x !== part.curQ.x || r.y !== part.curQ.y || r.z !== part.curQ.z) {
        part.prevP.copy(part.curP); part.prevQ.copy(part.curQ);
        part.curP.set(t.x, t.y, t.z); part.curQ.set(r.x, r.y, r.z, r.w);
        stepped = true;
      }
      if (!b.isSleeping()) asleep = false;
      const lv = b.linvel(), av = b.angvel();
      fastest = Math.max(fastest, Math.hypot(lv.x, lv.y, lv.z), Math.hypot(av.x, av.y, av.z) * SPIN_LEVER);
    }
    if (stepped) this.sinceStep = 0;
    this.quietT = fastest < QUIET_V ? this.quietT + dt : 0;
    // a rigid box still off its base keeps rolling (its spring wakes it), however still or asleep: only MAX_T freezes it
    const tilt = this.build === 'rigid' ? this.upright(fastest) : 0;
    const settled = ((asleep || this.quietT >= QUIET_T) && tilt < UP_REST) || this.age >= MAX_T;
    if (!settled && this.build === 'quadruped') this.right(fastest);
    const alpha = settled ? 1 : THREE.MathUtils.clamp(alphaClock !== null ? alphaClock() : this.sinceStep / FIXED_STEP, 0, 1);
    this.write(alpha);
    this.fastest = fastest;
    if (settled) this.freeze();
  }
  /** the fastest body at the last pose() (m/s; a spin counts at SPIN_LEVER m per radian) */
  fastest = 0;

  /**
   * The righting bias (RIGHT_KP): set the torso's roll torque for the fixed steps until the next pose(). Roll only —
   * about the torso's long axis — so the fall, the pitch down a slope and the legs stay the physics' own.
   */
  private right(fastest: number): void {
    const torso = this.parts[0];
    if (torso === undefined) return;
    const b = torso.body;
    const w = 1 - (2 / 3) * THREE.MathUtils.smoothstep(fastest, RIGHT_SLOW * 0.5, RIGHT_SLOW * 1.5);
    b.resetTorques(false);
    if (b.isSleeping()) return;
    const t = b.translation(), r = b.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    // the ground under the torso (its normal; straight up off the ground or on a miss)
    const hit = castRay(this.system.physics, t, DOWN, 3);
    const n = _b.set(0, 1, 0);
    if (hit !== null && hit.normal.y > 0.3) n.set(hit.normal.x, hit.normal.y, hit.normal.z);
    const f = _p.set(0, 0, 1).applyQuaternion(_q);            // the long axis (the body bone's forward)
    n.addScaledVector(f, -n.dot(f));                          // the normal seen end-on
    if (n.lengthSq() < 1e-4) return;                          // standing on its nose: pitch, not roll
    n.normalize();
    const l = _a.set(1, 0, 0).applyQuaternion(_q);            // the left flank's axis
    const ln = l.dot(n);
    const side = Math.abs(ln) > 0.05 ? Math.sign(ln) : this.rightSide;
    // the roll (about f) that takes l onto side × n, and the roll rate
    const err = Math.atan2(f.dot(_s.crossVectors(l, n)) * side, ln * side);
    // no push inside the band a body lies in on its side (its legs prop it up to RIGHT_BAND[0] off the flank toward
    // the belly, only RIGHT_BAND[1] toward the back): the spring doesn't press the legs into the ground to hold 90°
    const band = _c.set(0, 1, 0).applyQuaternion(_q).dot(n) > 0 ? RIGHT_BAND[0] : RIGHT_BAND[1];
    const e = Math.sign(err) * Math.max(0, Math.abs(err) - band);
    const av = b.angvel();
    const rate = f.x * av.x + f.y * av.y + f.z * av.z;
    const tau = this.rightScale * w * (RIGHT_KP * e - RIGHT_KD * rate);
    b.addTorque({ x: f.x * tau, y: f.y * tau, z: f.z * tau }, false);
  }

  /**
   * The rigid build's upright spring (UP_KP): set the box's tilt torque for the fixed steps until the next pose(). It turns
   * the body's up axis onto the ground's normal under it (straight up off the ground or on a miss); on its head the turn
   * goes over its side axis. Returns the tilt (rad).
   */
  private upright(fastest: number): number {
    const part = this.parts[0];
    if (part === undefined || this.upK === 0) return 0;
    const b = part.body;
    b.resetTorques(false);
    const t = b.translation(), r = b.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    // the ground under it: the body's origin is its feet, on the ground once it lies upright, so cast from above them
    const lift = this.upReach;
    _o.x = t.x; _o.y = t.y + lift; _o.z = t.z;
    const hit = castRay(this.system.physics, _o, DOWN, 3 + lift * 2);
    const n = _b.set(0, 1, 0);
    if (hit !== null && hit.normal.y > 0.3) n.set(hit.normal.x, hit.normal.y, hit.normal.z);
    const u = _a.set(0, 1, 0).applyQuaternion(_q);
    const axis = _c.crossVectors(u, n);
    const sin = axis.length(), cos = u.dot(n);
    const tilt = Math.atan2(sin, cos);
    if (b.isSleeping() && tilt < 0.05) return tilt;
    if (sin > 1e-4) axis.divideScalar(sin);
    else if (cos < 0) axis.set(1, 0, 0).applyQuaternion(_q);   // on its head: over the box's side axis
    else axis.set(0, 0, 0);
    const av = b.angvel();
    // the tilt rate: the spin less its yaw about the normal
    const yaw = av.x * n.x + av.y * n.y + av.z * n.z;
    const wx = av.x - n.x * yaw, wy = av.y - n.y * yaw, wz = av.z - n.z * yaw;
    const w = 1 - (2 / 3) * THREE.MathUtils.smoothstep(fastest, RIGHT_SLOW * 0.5, RIGHT_SLOW * 1.5);
    const k = this.upK * w * tilt, dmp = this.upD * w;
    b.addTorque({ x: axis.x * k - wx * dmp, y: axis.y * k - wy * dmp, z: axis.z * k - wz * dmp }, tilt > 0.05);
    return tilt;
  }

  private write(alpha: number): void {
    const root = this.root;
    for (let i = 0; i < this.parts.length; i++) {
      const part = this.parts[i];
      if (part === undefined) continue;
      _p.lerpVectors(part.prevP, part.curP, alpha);
      _q.slerpQuaternions(part.prevQ, part.curQ, alpha);
      if (i === 0) {
        if (this.build === 'quadruped') {
          // the mesh follows the torso: mesh = torso × (the body bone's local pose)⁻¹, so the body bone keeps its place
          _q.multiply(this.rootLocalQInv);
          _p.sub(_a.copy(this.rootLocalP).multiplyScalar(this.scale).applyQuaternion(_q));
        }
        root.position.copy(_p); root.quaternion.copy(_q);
        continue;
      }
      // a limb: its local rotation under its parent bone's world rotation (parents are written first)
      const parent = part.bone.parent;
      if (parent === null) continue;
      parent.getWorldQuaternion(_q2);
      part.bone.quaternion.copy(_q2.invert().multiply(_q));
    }
    root.updateMatrixWorld(true);
  }

  /** remove the bodies and keep the pose */
  private freeze(): void {
    this.removeBodies();
    this.frozenP.copy(this.root.position);
    this.state = 'frozen';
  }

  /** The animal left (faded out, despawned): drop the bodies if they're still in the world. */
  dispose(): void {
    this.removeBodies();
    this.state = 'gone';
  }

  private removeBodies(): void {
    if (this.state !== 'live') return;
    const world = this.system.physics.world;
    for (const j of this.joints) if (world.impulseJoints.contains(j.handle)) world.removeImpulseJoint(j, false);
    for (const p of this.parts) if (world.bodies.contains(p.body.handle)) world.removeRigidBody(p.body);
    this.joints.length = 0;
    this.system.released();
  }
}

/** A world's ragdolls: the cap and the live count. */
export class Ragdolls {
  /** ragdolls with bodies in the world right now (the bench reads it) */
  live = 0;

  readonly physics: Physics;
  readonly cap: number;
  constructor(physics: Physics, cap: number = RAGDOLL_CAP[TIER]) {
    this.physics = physics;
    this.cap = cap;
  }

  /** A ragdoll for this death, or null past the cap (the caller falls back to its keyframed collapse). */
  spawn(spec: RagdollSpec): Ragdoll | null {
    if (this.live >= this.cap) return null;
    this.live++;
    return new Ragdoll(this, spec);
  }

  /** @internal a ragdoll froze or was disposed */
  released(): void { this.live = Math.max(0, this.live - 1); }
}

const systems = new WeakMap<Physics, Ragdolls>();
/** The ragdolls of this physics world (made on first use). */
export function ragdollsFor(physics: Physics): Ragdolls {
  let r = systems.get(physics);
  if (r === undefined) { r = new Ragdolls(physics); systems.set(physics, r); }
  return r;
}
