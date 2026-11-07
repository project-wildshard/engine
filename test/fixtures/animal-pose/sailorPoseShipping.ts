/** Frozen predecessor pose; do not update to follow the data implementation. */
import type { AnimalRigContext, AnimalRigJoint } from '../../../src/shared/engine/entities/animalRig';
import { bump, clamp, lookAngles, smooth01, squashBody, step } from '../../../src/shared/engine/entities/species/rigs';
import { stepCreatureLift } from '../../../src/shared/game/plugin/animation';
import { poseCreatureStride } from '@wildshard/engine/test/creatureStride';
import { sampleCreatureSwing } from '../creatureSwing';

type Side = 'L' | 'R';
type SailorBones = Record<'body' | 'spine' | 'chest' | 'head' | `arm${Side}_${'sh' | 'el' | 'hand'}` | `leg${Side}_${'hip' | 'knee' | 'foot'}`, AnimalRigJoint>;
const R = (b: AnimalRigJoint,x:number,y:number,z:number) => b.rotation.set(x,y,z);

const SWING = { wind: [0, .6], cut: [.62, .78], recover: [.85, 1],
  channels: { swX: [.2, -2.7, .95], swZ: [-.25, -.9, .2], elR: [-.5, -.9, -.15], body: [0, -.25, .45], spine: [0, .45, -.5], head: [0, 0, .2] } } as const;
const STRIDE = { hip: .55, knee: .35, spread: .08, kneeRest: .15 };
const swing = { swX: 0, swZ: 0, elR: 0, body: 0, spine: 0, head: 0 };

export function animateSailor(c: AnimalRigContext): void {
  const b = c.bones as SailorBones, t = c.t, seed = c.seed, a = c.animal, dt = c.dt;
  // ── rising / sinking through the deck (per frame, smooth): mem.rise 0 (under) → 1 (standing) ──
  const up = stepCreatureLift(a, dt, 1.5, 1.5, -2.3, 6);
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
  sampleCreatureSwing(atk, SWING, swing);
  R(b.body, 0.28 + 0.1 * moving + 0.15 * c.brace - 0.35 * rise + 1.35 * topple + swing.body, 0, 0.03 * sway);
  R(b.spine, 0.1 + 0.05 * c.brace, 0.06 * sway + swing.spine + look.yaw * 0.3, 0.04 * Math.sin(t * 0.7 + seed));
  R(b.chest, 0.08, look.yaw * 0.2, 0);
  R(b.head, -0.15 + 0.2 * c.flinch + 0.25 * kneel + 0.3 * topple + swing.head - look.pitch * 0.5 - 0.6 * rise, look.yaw * 0.5, 0.15 * Math.sin(t * 0.6 + seed));
  // ── arms: the left hangs and swings stiffly; the right carries the cutlass low, or swings it ──
  const armSw = Math.sin(ph) * 0.35 * moving;
  const riseArms = rise > 0.02 ? -2.2 * bump(1 - rise, 0, 0.9) - 0.3 * rise : 0;   // arms come up as it surfaces, then drop
  R(b.armL_sh, 0.15 - armSw + riseArms + 0.4 * c.brace + 0.6 * dead, 0, 0.25 + 0.3 * rise);
  R(b.armL_el, -0.35 - 0.2 * Math.max(0, -armSw) - 0.6 * rise, 0, 0.1);
  R(b.armR_sh, swing.swX + armSw * 0.5 + riseArms * 0.8 + 0.8 * dead, 0, swing.swZ - 0.2 * rise);
  R(b.armR_el, swing.elR - 0.5 * rise, 0, -0.1);
  R(b.armR_hand, 0.35, 0, 0);
  // ── legs: a stiff-kneed shamble, knees dropping when it dies ──
  poseCreatureStride(b, ph, moving, c.brace, kneel, topple, STRIDE);
  squashBody(b.body, c.flinch);
}
