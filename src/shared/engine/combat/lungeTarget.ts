/**
 * Which target a sword swing lunges onto, renderer- and runtime-free (CI12: the Nalati native polearm / javelin tape picks
 * the same target the page does): a target's horizontal half-size (`targetRadius`, where a lunge stops short of it) and the
 * pick itself (`pickLunge`). `SweptMelee.findLunge` picks through this with the live aim targets and lock-on; a native host
 * passes its own.
 *
 *   pickLunge(app.aimTargets, player.position, player.yaw, range, cone, lockOn.state === 'locked' ? lockOn : undefined)
 */
import type { AimTarget } from '../../../client/engine/player/AimTargets';

/** what the pick reads of a target (a subset of AimTarget) */
export type LungeCandidate = Pick<AimTarget, 'alive' | 'hidden' | 'dims' | 'scale'> & { readonly position: { readonly x: number; readonly y: number; readonly z: number } };

/** the target's horizontal half-size (m) from its dims — where a lunge stops short of it */
export function targetRadius(t: Pick<AimTarget, 'dims' | 'scale'>): number {
  const d = t.dims;
  return Math.max(0.3, Math.max(d?.bodyRadius ?? 0.33, (d?.bodyHalfLen ?? 0.5) * 0.6)) * (t.scale ?? 1);
}

/** The target a swing from `from` facing `yaw` would lunge onto: alive, within `range` m (feet → body edge), inside ±`cone`
 *  (rad) of the view, near the feet's height — the smallest angle wins, distance breaking near-ties. Locked on (`lock`, E50
 *  §2.4): only ever the locked target, with no cone check, and never a different one. */
export function pickLunge<T extends LungeCandidate>(targets: Iterable<T>, from: { readonly x: number; readonly y: number; readonly z: number }, yaw: number,
  range: number, cone: number, lock?: { readonly target: T | null }): T | null {
  if (lock !== undefined) {
    const t = lock.target;
    if (t === null || !t.alive || t.hidden) return null;
    return Math.hypot(t.position.x - from.x, t.position.z - from.z) - targetRadius(t) <= range ? t : null;
  }
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  let best: T | null = null, bestScore = Infinity;
  for (const t of targets) {
    if (!t.alive || t.hidden || Math.abs(t.position.y - from.y) > 2) continue;
    const dx = t.position.x - from.x, dz = t.position.z - from.z, d = Math.hypot(dx, dz);
    if (d < 0.01 || d - targetRadius(t) > range) continue;
    const angle = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d)));
    if (angle > cone) continue;
    const score = angle / cone + 0.3 * d / range;
    if (score < bestScore) { bestScore = score; best = t; }
  }
  return best;
}
