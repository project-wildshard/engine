import { afterEach, expect, test } from 'vitest';
import { initializeTier, TIER } from '../core/tier';
import { arrivalTier, mobileDevice } from './titleArrival';

const original = TIER;
afterEach(() => { initializeTier(original); });

test('cold arrival metadata follows each configured renderer tier', () => {
  for (const tier of ['phone', 'desktop', 'phone'] as const) {
    initializeTier(tier);
    expect(TIER).toBe(tier);
    expect(arrivalTier.current).toBe(tier);
  }
});

test('cold and rendered entry share the original mobile classification', () => {
  expect(mobileDevice('iPhone', 'iPhone', 1)).toBe(true);
  expect(mobileDevice('Android', 'Linux', 1)).toBe(true);
  expect(mobileDevice('Macintosh', 'MacIntel', 2)).toBe(true);
  expect(mobileDevice('Macintosh', 'MacIntel', 0)).toBe(false);
});
