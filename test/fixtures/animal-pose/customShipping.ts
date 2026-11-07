import * as THREE from 'three';
import type { AnimalRigContext, AnimalRigJoint } from '../../../src/shared/engine/entities/animalRig';
import { lookAngles, smooth01, bump, step, clamp, squashBody } from '../../../src/shared/engine/entities/species/rigs';
type CaptainMem=Record<string,number>&{init:number;rise:number;phase:number};
import type { MonkeyMem } from '../species-oracle/monkeyPolicy';
type Side='L'|'R';type LegIdx=0|1|2;
type CrabBones=Record<'body'|'head'|`claw${Side}_${'arm'|'hand'|'tip'}`|`leg${Side}${LegIdx}_${'hip'|'knee'}`,AnimalRigJoint>;
type MonkeyBones=Record<'body'|'spine'|'chest'|'head'|`tail${1|2|3}`|`arm${Side}_${'sh'|'el'|'hand'}`|`leg${Side}_${'hip'|'knee'|'foot'}`,AnimalRigJoint>;
type SailorBones=Record<'body'|'spine'|'chest'|'head'|`arm${Side}_${'sh'|'el'|'hand'}`|`leg${Side}_${'hip'|'knee'|'foot'}`,AnimalRigJoint>;
type CaptainBones=SailorBones;
type SailorMem=Record<string,number>&{init:number;rise:number;rising:number;sinking:number;floor:number;floorS?:number};
const LEG_IDX:readonly LegIdx[]=[0,1,2],TRIPOD_A=new Set(['L0','R1','L2']);
const R=(b:AnimalRigJoint,x:number,y:number,z:number)=>b.rotation.set(x,y,z),L=THREE.MathUtils.lerp,RISE_T=1.5;
export function shippingCrab(c: AnimalRigContext): void {
  const b = c.bones as CrabBones, t = c.t, seed = c.seed;
  const moving = clamp(Math.hypot(c.speed, c.strafe) / 0.5, 0, 1);
  const strafeK = clamp(c.strafe / 1.3, -1, 1);
  const fwdK = clamp(c.speed / 1.5, -1, 1);
  const dead = c.deathT >= 0 ? smooth01(c.deathT) : 0;
  const engaged = c.state === 'sidestep' || c.state === 'attack' || c.state === 'alert';
  const atk = c.attack;
  // ── claws: raised while engaged, the snap = raise both over 2/3 of the attack then slam down and shut ──
  let raise = engaged ? 0.55 : 0.15, spread = engaged ? 0.25 : 0.0, open = engaged ? 0.35 : 0.1;
  if (atk >= 0) {
    const wind = step(atk, 0, 0.62), slam = step(atk, 0.64, 0.78), rec = step(atk, 0.86, 1);
    raise = THREE.MathUtils.lerp(raise, 1.35, wind) * (1 - slam) + 0.05 * slam * (1 - rec) + raise * rec;
    open = THREE.MathUtils.lerp(open, 0.85, wind) * (1 - slam) + 0.0 * slam;
    spread = THREE.MathUtils.lerp(spread, 0.55, wind) * (1 - slam) - 0.25 * slam;
  }
  raise += 0.5 * c.brace - 0.9 * dead;                          // braced: claws up; dead: claws drop
  const twitch = 0.05 * Math.sin(t * 2.7 + seed * 5);
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    const arm = b[`claw${side}_arm`], hand = b[`claw${side}_hand`], tip = b[`claw${side}_tip`];
    arm.rotation.set(-raise * 0.7, sx * (spread * 0.6 + twitch), sx * raise * 0.35);
    hand.rotation.set(-raise * 0.5, sx * spread * 0.5, 0);
    tip.rotation.set(0, sx * -(open * 0.6), -sx * open * 0.15);
  }
  // ── legs: two tripods, lift + swing; the sidestep reaches the leading legs out and folds the trailing ones ──
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    for (const i of LEG_IDX) {
      const hip = b[`leg${side}${i}_hip`], knee = b[`leg${side}${i}_knee`];
      const lp = (c.phase + (TRIPOD_A.has(side + i) ? 0 : 0.5)) % 1;
      const swing = lp < 0.42 ? Math.sin((lp / 0.42) * Math.PI) : 0;           // in the air
      const along = lp < 0.42 ? -Math.cos((lp / 0.42) * Math.PI) : 1 - 2 * ((lp - 0.42) / 0.58);   // -1 → 1 forward in the air, back on the ground
      const lift = swing * 0.42 * moving;
      // + rotation.z on a left leg raises it; rotation.y swings it along the body (sign by side)
      const reach = strafeK * sx;                                             // this side leads the sidestep
      const idle = (1 - moving) * 0.03 * Math.sin(t * 1.3 + i * 1.9 + seed * 3);
      hip.rotation.set(0, -sx * along * 0.30 * fwdK * moving, sx * (lift + idle + 0.22 * reach * swing));
      knee.rotation.set(0, 0, sx * (0.25 * swing * moving - 0.30 * reach * (1 - swing) * moving + 0.55 * c.flinch));
      if (dead > 0) { hip.rotation.z = sx * (0.15 + 0.5 * dead); knee.rotation.z = sx * 1.25 * dead; }
    }
  }
  // ── body: bob with the skitter, a low crouch when braced / flinching, drops to the sand when dead ──
  const bob = 0.012 * Math.sin(c.phase * Math.PI * 4) * moving;
  b.body.position.y = c.dims.bodyY + bob + 0.006 * Math.sin(t * 1.5 + seed) - 0.05 * c.brace - 0.03 * c.flinch - 0.11 * dead + 0.03 * (atk >= 0 ? bump(atk, 0.6, 0.85) : 0);
  b.body.rotation.set(0.05 * c.flinch + 0.08 * (atk >= 0 ? step(atk, 0, 0.62) : 0) - 0.06 * dead, 0, strafeK * 0.06 * moving);
  // ── eyestalks follow the target ──
  const look = lookAngles(c, 0.36, 1.0, 0.5);
  b.head.rotation.set(-look.pitch * 0.4 + 0.15 * dead, look.yaw * 0.6, 0.06 * Math.sin(t * 3.1 + seed * 7));
  squashBody(b.body, c.flinch);
}

export function shippingMonkey(c: AnimalRigContext): void {
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

export function shippingSailor(c: AnimalRigContext): void {
  const b = c.bones as SailorBones, t = c.t, seed = c.seed, m = c.mem as SailorMem, a = c.animal, dt = c.dt;
  // ── rising / sinking through the deck (per frame, smooth): mem.rise 0 (under) → 1 (standing) ──
  if (m.rising) { m.rise = Math.min(1, (m.rise || 0) + dt / RISE_T); if (m.rise >= 1) m.rising = 0; }
  if (m.sinking) { m.rise = Math.max(0, (m.rise || 0) - dt / RISE_T); if (m.rise <= 0) m.sinking = 0; }
  const up = m.init ? smooth01(m.rise || 0) : 0;
  const floor = m.floor || 0;
  m.floorS = (m.floorS ?? floor) + (floor - (m.floorS ?? floor)) * Math.min(1, dt * 6);   // the deck under it, smoothed (it steps off the heeled deck onto the sand)
  a.yOffset = L(m.floorS - 2.3, m.floorS, up);
  const rise = 1 - up;
  const dead = c.deathT >= 0 ? smooth01(c.deathT) : 0;
  const moving = clamp(c.speed / 0.8, 0, 1);
  const ph = c.phase * Math.PI * 2;
  const atk = c.attack;
  const look = lookAngles(c, 1.6, 0.9, 0.5);
  const sway = Math.sin(t * 0.8 + seed * 4);
  // ── body: hunched, lurching with the shamble; dies to its knees then face down ──
  const kneel = step(dead, 0, 0.5), topple = step(dead, 0.45, 1);
  b.body.position.y = c.dims.bodyY - 0.06 - 0.04 * Math.abs(Math.sin(ph)) * moving - 0.08 * c.brace - 0.42 * kneel - 0.25 * topple + 0.02 * sway * (1 - moving);
  let bodyP = 0.28 + 0.1 * moving + 0.15 * c.brace - 0.35 * rise + 1.35 * topple;
  let spineY = 0.06 * sway, headP = -0.15 + 0.2 * c.flinch + 0.25 * kneel + 0.3 * topple;
  const headZ = 0.15 * Math.sin(t * 0.6 + seed);
  // ── the cutlass swing: wind up over the head (0 → 0.62), the cut (0.62 → 0.78), recover ──
  let swX = 0.2, swZ = -0.25, elR = -0.5;
  const swY = 0;
  if (atk >= 0) {
    const wind = step(atk, 0, 0.6), cut = step(atk, 0.62, 0.78), rec = step(atk, 0.85, 1);
    swX = L(L(0.2, -2.7, wind), 0.95, cut) * (1 - rec) + 0.2 * rec;
    swZ = L(L(-0.25, -0.9, wind), 0.2, cut) * (1 - rec) - 0.25 * rec;
    elR = L(L(-0.5, -0.9, wind), -0.15, cut) * (1 - rec) - 0.5 * rec;
    bodyP += L(L(0, -0.25, wind), 0.45, cut) * (1 - rec);
    spineY += L(L(0, 0.45, wind), -0.5, cut) * (1 - rec);
    headP += 0.2 * cut * (1 - rec);
  }
  R(b.body, bodyP, 0, 0.03 * sway);
  R(b.spine, 0.1 + 0.05 * c.brace, spineY + look.yaw * 0.3, 0.04 * Math.sin(t * 0.7 + seed));
  R(b.chest, 0.08, look.yaw * 0.2, 0);
  R(b.head, headP - look.pitch * 0.5 - 0.6 * rise, look.yaw * 0.5, headZ);
  // ── arms: the left hangs and swings stiffly; the right carries the cutlass low, or swings it ──
  const armSw = Math.sin(ph) * 0.35 * moving;
  const riseArms = rise > 0.02 ? -2.2 * bump(1 - rise, 0, 0.9) - 0.3 * rise : 0;   // arms come up as it surfaces, then drop
  R(b.armL_sh, 0.15 - armSw + riseArms + 0.4 * c.brace + 0.6 * dead, 0, 0.25 + 0.3 * rise);
  R(b.armL_el, -0.35 - 0.2 * Math.max(0, -armSw) - 0.6 * rise, 0, 0.1);
  R(b.armR_sh, swX + armSw * 0.5 + riseArms * 0.8 + 0.8 * dead, swY, swZ - 0.2 * rise);
  R(b.armR_el, elR - 0.5 * rise, 0, -0.1);
  R(b.armR_hand, 0.35, 0, 0);
  // ── legs: a stiff-kneed shamble, knees dropping when it dies ──
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    const lsw = Math.sin(ph + (sx > 0 ? 0 : Math.PI));
    const hip = b[`leg${side}_hip`], knee = b[`leg${side}_knee`], foot = b[`leg${side}_foot`];
    R(hip, -0.55 * lsw * moving - 0.1 * c.brace - 0.1 + 0.15 * kneel - 0.4 * topple, 0, sx * 0.08);
    R(knee, (0.35 + 0.4 * Math.max(0, lsw)) * moving + 0.15 * c.brace + 0.15 + 1.9 * kneel, 0, 0);
    R(foot, -0.15 * lsw * moving - 0.1, 0, 0);
  }
  squashBody(b.body, c.flinch);
}

export function shippingCaptain(c: AnimalRigContext): void {
  const b = c.bones as CaptainBones, t = c.t, seed = c.seed, m = c.mem as CaptainMem;
  // the rise / sink clock and his feet under the pool run on the body step (captainPolicy.ts advanceCaptainRise); the
  // pose only reads them
  const up = m.init ? smooth01(m.rise || 0) : 0;
  const rise = 1 - up;
  const dead = c.deathT >= 0 ? smooth01(c.deathT) : 0;
  const moving = clamp(c.speed / 0.9, 0, 1);
  const ph = c.phase * Math.PI * 2;
  const atk = c.attack;
  const look = lookAngles(c, 1.6, 0.9, 0.5);
  const sway = Math.sin(t * 0.7 + seed * 4);
  const rage = (m.phase || 0) >= 3 ? 1 : 0;
  const kneel = step(dead, 0, 0.5), topple = step(dead, 0.45, 1);
  b.body.position.y = c.dims.bodyY - 0.05 - 0.05 * Math.abs(Math.sin(ph)) * moving - 0.1 * c.brace - 0.42 * kneel - 0.25 * topple + 0.02 * sway * (1 - moving);
  let bodyP = 0.16 + 0.12 * moving + 0.1 * rage + 0.15 * c.brace - 0.4 * rise + 1.35 * topple;
  let spineY = 0.06 * sway;
  let headP = -0.1 + 0.2 * c.flinch + 0.25 * kneel + 0.3 * topple;
  let swX = 0.25, swZ = -0.3, elR = -0.45;
  if (atk >= 0) {
    const wind = step(atk, 0, 0.62), cut = step(atk, 0.64, 0.8), rec = step(atk, 0.86, 1);
    swX = L(L(0.25, -2.9, wind), 1.05, cut) * (1 - rec) + 0.25 * rec;
    swZ = L(L(-0.3, -1.0, wind), 0.25, cut) * (1 - rec) - 0.3 * rec;
    elR = L(L(-0.45, -1.0, wind), -0.1, cut) * (1 - rec) - 0.45 * rec;
    bodyP += L(L(0, -0.3, wind), 0.5, cut) * (1 - rec);
    spineY += L(L(0, 0.5, wind), -0.55, cut) * (1 - rec);
    headP += 0.2 * cut * (1 - rec);
  }
  R(b.body, bodyP, 0, 0.03 * sway);
  R(b.spine, 0.08 + 0.05 * c.brace, spineY + look.yaw * 0.3, 0.04 * Math.sin(t * 0.6 + seed));
  R(b.chest, 0.06 - 0.1 * rage, look.yaw * 0.2, 0);
  R(b.head, headP - look.pitch * 0.5 - 0.7 * rise, look.yaw * 0.5, 0.1 * Math.sin(t * 0.5 + seed));
  const armSw = Math.sin(ph) * 0.3 * moving;
  const riseArms = rise > 0.02 ? -2.4 * bump(1 - rise, 0, 0.9) - 0.3 * rise : 0;
  R(b.armL_sh, 0.1 - armSw + riseArms + 0.4 * c.brace + 0.6 * dead - 0.6 * rage * (0.5 + 0.5 * Math.sin(t * 5)), 0, 0.3 + 0.3 * rise);
  R(b.armL_el, -0.4 - 0.2 * Math.max(0, -armSw) - 0.6 * rise, 0, 0.1);
  R(b.armR_sh, swX + armSw * 0.5 + riseArms * 0.8 + 0.8 * dead, 0, swZ - 0.2 * rise);
  R(b.armR_el, elR - 0.5 * rise, 0, -0.1);
  R(b.armR_hand, 0.35, 0, 0);
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    const lsw = Math.sin(ph + (sx > 0 ? 0 : Math.PI));
    R(b[`leg${side}_hip`], -0.5 * lsw * moving - 0.1 * c.brace - 0.1 + 0.15 * kneel - 0.4 * topple, 0, sx * 0.07);
    R(b[`leg${side}_knee`], (0.3 + 0.4 * Math.max(0, lsw)) * moving + 0.15 * c.brace + 0.12 + 1.9 * kneel, 0, 0);
    R(b[`leg${side}_foot`], -0.15 * lsw * moving - 0.1, 0, 0);
  }
}
