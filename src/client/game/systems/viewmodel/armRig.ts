// The first-person arm rig (lab P8 "viewmodel", round 13, E169): the skeleton, the two-bone IK, the wrist limits and
// the joint-angle readout the rig gate measures. Pure three.js maths, no scene: the baker (bake.ts) calls it to turn the
// authored WEAPON paths into bone transforms, and the gate (fpArms.ts `jointAngles`) measures played-back bones with
// the same definitions.
//
// Rig space = camera space at scale 1 (x right, y up, −z forward, metres), the portrait framing of the engine's
// first-person camera (vertical fov = fovForAspect(72°, 402/874) ≈ 94°, Sword.ts). fpArms.layout() fits a root transform
// for any other camera, so the clips never change with the aspect.
//
// Per arm (side +1 right, −1 left):
//   <S>_shoulder   the clavicle end (position animated: breathing, protraction on a strike)
//   <S>_upperarm   +y → the elbow, x = the elbow's hinge axis (lateral)
//   <S>_forearm    +y → the wrist, z = the proximal roll (the hinge frame + the rest pronation)
//   <S>_twist1..3  children of the forearm at 85 / 55 / 22 % of its length, a pure roll about +y carrying 90 / 60 / 25 %
//                  of the pronation change (the radius turning round the ulna): no candy-wrapper, no glove spinning alone
//   <S>_hand       child of the forearm at the wrist; right: the JIAN frame (the grip), left: the GAUNTLET frame
//   R_weapon       child of R_hand: the jian's JIAN-local origin (the guard point)
//   L_claw         child of L_twist1 (the gauntlet shell rides the distal forearm): the Fei Zhua's talons
// Wrist limits (swing-twist about the forearm): pronation / supination ≤ 75° from neutral (thumb up), flexion /
// extension ≤ 60°, radial / ulnar deviation ≤ 25°; a soft clamp (identity to 80 % of a limit, a tanh knee to the
// limit) so a clamp never kinks the motion. When the authored weapon asks for more, the HAND wins and the weapon
// follows it (the hand is locked to the grip).
import { Matrix4, Quaternion, Vector3 } from 'three';

export type Side = 1 | -1;

/** the hand in its owner's local frame (JIAN-local for the right: blender/hand_model.py; GAUNTLET-local for the left) */
export interface HandSpec {
  /** the wrist centre */
  wrist: Vector3;
  /** unit: from the wrist toward the elbow at bind (the glove cuff's / the gauntlet's axis) */
  fore: Vector3;
  /** forearm length, wrist → elbow (m) */
  foreLen: number;
  /** unit: wrist → the MCP knuckle row (the hand's long axis) */
  long: Vector3;
  /** unit: the back of the hand (dorsal) */
  back: Vector3;
}

/** the right hand in JIAN-local: the diagonal jian grip (blender/hand_model.py DiagonalHand, round 13): the back of the
 *  hand toward the eye, the forearm continuing the grip line 3° off it, 23° of modelled ulnar deviation */
export const RIGHT_HAND: HandSpec = {
  wrist: new Vector3(0.0229, -0.2158, 0.0262),
  fore: new Vector3(0.0504, -0.9985, 0.0202).normalize(),
  foreLen: 0.3,
  long: new Vector3(0.2248, 0.9272, -0.2997).normalize(),
  back: new Vector3(0.8, 0, 0.6),
};

/** the Fei Zhua assets were modelled 1.2× a human forearm: the bake scales the whole left arm by this (about the hub) */
export const LEFT_SCALE = 0.82;

/** the left fist + gauntlet in GAUNTLET-local, after LEFT_SCALE (+y elbow → claw hub at the origin, +z the back of the forearm) */
export const LEFT_HAND: HandSpec = {
  wrist: new Vector3(0, -0.085, -0.036).multiplyScalar(LEFT_SCALE),
  fore: new Vector3(0, -1, 0),
  foreLen: 0.36 * LEFT_SCALE,
  long: new Vector3(0, 1, 0),
  back: new Vector3(0, 0, 1),
};

/** the grip centre in JIAN-local: where the moves pivot and the hand's offset is measured */
export const GRIP: Vector3 = new Vector3(0, -0.16, 0);

/** wrist limits (degrees): pronation + / supination −, extension + / flexion −, radial + / ulnar − (a jian grip lives
 *  in ulnar deviation, whose anatomical range is ~30–35°; radial is ~20°) */
export const LIMITS = { pronation: [-75, 75], flexion: [-60, 60], deviation: [-32, 22] } as const;
const D2R = Math.PI / 180;

/** twist bones: position along the forearm (share of its length from the elbow) and the share of the roll they carry */
export const TWISTS = [{ at: 0.85, share: 0.9 }, { at: 0.55, share: 0.6 }, { at: 0.22, share: 0.25 }] as const;

export const BONES = {
  right: ['R_shoulder', 'R_upperarm', 'R_forearm', 'R_twist1', 'R_twist2', 'R_twist3', 'R_hand', 'R_weapon'],
  left: ['L_shoulder', 'L_upperarm', 'L_forearm', 'L_twist1', 'L_twist2', 'L_twist3', 'L_hand', 'L_claw'],
} as const;

export interface Pose { pos: Vector3; quat: Quaternion }

/** world (rig-space) transforms of one arm's bones, in BONES order */
export interface ArmWorld {
  shoulder: Matrix4; upper: Matrix4; fore: Matrix4; twists: [Matrix4, Matrix4, Matrix4]; hand: Matrix4; tip: Matrix4;
  /** the solved points */
  S: Vector3; E: Vector3; W: Vector3;
  /** the joint angles after the clamp (degrees) and how much the clamp moved the hand (degrees) */
  angles: JointAngles;
  clamped: number;
}

interface JointAngles {
  /** elbow flexion (0 = straight) */
  elbow: number;
  /** + pronation / − supination from neutral (thumb up) */
  pronation: number;
  /** + extension / − flexion */
  flexion: number;
  /** + radial / − ulnar */
  deviation: number;
}

const tmpA = new Vector3(), tmpB = new Vector3(), tmpC = new Vector3();

/** signed angle from a to b about axis n (all ⟂ n not required: projected) in radians */
export function signedAngle(a: Vector3, b: Vector3, n: Vector3): number {
  const pa = tmpA.copy(a).addScaledVector(n, -a.dot(n));
  const pb = tmpB.copy(b).addScaledVector(n, -b.dot(n));
  const x = pa.dot(pb);
  const y = tmpC.crossVectors(pa, pb).dot(n);
  return Math.atan2(y, x);
}

/** a rotation whose +y is `y` and whose +z leans toward `z` */
export function frameYZ(y: Vector3, z: Vector3): Quaternion {
  const Y = y.clone().normalize();
  const Z = z.clone().addScaledVector(Y, -z.dot(Y));
  if (Z.lengthSq() < 1e-10) Z.set(Math.abs(Y.x) < 0.9 ? 1 : 0, 0, Math.abs(Y.x) < 0.9 ? 0 : 1).addScaledVector(Y, -(Math.abs(Y.x) < 0.9 ? Y.x : Y.z));
  Z.normalize();
  const X = new Vector3().crossVectors(Y, Z);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(X, Y, Z));
}

/** soft limit: identity to 80 % of the bound on each side, a tanh knee up to the bound */
export function softLimit(x: number, lo: number, hi: number): number {
  const L = x >= 0 ? hi : -lo;
  const k = 0.8 * L, a = Math.abs(x);
  if (a <= k) return x;
  return Math.sign(x) * (k + (L - k) * Math.tanh((a - k) / (L - k)));
}

/** two-bone IK: shoulder S, target W (moved into reach), pole P → elbow E (and the W it reached) */
export function twoBone(S: Vector3, W: Vector3, P: Vector3, Lu: number, Lf: number): { E: Vector3; W: Vector3 } {
  const d0 = W.distanceTo(S);
  const dMax = (Lu + Lf) * 0.985, dMin = Math.abs(Lu - Lf) + 0.25 * Math.min(Lu, Lf);
  // soft reach: a tanh knee over the last 10 % (a hard clamp would kink the motion as it engages)
  const k = dMax * 0.9;
  let d = d0 > k ? k + (dMax - k) * Math.tanh((d0 - k) / (dMax - k)) : d0;
  d = Math.max(dMin, d);
  const axis = W.clone().sub(S).normalize();
  const Wr = S.clone().addScaledVector(axis, d);
  const a = (Lu * Lu - Lf * Lf + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, Lu * Lu - a * a));
  const C = S.clone().addScaledVector(axis, a);
  const pd = P.clone().sub(C);
  pd.addScaledVector(axis, -pd.dot(axis));
  if (pd.lengthSq() < 1e-10) pd.set(0, -1, 0).addScaledVector(axis, axis.y);
  pd.normalize();
  return { E: C.addScaledVector(pd, h), W: Wr };
}

/**
 * The anatomical frames at the wrist, from the solved points and the hand's orientation:
 * yF = wrist → elbow, zN = the neutral dorsal (lateral, from the elbow hinge), zD = the hand's dorsal ⟂ yF.
 */
function wristFrames(side: Side, S: Vector3, E: Vector3, W: Vector3, handQ: Quaternion, spec: HandSpec): { yF: Vector3; zN: Vector3; zD: Vector3; hinge: Vector3; long: Vector3 } {
  const upper = E.clone().sub(S).normalize();
  const fore = W.clone().sub(E).normalize();
  const yF = fore.clone().negate();
  const hinge = new Vector3().crossVectors(upper, fore);
  if (hinge.lengthSq() < 1e-8) hinge.set(side, 0, 0);
  hinge.normalize();
  const zN = hinge.clone().multiplyScalar(side);
  zN.addScaledVector(yF, -zN.dot(yF)).normalize();
  const back = spec.back.clone().applyQuaternion(handQ);
  const zD = back.addScaledVector(yF, -back.dot(yF)).normalize();
  const long = spec.long.clone().applyQuaternion(handQ);
  return { yF, zN, zD, hinge, long };
}

/** the joint angles of an arm from its points and the hand's orientation (degrees) */
export function measure(side: Side, S: Vector3, E: Vector3, W: Vector3, handQ: Quaternion, spec: HandSpec): JointAngles {
  const { yF, zN, zD, long } = wristFrames(side, S, E, W, handQ, spec);
  const upper = E.clone().sub(S).normalize();
  const fore = W.clone().sub(E).normalize();
  const elbow = Math.acos(Math.min(1, Math.max(-1, upper.dot(fore)))) / D2R;
  const pronation = side * signedAngle(zN, zD, yF) / D2R;
  const xR = new Vector3().crossVectors(yF, zD).multiplyScalar(side);
  const fwd = yF.clone().negate();
  const my = long.dot(fwd), mz = long.dot(zD), mx = long.dot(xR);
  return { elbow, pronation, flexion: Math.atan2(mz, my) / D2R, deviation: Math.atan2(mx, my) / D2R };
}

/** the hand's orientation clamped to the wrist limits (returns the new quaternion and the correction angle) */
function clampHand(side: Side, S: Vector3, E: Vector3, W: Vector3, handQ: Quaternion, spec: HandSpec): { q: Quaternion; moved: number } {
  const a = measure(side, S, E, W, handQ, spec);
  const pr = softLimit(a.pronation, LIMITS.pronation[0], LIMITS.pronation[1]);
  const fl = softLimit(a.flexion, LIMITS.flexion[0], LIMITS.flexion[1]);
  const dv = softLimit(a.deviation, LIMITS.deviation[0], LIMITS.deviation[1]);
  if (pr === a.pronation && fl === a.flexion && dv === a.deviation) return { q: handQ.clone(), moved: 0 };
  const { yF, zD, long } = wristFrames(side, S, E, W, handQ, spec);
  const xR = new Vector3().crossVectors(yF, zD).multiplyScalar(side);
  const fwd = yF.clone().negate();
  // swing: bring the long axis to the clamped flexion / deviation
  const want = fwd.clone().addScaledVector(xR, Math.tan(dv * D2R)).addScaledVector(zD, Math.tan(fl * D2R)).normalize();
  const q = new Quaternion().setFromUnitVectors(long.clone().normalize(), want).multiply(handQ);
  // twist: turn the hand about the forearm by the pronation excess
  q.premultiply(new Quaternion().setFromAxisAngle(yF, side * (pr - a.pronation) * D2R));
  return { q, moved: 2 * Math.acos(Math.min(1, Math.abs(q.dot(handQ)))) / D2R };
}

/** one arm's constant measures (set at the rest pose) */
export interface ArmConst {
  side: Side;
  spec: HandSpec;
  /** upper arm length (m), from the rest shoulder to the rest elbow */
  Lu: number;
  /** the rest pronation (deg): the proximal forearm roll holds it relative to the hinge */
  restPronation: number;
  /** a bias added to the IK pole (rig space): the elbow's preferred side */
  poleBias: Vector3;
}

/** where the elbow wants to be: behind the wrist along the hand's forearm axis, plus a bias */
function pole(W: Vector3, handQ: Quaternion, c: ArmConst): Vector3 {
  return W.clone().addScaledVector(c.spec.fore.clone().applyQuaternion(handQ), c.spec.foreLen).add(c.poleBias);
}

/**
 * Solve one arm. `owner` = the authored pose of the hand's owner frame (right: the jian, JIAN-local → rig; left: the
 * gauntlet, GAUNTLET-local → rig), `S` = the shoulder. Returns the bone world transforms; the owner frame the hand
 * really reached is `hand` × T(−wrist) (the weapon / gauntlet follows the clamped hand).
 */
export function solveArm(c: ArmConst, owner: Pose, S: Vector3): ArmWorld {
  const spec = c.spec;
  let handQ = owner.quat.clone();
  let W = owner.pos.clone().add(spec.wrist.clone().applyQuaternion(handQ));
  let E = new Vector3();
  let moved = 0;
  if (c.side === -1) {
    // the left: the authored frame is the forearm's; the fist hangs straight off it. Solve, then turn the frame onto the
    // solved forearm (shortest arc) so the gauntlet rides the arm the IK found
    const r = twoBone(S, W, pole(W, handQ, c), c.Lu, spec.foreLen);
    E = r.E;
    W = r.W;
    const want = W.clone().sub(E).normalize();
    const have = spec.fore.clone().negate().applyQuaternion(handQ);
    handQ = new Quaternion().setFromUnitVectors(have, want).multiply(handQ);
    const cl = clampHand(c.side, S, E, W, handQ, spec);
    handQ = cl.q;
    moved = cl.moved;
  } else {
    for (let pass = 0; pass < 3; pass++) {
      const r = twoBone(S, W, pole(W, handQ, c), c.Lu, spec.foreLen);
      E = r.E;
      W = r.W;
      const cl = clampHand(c.side, S, E, W, handQ, spec);
      moved += cl.moved;
      handQ = cl.q;
      if (cl.moved < 0.05) break;
    }
  }
  return buildBones(c, S, E, W, handQ, moved);
}

/** the bone world transforms from solved points and the (clamped) hand orientation */
export function buildBones(c: ArmConst, S: Vector3, E: Vector3, W: Vector3, handQ: Quaternion, moved: number): ArmWorld {
  const spec = c.spec;
  const { yF, zN, zD, hinge } = wristFrames(c.side, S, E, W, handQ, spec);
  // the proximal roll: the neutral (hinge) dorsal turned by the rest pronation; the twists interpolate to the hand's
  const zP = zN.clone().applyAxisAngle(yF, c.side * c.restPronation * D2R);
  const delta = signedAngle(zP, zD, yF);
  const lateral = hinge.clone().multiplyScalar(c.side);
  const upperQ = frameYZ(E.clone().sub(S), new Vector3().crossVectors(lateral, E.clone().sub(S)));
  const foreY = W.clone().sub(E).normalize();
  const foreQ = frameYZ(foreY, zP);
  const m = (p: Vector3, q: Quaternion): Matrix4 => new Matrix4().compose(p, q, new Vector3(1, 1, 1));
  const twists: Matrix4[] = TWISTS.map((t) => {
    const p = E.clone().addScaledVector(foreY, spec.foreLen * t.at);
    const q = new Quaternion().setFromAxisAngle(yF, t.share * delta).multiply(foreQ);
    return m(p, q);
  });
  const hand = m(W, handQ);
  // right: the weapon origin (JIAN-local 0) · left: the claw hub (GAUNTLET-local 0), both at hand × T(−wrist)
  const tip = hand.clone().multiply(new Matrix4().makeTranslation(-spec.wrist.x, -spec.wrist.y, -spec.wrist.z));
  const angles = measure(c.side, S, E, W, handQ, spec);
  return {
    shoulder: m(S, new Quaternion()), upper: m(S, upperQ), fore: m(E, foreQ),
    twists: [twists[0] ?? new Matrix4(), twists[1] ?? new Matrix4(), twists[2] ?? new Matrix4()],
    hand, tip, S: S.clone(), E: E.clone(), W: W.clone(), angles, clamped: moved,
  };
}

/**
 * An arm's constants from its rest owner pose and shoulder: the upper arm length is anatomical (`Lu`), the rest elbow is
 * where the IK puts it (pole: behind the wrist along the hand's forearm axis), and the rest pronation is measured there.
 */
export function armConst(side: Side, spec: HandSpec, rest: Pose, S: Vector3, Lu: number, poleBias: Vector3): ArmConst {
  const c: ArmConst = { side, spec, Lu, restPronation: 0, poleBias };
  const W = rest.pos.clone().add(spec.wrist.clone().applyQuaternion(rest.quat));
  const r = twoBone(S, W, pole(W, rest.quat, c), Lu, spec.foreLen);
  c.restPronation = measure(side, S, r.E, r.W, rest.quat, spec).pronation;
  return c;
}
