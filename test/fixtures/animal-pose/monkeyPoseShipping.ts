import { MathUtils } from 'three';
import type { AnimalRigContext, AnimalRigJoint } from '@wildshard/engine/entities/animalRig';
import { bump, clamp, lookAngles, smooth01, squashBody, step } from '@wildshard/engine/entities/species/rigs';
import type { MonkeyMem } from '../species-oracle/monkeyPolicy';

type Side = 'L' | 'R';
type MonkeyBones = Record<'body' | 'spine' | 'chest' | 'head' | `tail${1 | 2 | 3}` | `arm${Side}_${'sh' | 'el' | 'hand'}` | `leg${Side}_${'hip' | 'knee' | 'foot'}`, AnimalRigJoint>;
const R = (b: AnimalRigJoint,x:number,y:number,z:number) => b.rotation.set(x,y,z);
const L = MathUtils.lerp;

export function animateMonkey(c: AnimalRigContext): void {
  const b = c.bones as MonkeyBones, t = c.t, seed = c.seed, m = c.mem as MonkeyMem, a = c.animal, dt = c.dt;
  // ── vertical: the drop (ballistic) and the climb (2.2 m/s up the trunk, sliding from the foot to the crown) run here, per frame ──
  if (m.drop) {
    m.vy = (m.vy || 0) - 9.8 * dt;
    a.yOffset += m.vy * dt;
    if (a.yOffset <= 0) { a.yOffset = 0; m.drop = 0; m.vy = 0; m.land = 0.35; }
  } else if (m.climb && m.perchH > 0) {
    a.yOffset = Math.min(m.perchH, a.yOffset + 2.2 * dt);
    const k = m.perchH > 0.01 ? a.yOffset / m.perchH : 1;
    a.position.x = L(m.bx, m.px, k); a.position.z = L(m.bz, m.pz, k);
    if (a.yOffset >= m.perchH - 1e-3) { m.climb = 0; a.position.x = m.px; a.position.z = m.pz; }
  }
  m.land = Math.max(0, (m.land || 0) - dt);
  const dead = c.deathT >= 0 ? smooth01(c.deathT) : 0;
  const perched = c.state === 'perch' || (c.state === 'attack' && !m.bite && m.onGround !== 1);
  const moving = clamp(Math.hypot(c.speed, c.strafe) / 1.0, 0, 1);
  const ph = c.phase * Math.PI * 2;
  const atk = c.attack;
  const look = lookAngles(c, 0.75);
  // ── base pose weights: sitting (perch), all-fours scamper (moving), standing crouch (ground idle), falling, climbing ──
  const sit = perched ? 1 : 0, fall = m.drop ? 1 : 0, climb = m.climb ? 1 : 0;
  const run = (1 - sit) * (1 - fall) * (1 - climb) * moving;
  const crouch = (1 - sit) * (1 - fall) * (1 - climb) * (1 - moving);
  // body: sits low with the chest up; scampers pitched forward; a landing squat
  const landK = bump(m.land, 0, 0.35);
  b.body.position.y = c.dims.bodyY - 0.13 * sit - 0.08 * run - 0.05 * crouch - 0.12 * landK + 0.02 * Math.sin(ph * 2) * run + 0.005 * Math.sin(t * 1.6 + seed) - 0.30 * dead;
  R(b.body, 0.25 * sit + 0.65 * run + 0.35 * crouch + 0.2 * fall + 0.35 * landK + 0.35 * c.flinch + dead - 0.6 * climb, 0, 0.04 * Math.sin(ph) * run);
  R(b.spine, -0.15 * sit - 0.1 * run + 0.15 * c.brace + 0.2 * dead, look.yaw * 0.25, 0);
  R(b.chest, -0.1 * sit + 0.1 * c.brace, look.yaw * 0.25, 0);
  // head: looks at you; the bite lunges it forward
  let headP = -0.25 * sit - 0.5 * run - 0.3 * crouch + 0.35 * c.flinch + 0.5 * dead + 0.3 * climb;
  if (atk >= 0 && m.bite) headP += 0.5 * bump(atk, 0.2, 0.7);
  R(b.head, headP - look.pitch * 0.6, look.yaw * 0.5, 0.08 * Math.sin(t * 0.9 + seed * 3) * sit);
  // ── arms ──
  const scratch = sit ? bump(((t + seed * 7) % 9) / 9, 0.55, 0.75) : 0;   // now and then a hand comes up to scratch the head
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    const sh = b[`arm${side}_sh`], el = b[`arm${side}_el`];
    const sw = Math.sin(ph + (sx > 0 ? 0 : Math.PI));
    let shX = 0.35 * sit + (0.9 + 0.7 * sw) * run + 0.5 * crouch - 1.6 * fall + (side === 'R' ? 0.25 : 0.15) * dead;
    let elX = -0.4 * sit - (0.5 + 0.4 * Math.max(0, -sw)) * run - 0.6 * crouch - 0.6 * fall;
    let shZ = sx * (0.15 * sit + 0.1 * run + 0.9 * fall + 0.35 * dead);
    if (climb) { const cs = Math.sin(t * 6 + (sx > 0 ? 0 : Math.PI)); shX = -1.9 + 0.5 * cs; elX = -0.8 + 0.4 * cs; shZ = sx * 0.3; }
    if (scratch > 0 && side === 'L') { shX = L(shX, -1.4, scratch); elX = L(elX, -2.2, scratch); shZ = L(shZ, sx * 0.9, scratch); }
    if (atk >= 0) {
      if (m.bite) { const lunge = bump(atk, 0.15, 0.75); shX = L(shX, -1.1, lunge); elX = L(elX, -0.2, lunge); shZ = L(shZ, sx * 0.5, lunge); }
      else if (side === 'R') {
        // the throw: the arm winds back over the head (0 → 0.6), whips forward (0.6 → 0.75), drops back
        const wind = step(atk, 0, 0.58), whip = step(atk, 0.6, 0.76), rec = step(atk, 0.82, 1);
        const target = L(-2.8, 0.9, whip);
        shX = L(L(shX, -2.8, wind), target, whip) * (1 - rec) + shX * rec;
        elX = L(L(elX, -1.2, wind), -0.15, whip) * (1 - rec) + elX * rec;
        shZ = L(shZ, sx * 0.5, wind) * (1 - rec) + shZ * rec;
      } else { const wind = step(atk, 0, 0.58) * (1 - step(atk, 0.82, 1)); shX = L(shX, -0.6, wind); shZ = L(shZ, sx * 0.4, wind); }
    }
    R(sh, shX + 0.3 * c.brace, 0, shZ);
    R(el, elX, 0, 0);
    // legs: folded under while sitting, kicking while scampering, tucked while falling
    const hip = b[`leg${side}_hip`], knee = b[`leg${side}_knee`], foot = b[`leg${side}_foot`];
    const lsw = Math.sin(ph + (sx > 0 ? Math.PI : 0));
    let hipX = -1.5 * sit + (-0.5 + 0.6 * lsw) * run - crouch - 1.2 * fall - 0.6 * dead - 0.9 * climb - 0.7 * landK;
    let kneeX = 2.3 * sit + (0.9 + 0.5 * Math.max(0, lsw)) * run + 1.7 * crouch + 1.4 * fall + 0.8 * dead + 1.4 * climb + 1.2 * landK;
    if (climb) { const cs = Math.sin(t * 6 + (sx > 0 ? Math.PI : 0)); hipX += 0.4 * cs; kneeX += 0.3 * cs; }
    R(hip, hipX, 0, sx * (0.25 * sit + 0.1 + 0.4 * fall));
    R(knee, kneeX, 0, 0);
    R(foot, -0.4 * sit - 0.3 * run - 0.5 * crouch + 0.3 * fall, 0, 0);
  }
  // ── tail: curls up over the back at rest, streams behind on the run, lashes while it winds up ──
  const lash = atk >= 0 && !m.bite ? 0.6 * Math.sin(t * 9) * step(atk, 0, 0.5) : 0;
  const curl = 0.9 * sit + 0.4 * crouch + 0.2 * run + 0.7 * climb - 0.9 * dead;
  R(b.tail1, -0.5 * curl - 0.4 * run + 0.9 * dead, 0, 0.25 * Math.sin(t * 1.7 + seed) * (1 - run) + lash * 0.4);
  R(b.tail2, -0.8 * curl + 0.3 * Math.sin(t * 2.1 + seed) * sit, 0, 0.2 * Math.sin(t * 1.7 + 1 + seed) + lash * 0.6);
  R(b.tail3, -0.9 * curl + 0.4 * Math.sin(t * 2.6 + seed), 0, lash);
  squashBody(b.body, c.flinch);
}
