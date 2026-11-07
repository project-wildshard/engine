import { expect, test } from 'vitest';
import { Euler, Vector3 } from 'three';
import { poseCreatureStride } from '../../../test/engine/creatureStride';

test('stride alternates borrowed legs and layers fold, refusing invalid input before posing', () => {
  const joint = () => ({ position: new Vector3(), rotation: new Euler(), scale: new Vector3(1, 1, 1) });
  const bones = { legL_hip: joint(), legL_knee: joint(), legL_foot: joint(), legR_hip: joint(), legR_knee: joint(), legR_foot: joint() };
  const profile = { hip: .5, knee: .3, spread: .07 };
  poseCreatureStride(bones, Math.PI / 2, 1, 0, 0, 0, profile);
  expect(bones.legL_hip.rotation.x).toBeLessThan(bones.legR_hip.rotation.x);
  expect(bones.legL_knee.rotation.x).toBeGreaterThan(bones.legR_knee.rotation.x);
  const hip = bones.legL_hip.rotation.x, knee = bones.legL_knee.rotation.x;
  poseCreatureStride(bones, Math.PI / 2, 1, 0, 1, 0, profile, .2);
  expect(bones.legL_hip.rotation.x).toBeGreaterThan(hip);
  expect(bones.legL_knee.rotation.x).toBeGreaterThan(knee);
  const snapshot = () => Object.values(bones).map(bone => [bone.position.toArray(), bone.rotation.toArray(), bone.scale.toArray()]);
  const saved = snapshot();
  expect(() => poseCreatureStride(bones, Number.NaN, 1, 0, 0, 0, profile)).toThrow('stride');
  expect(() => poseCreatureStride(bones, 0, 1, 0, 0, 0, { ...profile, kneeFold: Infinity })).toThrow('stride');
  const missing = { ...bones }; Reflect.deleteProperty(missing, 'legR_foot');
  expect(() => poseCreatureStride(missing, 0, 1, 0, 0, 0, profile)).toThrow('stride');
  expect(snapshot()).toEqual(saved);
});
