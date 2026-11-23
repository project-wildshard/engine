import { expect, test } from 'vitest';
import { mediumOn } from '../src/client/engine/core/desktopPreset';

// DRIFTWOOD-FPS DF14, J495: Medium is a desktop pick only; a phone reads the same slot as its own Low / High
test('a saved medium picks desktop Medium on the desktop tier and nowhere else', () => {
  expect(mediumOn('desktop', 'medium')).toBe(true);
  expect(mediumOn('desktop', 'high')).toBe(false);
  expect(mediumOn('desktop', null)).toBe(false);
  expect(mediumOn('phone', 'medium')).toBe(false);
  expect(mediumOn('phone', 'low')).toBe(false);
});
