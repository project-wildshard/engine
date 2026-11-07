// CI12 Nalati polearm / javelin: the lunge pick split out of SweptMelee.findLunge and AimTargets (lungeTarget.ts, runtime-
// free) picks exactly the target the page's inline code picked, locked or not, with the same target radius.
import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { pickLunge, targetRadius } from '../src/shared/engine/combat/lungeTarget';
import type { AimTarget } from '../src/client/engine/player/AimTargets';

/** AimTargets.targetRadius and SweptMelee.findLunge before the split (before CI12) */
function oldRadius(t: AimTarget): number {
  const d = t.dims;
  return Math.max(0.3, Math.max(d?.bodyRadius ?? 0.33, (d?.bodyHalfLen ?? 0.5) * 0.6)) * (t.scale ?? 1);
}
function oldPick(targets: readonly AimTarget[], p: Vector3, yaw: number, range: number, cone: number, lock: { state: string; target: AimTarget | null }): AimTarget | null {
  if (lock.state === 'locked') {
    const t = lock.target;
    if (t === null || !t.alive || t.hidden) return null;
    return Math.hypot(t.position.x - p.x, t.position.z - p.z) - oldRadius(t) <= range ? t : null;
  }
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  let best: AimTarget | null = null, bestScore = Infinity;
  for (const t of targets) {
    if (!t.alive || t.hidden || Math.abs(t.position.y - p.y) > 2) continue;
    const dx = t.position.x - p.x, dz = t.position.z - p.z, d = Math.hypot(dx, dz);
    if (d < 0.01 || d - oldRadius(t) > range) continue;
    const angle = Math.acos(Math.min(1, Math.max(-1, (dx * fx + dz * fz) / d)));
    if (angle > cone) continue;
    const score = angle / cone + 0.3 * d / range;
    if (score < bestScore) { bestScore = score; best = t; }
  }
  return best;
}

test('the split lunge pick and target radius answer exactly as the page did', () => {
  let seed = 11; const rand = (): number => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 2 ** 32; };
  let picked = 0, empty = 0, lockedPicks = 0;
  for (let n = 0; n < 4000; n++) {
    const p = new Vector3(rand() * 20 - 10, rand() * 2, rand() * 20 - 10), yaw = rand() * Math.PI * 4 - Math.PI * 2;
    const targets: AimTarget[] = Array.from({ length: 1 + (n % 7) }, (_, i) => ({
      alive: (n + i) % 9 !== 0, ...(i % 5 === 1 ? { hidden: true } : {}), position: new Vector3(p.x + rand() * 8 - 4, p.y + rand() * 5 - 2.5, p.z + rand() * 8 - 4),
      ...(i % 3 === 0 ? {} : { scale: .5 + rand() * 2 }),
      ...(i % 4 === 0 ? {} : { dims: { ...(i % 2 === 0 ? { bodyRadius: rand() } : {}), ...(i % 3 === 2 ? { bodyHalfLen: rand() * 2 } : {}) } }) }));
    // an exact tie and a target on the player's feet come round too
    if (n % 11 === 0) { const twin = targets[0]; if (twin !== undefined) targets.push({ ...twin, position: twin.position.clone() }); }
    if (n % 13 === 0) targets.push({ alive: true, position: p.clone() });
    const range = 1 + rand() * 4, cone = .2 + rand() * 1.2;
    for (const t of targets) expect(targetRadius(t)).toBe(oldRadius(t));
    const locks = [{ state: 'off', target: null }, { state: 'locked', target: targets[n % targets.length] ?? null }, { state: 'locked', target: null }];
    for (const lock of locks) {
      const want = oldPick(targets, p, yaw, range, cone, lock), got = pickLunge(targets, p, yaw, range, cone, lock.state === 'locked' ? lock : undefined);
      expect(got).toBe(want);
      if (want === null) empty++; else { picked++; if (lock.state === 'locked') lockedPicks++; }
    }
  }
  expect(picked).toBeGreaterThan(500); expect(empty).toBeGreaterThan(500); expect(lockedPicks).toBeGreaterThan(100);
});
