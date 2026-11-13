/**
 * REMOTE-PLAYERS RP4 (Jake, 2026-11-12 17:43: "I need to see them walking, and I need walking animation"): the castaway body's
 * walk and run, as another player sees them, from how fast that player's row moves. The castaway rig's `walk` and `run` slots
 * are procedural (castawayBody.ts `CASTAWAY_BAKE`): these are those clips, posed in code so they can lock to the ground.
 *
 * A stride is one cycle of both legs, `stride` metres long. Each foot is on the ground for `stance` of it and moves back under
 * the hip at exactly the body's speed (no foot slide), then swings forward on an arc. The legs are solved to their feet (two
 * bones, the knee always ahead of the line from hip to ankle, so a knee folds the way a knee folds), the hips dip at each
 * footfall as low as a planted foot needs, the arms swing against the legs, the elbows bend and the spine leans into a run.
 * Speed blends it all: standing to striding over 0.1 to 0.7 m/s, walk to run over 4 to 6 m/s, so nothing snaps at the 0.4
 * and 5 m/s the label changes at.
 *
 *   const mix = gaitMix(speed);                        // the blend at this speed
 *   phase = (phase + speed * dt / mix.stride) % 1;     // the cadence, matched to speed
 *   stridePose(phase, mix, pose);                      // pose.bends[joint] about each bone's +x (forward), pose.drop the hips'
 */
import type { DummyJoint } from '../practice/TrainingDummy';

export type Gait = 'idle' | 'walk' | 'run';
/** Over this a row's body is walking, and over this it runs, in m/s (a walk is 4.3 and a sprint 7.2, player/walk.ts). */
export const WALKS = 0.4, RUNS = 5;
/** The clip a speed plays. */
export function gaitOf(speed: number): Gait { return speed < WALKS ? 'idle' : speed < RUNS ? 'walk' : 'run'; }

/** The castaway's leg in its own side view (castawayBody.ts `boneSpecs`): the hip over the soles, the bones' lengths, the
 *  ankle's height at rest, and how far each bone leans forward from straight down at rest. */
const HIP = 0.93, THIGH = Math.hypot(0.43, 0.01), SHIN = Math.hypot(0.42, 0.02), ANKLE = 0.08;
const THIGH_REST = Math.atan2(0.01, 0.43), SHIN_REST = Math.atan2(-0.02, 0.42), REACH = (THIGH + SHIN) * 0.999;

/** Each clip's shape: how low the hips ride at most, how high a swinging foot lifts, the arms' swing and the elbows' bend, and
 *  the spine's lean, in metres and radians. A run's hips also rise this far in the air between footfalls. */
interface Shape { readonly crouch: number; readonly lift: number; readonly arms: number; readonly elbows: number; readonly lean: number }
const WALK: Shape = { crouch: 0.03, lift: 0.09, arms: 0.5, elbows: 0.3, lean: 0.05 };
const RUN: Shape = { crouch: 0.07, lift: 0.26, arms: 0.85, elbows: 1.25, lean: 0.22 };
const FLIGHT = 0.04;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (from: number, to: number, x: number): number => { const t = clamp01((x - from) / (to - from)); return t * t * (3 - 2 * t); };

/** The blend at a speed: `move` from standing (0) to striding (1), `run` from walk (0) to run (1), the stride's length and the
 *  share of it each foot is down. */
export interface GaitMix { readonly move: number; readonly run: number; readonly stride: number; readonly stance: number }
export function gaitMix(speed: number): GaitMix {
  const v = Math.max(0, speed), run = smooth(RUNS - 1, RUNS + 1, v);
  // Longer strides as the body goes faster (a 4.3 m/s walk is a brisk 2 strides a second); a walk keeps a foot down 60 % of the
  // time when slow, less as it hurries, and a run 30 %, the rest in the air.
  return { move: smooth(0.1, 0.7, v), run, stride: Math.min(3.2, 0.9 + 0.3 * v), stance: lerp(lerp(0.6, 0.4, smooth(1.5, 3.5, v)), 0.3, run) };
}

/** The joints a stride moves. */
export type StrideJoint = Extract<DummyJoint, 'leftThigh' | 'leftShin' | 'rightThigh' | 'rightShin' | 'leftUpperArm' | 'rightUpperArm' | 'leftForeArm' | 'rightForeArm' | 'spine'>;
export const STRIDE_JOINTS: readonly StrideJoint[] = ['leftThigh', 'leftShin', 'rightThigh', 'rightShin', 'leftUpperArm', 'rightUpperArm', 'leftForeArm', 'rightForeArm', 'spine'];
/** A pose: each joint's turn from rest about its own +x (positive swings a limb forward and leans the spine forward), and how
 *  far the hips sit under their rest height. */
export interface StridePose { readonly bends: Record<StrideJoint, number>; drop: number }
export function stridePoseAtRest(): StridePose {
  return { bends: Object.fromEntries(STRIDE_JOINTS.map(joint => [joint, 0])) as Record<StrideJoint, number>, drop: 0 };
}

/** How high the hips can be over a planted ankle `z` forward of them. */
const reachFrom = (z: number): number => ANKLE + Math.sqrt(Math.max(0, REACH * REACH - z * z));

/** The thigh's and shin's lean forward from straight down that put the ankle at (z, y) from a hip at `hip`, the knee ahead,
 *  into `out` [thigh, shin]. */
function solve(hip: number, z: number, y: number, out: number[]): void {
  const down = hip - y, d = Math.min(REACH, Math.max(0.2, Math.hypot(z, down))), toward = Math.atan2(z, down);
  const atHip = Math.acos(clamp01((THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d)));
  const atKnee = Math.acos(Math.max(-1, Math.min(1, (THIGH * THIGH + SHIN * SHIN - d * d) / (2 * THIGH * SHIN))));
  out[0] = toward + atHip; out[1] = out[0] - (Math.PI - atKnee);
}

/** Each leg, half a stride apart, and the arm (the other side's) that swings with it. */
const LEGS = [
  { thigh: 'leftThigh', shin: 'leftShin', arm: 'rightUpperArm', elbow: 'rightForeArm', offset: 0 },
  { thigh: 'rightThigh', shin: 'rightShin', arm: 'leftUpperArm', elbow: 'leftForeArm', offset: 0.5 },
] as const;
const ankles = [0, 0, 0, 0], leg = [0, 0];

/** Pose a stride `phase` (0 to 1, the left foot coming down at 0, the right at 0.5) of the blend `mix` into `out`. */
export function stridePose(phase: number, mix: GaitMix, out: StridePose): StridePose {
  const { bends } = out, { move, run, stride, stance } = mix;
  if (move <= 0) { for (const joint of STRIDE_JOINTS) bends[joint] = 0; out.drop = 0; return out; }
  // Starting to move, the feet step out from under the hips (the targets grow with `move`) and the pose eases off rest.
  const reach = (stance * stride * move) / 2, lift = lerp(WALK.lift, RUN.lift, run) * move, top = HIP - lerp(WALK.crouch, RUN.crouch, run) * move;
  const fade = Math.min(1, move * 3), arms = lerp(WALK.arms, RUN.arms, run) * move, elbows = lerp(WALK.elbows, RUN.elbows, run) * move;
  // Each ankle: a planted foot goes back under the hip at the body's speed, a lifted one swings forward on an arc. The hips ride
  // as high as every planted foot still reaches the ground, so it stays put; in a run's flight they rise on a small arc.
  let hip = top, flying = true;
  for (const [at, { offset }] of LEGS.entries()) {
    const p = (phase + offset) % 1;
    if (p < stance) {
      const z = reach * (1 - (2 * p) / stance);
      ankles[at * 2] = z; ankles[at * 2 + 1] = ANKLE; hip = Math.min(hip, reachFrom(z)); flying = false;
    } else {
      const u = (p - stance) / (1 - stance);
      ankles[at * 2] = -reach * Math.cos(Math.PI * u); ankles[at * 2 + 1] = ANKLE + lift * Math.sin(Math.PI * u);
    }
  }
  if (flying) hip = Math.min(top, reachFrom(reach)) + FLIGHT * run * move * Math.sin((Math.PI * ((phase % 0.5) - stance)) / (0.5 - stance));
  for (const [at, side] of LEGS.entries()) {
    const z = ankles[at * 2] ?? 0;
    solve(hip, z, ankles[at * 2 + 1] ?? ANKLE, leg);
    const thigh = leg[0] ?? 0, shin = leg[1] ?? 0;
    bends[side.thigh] = (thigh - THIGH_REST) * fade;
    bends[side.shin] = (shin - thigh - (SHIN_REST - THIGH_REST)) * fade;
    // the other side's arm swings with this leg, so each arm swings against its own side's leg
    bends[side.arm] = (reach > 1e-6 ? z / reach : 0) * arms;
    bends[side.elbow] = elbows;
  }
  bends.spine = lerp(WALK.lean, RUN.lean, run) * move;
  out.drop = (HIP - hip) * fade;
  return out;
}
