// @vitest-environment happy-dom
// meta IPHONE13-REAL-TEST IP34: phone Low's size-based LOD knobs at its drawing density, behind `debug.densityLod`.
import { afterEach, expect, test } from 'vitest';
import { applyDensityLod, DENSITY_LOD_DEFAULT, DENSITY_LOD_SLOT, densityLodOn } from './densityLod';
import { TIER_TABLE } from './tiers';
import { jsonSlot } from '../saves/slots';

const slot = jsonSlot(DENSITY_LOD_SLOT, 'device');
afterEach(() => { slot.reset(); });
const knobs = (): { slabLodAngle: number; slabFarAngle: number; placedLodScale: number } => {
  const { slabLodAngle, slabFarAngle, placedLodScale } = TIER_TABLE.phone;
  return { slabLodAngle, slabFarAngle, placedLodScale };
};

test('at 1x the phone keeps its 2x pixel error: twice the slab angles, half the placed LOD scale', () => {
  const k = knobs();
  applyDensityLod(k, 'phone', 1, true);
  expect(k).toEqual({ slabLodAngle: TIER_TABLE.phone.slabLodAngle * 2, slabFarAngle: TIER_TABLE.phone.slabFarAngle * 2, placedLodScale: TIER_TABLE.phone.placedLodScale / 2 });
  const mid = knobs();
  applyDensityLod(mid, 'phone', 1.5, true);
  expect(mid.slabFarAngle).toBeCloseTo(TIER_TABLE.phone.slabFarAngle * 4 / 3);
});

test('off, the desktop, and 2x or more leave the knobs as tuned', () => {
  for (const [tier, density, on] of [['phone', 1, false], ['desktop', 1, true], ['phone', 2, true], ['phone', 0, true]] as const) {
    const k = knobs();
    applyDensityLod(k, tier, density, on);
    expect(k).toEqual(knobs());
  }
});

test('the slot wins, else the default', () => {
  expect(densityLodOn()).toBe(DENSITY_LOD_DEFAULT);
  slot.write(true); expect(densityLodOn()).toBe(true);
  slot.write(false); expect(densityLodOn()).toBe(false);
  slot.write(3); expect(densityLodOn()).toBe(3);
  slot.write(0.5); expect(densityLodOn()).toBe(DENSITY_LOD_DEFAULT);
});

test('unset, phone Low (density 1) takes the slab scale 3 and other densities stay off (IP34)', () => {
  expect(DENSITY_LOD_DEFAULT).toBe(3);
  expect(densityLodOn(1)).toBe(3);
  expect(densityLodOn(1.5)).toBe(false);
  const low = knobs();
  applyDensityLod(low, 'phone', 1);
  expect(low.slabFarAngle).toBeCloseTo(TIER_TABLE.phone.slabFarAngle * 3);
  const mid = knobs();
  applyDensityLod(mid, 'phone', 1.5);
  expect(mid).toEqual(knobs());
});

test('a numeric pick scales the slab angles; the placed scale stays at the density', () => {
  const k = knobs();
  applyDensityLod(k, 'phone', 1, 3);
  expect(k.slabFarAngle).toBeCloseTo(TIER_TABLE.phone.slabFarAngle * 3);
  expect(k.slabLodAngle).toBeCloseTo(TIER_TABLE.phone.slabLodAngle * 3);
  expect(k.placedLodScale).toBeCloseTo(TIER_TABLE.phone.placedLodScale / 2);
});
