import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { skyHorizonColor } from './bakedApi';

/** an 8×4 RGBA sky, every texel `v` (half-float or float) */
function sky(v: number, half: boolean): THREE.DataTexture {
  const n = 8 * 4 * 4, data = half ? new Uint16Array(n).fill(THREE.DataUtils.toHalfFloat(v)) : new Float32Array(n).fill(v);
  return new THREE.DataTexture(data, 8, 4, THREE.RGBAFormat, half ? THREE.HalfFloatType : THREE.FloatType);
}

describe('skyHorizonColor', () => {
  it('averages the row above the horizon from half-float or float data', () => {
    expect(skyHorizonColor(sky(0.5, true)).r).toBeCloseTo(0.5);
    expect(skyHorizonColor(sky(0.25, false)).g).toBeCloseTo(0.25);
  });
  it('holds the brightest channel to 1.1 only when asked', () => {
    expect(skyHorizonColor(sky(4, false)).b).toBeCloseTo(4);
    expect(skyHorizonColor(sky(4, false), true).b).toBeCloseTo(1.1);
  });
});
