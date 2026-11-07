import { Vector3, type Quaternion } from 'three';
import { smoothstep } from '../core/noise';
import type { TargetHit } from '../../../client/engine/combat/types';

/**
 * A swept blade's law with no scene (a sword, a sabre's pass): the swing pose from its keys, the blade's grip and tip
 * directions from that pose, the in-reach gate and the sweep from last frame's blade to this one: sub-samples, rays along
 * the blade and below it, each target struck once per swing up to the cap. The browser's SweptMelee (combat/view)
 * draws and strikes through it; a Node simulation (CI12's weapon tapes) runs the same law with its own targets.
 */
export interface BladeKey { readonly t: number; readonly pos: Vector3; readonly q: Quaternion }
export interface BladeSweepProfile { readonly rays: number; readonly extensions: readonly number[]; readonly step: number; readonly maxSamples: number; readonly maxHits: number }

/** One swing's keys, as a move holds them. */
export interface BladeSwing { readonly keys: readonly [BladeKey, BladeKey, BladeKey]; readonly total: number }
/** A blade's whole pose set: what a host needs to sweep it with no scene. */
export interface SweptBladeRig {
  readonly rest: BladeKey; readonly charge: BladeKey; readonly sprint: BladeKey;
  readonly combo: readonly BladeSwing[]; readonly heavy: BladeSwing;
  /** Seconds to rise into the charge pose. */
  readonly chargeBlend: number;
  readonly tipX: number; readonly tipY: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : Math.min(1, v));
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const easeIn = (t: number): number => t * t;

/** A move at `t` s into it: from-pose -> cocked -> mid -> follow-through -> rest (camera space, scale 1). */
export function sweptSwingPose(move: { readonly keys: readonly [BladeKey, BladeKey, BladeKey]; readonly total: number }, t: number,
  from: { readonly pos: Vector3; readonly q: Quaternion }, rest: BladeKey, outPos: Vector3, outQ: Quaternion): void {
  const k = move.keys;
  let aPos: Vector3, aQ: Quaternion, bPos: Vector3, bQ: Quaternion, t0: number, t1: number, f: number;
  if (t < k[0].t) { aPos = from.pos; aQ = from.q; bPos = k[0].pos; bQ = k[0].q; t0 = 0; t1 = k[0].t; f = easeIn(clamp01((t - t0) / (t1 - t0))); }
  else if (t < k[1].t) { aPos = k[0].pos; aQ = k[0].q; bPos = k[1].pos; bQ = k[1].q; t0 = k[0].t; t1 = k[1].t; f = easeOut(clamp01((t - t0) / (t1 - t0))); } // snap into the slash
  else if (t < k[2].t) { aPos = k[1].pos; aQ = k[1].q; bPos = k[2].pos; bQ = k[2].q; t0 = k[1].t; t1 = k[2].t; f = clamp01((t - t0) / (t1 - t0)); }
  else { aPos = k[2].pos; aQ = k[2].q; bPos = rest.pos; bQ = rest.q; t0 = k[2].t; t1 = move.total; f = smoothstep(0, 1, clamp01((t - t0) / (t1 - t0))); } // settle out of it
  outPos.copy(aPos).lerp(bPos, f);
  outQ.slerpQuaternions(aQ, bQ, f);
}

/** A plain rig's blade from its swing pose: unit dirs from the eye through the grip (the pose) and the tip (tipX, tipY). */
export function sweptBladeDirs(pos: Vector3, q: Quaternion, tipX: number, tipY: number, grip: Vector3, tip: Vector3): void {
  grip.copy(pos).normalize();
  tip.set(tipX, tipY, 0).applyQuaternion(q).add(pos).normalize();
}

/** A live, shown target whose body is within the blade's reach (+ 0.6: a move may reach further than the rig, + its radius,
 *  + a metre of slack) of the eye. */
export function bladeInReach<T extends { readonly alive: boolean; readonly hidden?: boolean; readonly position: Vector3 }>(eye: Vector3, reach: number,
  targets: Iterable<T>, radius: (target: T) => number): boolean {
  for (const t of targets) {
    if (!t.alive || t.hidden === true) continue;
    const r = reach + 0.6 + radius(t) + 1;
    if (t.position.distanceToSquared(eye) < r * r) return true;
  }
  return false;
}

const _g0 = new Vector3(), _t0 = new Vector3(), _b = new Vector3(), _dir = new Vector3();

/** One swing's sweep: last frame's blade, what it has struck (each target once), and the step that sweeps to this frame. */
export class BladeSweep {
  readonly struck: (TargetHit['animal'] | null)[];
  struckN = 0;
  readonly grip: Vector3 = new Vector3(); readonly tip: Vector3 = new Vector3(); have = false;
  private readonly profile: BladeSweepProfile;
  constructor(profile: BladeSweepProfile) { this.profile = profile; this.struck = Array.from({ length: profile.maxHits }, () => null); }
  /** a new swing: nothing struck, no last blade */
  reset(): void { this.struckN = 0; this.struck.fill(null); this.have = false; }
  /** Keep this frame's blade (`grip1`, `tip1`) as the last one without sweeping (no swing live, nothing in reach). */
  hold(grip1: Vector3, tip1: Vector3): void { this.grip.copy(grip1); this.tip.copy(tip1); this.have = true; }
  /**
   * Sweep last frame's blade to this frame's (`grip1`, `tip1`, camera-space unit dirs) from the eye `origin` turned by
   * `rotation`: sub-samples by the larger angle swept, rays from the grip to the tip and pitched below it, each the target
   * `raycast` meets within `reach`. A live target not yet struck this swing and not `blocked` (a wall between) is `strike`d.
   */
  sweep(grip1: Vector3, tip1: Vector3, origin: Vector3, rotation: Quaternion, reach: number, ports: {
    readonly raycast: (origin: Vector3, dir: Vector3, reach: number) => TargetHit | null;
    readonly blocked: (origin: Vector3, point: Vector3) => boolean;
    readonly strike: (hit: TargetHit) => void;
  }): void {
    const p = this.profile;
    const ang = Math.max(this.grip.angleTo(grip1), this.tip.angleTo(tip1));
    const subs = Math.min(p.maxSamples, Math.max(1, Math.ceil(ang / p.step)));
    for (let s = 1; s <= subs && this.struckN < p.maxHits; s++) {
      const f = s / subs;
      _g0.copy(this.grip).lerp(grip1, f).normalize(); _t0.copy(this.tip).lerp(tip1, f).normalize();
      for (let k = 0; k < p.rays * (1 + p.extensions.length); k++) {
        const j = k % p.rays, ext = (k - j) / p.rays;
        _b.copy(_g0).lerp(_t0, j / (p.rays - 1)).normalize();
        if (ext === 0) _dir.copy(_b);
        else { // under the blade: the blade point's dir pitched further down about the camera's right axis
          const a = p.extensions[ext - 1] ?? 0, c = Math.cos(a), sn = Math.sin(a);
          _dir.set(_b.x, _b.y * c + _b.z * sn, -_b.y * sn + _b.z * c);
        }
        _dir.applyQuaternion(rotation);
        const hit = ports.raycast(origin, _dir, reach);
        if (hit === null || !hit.animal.alive || this.struck.includes(hit.animal)) continue;
        if (ports.blocked(origin, hit.point)) continue;
        this.struck[this.struckN++] = hit.animal;
        ports.strike(hit);
        if (this.struckN >= p.maxHits) break;
      }
    }
    this.grip.copy(grip1); this.tip.copy(tip1);
  }
}
