import { expect, test } from 'vitest';
import { TIER_TABLE } from './tiers';

/** NINE-DRAGON-BENCHMAX NB8: the slab runs and their size cut are the phone's; the desktop draws every slab chunk whole. */
test('only the phone tier cuts slab chunks', () => {
  expect(TIER_TABLE.desktop.slabRanges).toBe(false);
  expect(TIER_TABLE.desktop.slabLodAngle).toBe(0);
  expect(TIER_TABLE.phone.slabRanges).toBe(true);
  // the phone's angle is the one slab-ranges.test.ts drives: ~0.7 device pixels at DPR 2
  expect(TIER_TABLE.phone.slabLodAngle).toBe(0.001);
});
