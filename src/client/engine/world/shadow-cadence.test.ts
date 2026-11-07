import { expect, test } from 'vitest';
import { cascadeRedraws } from './shadowCadence';

test('BA-3: the near cascade every frame, the middle every 2nd, the far every 4th, never both', () => {
  const ticks = [0, 1, 2, 3].map(tick => cascadeRedraws(tick, 3));
  expect(ticks).toEqual([[true, false, true], [true, true, false], [true, false, false], [true, true, false]]);
  const maps = ticks.map(row => row.filter(Boolean).length);
  expect(maps.reduce((a, b) => a + b) / 4).toBe(1.75); expect(Math.max(...maps)).toBe(2);
  expect(cascadeRedraws(3, 2)).toEqual([true, false]); expect(cascadeRedraws(5, 1)).toEqual([true]);
});
