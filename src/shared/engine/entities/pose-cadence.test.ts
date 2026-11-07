import { expect, test } from 'vitest';
import { poseEvery } from './poseCadence';

test('FC11: bones pose every frame within 30 m, every 2nd to 70 m, every 4th beyond', () => {
  expect([0, 29.9, 30, 69.9, 70, 139].map((d) => poseEvery(d * d))).toEqual([1, 1, 2, 2, 4, 4]);
});
