import type { AnimalRigContext } from '../../../src/shared/engine/entities/animalRig';
const STIFF: readonly string[] = ['FL_carpus', 'FR_carpus', 'FL_fetlock', 'FR_fetlock', 'BL_stifle', 'BR_stifle', 'BL_hock', 'BR_hock'];

// Frozen before the numeric pose migration; no production dependency.
export function shippingThrall(c: AnimalRigContext & { animal: AnimalRigContext['animal'] & { variant: string } }): void {
  if (c.animal.variant !== 'thrall' || !c.alive) return;
  const b = c.bones;
  for (const n of STIFF) { const bone = b[n]; if (bone) bone.rotation.x *= 0.3; }
  const twitch = Math.max(0, Math.sin(c.t * 4.6 + c.seed * 7.1)) ** 14;   // a sharp jerk, ~every 1.4 s
  const side = Math.sin(c.seed * 13.7) > 0 ? 1 : -1;
  const neck = b['neck1'], head = b['head'], body = b['body'];
  if (neck) neck.rotation.x += 0.1;
  if (head) { head.rotation.x += 0.08 + 0.1 * twitch; head.rotation.y += 0.35 * twitch * side; head.rotation.z += 0.3 * twitch * side; }
  const moving = Math.min(1, Math.abs(c.speed) / 1.2);
  if (body) body.rotation.z += 0.05 * moving * Math.sin(c.phase * Math.PI * 2);
}
