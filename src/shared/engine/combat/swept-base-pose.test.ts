import { expect, test } from 'vitest';
import { MathUtils, Quaternion, Vector3 } from 'three';
import { smoothstep } from '../core/noise';
import { sweptSwingPose, type BladeKey } from './sweptBlade';
import { SweptBasePose, type SweptBasePoseSwing } from './sweptBasePose';

const clamp01 = (v: number): number => (v < 0 ? 0 : Math.min(1, v));
/** SweptMelee's base pose as it was inline before the kernel (its fields, blend block and pose block, verbatim; `ready` was this.charge) */
class Inline {
  fromPos = new Vector3(); fromQ = new Quaternion(); from = { pos: this.fromPos, q: this.fromQ };
  basePos = new Vector3(); baseQ = new Quaternion(); chargeBlend = 0; sprintBlend = 0;
  constructor(rest: BladeKey) { this.basePos.copy(rest.pos); this.baseQ.copy(rest.q); }
  start(): void { this.fromPos.copy(this.basePos); this.fromQ.copy(this.baseQ); }
  step(dt: number, chargeTime: number, charging: boolean, sprinting: boolean, move: SweptBasePoseSwing | null, mv: { rest: BladeKey; charge: BladeKey; sprint: BladeKey },
    swingTime: number, ready: number, t: number, pos: Vector3, q: Quaternion): number {
    { const step = dt / chargeTime; this.chargeBlend = clamp01(this.chargeBlend + MathUtils.clamp((charging ? 1 : 0) - this.chargeBlend, -step, step)); }
    this.sprintBlend += ((sprinting && !move && !charging ? 1 : 0) - this.sprintBlend) * Math.min(1, dt * 7);
    if (move) sweptSwingPose(move, swingTime, this.from, mv.rest, pos, q);
    else { pos.copy(mv.rest.pos); q.copy(mv.rest.q); }
    const c = smoothstep(0, 1, this.chargeBlend), sp = this.sprintBlend;
    if (c > 0) {
      pos.lerp(mv.charge.pos, c); q.slerp(mv.charge.q, c);
      pos.x += Math.sin(t * 43) * 0.0025 * ready * c; pos.y += (Math.sin(t * 37) * 0.002 + 0.02 * ready) * c;
    }
    if (sp > 0) { pos.lerp(mv.sprint.pos, sp); q.slerp(mv.sprint.q, sp); }
    this.basePos.copy(pos); this.baseQ.copy(q);
    return c;
  }
}

test('the base pose kernel blends, swings and continues exactly as the inline sword did', () => {
  let seed = 7;
  const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const key = (t: number): BladeKey => ({ t, pos: new Vector3(rnd() - .5, rnd() - .5, -rnd()), q: new Quaternion(rnd() - .5, rnd() - .5, rnd() - .5, rnd() + .5).normalize() });
  const mv = { rest: key(0), charge: key(0), sprint: key(0) };
  const moves: SweptBasePoseSwing[] = [0, 1, 2].map(() => ({ keys: [key(.08), key(.18), key(.3)] as const, total: .5 }));
  const inline = new Inline(mv.rest), kernel = new SweptBasePose(); kernel.rest(mv.rest);
  let restored: SweptBasePose | null = null;
  const pa = new Vector3(), qa = new Quaternion(), pb = new Vector3(), qb = new Quaternion(), pc = new Vector3(), qc = new Quaternion();
  let move: SweptBasePoseSwing | null = null, swingTime = 0, t = 0;
  for (let frame = 0; frame < 6000; frame++) {
    const dt = rnd() < .05 ? 0 : rnd() * .05, charging = rnd() < .35, sprinting = rnd() < .4, ready = rnd() < .5 ? 0 : rnd();
    if (move === null && rnd() < .04) { move = moves[Math.floor(rnd() * moves.length)] ?? null; swingTime = 0; inline.start(); kernel.startSwing(); restored?.startSwing(); }
    else if (move !== null) { swingTime += dt; if (swingTime > move.total) move = null; }
    t += dt;
    const c1 = inline.step(dt, .35, charging, sprinting, move, mv, swingTime, ready, t, pa, qa);
    kernel.blend(dt, .35, charging, sprinting, move !== null);
    const c2 = kernel.pose(mv, move, swingTime, ready, t, pb, qb);
    expect([c2, ...pb.toArray(), ...qb.toArray(), kernel.chargeBlend, kernel.sprintBlend]).toEqual([c1, ...pa.toArray(), ...qa.toArray(), inline.chargeBlend, inline.sprintBlend]);
    expect([...kernel.basePos.toArray(), ...kernel.baseQ.toArray(), ...kernel.fromPos.toArray(), ...kernel.fromQ.toArray()])
      .toEqual([...inline.basePos.toArray(), ...inline.baseQ.toArray(), ...inline.fromPos.toArray(), ...inline.fromQ.toArray()]);
    if (restored !== null) {
      restored.blend(dt, .35, charging, sprinting, move !== null);
      const c3 = restored.pose(mv, move, swingTime, ready, t, pc, qc);
      expect([c3, ...pc.toArray(), ...qc.toArray()]).toEqual([c2, ...pb.toArray(), ...qb.toArray()]);
    }
    // a native checkpoint mid-run (mid-swing more often than not): a fresh owner continues identically
    if (frame === 2500) { restored = new SweptBasePose(); restored.restore(structuredClone(kernel.snapshot())); expect(restored.snapshot()).toEqual(kernel.snapshot()); }
  }
});
