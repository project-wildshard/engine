import { bakedSamplers } from '@wildshard/format/bakedTerrainSampling';
import type { TerrainField } from '../../../shared/engine/level/data';
import type { HuntGround } from '../../../shared/engine/ai/huntPattern';
import { expect, test } from 'vitest';

import type { BakedGrid } from '@wildshard/format/bakedTerrainBytes';

// Historical contract oracle; production consumers use the data-driven owners.
/**
 * Bind a baked navigation surface to live authored water/forest queries. The grid supplies only height and normal;
 * trails, pads, water, wetness and trees remain the caller's authority. Bounds are inclusive after the requested margin.
 * The stream function is captured on binding, while water level and pond are read on each query.
 */
function bakedHuntGround(grid: BakedGrid, ports: {
  readonly field: Pick<TerrainField, 'trailDistance' | 'cabinMask' | 'streamAt' | 'waterLevel' | 'pond'>;
  readonly chunkHalf: number;
  readonly trees: HuntGround['trees'];
  readonly treeless: HuntGround['treeless'];
  readonly wetAt: HuntGround['wetAt'];
  readonly sea: HuntGround['sea'];
}): HuntGround {
  const samplers = bakedSamplers(grid), field = ports.field, stream = field.streamAt, half = ports.chunkHalf;
  return {
    heightAt: samplers.heightAt, normalY: (x, z) => samplers.normalAt(x, z)[1],
    trailDistance: field.trailDistance, cabinMask: field.cabinMask,
    inChunk: (x, z, margin) => Math.abs(x) <= half - margin && Math.abs(z) <= half - margin,
    streamAt: (x, z) => stream === undefined ? null : stream(x, z), waterLevel: () => field.waterLevel(), pond: () => field.pond,
    sea: ports.sea, wetAt: ports.wetAt, trees: ports.trees, treeless: ports.treeless, terrain: () => true, chunkHalf: half,
  };
}


test('baked hunting ground keeps inclusive bounds and live water, wetness and forest authority', () => {
  const grid: BakedGrid = { res: 2, size: 10, seed: 0, landscapeHash: 0, heights: new Float32Array([0, 10, 0, 10]), splat: new Uint8Array(16), undergrowth: null };
  let water = 2, wet = false, empty = false, sea = false;
  const field = { trailDistance: (x: number, z: number) => x - z, cabinMask: (x: number, z: number) => x + z,
    waterLevel: () => water, pond: { x: 1, z: 2, r: 3 } as { x: number; z: number; r: number } | null };
  const trees = [{ x: 1, z: 2, r: 0.4 }], queries: number[][] = [];
  const ports = { field, chunkHalf: 5, trees: (x: number, z: number, r: number) => { queries.push([x, z, r]); return trees; },
    treeless: () => empty, sea: () => sea, wetAt: () => wet };
  const ground = bakedHuntGround(grid, ports);
  expect(ground.heightAt(0, 0)).toBeCloseTo(5);
  expect(ground.normalY(0, 0)).toBeCloseTo(Math.SQRT1_2);
  expect(ground.inChunk(-4, 4, 1)).toBe(true);
  expect(ground.inChunk(-4.01, 4, 1)).toBe(false);
  expect(ground.trailDistance(3, 1)).toBe(2);
  expect(ground.cabinMask(3, 1)).toBe(4);
  expect(ground.streamAt(1, 2)).toBeNull();
  expect(ground.waterLevel()).toBe(2);
  water = 7; field.pond = null; wet = true; empty = true; sea = true;
  expect(ground.waterLevel()).toBe(7);
  expect(ground.pond()).toBeNull();
  expect(ground.wetAt(0, 0)).toBe(true);
  expect(ground.treeless()).toBe(true);
  expect(ground.sea()).toBe(true);
  expect(ground.trees(3, 4, 5)).toBe(trees);
  expect(queries).toEqual([[3, 4, 5]]);
  expect(ground.terrain()).toBe(true);
  expect(bakedHuntGround(grid, { ...ports, field: { ...field, streamAt: (x, z) => x + z } }).streamAt(2, 3)).toBe(5);
});
