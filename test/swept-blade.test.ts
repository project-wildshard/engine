import { expect, test } from 'vitest';
import { Quaternion, Ray, Sphere, Vector3 } from 'three';
import { smoothstep } from '../src/shared/engine/core/noise';
import { Rng } from '../src/shared/engine/core/rng';
import type { TargetHit } from '../src/client/engine/combat/types';
import { BladeSweep, bladeInReach, sweptSwingPose, type BladeKey } from '../src/shared/engine/combat/sweptBlade';

// The swept blade's law (sweptBlade.ts) beside the loop SweptMelee ran inline before it, kept here as the reference: the
// same blade motions over the same targets must strike the same targets, in the same order, at the same points.
const profile = { rays: 5, extensions: [0.18, 0.36], step: 0.05, maxSamples: 8, maxHits: 3 };
interface Body { kind: string; position: Vector3; alive: boolean; hidden?: boolean; r: number; applyDamage: () => boolean; damageFor: () => number }
const ray = new Ray(), sphere = new Sphere(), crossing = new Vector3();
function field(rng: Rng): Body[] {
  return Array.from({ length: 6 }, (_, i) => ({ kind: `wolf-${i}`, position: new Vector3((rng.next() - 0.5) * 5, 1 + rng.next(), -1 - rng.next() * 2.5),
    alive: rng.next() > 0.1, r: 0.3 + rng.next() * 0.3, applyDamage: () => false, damageFor: () => 0 }));
}
function raycastOf(bodies: Body[]): (o: Vector3, d: Vector3, reach: number) => TargetHit | null {
  return (o, d, reach) => {
    ray.set(o, d); let best: TargetHit | null = null;
    for (const b of bodies) {
      if (ray.intersectSphere(sphere.set(b.position, b.r), crossing) === null) continue;
      const dist = crossing.distanceTo(o);
      if (dist <= reach && (best === null || dist < best.distance)) best = { animal: b, point: crossing.clone(), distance: dist, headshot: false };
    }
    return best;
  };
}
/** SweptMelee.sweepHit's loop as it was (HEAD before sweptBlade.ts) */
function referenceSweep(state: { grip: Vector3; tip: Vector3; struck: (Body | null)[]; struckN: number }, g1: Vector3, t1: Vector3, origin: Vector3, rotation: Quaternion,
  reach: number, raycast: (o: Vector3, d: Vector3, r: number) => TargetHit | null, blocked: (o: Vector3, p: Vector3) => boolean, strike: (hit: TargetHit) => void): void {
  const _g0 = new Vector3(), _t0 = new Vector3(), _b = new Vector3(), _dir = new Vector3();
  const ang = Math.max(state.grip.angleTo(g1), state.tip.angleTo(t1));
  const subs = Math.min(profile.maxSamples, Math.max(1, Math.ceil(ang / profile.step)));
  for (let s = 1; s <= subs && state.struckN < profile.maxHits; s++) {
    const f = s / subs;
    _g0.copy(state.grip).lerp(g1, f).normalize(); _t0.copy(state.tip).lerp(t1, f).normalize();
    for (let k = 0; k < profile.rays * (1 + profile.extensions.length); k++) {
      const j = k % profile.rays, ext = (k - j) / profile.rays;
      _b.copy(_g0).lerp(_t0, j / (profile.rays - 1)).normalize();
      if (ext === 0) _dir.copy(_b);
      else { const a = profile.extensions[ext - 1] ?? 0, c = Math.cos(a), sn = Math.sin(a); _dir.set(_b.x, _b.y * c + _b.z * sn, -_b.y * sn + _b.z * c); }
      _dir.applyQuaternion(rotation);
      const hit = raycast(origin, _dir, reach);
      if (hit === null || !hit.animal.alive || state.struck.includes(hit.animal as Body)) continue;
      if (blocked(origin, hit.point)) continue;
      state.struck[state.struckN++] = hit.animal as Body;
      strike(hit);
      if (state.struckN >= profile.maxHits) break;
    }
  }
  state.grip.copy(g1); state.tip.copy(t1);
}
const unit = (rng: Rng): Vector3 => new Vector3((rng.next() - 0.5) * 1.6, (rng.next() - 0.5) * 0.8, -1).normalize();

test('the blade sweep strikes the same targets in the same order at the same points as the inline loop', () => {
  let total = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const rng = new Rng(seed), bodies = field(rng), raycast = raycastOf(bodies);
    const blocked = (_o: Vector3, p: Vector3): boolean => p.x > 2.2; // a wall on the right
    const origin = new Vector3(0, 1.6, 0), rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (rng.next() - 0.5) * 0.4);
    const kernel = new BladeSweep(profile), ref = { grip: new Vector3(), tip: new Vector3(), struck: Array.from({ length: profile.maxHits }, (): Body | null => null), struckN: 0 };
    const g = unit(rng), t = unit(rng); kernel.hold(g, t); ref.grip.copy(g); ref.tip.copy(t);
    const kHits: number[][] = [], rHits: number[][] = [];
    for (let frame = 0; frame < 6; frame++) {
      const g1 = unit(rng), t1 = unit(rng);
      kernel.sweep(g1, t1, origin, rotation, 3, { raycast, blocked, strike: hit => { kHits.push([bodies.indexOf(hit.animal as Body), ...hit.point.toArray()]); } });
      referenceSweep(ref, g1, t1, origin, rotation, 3, raycast, blocked, hit => { rHits.push([bodies.indexOf(hit.animal as Body), ...hit.point.toArray()]); });
      expect(kernel.struckN).toBe(ref.struckN); expect(kernel.grip.toArray()).toEqual(ref.grip.toArray());
    }
    expect(kHits).toEqual(rHits); total += kHits.length;
  }
  expect(total).toBeGreaterThan(20);
});

test('a new swing strikes a target again; a struck one is not struck twice in a swing; the cap holds', () => {
  const bodies: Body[] = [{ kind: 'wolf', position: new Vector3(0, 1.6, -1.5), alive: true, r: 0.6, applyDamage: () => false, damageFor: () => 0 }];
  const raycast = raycastOf(bodies), sweep = new BladeSweep(profile), struck: number[] = [];
  const left = new Vector3(-0.6, 0, -1).normalize(), right = new Vector3(0.6, 0, -1).normalize(), origin = new Vector3(0, 1.6, 0), q = new Quaternion();
  const swing = (): void => { sweep.hold(left, left); sweep.sweep(right, right, origin, q, 3, { raycast, blocked: () => false, strike: () => { struck.push(1); } }); sweep.sweep(left, left, origin, q, 3, { raycast, blocked: () => false, strike: () => { struck.push(1); } }); };
  swing(); expect(struck).toEqual([1]);
  sweep.reset(); swing(); expect(struck).toEqual([1, 1]);
});

test('the swing pose and the reach gate keep the inline arithmetic', () => {
  const key = (t: number, x: number): BladeKey => ({ t, pos: new Vector3(x, -0.2, -0.4), q: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), x) });
  const move = { keys: [key(0.08, 0.3), key(0.16, -0.1), key(0.3, -0.4)] as const, total: 0.5 };
  const from = { pos: new Vector3(0.2, -0.3, -0.5), q: new Quaternion() }, rest = key(0, 0.25);
  const clamp01 = (v: number): number => (v < 0 ? 0 : Math.min(1, v));
  for (let t = 0; t <= 0.55; t += 0.01) {
    const pos = new Vector3(), q = new Quaternion(); sweptSwingPose(move, t, from, rest, pos, q);
    const k = move.keys; let a = from.pos, aq = from.q, b = k[0].pos, bq = k[0].q, f: number;
    if (t < k[0].t) f = (clamp01(t / k[0].t)) ** 2;
    else if (t < k[1].t) { a = k[0].pos; aq = k[0].q; b = k[1].pos; bq = k[1].q; const u = clamp01((t - k[0].t) / (k[1].t - k[0].t)); f = 1 - (1 - u) * (1 - u); }
    else if (t < k[2].t) { a = k[1].pos; aq = k[1].q; b = k[2].pos; bq = k[2].q; f = clamp01((t - k[1].t) / (k[2].t - k[1].t)); }
    else { a = k[2].pos; aq = k[2].q; b = rest.pos; bq = rest.q; f = smoothstep(0, 1, clamp01((t - k[2].t) / (move.total - k[2].t))); }
    expect(pos.toArray()).toEqual(a.clone().lerp(b, f).toArray()); expect(q.toArray()).toEqual(new Quaternion().slerpQuaternions(aq, bq, f).toArray());
  }
  const eye = new Vector3(), radius = (t: { r: number }): number => t.r;
  expect(bladeInReach(eye, 2, [{ alive: true, position: new Vector3(0, 0, -3.8), r: 0.3 }], radius)).toBe(true);
  expect(bladeInReach(eye, 2, [{ alive: true, position: new Vector3(0, 0, -4), r: 0.3 }], radius)).toBe(false);
  expect(bladeInReach(eye, 2, [{ alive: true, hidden: true, position: new Vector3(0, 0, -1), r: 0.3 }, { alive: false, position: new Vector3(0, 0, -1), r: 0.3 }], radius)).toBe(false);
});
