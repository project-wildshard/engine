/**
 * REMOTE-PLAYERS RP9 (Jake, 2026-11-12 17:43: "I need to see them walking ... everything, right? Like, it's an MMO"): another
 * player's jump and fall, layered over the walk and run (remoteGait.ts) and under a strike (remoteStrike.ts).
 *
 * The row's `air` bit (RP6) says the player is off the ground under his own motion (not swimming, carried, stunned or on a
 * deck); the row's height, frame to frame, gives his vertical speed. Going up the legs tuck; coming down the arms go out and
 * the legs reach for the ground, the two blended by that speed so the top of a jump turns over smoothly. When `air` goes false
 * the hips dip into a squat for a moment, as deep and as long as the last downward speed asks, and come back up. The air pose
 * eases in and out (`weight`), so nothing snaps. No `air` value (an older server, or a column this build lacks) is no data:
 * nothing is drawn. A board rider or a mounted one is posed by RP8 and left alone.
 *
 *   air.update(row.air, row.y, dt, riding || mounted);   // once a frame, before the pose
 *   air.layer(stridePose(phase, mix, pose));             // over the gait: its bends and its hips' drop
 *   air.spreadArms(joints);                              // after the bends: the arms out to the side
 */
import * as THREE from 'three';
import type { DummyJoints } from '../practice/TrainingDummy';
import { STRIDE_JOINTS, type StrideJoint, type StridePose } from './remoteGait';

/** What the body is doing in the air, as `__onlinePlayers()` reports it: '' on the ground. */
export type AirPhase = '' | 'jump' | 'fall' | 'land';

/** Each joint's turn about its own +x (forward) on the way up and on the way down, radians, as remoteGait's bends. */
type Bends = Readonly<Record<StrideJoint, number>>;
const TUCK: Bends = { leftThigh: 1.3, rightThigh: 1.05, leftShin: -2, rightShin: -1.7, leftUpperArm: 0.55, rightUpperArm: 0.4, leftForeArm: 1, rightForeArm: 0.9, spine: 0.22 };
const REACH: Bends = { leftThigh: 0.25, rightThigh: -0.05, leftShin: -0.35, rightShin: -0.15, leftUpperArm: 0.3, rightUpperArm: 0.3, leftForeArm: 0.35, rightForeArm: 0.35, spine: -0.06 };
/** How far the arms go out to the side, tucked and falling, radians. */
const SPREAD_TUCK = 0.2, SPREAD_FALL = 1.2;
/** The air pose comes and goes at this rate (per second), and vertical speed settles at this one. */
const EASE = 12, SETTLE = 20;
/** Faster than this the row jumped, not moved (a respawn or a teleport), m/s. */
const TELEPORT = 40;
/** Under this downward speed, or this short a time off the ground (a slope's or a step's tick or two), a landing is a step,
 *  with no dip: m/s and seconds. */
const SOFT = 1.5, HOP = 0.1;
/** Thigh plus shin, metres (castawayBody.ts): a squat that folds each by `a` sinks the hips about LEG × (1 − cos a). */
const LEG = 0.85;

/** How long a landing dips, seconds, after coming down at `fall` m/s: a jump's landing (about 7 m/s) a third of a second. */
export const LAND_TIME = (fall: number): number => Math.min(0.45, 0.18 + 0.02 * Math.max(0, fall));
/** How deep the hips sink at the bottom of the dip, metres. */
export const LAND_DEPTH = (fall: number): number => Math.min(0.2, 0.012 * Math.max(0, fall));

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (from: number, to: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - from) / (to - from))); return t * t * (3 - 2 * t); };
/** The dip over a landing (0 to 1 of it): down quickly, back up more slowly. */
const dipAt = (u: number): number => (u < 0.3 ? Math.sin((Math.PI / 2) * (u / 0.3)) : 0.5 + 0.5 * Math.cos((Math.PI * (u - 0.3)) / 0.7));

const Z = new THREE.Vector3(0, 0, 1), turn = new THREE.Quaternion();

/** One body's jump, fall and landing. */
export class AirPose {
  phase: AirPhase = '';
  /** How much of the air pose is drawn over the gait, 0 to 1. */
  weight = 0;
  /** The arms out to the side, radians. */
  spread = 0;
  private y = Number.NaN;
  /** Vertical speed, settled, m/s; and its last raw value. */
  private vy = 0;
  private raw = 0;
  private aloft = false;
  /** The downward speed of the last frame in the air. */
  private falling = 0;
  /** How long it has been off the ground. */
  private aloftFor = 0;
  /** Into the landing, and how long and deep it is. */
  private landed = 0;
  private landFor = 0;
  private depth = 0;

  /** Read this frame's row: `air` (undefined: no data), its height, and whether something else poses the body (a board, a saddle). */
  update(air: boolean | undefined, y: number, dt: number, held: boolean): AirPhase {
    const raw = Number.isNaN(this.y) || dt <= 0 ? 0 : (y - this.y) / dt;
    this.y = y; this.raw = Math.abs(raw) > TELEPORT ? 0 : raw;
    this.vy += (this.raw - this.vy) * Math.min(1, dt * SETTLE);
    if (held || air === undefined) {
      this.aloft = false; this.phase = ''; this.landFor = 0;
      if (held) { this.weight = 0; this.spread = 0; } else this.ease(0, dt);
      return this.phase;
    }
    if (air) {
      if (!this.aloft) this.aloftFor = 0;
      this.aloft = true; this.landFor = 0; this.aloftFor += dt;
      if (Math.abs(raw) <= TELEPORT) this.falling = Math.max(0, -this.raw, -this.vy); // a fall past TELEPORT keeps its last speed
      this.phase = this.vy > 0 ? 'jump' : 'fall';
      this.ease(1, dt);
      return this.phase;
    }
    if (this.aloft) { // touching down: the dip from the last downward speed
      const fall = Math.max(this.falling, -this.raw);
      this.aloft = false; this.landed = 0;
      this.landFor = fall < SOFT || this.aloftFor < HOP ? 0 : LAND_TIME(fall); this.depth = LAND_DEPTH(fall);
    }
    this.ease(0, dt);
    if (this.landed < this.landFor) { this.phase = 'land'; this.landed += dt; } else { this.phase = ''; this.landFor = 0; }
    return this.phase;
  }

  /** The air pose over a gait pose, in place: its bends and its hips' drop. */
  layer(pose: StridePose): StridePose {
    const { bends } = pose, { weight } = this, up = smooth(-1, 1, this.vy);
    if (weight > 1e-4) {
      for (const joint of STRIDE_JOINTS) bends[joint] = lerp(bends[joint], lerp(REACH[joint], TUCK[joint], up), weight);
      pose.drop = lerp(pose.drop, 0, weight);
    }
    if (this.phase === 'land' && this.landFor > 0) {
      const dip = dipAt(Math.min(1, this.landed / this.landFor)), sink = this.depth * dip, mix = Math.min(1, dip * 4);
      const fold = Math.acos(Math.max(-1, 1 - sink / LEG));
      for (const side of ['left', 'right'] as const) {
        bends[`${side}Thigh`] = lerp(bends[`${side}Thigh`], fold, mix);
        bends[`${side}Shin`] = lerp(bends[`${side}Shin`], -2 * fold, mix);
        bends[`${side}UpperArm`] = lerp(bends[`${side}UpperArm`], 0.35, mix * 0.5);
        bends[`${side}ForeArm`] = lerp(bends[`${side}ForeArm`], 0.6, mix * 0.5);
      }
      bends.spine += 0.6 * fold * mix;
      pose.drop = lerp(pose.drop, sink, mix);
    }
    return pose;
  }

  /** The arms out to the side, after the bends have set them. */
  spreadArms(joints: DummyJoints): void {
    if (this.spread <= 1e-4) return;
    joints.leftUpperArm?.quaternion.multiply(turn.setFromAxisAngle(Z, this.spread));
    joints.rightUpperArm?.quaternion.multiply(turn.setFromAxisAngle(Z, -this.spread));
  }

  private ease(to: number, dt: number): void {
    this.weight += (to - this.weight) * Math.min(1, dt * EASE);
    if (this.weight < 1e-4) this.weight = 0;
    this.spread = this.weight * lerp(SPREAD_FALL, SPREAD_TUCK, smooth(-1, 1, this.vy));
  }
}
