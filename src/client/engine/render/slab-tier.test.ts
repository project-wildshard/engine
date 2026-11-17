import { expect, test } from 'vitest';
import { TIER_TABLE } from './tiers';

/** NINE-DRAGON-BENCHMAX NB8: the slab runs and their size cut are the phone's; the desktop draws every slab chunk whole. */
test('only the phone tier cuts slab chunks', () => {
  expect(TIER_TABLE.desktop.slabRanges).toBe(false);
  expect(TIER_TABLE.desktop.slabLodAngle).toBe(0);
  expect(TIER_TABLE.phone.slabRanges).toBe(true);
  // the phone's angle is the one slab-ranges.test.ts drives: ~0.7 device pixels at DPR 2
  expect(TIER_TABLE.phone.slabLodAngle).toBe(0.001);
  // mini-nb8e: a key's chunks merge on the phone only (and there only with multi-draw, `worldScenes.ts`)
  expect(TIER_TABLE.desktop.slabMerge).toBe(false);
  expect(TIER_TABLE.phone.slabMerge).toBe(true);
});

/** NB8 (mini-nb8i): the phone's slab trees split by facing (built in a worker), and its placed copies chosen for a view
 *  padded 3° (re-chosen at a quarter of that turn) where the desktop keeps 7° */
test('only the phone splits slab trees by facing and pads its placed copies\' view less', () => {
  expect(TIER_TABLE.desktop.slabFacing).toBe(false);
  expect(TIER_TABLE.phone.slabFacing).toBe(true);
  expect(TIER_TABLE.desktop.cullViewPad).toBe(7);
  expect(TIER_TABLE.phone.cullViewPad).toBe(3);
});
