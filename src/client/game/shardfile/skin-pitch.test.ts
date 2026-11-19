// ONE-FORMAT CC58b2: the page leans a horizontal biped's spine by its contract's pitch, once a frame, whatever the driver did.
import { expect, test } from 'vitest';
import { Bone, Quaternion, Vector3 } from 'three';
import { HORIZONTAL_SPINE_PITCH } from '@wildshard/format/creatureSkeletons';
import { SkinPitch } from './clientSkins';

/** How far apart two rotations are, safe where `angleTo`'s acos sees a dot a hair over 1. */
const apart = (a: Quaternion, b: Quaternion): number => 1 - Math.min(1, Math.abs(a.dot(b)));

const lean = (angle: number): Quaternion => new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), angle);

test('a bone the driver leaves alone keeps one pitch across frames', () => {
  const spine = new Bone(), bones = { spine }, pitch = new SkinPitch({ bone: 'spine', angle: HORIZONTAL_SPINE_PITCH });
  for (let frame = 0; frame < 5; frame++) { pitch.before(bones); pitch.after(bones); }
  expect(apart(spine.quaternion, lean(HORIZONTAL_SPINE_PITCH))).toBeLessThan(1e-9);
});

test('a bone the driver rewrites each frame takes the pitch over its pose', () => {
  const spine = new Bone(), bones = { spine }, pitch = new SkinPitch({ bone: 'spine', angle: 1.3 });
  const sway = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.2);
  for (let frame = 0; frame < 3; frame++) { pitch.before(bones); spine.quaternion.copy(sway); pitch.after(bones); }
  expect(apart(spine.quaternion, lean(1.3).multiply(sway))).toBeLessThan(1e-9);
  // the driver's leaned spine points its child up-and-forward: +y turns toward +z
  const up = new Vector3(0, 1, 0).applyQuaternion(lean(1.3));
  expect(up.z).toBeCloseTo(Math.sin(1.3), 9);
});

test('a skin without the bone is left alone', () => {
  const hips = new Bone(), pitch = new SkinPitch({ bone: 'spine', angle: 1.3 });
  pitch.before({ hips }); pitch.after({ hips });
  expect(apart(hips.quaternion, new Quaternion())).toBeLessThan(1e-9);
});
