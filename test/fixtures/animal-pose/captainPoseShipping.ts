/** Frozen predecessor pose; do not update to follow the data implementation. */
import { poseCreatureStride } from '@wildshard/engine/test/creatureStride';
import { sampleCreatureSwing } from '../creatureSwing';
import type { AnimalRigContext, AnimalRigJoint } from '../../../src/shared/engine/entities/animalRig';
import { bump, clamp, lookAngles, smooth01, step } from '../../../src/shared/engine/entities/species/rigs';

type Side = 'L' | 'R';
type CaptainBones = Record<'body' | 'spine' | 'chest' | 'head' | `arm${Side}_${'sh' | 'el' | 'hand'}` | `leg${Side}_${'hip' | 'knee' | 'foot'}`, AnimalRigJoint>;
const R = (b: AnimalRigJoint,x:number,y:number,z:number) => b.rotation.set(x,y,z);

const SWING = { wind: [0, .62], cut: [.64, .8], recover: [.86, 1],
  channels: { swX: [.25, -2.9, 1.05], swZ: [-.3, -1, .25], elR: [-.45, -1, -.1], body: [0, -.3, .5], spine: [0, .5, -.55], head: [0, 0, .2] } } as const;
const STRIDE = { hip: .5, knee: .3, spread: .07 };
const swing = { swX: 0, swZ: 0, elR: 0, body: 0, spine: 0, head: 0 };

export function animateCaptain(c: AnimalRigContext): void {
  const b = c.bones as CaptainBones, t = c.t, seed = c.seed, m = c.mem;
  // the rise / sink clock and his feet under the pool run on the body step (admitted body-step offset); the
  // pose only reads them
  const up = m['init'] ? smooth01(m['rise'] ?? 0) : 0;
  const rise = 1 - up;
  const dead = c.deathT >= 0 ? smooth01(c.deathT) : 0;
  const moving = clamp(c.speed / 0.9, 0, 1);
  const ph = c.phase * Math.PI * 2;
  const atk = c.attack;
  const look = lookAngles(c, 1.6, 0.9, 0.5);
  const sway = Math.sin(t * 0.7 + seed * 4);
  const rage = (m['phase'] ?? 0) >= 3 ? 1 : 0;
  const kneel = step(dead, 0, 0.5), topple = step(dead, 0.45, 1);
  b.body.position.y = c.dims.bodyY - 0.05 - 0.05 * Math.abs(Math.sin(ph)) * moving - 0.1 * c.brace - 0.42 * kneel - 0.25 * topple + 0.02 * sway * (1 - moving);
  sampleCreatureSwing(atk, SWING, swing);
  R(b.body, 0.16 + 0.12 * moving + 0.1 * rage + 0.15 * c.brace - 0.4 * rise + 1.35 * topple + swing.body, 0, 0.03 * sway);
  R(b.spine, 0.08 + 0.05 * c.brace, 0.06 * sway + swing.spine + look.yaw * 0.3, 0.04 * Math.sin(t * 0.6 + seed));
  R(b.chest, 0.06 - 0.1 * rage, look.yaw * 0.2, 0);
  R(b.head, -0.1 + 0.2 * c.flinch + 0.25 * kneel + 0.3 * topple + swing.head - look.pitch * 0.5 - 0.7 * rise, look.yaw * 0.5, 0.1 * Math.sin(t * 0.5 + seed));
  const armSw = Math.sin(ph) * 0.3 * moving;
  const riseArms = rise > 0.02 ? -2.4 * bump(1 - rise, 0, 0.9) - 0.3 * rise : 0;
  R(b.armL_sh, 0.1 - armSw + riseArms + 0.4 * c.brace + 0.6 * dead - 0.6 * rage * (0.5 + 0.5 * Math.sin(t * 5)), 0, 0.3 + 0.3 * rise);
  R(b.armL_el, -0.4 - 0.2 * Math.max(0, -armSw) - 0.6 * rise, 0, 0.1);
  R(b.armR_sh, swing.swX + armSw * 0.5 + riseArms * 0.8 + 0.8 * dead, 0, swing.swZ - 0.2 * rise);
  R(b.armR_el, swing.elR - 0.5 * rise, 0, -0.1);
  R(b.armR_hand, 0.35, 0, 0);
  poseCreatureStride(b, ph, moving, c.brace, kneel, topple, STRIDE);
}
