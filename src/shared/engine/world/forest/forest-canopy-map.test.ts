import { expect, test } from 'vitest';
import { CHUNK_HALF, CHUNK_SIZE } from '../../core/config';
import { canopyMapOf } from './placement';

// G227 / tile streaming P1: the canopy density is a pure function of the trees, so the runtime forest and a baked tiled
// ground share it. A crown is a disc of 0.16 x the tree's height, 0.7 at its centre, summed and capped at 1.
test('a crown darkens a disc around its tree, and crowns sum to at most 1', () => {
  const n = 256, cell = (v: number): number => Math.round(((v + CHUNK_HALF) / CHUNK_SIZE) * n);
  const one = canopyMapOf([{ x: 0, z: 0, height: 20 }], n);
  expect(one[cell(0) * n + cell(0)]).toBeCloseTo(0.7, 5);
  expect(one[cell(0) * n + cell(10)]).toBe(0); // 10 m out: past the 3.2 m crown
  expect(one.reduce((sum, v) => sum + v, 0)).toBeGreaterThan(0);
  const stacked = canopyMapOf([{ x: 0, z: 0, height: 20 }, { x: 0, z: 0, height: 20 }], n);
  expect(stacked[cell(0) * n + cell(0)]).toBe(1);
  expect(canopyMapOf([], n).every(v => v === 0)).toBe(true);
});
