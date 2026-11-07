import { bindRig } from '@wildshard/engine/anim/rig';
/**
 * E322 F-M3 — the Pine Hollow people's rig (Jake picked B; A, the upper-body-only rig that was in npcModels.ts, went with
 * its Debug row — git 4da54ccc has it). Built at load from the hull like A was, so any head grafted above the neck
 * (E304) rigs the same. What B adds over A:
 *
 *   legs      a thigh → shin → foot chain per side, placed on the legs' own centre lines (the generated people stand ~2–3 cm
 *             off x = 0, and their A-pose legs ~0.07 H apart). Weighted by height (the pelvis blends hips → thigh from 0.52 H
 *             down to 0.40 H, the knee and the ankle blend over ±0.035 H / 0.035 H), split by side with a blend band round
 *             the legs' midline that widens up the thigh (0.015 H at the shin → 0.05 H at the crotch: a long coat's front
 *             panel rides both legs), the foot on its own bone below the ankle.
 *   shoulder  A's arm (its air-gap test and weight bands), split: a clavicle (chest → clavicle → shoulder → twist → elbow →
 *             hand) that protracts and lifts with a forward raise (15 % / 12 % of it, + 30 % of a point's yaw), an upper-arm
 *             twist bone taking half a raise's twist about the arm (a swing-twist split), the deltoid cap above the armpit
 *             weighted by its distance from the joint (A left it 100 % on the chest). Then B is BOUND IN A's HANG (`HANG`:
 *             the mesh pre-posed into A's idle with A's own weights), so an idle B is A's idle, and the girdle's weights
 *             (spine, chest, clavicles, shoulders, twists) are blurred along the welded surface within 0.18 H of either
 *             joint (`diffuse`), across the armpit. A's stretch on a raise was the armpit's crease: one vertex on the arm,
 *             its neighbour on the chest. (Blurring in the A-pose bind instead spread the web between arm and coat into a
 *             grey membrane as the arms lowered to hang: hence the hang bind.) Measured (test/shards/pine-hollow/pine-npc-rig.test.ts), the
 *             edges within 0.2 H of the shoulders on Hale's point: A p99 2.4–5.5×, worst 16–25× · B p99 1.5–2.1×, worst
 *             5.6–13×; B's idle moves no edge there past 1.6×.
 *   clips     A's idle / talk / point, the same poses (A's shoulder Euler measured from the hang, split over clavicle ·
 *             shoulder · twist; A's elbow bend conjugated into the hung frame), plus a
 *             walk: a phase machine per foot (stance 60 % of a 1.0 s cycle, the ball of the foot planted, the heel lifting
 *             before toe-off, a swing arc 0.04 H high), two-bone IK per leg solved in the hips' frame (so the idle weight
 *             shift and the walk's hip roll / yaw never slide a foot), the hips' bob of the compass gait (≈ 0.02 H), the
 *             torso's counter-twist and the arms' counter-swing. The root travels at `walkSpeed`; `walkCycle` metres of
 *             travel = one cycle of `phase`. Measured (test/shards/pine-hollow/pine-npc-rig.test.ts): the planted ball's slide ≤ 0.01 H.
 *
 * E350 F-X3, the webs: the generator fused each hanging forearm (and Hale's lantern) to the coat; the fitter splits those
 * triangles at the seam, so Hale's point no longer drags a grey sheet from his sleeve to his coat.
 *
 * The fitter itself (`rigLegs`: weights, hang bind, `diffuse`, web split) runs offline in Pine's skin generator
 * (src/shards/pine-hollow/generators/npcSkin.ts); this module keeps the bones, the walk and the pose.
 *
 * Also: the ranger's lantern is found under his right hand (|x − hand.x| < 0.08 H), not by "anything left of the torso"
 * as in A, which also caught the outside of his right shin.
 */
import * as THREE from 'three';
import { smoothstep } from '@wildshard/engine/core/noise';

/** Authored pivot and skinned models share the NPC row lifecycle; their pose driver stays with the content. */
export interface NpcModel {
  readonly group: THREE.Group;
  update: (dt: number, t: number, player: THREE.Vector3) => void;
}

export const LEG_BONE_NAMES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'clavicleR', 'shoulderR', 'twistR', 'elbowR', 'handR',
  'clavicleL', 'shoulderL', 'twistL', 'elbowL', 'handL',
  'thighR', 'shinR', 'footR', 'thighL', 'shinL', 'footL',
] as const;
const PARENT = [-1, 0, 1, 2, 3, 2, 5, 6, 7, 8, 2, 10, 11, 12, 13, 0, 15, 16, 0, 18, 19];
const J = {
  hips: 0, spine: 1, chest: 2, neck: 3, head: 4,
  clR: 5, shR: 6, twR: 7, elR: 8, haR: 9, clL: 10, shL: 11, twL: 12, elL: 13, haL: 14,
  thR: 15, knR: 16, ftR: 17, thL: 18, knL: 19, ftL: 20,
} as const;

/** the walk: one cycle's length (s), the stance share of it, a planted foot's hip-relative travel per stance (× H) */
export const WALK = { cycle: 1.0, stance: 0.6, stride: 0.24, lift: 0.04, heel: 0.35, rise: 0.01, sink: 0.022, arm: 0.3 } as const;

export interface LegBuilt {
  geometry: THREE.BufferGeometry;
  /** every bone's rest point (mesh space), LEG_BONE_NAMES order */
  rest: THREE.Vector3[];
  height: number;
  /** the floor (the model's lowest y) */
  y0: number;
  lantern: THREE.Vector3 | null;
  /** the ball of each foot at rest (mesh space): right, left — the walk's planted point */
  ball: [THREE.Vector3, THREE.Vector3];
  /** m/s at which the walk's planted feet stay put */
  walkSpeed: number;
  /** metres of travel per walk cycle */
  walkCycle: number;
  /** E350 F-X3: the arm-to-coat web triangles split into a sleeve copy and a coat copy (`split`), the long ones kept on the coat only */
  webs: { split: number; coatOnly: number };
}

/**
 * The hang B is bound in (A's idle arms, npcModels.ts `pose`: each shoulder lowered from the A-pose about z, the elbows a
 * little bent), right then left. B pre-poses the mesh into it with A's own weights and binds there, so an idle B is A's
 * idle exactly and every arm rotation is measured from the hang: only a raise stretches what the shoulder blend spreads.
 */
const HANG = [
  { sh: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.42)), el: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.15, 0, 0)) },
  { sh: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.42 * 0.9)), el: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.12, 0, 0)) },
] as const;

/** the rig's bones at rest (LEG_BONE_NAMES order), parented, the root first */
export function legBones(b: LegBuilt): THREE.Bone[] {
  const bones = LEG_BONE_NAMES.map((name) => { const bone = new THREE.Bone(); bone.name = name; return bone; });
  bones.forEach((bone, i) => {
    const pi = PARENT[i] ?? -1, r = b.rest[i] ?? new THREE.Vector3();
    const pr = pi >= 0 ? b.rest[pi] ?? new THREE.Vector3() : new THREE.Vector3();
    bone.position.copy(r).sub(pr);
    if (pi >= 0) bones[pi]?.add(bone);
  });
  const root = bones[0];
  if (root === undefined) throw new Error('[anim] NPC rig has no root');
  bindRig(root, [], { skeleton: 'npc.legs.v1', clips: [], sockets: LEG_BONE_NAMES }, { skeleton: 'npc.legs.v1' });
  return bones;
}

/** the pose's inputs (npcModels.ts NpcRig.pose): `walk` 0 … 1 blends the walk in, `phase` its cycle (0 … 1, wraps) */
export interface LegPoseIn { t: number; talk: number; point: number; pointYaw: number; look: number; walk: number; phase: number }

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _tw = new THREE.Quaternion(), _e = new THREE.Euler();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _d = new THREE.Vector3(), _ball = new THREE.Vector3(), _hq = new THREE.Quaternion(), _hp = new THREE.Vector3();
const I = new THREE.Quaternion();
const X_AXIS = new THREE.Vector3(1, 0, 0), Z_AXIS = new THREE.Vector3(0, 0, 1);

/** a foot's planted-point target (hip-relative offsets, × H) and its toe-down pitch at `p` (0 … 1 of its own cycle) */
export function footPlan(p: number): { z: number; y: number; pitch: number; stance: boolean } {
  const s = WALK.stride;
  if (p < WALK.stance) {
    const u = p / WALK.stance;
    return { z: s / 2 - s * u, y: 0, pitch: WALK.heel * smoothstep(0.7, 1, u), stance: true };
  }
  const u = (p - WALK.stance) / (1 - WALK.stance);
  return { z: -s / 2 + s * smoothstep(0, 1, u), y: WALK.lift * Math.sin(Math.PI * u), pitch: WALK.heel * (1 - smoothstep(0, 0.55, u)), stance: false };
}

/** the pose function over `bones` (legBones' order) for `b` */
export function legPose(bones: THREE.Bone[], b: LegBuilt): (i: LegPoseIn) => void {
  const bn = (j: number): THREE.Bone => bones[j] ?? new THREE.Bone();
  const H = b.height, rest = b.rest;
  const r = (j: number): THREE.Vector3 => rest[j] ?? new THREE.Vector3();
  // per side: the arm's twist axis (shoulder → elbow, the shoulder's frame = mesh frame at rest), the leg's lengths and bend axis
  const arms = [J.clR, J.clL].map((cl, k) => {
    const hg = HANG[k] ?? HANG[0];
    return { cl, axis: r(cl + 3).clone().sub(r(cl + 1)).normalize(), hangInv: hg.sh.clone().invert(), hang: hg.sh.clone(), elRestInv: hg.el.clone().invert() };
  });
  const legs = [J.thR, J.thL].map((th, k) => {
    const hip = r(th), knee = r(th + 1), ankle = r(th + 2), ball = b.ball[k] ?? ankle;
    const dir = ankle.clone().sub(hip).normalize();
    return {
      th, hip, l1: knee.distanceTo(hip), l2: ankle.distanceTo(knee), thighV: knee.clone().sub(hip), shinV: ankle.clone().sub(knee),
      bend: new THREE.Vector3().crossVectors(Z_AXIS, dir).normalize(), ball, off: ball.clone().sub(ankle),
    };
  });
  const hips = bn(J.hips), spine = bn(J.spine), chest = bn(J.chest), neck = bn(J.neck), head = bn(J.head);
  const hipsRest = r(J.hips);

  const setArm = (k: number, ex: number, ey: number, ez: number, elbow: number): void => {
    const a = arms[k];
    if (!a) return;
    // A's absolute arm rotation (from the A-pose), measured from the hang B is bound in
    const Q = _q.setFromEuler(_e.set(ex, ey, ez)).multiply(a.hangInv);
    // the clavicle: a forward raise protracts and lifts it (≈ 15 % / 12 % of the raise), plus 30 % of a point's yaw;
    // the hang and a swing back leave it
    const s = k === 0 ? -1 : 1, up = Math.max(0, -ex);
    const C = _q2.setFromEuler(_e.set(0, -s * 0.15 * up + 0.3 * ey, s * 0.12 * up));
    bn(a.cl).quaternion.copy(C);
    // the shoulder: the rest, split swing · twist about the arm, half the twist left to the twist bone
    const S = _q3.copy(C).invert().multiply(Q);
    const dt = S.x * a.axis.x + S.y * a.axis.y + S.z * a.axis.z;
    _tw.set(a.axis.x * dt, a.axis.y * dt, a.axis.z * dt, S.w);
    if (_tw.lengthSq() < 1e-12) _tw.identity(); else _tw.normalize();
    const half = _q.slerpQuaternions(I, _tw, 0.5);
    const swing = S.multiply(_tw.clone().invert());
    bn(a.cl + 1).quaternion.copy(swing).multiply(half);
    bn(a.cl + 2).quaternion.copy(half);
    // the elbow: A's bend, conjugated into the hung frame (hang · bend · rest bend⁻¹ · hang⁻¹)
    bn(a.cl + 3).quaternion.copy(a.hang).multiply(_q2.setFromEuler(_e.set(elbow, 0, 0))).multiply(a.elRestInv).multiply(a.hangInv);
    bn(a.cl + 4).quaternion.identity();
  };

  const bendQ = (axis: THREE.Vector3, angle: number, out: THREE.Quaternion): THREE.Quaternion => out.setFromAxisAngle(axis, angle);

  return (inp) => {
    const { t, talk, point, pointYaw, look } = inp;
    const k = Math.max(0, Math.min(1, inp.walk)), ph = ((inp.phase % 1) + 1) % 1;
    const breathe = Math.sin(t * 1.6), idle = 1 - k;
    const swingR = Math.cos(2 * Math.PI * (ph - 0.05));   // + = the right arm back (the right foot forward at phase 0)
    // the hips: A's weight shift at rest; walking, the compass gait's bob, a little roll to the stance leg and yaw with the stride
    const bob = k * H * (-WALK.sink + WALK.rise * Math.cos(4 * Math.PI * (ph - 0.3)));
    hips.position.set(hipsRest.x, hipsRest.y + bob, hipsRest.z);
    const hipYaw = k * 0.06 * Math.cos(2 * Math.PI * ph), hipRoll = idle * 0.012 * Math.sin(t * 0.35) + k * 0.03 * Math.sin(2 * Math.PI * ph);
    hips.rotation.set(0, hipYaw, hipRoll);
    spine.rotation.set(0.01 * breathe * idle + 0.04 * k, -hipYaw * 0.6, -0.01 * Math.sin(t * 0.35) * idle - hipRoll * 0.7);
    chest.rotation.set(-0.012 * breathe - 0.03 * talk * Math.max(0, Math.sin(t * 2.2)), -hipYaw * 0.9, 0);
    const nod = talk * 0.07 * Math.sin(t * 3.1) * Math.max(0, Math.sin(t * 0.9));
    neck.rotation.set(0.02 + nod * 0.5 - 0.02 * k, look * 0.45, 0);
    head.rotation.set(nod, look * 0.55, 0);
    // the arms: A's poses, plus the walk's counter-swing (the lantern arm swings less)
    const lower = 0.42, gest = talk * (1 - point);
    const g = gest * (0.5 + 0.5 * Math.sin(t * 2.4));
    const swR = k * WALK.arm * swingR * (b.lantern ? 0.45 : 1) * (1 - point), swL = -k * WALK.arm * swingR;
    setArm(1, -0.05 * breathe + swL, 0, -lower * 0.9, -0.12 - 0.05 * talk - k * (0.15 + 0.12 * Math.max(0, -swL / WALK.arm)));
    setArm(0, -0.25 * g - 1.35 * point + swR, -pointYaw * point, lower * (1 - point) * (1 - 0.4 * g), -0.15 - 0.9 * g - 0.1 * point - k * (0.15 + 0.12 * Math.max(0, -swR / WALK.arm)));
    // the legs: two-bone IK toward each foot's planted point, in the hips' frame
    _hq.copy(hips.quaternion); _hp.copy(hips.position);
    const hqInv = _q3.copy(_hq).invert();
    legs.forEach((L, side) => {
      const plan = footPlan(side === 0 ? ph : (ph + 0.5) % 1);
      const pitch = k * plan.pitch;
      _ball.copy(L.ball).add(_v.set(0, k * plan.y * H, k * plan.z * H));
      const ankle = _ball.sub(_v.copy(L.off).applyAxisAngle(X_AXIS, pitch));   // the ankle under the planted ball, the heel lifted by `pitch`
      _d.copy(ankle).sub(_hp).applyQuaternion(hqInv).sub(_v2.copy(L.hip).sub(hipsRest));   // hip → ankle, hips-local
      const reach = L.l1 + L.l2, dl = Math.max(0.3 * reach, Math.min(0.9995 * reach, _d.length()));
      const beta = Math.acos(Math.max(-1, Math.min(1, (L.l1 * L.l1 + dl * dl - L.l2 * L.l2) / (2 * L.l1 * dl))));
      const gamma = Math.PI - Math.acos(Math.max(-1, Math.min(1, (L.l1 * L.l1 + L.l2 * L.l2 - dl * dl) / (2 * L.l1 * L.l2))));
      const thighBend = bendQ(L.bend, -beta, new THREE.Quaternion()), shinQ = bendQ(L.bend, gamma, new THREE.Quaternion());
      const bent = _v.copy(L.shinV).applyQuaternion(shinQ).add(L.thighV).applyQuaternion(thighBend);
      const align = new THREE.Quaternion().setFromUnitVectors(bent.normalize(), _d.normalize());
      const thigh = bn(L.th), shin = bn(L.th + 1), foot = bn(L.th + 2);
      thigh.quaternion.copy(align).multiply(thighBend);
      shin.quaternion.copy(shinQ);
      // the foot: level in mesh space, pitched toe-down by the heel lift
      foot.quaternion.copy(_hq).multiply(thigh.quaternion).multiply(shinQ).invert().multiply(_q2.setFromAxisAngle(X_AXIS, pitch));
    });
  };
}
