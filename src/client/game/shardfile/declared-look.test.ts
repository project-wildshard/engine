import { describe, expect, it } from 'vitest';
import type { LookLevel } from '@wildshard/format/look-level';
import type { ShardManifest } from '../shard/manifest';
import { declaredLevel, declaredLook } from './declaredLook';

// ONE-FORMAT OF7: a declared page reads `look/look` over its manifest's sky, atmosphere and grade where the look declares
// them. Driftwood, Pine and Dunes declare no light and no bloom, so their level look is their manifest's, unchanged.
const MANIFEST = {
  sky: { sunColor: [1, 0.97, 0.9], sunIntensity: 2.7, envIntensity: 0.7, bgIntensity: 1, fogSunColor: [1, 0.98, 0.92], cloudSunColor: [1, 0.98, 0.94], hemiSky: 0x7b90f4, hemiGround: 0xd8a878, hemiIntensity: 0.9 },
  atmosphere: { fogHeight: -20, fogHeightFalloff: 0.08, fogHeightDensity: 0.0004, fogDistDensity: 0.00014, volumetricSunColor: [1, 0.97, 0.9] },
  grade: { saturation: 0.3, brightness: 0, contrast: 0.2, bloomIntensity: 0.4, bloomThreshold: 1, shadowTint: [0.94, 0.98, 1.06], highTint: [1.04, 1.01, 0.96], lift: [0, 0, 0.005], gain: [1.02, 1.02, 1], gamma: 1 },
} as unknown as Pick<ShardManifest, 'sky' | 'atmosphere' | 'grade'>;
const EMPTY = { grade: {} } as const;
const DECLARED = { light: { heightFog: { height: 4, falloff: 0.2, density: 0.01 } }, grade: { bloom: { intensity: 0.6, threshold: 0.9, radius: 0.55 } } } as const;

describe('declaredLook (OF7)', () => {
  it('keeps the manifest look when the look declares nothing (Driftwood, Pine, Dunes)', () => {
    for (const tier of ['desktop', 'phone']) for (const on of [true, false]) {
      const look = declaredLook(MANIFEST, { look: EMPTY }, on, tier);
      expect(look.sky).toBe(MANIFEST.sky); expect(look.atmosphere).toBe(MANIFEST.atmosphere); expect(look.grade).toBe(MANIFEST.grade);
    }
  });

  it('reads the height fog and the desktop bloom from the look over the manifest', () => {
    const look = declaredLook(MANIFEST, { look: DECLARED }, true, 'desktop');
    expect(look.sky).toBe(MANIFEST.sky);
    expect(look.atmosphere).toEqual({ ...MANIFEST.atmosphere, fogHeight: 4, fogHeightFalloff: 0.2, fogHeightDensity: 0.01 });
    expect(look.grade).toEqual({ ...MANIFEST.grade, bloomIntensity: 0.6, bloomThreshold: 0.9 });
  });

  it('keeps the manifest bloom on the phone tier and everything with the look light off', () => {
    const phone = declaredLook(MANIFEST, { look: DECLARED }, true, 'phone');
    expect(phone.grade).toBe(MANIFEST.grade);
    expect(phone.atmosphere).toEqual({ ...MANIFEST.atmosphere, fogHeight: 4, fogHeightFalloff: 0.2, fogHeightDensity: 0.01 });
    const off = declaredLook(MANIFEST, { look: DECLARED }, false, 'desktop');
    expect(off.atmosphere).toBe(MANIFEST.atmosphere); expect(off.grade).toBe(MANIFEST.grade);
  });
});

// ONE-FORMAT OF9b2: the level look lives in look/look's `level`; an older product's manifest fields are lifted at the door.
const HORIZON = { rings: [], cloudSea: true };
const LEVEL = { sky: { ...MANIFEST.sky, sunIntensity: 3.1 }, atmosphere: MANIFEST.atmosphere, grade: MANIFEST.grade, horizon: HORIZON } as unknown as LookLevel;

describe('declaredLevel (OF9b2)', () => {
  it('draws look/look\'s level look over the discovery manifest', () => {
    const level = declaredLevel(MANIFEST, { look: { level: LEVEL } });
    expect(level.sky).toBe(LEVEL.sky); expect(level.atmosphere).toBe(LEVEL.atmosphere); expect(level.grade).toBe(LEVEL.grade);
    expect(level.horizon).toBe(HORIZON);
  });

  it('lifts an older product\'s manifest level look byte for byte, else keeps the discovery manifest\'s', () => {
    const lifted = declaredLevel(MANIFEST, { look: {}, manifest: { ...LEVEL } });
    expect(JSON.stringify(lifted)).toBe(JSON.stringify(LEVEL));
    const kept = declaredLevel(MANIFEST, { look: {} });
    expect(kept.sky).toBe(MANIFEST.sky); expect('horizon' in kept).toBe(false);
  });

  it('lays the look\'s height fog and desktop bloom over the level look', () => {
    const look = declaredLook(MANIFEST, { look: { ...DECLARED, level: LEVEL } }, true, 'desktop');
    expect(look.sky).toBe(LEVEL.sky); expect(look.horizon).toBe(HORIZON);
    expect(look.grade).toEqual({ ...LEVEL.grade, bloomIntensity: 0.6, bloomThreshold: 0.9 });
  });
});
