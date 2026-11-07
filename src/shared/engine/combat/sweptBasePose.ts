import { MathUtils, Quaternion, Vector3 } from 'three';
import { smoothstep } from '../core/noise';
import { sweptSwingPose, type BladeKey } from './sweptBlade';

/**
 * CI12: a swept blade's base pose, renderer-free: the swing (from where the blade stood when the swing started) or rest,
 * eased toward the heavy's charge pose (with its ready tremble and lift) and the sprint pose. The base pose is what the
 * blade sweep reads (sweptBladeDirs) before any sway, bob or framing; the page's SweptMelee and a Node simulation step the
 * same equations in the same order.
 *
 *   pose.rest(moves.rest);                                 // a new move set
 *   pose.startSwing();                                     // the clock started a swing
 *   pose.blend(dt, profile.chargeBlend, charging, sprinting, move !== null);
 *   const c = pose.pose(moves, move, swingTime, ready, t, pos, q);   // pos / q = basePos / baseQ; c the eased charge
 */
const clamp01 = (v: number): number => (v < 0 ? 0 : Math.min(1, v));

/** the rest, charge and sprint poses of a move set */
export interface SweptBasePoseMoves { readonly rest: BladeKey; readonly charge: BladeKey; readonly sprint: BladeKey }
/** a swing's keys (SweptMelee's Move) */
export interface SweptBasePoseSwing { readonly keys: readonly [BladeKey, BladeKey, BladeKey]; readonly total: number }
/** The base pose's continuation: the swing's start pose and this frame's base pose (position xyz, quaternion xyzw) and the
 *  charge / sprint blends. */
export interface SweptBasePoseSnapshot {
  readonly from: readonly number[]; readonly base: readonly number[]; readonly chargeBlend: number; readonly sprintBlend: number;
}

export class SweptBasePose {
  /** where the blade stood when this swing started */
  readonly fromPos: Vector3 = new Vector3(); readonly fromQ: Quaternion = new Quaternion();
  /** this frame's pose before sway / framing (camera space, scale 1) */
  readonly basePos: Vector3 = new Vector3(); readonly baseQ: Quaternion = new Quaternion();
  chargeBlend = 0; sprintBlend = 0;
  private readonly from = { pos: this.fromPos, q: this.fromQ };

  /** A move set's rest pose becomes the base pose. */
  rest(rest: BladeKey): void { this.basePos.copy(rest.pos); this.baseQ.copy(rest.q); }
  /** A swing starts from this frame's base pose. */
  startSwing(): void { this.fromPos.copy(this.basePos); this.fromQ.copy(this.baseQ); }
  /** The charge pose's blend (toward 1 while the heavy charges, at most `dt / chargeTime` a frame) and the sprint's
   *  (toward 1 while sprinting with no swing and no charge, 7 / s). */
  blend(dt: number, chargeTime: number, charging: boolean, sprinting: boolean, swinging: boolean): void {
    { const step = dt / chargeTime; this.chargeBlend = clamp01(this.chargeBlend + MathUtils.clamp((charging ? 1 : 0) - this.chargeBlend, -step, step)); }
    this.sprintBlend += ((sprinting && !swinging && !charging ? 1 : 0) - this.sprintBlend) * Math.min(1, dt * 7);
  }
  /** This frame's base pose into `pos` / `q` (and basePos / baseQ): `move` at `swingTime` (null: rest), toward the charge
   *  pose (its tremble and lift by `ready`, at time `t`) and the sprint pose. The eased charge blend. */
  pose(moves: SweptBasePoseMoves, move: SweptBasePoseSwing | null, swingTime: number, ready: number, t: number, pos: Vector3, q: Quaternion): number {
    if (move) sweptSwingPose(move, swingTime, this.from, moves.rest, pos, q);
    else { pos.copy(moves.rest.pos); q.copy(moves.rest.q); }
    const c = smoothstep(0, 1, this.chargeBlend), sp = this.sprintBlend;
    if (c > 0) {
      pos.lerp(moves.charge.pos, c); q.slerp(moves.charge.q, c);
      // charged: a taut tremble in the raised blade, and a small lift as it comes ready
      pos.x += Math.sin(t * 43) * 0.0025 * ready * c; pos.y += (Math.sin(t * 37) * 0.002 + 0.02 * ready) * c;
    }
    if (sp > 0) { pos.lerp(moves.sprint.pos, sp); q.slerp(moves.sprint.q, sp); }
    this.basePos.copy(pos); this.baseQ.copy(q);
    return c;
  }

  /** CI12: the continuation as data, for a native checkpoint. */
  snapshot(): SweptBasePoseSnapshot {
    return { from: [...this.fromPos.toArray(), ...this.fromQ.toArray()], base: [...this.basePos.toArray(), ...this.baseQ.toArray()],
      chargeBlend: this.chargeBlend, sprintBlend: this.sprintBlend };
  }
  /** Continue from `saved`. */
  restore(saved: SweptBasePoseSnapshot): void {
    if (saved.from.length !== 7 || saved.base.length !== 7 || [...saved.from, ...saved.base, saved.chargeBlend, saved.sprintBlend].some(value => !Number.isFinite(value)))
      throw new Error('Invalid swept base pose snapshot');
    this.fromPos.fromArray(saved.from, 0); this.fromQ.fromArray(saved.from, 3);
    this.basePos.fromArray(saved.base, 0); this.baseQ.fromArray(saved.base, 3);
    this.chargeBlend = saved.chargeBlend; this.sprintBlend = saved.sprintBlend;
  }
}
