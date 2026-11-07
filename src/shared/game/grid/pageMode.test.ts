import { afterEach, expect, test } from 'vitest';
import type { LevelSpec } from '@wildshard/engine/level/spec';
import { gridLevel, setPageMode } from './pageMode';

afterEach(() => { setPageMode('shard'); });
function level(): LevelSpec {
  return { id: 'bounds-policy', ground: {}, spawn: { x: 0, z: 0, yaw: 0 },
    sky: { sunColor: [1, 1, 1], sunIntensity: 1, envIntensity: 1, bgIntensity: 1, fogSunColor: [1, 1, 1], cloudSunColor: [1, 1, 1], hemiSky: 0, hemiGround: 0, hemiIntensity: 1 },
    atmosphere: { fogHeight: 0, fogHeightFalloff: 0, fogHeightDensity: 0, fogDistDensity: 0, volumetricSunColor: [1, 1, 1] },
    grade: { saturation: 1, brightness: 1, contrast: 1, bloomIntensity: 0, bloomThreshold: 1, shadowTint: [1, 1, 1], highTint: [1, 1, 1], lift: [0, 0, 0], gain: [1, 1, 1], gamma: 1 },
    budgets: {}, mechanisms: [], fight: {}, boot: { files: () => [] }, audio: { ambience: 'none', score: 'none' },
    loadout: { weapons: [], tools: [], start: [] }, species: [], spawns: [], minimap: {}, kitLook: 'pbr' };
}
test('standalone policy keeps the original level and its authored bounds', () => {
  const original = level(); original.boundary = { visible: true, walls: true };
  original.horizon = { rings: [], cloudSea: true };
  expect(gridLevel(original)).toBe(original);
  expect(original.boundary).toEqual({ visible: true, walls: true });
  expect(original.horizon.cloudSea).toBe(true);
});
test('grid policy replaces only walls and an existing horizon without mutating authored data', () => {
  setPageMode('grid');
  const original = level(); original.boundary = { visible: true, walls: true };
  const absent = gridLevel(original);
  expect(Object.hasOwn(absent, 'horizon')).toBe(false);
  original.horizon = { rings: [], cloudSea: true };
  const next = gridLevel(original);
  expect(next).toEqual({ ...original, boundary: { visible: false, walls: false }, horizon: { rings: [], cloudSea: false } });
  expect(next.ground).toBe(original.ground); expect(next.spawn).toBe(original.spawn); expect(next.sky).toBe(original.sky);
  expect(original.boundary).toEqual({ visible: true, walls: true }); expect(original.horizon.cloudSea).toBe(true);
});
