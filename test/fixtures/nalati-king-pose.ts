// Shipped pose at c623a5be8, frozen for the ordered-row migration.
import * as THREE from 'three';
import type { AnimalRigContext as RigAnimCtx } from '../../src/shared/engine/entities/animalRig';
import { lookAngles, smooth01, bump, step, clamp } from '../../src/shared/engine/entities/species/rigs';
import { terrainHeight as heightAt } from '../../src/shared/engine/world/terrainHeight';
type Side = 'L' | 'R';
type KingBones = Record<'body' | 'spine' | 'chest' | 'head' | 'crown' | 'cape' | `arm${Side}_${'sh' | 'el' | 'hand'}` | `leg${Side}_${'hip' | 'knee' | 'foot'}`, THREE.Bone>;
interface KingMem extends Record<string, number | undefined> {
  init?: number; floorY?: number; lift?: number; pose?: number; rise?: number; kneel?: number; act?: number; strike?: number;
  cape?: number; crown?: number; raise?: number; kneelS?: number; raiseS?: number; floorS?: number; deadT?: number;
}

const R = (b: THREE.Bone, x: number, y: number, z: number) => b.rotation.set(x, y, z);
const L = THREE.MathUtils.lerp;

export function animateKing(c: RigAnimCtx): void {
  const b = c.bones as KingBones, t = c.t, m = c.mem as KingMem, a = c.animal, dt = c.dt;
  // ── where he stands: the chamber floor (not the terrain) + the coffin lift ──
  // the floor under him, smoothed (the brain samples it at 10 Hz: plinth, sand drifts, fallen beams); dead, he crumbles
  // into the floor over a second and a half (the fight hides him and shows the heap of plaques)
  const lift = m.lift ?? 0;
  m.floorS = (m.floorS ?? m.floorY ?? 0) + ((m.floorY ?? 0) - (m.floorS ?? m.floorY ?? 0)) * Math.min(1, dt * 8);
  if (!c.alive) m.deadT = (m.deadT ?? 0) + dt;
  const sink = Math.max(0, (m.deadT ?? 0) - 0.9) * 0.9;
  a.yOffset = (m.floorS ?? 0) - heightAt(a.position.x, a.position.z) + lift - sink;
  const up = smooth01(m.pose === 0 ? m.rise ?? 0 : 1);        // 0 lying … 1 standing
  const sit = step(up, 0, 0.55), stand = step(up, 0.45, 1);
  m.kneelS = (m.kneelS ?? 0) + ((m.kneel ?? 0) - (m.kneelS ?? 0)) * Math.min(1, dt * 5);
  m.raiseS = (m.raiseS ?? 0) + ((m.raise ?? 0) - (m.raiseS ?? 0)) * Math.min(1, dt * 6);
  const kneel = smooth01(m.kneelS), raise = smooth01(m.raiseS);
  const dead = c.deathT >= 0 ? smooth01(c.deathT) : 0;
  const moving = clamp(c.speed / 1.2, 0, 1);
  const ph = c.phase * Math.PI * 2;
  const look = lookAngles(c, 1.65, 1.0, 0.5);
  const breathe = Math.sin(t * 1.3 + c.seed * 5);
  const atk = c.attack, act = m.act ?? 0;
  // cloak / headdress: a bone scaled to nothing collapses its skin
  const capeS = Math.max(0.001, m.cape ?? 1), crownS = Math.max(0.001, m.crown ?? 1);
  b.cape.scale.setScalar(capeS); b.crown.scale.setScalar(crownS);
  // ── the root: lying on his back in the coffin → sitting up → standing; kneeling drops the hips ──
  const lie = 1 - sit;
  const kneelDrop = 0.36 * kneel + 0.5 * step(dead, 0, 0.5);
  b.body.position.set(0, c.dims.bodyY - 0.55 * lie - 0.18 * (1 - stand) * sit - kneelDrop + 0.01 * breathe * (1 - moving), -0.35 * lie);
  let bodyP = -1.52 * lie + 0.08 * moving + 0.12 * kneel + 1.2 * step(dead, 0.45, 1);
  let spineY = 0, headP = -0.05 + 0.25 * c.flinch;
  let armRx = 0.1, armRz = -0.18, elR = -0.45;
  const spineP = 0.02 + 0.1 * kneel, handR = 0.25;
  let armLx = 0.15, armLz = 0.2, elL = -0.35;
  // ── the akinakes combo: a glinting wind-up, then the cut; the fourth (phase III) and the third are the wide ones ──
  if (act === 1 && atk >= 0) {
    const wide = (m.strike ?? 0) >= 2;
    const back = (m.strike ?? 0) % 2 === 1;
    const wind = step(atk, 0, 0.55), cut = step(atk, 0.55, 0.75), rec = step(atk, 0.82, 1);
    const k = (1 - rec);
    if (!back) {
      armRx = L(L(0.1, -2.3, wind), 0.9, cut) * k + 0.1 * rec;
      armRz = L(L(-0.18, -1.1, wind), wide ? 0.9 : 0.35, cut) * k - 0.18 * rec;
      elR = L(L(-0.45, -1.1, wind), -0.1, cut) * k - 0.45 * rec;
      spineY = L(L(0, 0.55, wind), wide ? -0.8 : -0.45, cut) * k;
    } else {
      armRx = L(L(0.1, -1.4, wind), 0.5, cut) * k + 0.1 * rec;
      armRz = L(L(-0.18, 0.7, wind), -1.2, cut) * k - 0.18 * rec;
      elR = L(L(-0.45, -1.3, wind), -0.2, cut) * k - 0.45 * rec;
      spineY = L(L(0, -0.5, wind), 0.55, cut) * k;
    }
    bodyP += L(L(0, -0.12, wind), 0.3, cut) * k;
    armLz += 0.4 * wind * k; armLx -= 0.3 * cut * k;
  }
  // ── the sunburst: the sword up over the head (gold spirals into it), then driven down into the floor ──
  if (act === 2 && atk >= 0) {
    const lift2 = step(atk, 0, 0.3), hold = atk < 0.72 ? 1 : 0, slam = step(atk, 0.72, 0.82), rec = step(atk, 0.88, 1);
    armRx = L(L(0.1, -2.9, lift2), 0.6, slam) * (1 - rec) + 0.1 * rec;
    armRz = L(-0.18, -0.25, lift2) * (1 - rec) - 0.18 * rec;
    elR = L(L(-0.45, -0.15, lift2), -0.5, slam) * (1 - rec) - 0.45 * rec;
    armLx = L(L(0.15, -2.4, lift2), 0.4, slam) * (1 - rec) + 0.15 * rec; armLz = L(0.2, 0.5, lift2) * (1 - rec) + 0.2 * rec;
    bodyP += (-0.2 * lift2 * hold + 0.55 * slam) * (1 - rec);
    headP += (-0.35 * lift2 * hold + 0.3 * slam) * (1 - rec);
    b.body.position.y -= 0.2 * slam * (1 - rec);
  }
  // ── the roar (a phase change) / tearing the cloak off: arms flung wide, head back ──
  if ((act === 3 || act === 4) && atk >= 0) {
    const k = bump(atk, 0, 1);
    armRx = L(armRx, act === 4 ? -2.2 : -0.6, k); armRz = L(armRz, -1.3, k);
    armLx = L(armLx, act === 4 ? -1.2 : -0.6, k); armLz = L(armLz, 1.3, k);
    headP -= 0.5 * k; bodyP -= 0.2 * k;
  }
  // ── the phase II kneel: the sword raised in both hands before him (the dome) ──
  if (raise > 0.01) {
    armRx = L(armRx, -1.35, raise); armRz = L(armRz, 0.35, raise); elR = L(elR, -0.9, raise);
    armLx = L(armLx, -1.3, raise); armLz = L(armLz, -0.3, raise); elL = L(elL, -1.0, raise);
    headP = L(headP, -0.2, raise);
  }
  // sitting up in the coffin: arms braced on the rim, then free
  if (lie > 0.02 || stand < 0.98) {
    const sitArms = sit * (1 - stand);
    armRx = L(armRx, 0.6, sitArms); armLx = L(armLx, 0.6, sitArms); armRz = L(armRz, -0.5, sitArms); armLz = L(armLz, 0.5, sitArms);
    armRx = L(armRx, 0.1, lie); armLx = L(armLx, 0.1, lie); armRz = L(armRz, -0.15, lie); armLz = L(armLz, 0.15, lie);
    headP += 0.4 * lie * (1 - sit);
  }
  R(b.body, bodyP, 0, 0.03 * Math.sin(ph) * moving);
  R(b.spine, spineP + 0.02 * breathe, spineY + look.yaw * 0.3, 0);
  R(b.chest, 0.02, look.yaw * 0.25, 0);
  R(b.head, headP - look.pitch * 0.6, look.yaw * 0.45, 0.04 * Math.sin(t * 0.7));
  // the cloak sways with the stride and hangs back from the shoulders
  R(b.cape, 0.08 + 0.12 * moving + 0.05 * Math.sin(t * 1.1 + ph) - 0.3 * lie, 0.06 * Math.sin(ph), 0.03 * Math.sin(t * 0.8));
  const armSw = Math.sin(ph) * 0.3 * moving;
  R(b.armR_sh, armRx + armSw * 0.4 + 0.8 * dead, 0, armRz);
  R(b.armR_el, elR, 0, -0.1);
  R(b.armR_hand, handR, 0, 0);
  R(b.armL_sh, armLx - armSw + 0.8 * dead, 0, armLz);
  R(b.armL_el, elL, 0, 0.1);
  R(b.armL_hand, 0.1, 0, 0);
  // ── legs: a heavy, regal stride; lying they stretch out along the coffin; kneeling the right knee goes down ──
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    const lsw = Math.sin(ph + (sx > 0 ? 0 : Math.PI));
    const hip = b[`leg${side}_hip`], knee = b[`leg${side}_knee`], foot = b[`leg${side}_foot`];
    // one knee down (the right), the left foot planted forward; dying he drops to both knees
    const kneelLeg = Math.max(side === 'R' ? kneel : 0, step(dead, 0, 0.5)), standLeg = side === 'L' ? kneel * (1 - step(dead, 0, 0.5)) : 0;
    // lying the legs ride the body (stretched along the coffin); sitting up the hips flex so they stay flat, then swing
    // down under him as he stands (the knees bend through it)
    const sitHip = -1.52 * sit * (1 - stand), rising = bump(stand, 0, 1);
    R(hip, -0.5 * lsw * moving + sitHip - 0.6 * rising - 1.35 * standLeg + 0.25 * kneelLeg, 0, sx * 0.05);
    R(knee, (0.3 + 0.45 * Math.max(0, lsw)) * moving + 1.2 * rising + 1.45 * standLeg + 1.55 * kneelLeg, 0, 0);
    R(foot, -0.15 * lsw * moving - 0.3 * kneelLeg - 0.1 * standLeg, 0, 0);
  }
}
