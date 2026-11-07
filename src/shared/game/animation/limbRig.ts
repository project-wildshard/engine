import * as THREE from 'three';
import { LIMB_POSE_KEYS, type LimbPoseKey, type LimbRigSpec, type BakedPoseClip } from '@wildshard/format/limbRig';

/** Client-only FK and two-bone foot IK on borrowed GLB skeletons; numeric clip playback is server-safe. */
/** The pose's scalar channels: offsets from the rest (the hull's stance). Angles in radians: pitch + = nose down (three's
 *  +x), yaw + = to its left, roll + = its right side down. */
/** One pose: the spine's scalars and, per limb (the spec's order), the foot's model-space offset from its rest spot and
 *  its toe pitch (`feet[limb * 4 + 0..3]` = dx dy dz toe). */
export type LimbPose = Record<LimbPoseKey, number> & { feet: Float32Array };

export function newLimbPose(): LimbPose {
  return { rootY: 0, rootZ: 0, rootPitch: 0, rootRoll: 0, rootYaw: 0, hipsPitch: 0, chestPitch: 0, chestYaw: 0, chestRoll: 0, neckPitch: 0, neckYaw: 0, headPitch: 0, headYaw: 0, headRoll: 0, tailPitch: 0, tailYaw: 0, feet: new Float32Array(16) };
}
/** Every channel back to the rest. */
export function zeroLimbPose(p: LimbPose): LimbPose { for (const k of LIMB_POSE_KEYS) p[k] = 0; p.feet.fill(0); return p; }
/** `into += p × w`, every channel (nothing when `w` is 0). */
export function addLimbPose(into: LimbPose, p: LimbPose, w: number): void {
  if (w === 0) return;
  for (const k of LIMB_POSE_KEYS) into[k] += p[k] * w;
  for (let i = 0; i < 16; i++) into.feet[i] = (into.feet[i] ?? 0) + (p.feet[i] ?? 0) * w;
}
/** `p × keep`, every channel (a clip taking the body over). */
export function scaleLimbPose(p: LimbPose, keep: number): void {
  for (const key of LIMB_POSE_KEYS) p[key] *= keep;
  for (let i = 0; i < 16; i++) p.feet[i] = (p.feet[i] ?? 0) * keep;
}

/** The rig's rest, readable without bones (a bake or a headless host keeps it). */
export interface LimbPoseRest {
  at: Readonly<Record<string, Readonly<{ x: number; y: number; z: number }>>>;
  rootPos: Readonly<{ x: number; y: number; z: number }>;
  /** the size unit and the strides it gives, model units */
  H: number; walkStride: number; chargeStride: number;
}

export interface LimbRest extends LimbPoseRest {
  bones: Record<string, THREE.Bone>;
  names: string[];
  /** model-space rest position per bone name */
  at: Record<string, THREE.Vector3>;
  rootPos: THREE.Vector3;
  H: number; walkStride: number; chargeStride: number;
  /** each limb's rest bend plane (unit normal, model space) and the side of it its middle joint sits on (±1) */
  plane: THREE.Vector3[]; bend: number[];
}
const rests = new WeakMap<THREE.Bone, LimbRest>();
const isBone = (o: THREE.Object3D | null): o is THREE.Bone => o !== null && (o as Partial<THREE.Bone>).isBone === true;

/** The rig's rest, read once off its bones (their local positions are the rest offsets; rest rotations are identity). */
export function limbRest(spec: LimbRigSpec, bones: Record<string, THREE.Bone>): LimbRest {
  const body = bones[spec.spine.root];
  if (!body) throw new Error(`limb rig: no ${spec.spine.root} bone`);
  const hit = rests.get(body);
  if (hit) return hit;
  const at: Record<string, THREE.Vector3> = {};
  const names = Object.keys(bones);
  const world = (b: THREE.Bone): THREE.Vector3 => {
    const w = at[b.name];
    if (w) return w;
    const p = isBone(b.parent) ? world(b.parent).clone().add(b.position) : b.position.clone();
    at[b.name] = p;
    return p;
  };
  for (const n of names) { const b = bones[n]; if (b) world(b); }
  const P = (n: string): THREE.Vector3 => at[n] ?? new THREE.Vector3();
  const H = Math.max(spec.minHeight, (P(spec.heightFrom[0]).y + P(spec.heightFrom[1]).y) / 2);
  const plane: THREE.Vector3[] = [], bend: number[] = [];
  for (const [a, b, c] of spec.limbs) {
    const A = P(a), B = P(b), C = P(c);
    const n = new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(B, A), new THREE.Vector3().subVectors(C, B));
    // a near-straight limb has no plane of its own: the side axis, bent forward (+z) like a knee
    if (n.length() < 1e-4 * A.distanceTo(C) ** 2) n.set(1, 0, 0); else n.normalize();
    const u = new THREE.Vector3().subVectors(C, A).normalize();
    const off = new THREE.Vector3().subVectors(B, A).addScaledVector(u, -new THREE.Vector3().subVectors(B, A).dot(u));
    const w = new THREE.Vector3().crossVectors(n, u);
    plane.push(n); bend.push(off.lengthSq() < 1e-10 ? -1 : Math.sign(off.dot(w)) || 1);
  }
  const r: LimbRest = { bones, names, at, rootPos: body.position.clone(), H, walkStride: spec.walkStride * H, chargeStride: spec.chargeStride * H, plane, bend };
  rests.set(body, r);
  return r;
}

// ─────────────────────────────── the solve: FK + two-bone IK ───────────────────────────────

const clamp = THREE.MathUtils.clamp;
const _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _wq: Record<string, THREE.Quaternion> = {};
const _wp: Record<string, THREE.Vector3> = {};
const wq = (n: string): THREE.Quaternion => (_wq[n] ??= new THREE.Quaternion());
const wp = (n: string): THREE.Vector3 => (_wp[n] ??= new THREE.Vector3());
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _t = new THREE.Vector3(), _u = new THREE.Vector3(), _n = new THREE.Vector3(), _w = new THREE.Vector3(), _x = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _m = new THREE.Matrix4(), _m0 = new THREE.Matrix4();

/** set bone `n`'s local rotation from euler angles and record its model-space transform (the parent's first) */
function fk(r: LimbRest, n: string, x: number, y: number, z: number): void {
  const b = r.bones[n];
  if (!b) return;
  _e.set(x, y, z, 'YXZ');
  b.quaternion.setFromEuler(_e);
  record(r, n);
}
function record(r: LimbRest, n: string): void {
  const b = r.bones[n];
  if (!b) return;
  const par = isBone(b.parent) ? b.parent.name : null;
  if (par === null) { wq(n).copy(b.quaternion); wp(n).copy(b.position); return; }
  wq(n).copy(wq(par)).multiply(b.quaternion);
  wp(n).copy(b.position).applyQuaternion(wq(par)).add(wp(par));
}
/** a rotation taking frame (u0, n0) onto (u1, n1) (unit, orthogonal pairs) */
function frameRot(u0: THREE.Vector3, n0: THREE.Vector3, u1: THREE.Vector3, n1: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  _x.crossVectors(u0, n0); _m0.makeBasis(u0, n0, _x);
  _x.crossVectors(u1, n1); _m.makeBasis(u1, n1, _x);
  _m.multiply(_m0.transpose());
  return out.setFromRotationMatrix(_m);
}

/**
 * Pose the skeleton: the spine by FK, each limb by two-bone IK onto its foot's target (rest spot + the pose's offset,
 * model space): the upper and middle bones solve, the lower keeps the ground's orientation (turned by the toe pitch).
 * The bend plane is the parent's side axis, and each limb bends the way its rest bends, so a knee never flips.
 */
export function applyLimbPose(spec: LimbRigSpec, r: LimbRest, p: LimbPose): void {
  const s = spec.spine, body = r.bones[s.root];
  if (!body) return;
  body.position.set(r.rootPos.x, r.rootPos.y + p.rootY, r.rootPos.z + p.rootZ);
  fk(r, s.root, p.rootPitch, p.rootYaw, p.rootRoll);
  fk(r, s.hips, p.hipsPitch - p.rootPitch * spec.hipsCounter[0], 0, -p.rootRoll * spec.hipsCounter[1]);
  fk(r, s.tail, p.tailPitch, p.tailYaw, 0);
  fk(r, s.chest, p.chestPitch, p.chestYaw, p.chestRoll);
  fk(r, s.neck, p.neckPitch, p.neckYaw, 0);
  fk(r, s.head, p.headPitch, p.headYaw, p.headRoll);
  for (let l = 0; l < spec.limbs.length; l++) {
    const chain = spec.limbs[l];
    if (!chain) continue;
    const [na, nb, nc, nd] = chain;
    const A = r.at[na], B = r.at[nb], C = r.at[nc], D = r.at[nd];
    const ba = r.bones[na], bb = r.bones[nb], bc = r.bones[nc], bd = r.bones[nd];
    if (!A || !B || !C || !D || !ba || !bb || !bc || !bd) continue;
    const par = isBone(ba.parent) ? ba.parent.name : s.root;
    // the upper joint where the spine left it
    _a.copy(ba.position).applyQuaternion(wq(par)).add(wp(par));
    // the target: the foot's rest + offset; the lower bone (C → D) turned by the toe pitch about the side axis
    const f = p.feet;
    _q1.setFromAxisAngle(_x.set(1, 0, 0), f[l * 4 + 3] ?? 0);
    _c.subVectors(C, D).applyQuaternion(_q1);
    _t.set(D.x + (f[l * 4] ?? 0), D.y + (f[l * 4 + 1] ?? 0), D.z + (f[l * 4 + 2] ?? 0)).add(_c);   // where the middle joint's child (C) must be
    const l1 = A.distanceTo(B), l2 = B.distanceTo(C);
    _u.subVectors(_t, _a);
    let d = _u.length();
    if (d < 1e-6) { _u.set(0, -1, 0); d = 1e-6; } else _u.multiplyScalar(1 / d);
    d = clamp(d, Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
    // the bend plane's normal: the limb's rest plane turned with the parent, square to the reach
    const n0 = r.plane[l] ?? _x.set(1, 0, 0);
    _n.copy(n0).applyQuaternion(wq(par));
    _n.addScaledVector(_u, -_n.dot(_u)).normalize();
    const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    // the middle joint on the side of the plane it sits on at rest
    _w.crossVectors(_n, _u).multiplyScalar(r.bend[l] ?? 1);
    _b.copy(_a).addScaledVector(_u, along).addScaledVector(_w, h);                   // the middle joint
    _t.copy(_a).addScaledVector(_u, d);                                                 // C, reachable
    // the rest frame of the upper bone: its direction and the same side normal at rest (the parent unturned)
    const u0 = new THREE.Vector3().subVectors(B, A).normalize(), r0 = n0.clone().addScaledVector(u0, -n0.dot(u0)).normalize();
    const u1 = new THREE.Vector3().subVectors(_b, _a).normalize(), n1 = _n.clone().addScaledVector(u1, -_n.dot(u1)).normalize();
    frameRot(u0, r0, u1, n1, _q2);                                                      // the upper bone's model-space rotation
    ba.quaternion.copy(_qi.copy(wq(par)).invert()).multiply(_q2);
    record(r, na);
    // the middle bone: its rest direction (turned by the upper) onto B → C
    const v0 = new THREE.Vector3().subVectors(C, B).normalize().applyQuaternion(_q2), v1 = new THREE.Vector3().subVectors(_t, _b).normalize();
    _q.setFromUnitVectors(v0, v1).multiply(_q2);
    bb.quaternion.copy(_qi.copy(_q2).invert()).multiply(_q);
    record(r, nb);
    // the lower bone: the ground's orientation turned by the toe
    bc.quaternion.copy(_qi.copy(_q).invert()).multiply(_q1);
    record(r, nc);
    bd.quaternion.identity();
    record(r, nd);
  }
}

// ─────────────────────────────── the clips: baked samples ───────────────────────────────

/** a grid lookup: the two samples around `u` and the blend between them (a loop wraps, a clamp holds its ends) */
function cell(u: number, from: number, to: number, n: number, loop: boolean, out: [number, number, number]): void {
  const k = loop ? (((u - from) / (to - from)) % 1 + 1) % 1 * n : clamp((u - from) / (to - from), 0, 1) * (n - 1);
  const i = Math.min(n - 1, Math.floor(k));
  out[0] = i; out[1] = loop ? (i + 1) % n : Math.min(n - 1, i + 1); out[2] = k - i;
}
const _cx: [number, number, number] = [0, 0, 0], _ct: [number, number, number] = [0, 0, 0];
/** channel `c` of the sample at grid cell (t row, x column) */
const sample = (clip: BakedPoseClip, ti: number, xi: number, c: number): number => clip.values[(ti * clip.x[2] + xi) * clip.channels.length + c] ?? 0;

/** Plays a baked clip at `x` (its input: a phase, a progress, seconds) and clock `t` onto `p` (each channel it sets is
 *  overwritten; zero `p` first for the clip alone): the samples blended linearly on both grids. Allocates nothing. */
export function playBakedClip(clip: BakedPoseClip, p: LimbPose, x: number, t: number): LimbPose {
  const [from, to, n, loop] = clip.x;
  cell(x, from, to, n, loop === 1, _cx);
  cell(t, 0, clip.t?.[0] ?? 1, clip.t?.[1] ?? 1, true, _ct);
  const x0 = _cx[0], x1 = _cx[1], fx = _cx[2], t0 = _ct[0], t1 = _ct[1], ft = _ct[2];
  for (let c = 0; c < 32; c++) {   // a clip sets at most every channel: 16 scalars and 16 foot slots
    const ch = clip.channels[c];
    if (ch === undefined) break;
    const a = sample(clip, t0, x0, c) + (sample(clip, t0, x1, c) - sample(clip, t0, x0, c)) * fx;
    const b = sample(clip, t1, x0, c) + (sample(clip, t1, x1, c) - sample(clip, t1, x0, c)) * fx;
    if (typeof ch === 'number') p.feet[ch] = a + (b - a) * ft; else p[ch] = a + (b - a) * ft;
  }
  return p;
}
