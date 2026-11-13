/**
 * REMOTE-PLAYERS RP7 (Jake, 2026-11-12: "I need to see attack animation"): another player's swing, as this page sees it. The
 * player row's `swing` (RP6) counts every swing, shot or strike its player starts (a u8 that wraps, not saved), and `heavy`
 * says whether that swing was the heavy. A change of the count plays a strike on the body's right arm and spine with the item
 * in its hand, on the first-person sword's own timings (`STARTER_MELEE_PROFILE`, which SweptMelee.ts swings by): a tap, a
 * slash across the body, or a heavy, a chop from over the head, the wider arc. With a bow in the hand (the left, RP5) it is a
 * draw and a loose instead, both arms and the spine. The castaway rig's `attack` slot (castawayBody.ts) is this, procedural.
 *
 * It layers after the gait (remoteGait.ts) and any air pose (RP9): the gait has set every joint for this frame, and the strike
 * overrides only the arms and spine while it plays, blending in from where they were and back to the gait after. The legs are
 * the gait's. The first count a page sees is where it starts, not a swing; a missing count (an older server) is no data.
 *
 *   const strike = new RemoteStrike();
 *   strike.show(row, free, dt, joints, rest);   // each frame, after the gait's pose
 *   strike.playing                              // 'tap' | 'heavy' | 'draw', or '' between swings
 */
import * as THREE from 'three';
import { PLAYER_CLASS } from '../../../shared/engine/net/netSchemas';
import type { DummyJoint, DummyJoints } from '../practice/TrainingDummy';

export type Strike = 'tap' | 'heavy' | 'draw';

const column = (name: string): number => PLAYER_CLASS.row.findIndex(entry => entry.name === name);
const SWING = column('swing'), HEAVY = column('heavy');

/** Whether a row's swing count says a new swing: any change of it, after the first value seen, which is where it starts. */
export class SwingCount {
  private last: number | null = null;
  /** This frame's count; true when it is a new swing. A missing one (NaN, an older server) is no data and keeps the last. */
  see(count: number): boolean {
    if (!Number.isFinite(count)) return false;
    const was = this.last;
    this.last = count;
    return was !== null && count !== was;
  }
}

/** The joints a strike moves. */
type StrikeJoint = Extract<DummyJoint, 'rightUpperArm' | 'rightForeArm' | 'leftUpperArm' | 'leftForeArm' | 'spine'>;
/** A pose, from each joint's rest: an upper arm raised forward (`raise`, about its own +x) then swept about the vertical
 *  (`sweep`: + toward the body's right, - toward its left, the castaway's arms both having their +x to the world's -x); an
 *  elbow bent forward; the spine leaning forward (`lean`) and turned (`twist`: + to its left). */
interface Pose {
  readonly right: readonly [raise: number, sweep: number]; readonly rightElbow: number;
  readonly left?: readonly [raise: number, sweep: number]; readonly leftElbow?: number;
  readonly spine: readonly [lean: number, twist: number];
}
/** A strike: its poses at their times from its start (the first is where the windup reaches), and how long it takes to give
 *  the arms back to the gait after its last. */
interface Clip { readonly keys: readonly (readonly [time: number, pose: Pose])[]; readonly back: number }

/**
 * The tap and the heavy on the first-person sword's clock (shared/game/weapons/starterCombat.ts `STARTER_MELEE_PROFILE`, the
 * combo's first slash and the heavy): windup 0.07 s, the slash to 0.235 s, done at 0.35 s; the heavy's windup 0.06 s, its chop
 * to 0.30 s, done at 0.62 s. The count arrives as the swing starts: a heavy's charge is not on the wire, so its windup is the
 * snap up from wherever the arm was. The bow's loose is the shot (the count): a 0.2 s draw stands in for the draw no one sent,
 * then the string hand flies back and the arms hold to the next nock (shared/engine/combat/bowDraw.ts RENOCK_TIME 0.62 s).
 */
const CLIPS: Readonly<Record<Strike, Clip>> = {
  tap: { back: 0.2, keys: [
    [0.07, { right: [1.0, 0.9], rightElbow: 0.9, spine: [0.05, -0.35] }],
    [0.235, { right: [1.25, -0.75], rightElbow: 0.15, spine: [0.12, 0.35] }],
    [0.35, { right: [1.0, -0.85], rightElbow: 0.4, spine: [0.08, 0.3] }],
  ] },
  heavy: { back: 0.25, keys: [
    [0.06, { right: [2.9, 0.25], rightElbow: 1.4, spine: [-0.2, -0.15] }],
    [0.3, { right: [0.45, -0.2], rightElbow: 0.1, spine: [0.5, 0.15] }],
    [0.62, { right: [0.55, -0.15], rightElbow: 0.3, spine: [0.4, 0.1] }],
  ] },
  draw: { back: 0.25, keys: [
    [0.2, { left: [1.5, -0.3], leftElbow: 0.05, right: [1.5, -0.35], rightElbow: 2.4, spine: [0, -0.3] }],
    [0.28, { left: [1.5, -0.3], leftElbow: 0.05, right: [1.45, 0.1], rightElbow: 1.6, spine: [0, -0.3] }],
    [0.62, { left: [1.4, -0.3], leftElbow: 0.15, right: [1.3, 0.05], rightElbow: 1.5, spine: [0, -0.25] }],
  ] },
};
const STRIKE_JOINTS: readonly StrikeJoint[] = ['rightUpperArm', 'rightForeArm', 'leftUpperArm', 'leftForeArm', 'spine'];

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const ease = (x: number): number => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);
const about = new THREE.Quaternion(), swept = new THREE.Quaternion(), target = new THREE.Quaternion();

/** The pose `t` seconds into a clip, past its windup (before the first key it is the first key). */
function poseAt(clip: Clip, t: number): Pose {
  const { keys } = clip;
  for (let at = 1; at < keys.length; at++) {
    const [to, next] = keys[at] as readonly [number, Pose], [from, was] = keys[at - 1] as readonly [number, Pose];
    if (t > to) continue;
    const k = ease((t - from) / (to - from)), pair = (a: readonly [number, number], b: readonly [number, number]): [number, number] => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
    return { right: pair(was.right, next.right), rightElbow: lerp(was.rightElbow, next.rightElbow, k), spine: pair(was.spine, next.spine),
      ...(was.left === undefined || next.left === undefined ? {} : { left: pair(was.left, next.left), leftElbow: lerp(was.leftElbow ?? 0, next.leftElbow ?? 0, k) }) };
  }
  return (keys.at(-1) as readonly [number, Pose])[1];
}
/** A joint's turn in a pose, from its rest, or null where the pose leaves it to the gait. */
function turnOf(pose: Pose, joint: StrikeJoint, out: THREE.Quaternion): THREE.Quaternion | null {
  const swing = (raise: number, sweep: number): THREE.Quaternion => out.copy(swept.setFromAxisAngle(Y, sweep)).multiply(about.setFromAxisAngle(X, raise));
  switch (joint) {
    case 'rightUpperArm': return swing(pose.right[0], pose.right[1]);
    case 'rightForeArm': return out.setFromAxisAngle(X, pose.rightElbow);
    case 'leftUpperArm': return pose.left === undefined ? null : swing(pose.left[0], pose.left[1]);
    case 'leftForeArm': return pose.leftElbow === undefined ? null : out.setFromAxisAngle(X, pose.leftElbow);
    case 'spine': return out.copy(swept.setFromAxisAngle(Y, pose.spine[1])).multiply(about.setFromAxisAngle(X, pose.spine[0]));
    default: return null;
  }
}

/** How fast strikes play on this page: 1, or 0 to hold every strike where it is while a proof shoots it (scripts/
 *  remote-strike-proof.mjs sets it on the page under this key, as othersOnMap.ts keeps its state). */
const PACE = Symbol.for('wildshard.remoteStrike.pace');
const pace = (): number => { const set = (globalThis as { [PACE]?: unknown })[PACE]; return typeof set === 'number' && Number.isFinite(set) && set >= 0 ? set : 1; };

/** One body's strikes: the count it watches, the strike playing and how far in, and where its arms were when it started. */
export class RemoteStrike {
  private readonly count = new SwingCount();
  private kind: Strike | null = null;
  private t = 0;
  /** Where each joint was as a strike restarted over another, which the new windup blends from; empty for the live gait. */
  private readonly from = new Map<StrikeJoint, THREE.Quaternion>();
  /** What the strike last set each joint to: the gait rewrites the bones every frame before a strike's turn, so a restart
   *  reads where the arms were here, never from the bones. */
  private readonly wrote = new Map<StrikeJoint, THREE.Quaternion>();
  private readonly turn = new THREE.Quaternion();
  /** The strike playing, or '' (what `__onlinePlayers()` reports as `attack`). */
  get playing(): Strike | '' { return this.kind ?? ''; }
  /**
   * This frame of a body, after its gait: a new count starts a strike (a draw with a bow in the left hand, else the heavy bit
   * picks tap or heavy), and a playing one poses the arms and spine over what the gait set. `free` is false on a board, in a
   * saddle or swimming, where the hands hold nothing (RP5): a swing there still counts but plays nothing.
   */
  show(row: Float64Array, free: boolean, dt: number, joints: DummyJoints, rest: ReadonlyMap<DummyJoint, THREE.Quaternion>): void {
    const swung = this.count.see(SWING === -1 ? Number.NaN : row[SWING] ?? Number.NaN);
    if (!free) { this.kind = null; this.from.clear(); this.wrote.clear(); return; }
    if (swung) {
      this.from.clear();
      if (this.kind !== null) for (const [joint, at] of this.wrote) this.from.set(joint, at.clone());
      this.wrote.clear();
      // RP5 hangs a bow in the left hand's mount, every other item in the right's
      this.kind = joints.leftHand?.getObjectByName('HeldItem') !== undefined ? 'draw' : row[HEAVY] === 1 ? 'heavy' : 'tap';
      this.t = 0;
    } else if (this.kind !== null) this.t += dt * pace();
    const { kind, t } = this;
    if (kind === null) return;
    const clip = CLIPS[kind], [windup] = clip.keys[0] ?? [0], end = (clip.keys.at(-1) ?? [0])[0];
    if (t >= end + clip.back) { this.kind = null; this.from.clear(); this.wrote.clear(); return; }
    const pose = poseAt(clip, t), into = windup > 0 ? ease(t / windup) : 1, out = t > end ? 1 - ease((t - end) / clip.back) : 1;
    for (const joint of STRIKE_JOINTS) {
      const bone = joints[joint], still = rest.get(joint), turn = turnOf(pose, joint, this.turn);
      if (bone === undefined || still === undefined || turn === null) continue;
      target.copy(still).multiply(turn);
      // in: from where the joint was (the gait's, or the last strike's) to the windup; out: back to the gait
      const from = this.from.get(joint);
      if (into < 1) bone.quaternion.copy(from ?? bone.quaternion).slerp(target, into);
      else bone.quaternion.slerp(target, out);
      const wrote = this.wrote.get(joint);
      if (wrote === undefined) this.wrote.set(joint, bone.quaternion.clone()); else wrote.copy(bone.quaternion);
    }
  }
}
