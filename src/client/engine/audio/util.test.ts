import { expect, test } from 'vitest';
import { spatialAudio } from './util';

const ear = { x: 10, y: 2, z: -4 };

test('spatial calls retain the inclusive 3D reach and near-centred pan', () => {
  expect(spatialAudio({ ...ear, y: 162 }, ear, 0, 160, 14, 1.3)).toEqual({
    dist: 160, gain: 1 / (1 + 160 / 14) ** 1.3, pan: 0,
  });
  expect(spatialAudio({ ...ear, y: 162.001 }, ear, 0, 160, 14, 1.3)).toBeNull();
  expect(spatialAudio({ ...ear, x: 10.5 }, ear, 0, 160, 14, 1.3)?.pan).toBe(0);
});

test('gull and creature policies keep their own rolloff and listener orientation', () => {
  const at = { ...ear, x: 24 };
  expect(spatialAudio(at, ear, 0, 160, 14, 1.3)).toEqual({ dist: 14, gain: 2 ** -1.3, pan: 0.8 });
  expect(spatialAudio(at, ear, Math.PI, 140, 9)).toEqual({ dist: 14, gain: 1 / (1 + 14 / 9) ** 1.4, pan: -0.8 });
  expect(spatialAudio(at, ear, Math.PI / 2, 140, 9)?.pan).toBeCloseTo(0, 14);
});
