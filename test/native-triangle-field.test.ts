// oxlint-disable-next-line import/no-nodejs-modules -- Preserve the actual native renderer-dependency guard.
import { execFileSync } from 'node:child_process';
import { expect, test } from 'vitest';
import { readNativeTriangleField } from '../src/sharddev/bake/terrain';
import { terrainTileHeight } from '@wildshard/format/terrainTileBytes';

const input = { resolution: 3, x: -5, z: -7, size: 12, heights: new Float32Array([-0, 1.17, 2.91, 3.13, 4.73, 5.29, 6.31, 7.79, 8.41]) };

test('the original column-major triangular law retains every diagonal, clamped edge and numeric bit', () => {
  const field = readNativeTriangleField(input), again = readNativeTriangleField(input);
  expect(field.heights).toEqual(input.heights); expect(field.heights).not.toBe(input.heights);
  expect(field.heights.buffer).not.toBe(again.heights.buffer); expect(Object.is(field.heights[0], -0)).toBe(true);
  for (const x of [-Infinity, -500, -5, -4.73, -2, 0, 1, 1.47, 6.99, 7, 500, Infinity, Number.NaN]) {
    for (const z of [-Infinity, -500, -7, -6.93, -4, -1, -.73, 4.99, 5, 500, Infinity, Number.NaN]) {
      expect(field.sample(x, z)).toBe(terrainTileHeight(input, x, z, { layout: 'column-major', boundary: 'clamp' }));
    }
  }
  field.heights[4] = -2;
  expect(field.sample(1, -1)).toBe(-2); expect(again.sample(1, -1)).toBe(input.heights[4]);
  const before = again.sample(-2, -4); input.heights[0] = 91;
  expect(again.sample(-2, -4)).toBe(before);
});

test('native triangular author intake refuses incomplete, nonfinite and over-cap samples', () => {
  const valid = { ...input, heights: new Float32Array(9) };
  for (const changed of [{ resolution: 1 }, { resolution: 2.5 }, { resolution: 258 }, { size: 0 }, { size: 501 },
    { x: Number.NaN }, { z: Infinity }, { heights: new Float32Array(8) },
    { heights: new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, Number.NaN]) },
    { heights: new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, Infinity]) }]) {
    expect(() => readNativeTriangleField({ ...valid, ...changed })).toThrow('Invalid native triangular field');
  }
});


test('the bounded triangular field stays available under the original native renderer guard', () => {
  const value = execFileSync(process.execPath, ['--experimental-transform-types', '--import', './scripts/sim-node-loader.mjs', '--input-type=module', '-e',
    "import {readNativeTriangleField} from './src/sharddev/bake/terrain.ts'; const field=readNativeTriangleField({resolution:2,x:0,z:0,size:1,heights:new Float32Array([0,1,2,3])}); if(field.sample(.25,.25)!==.75) throw new Error('Native triangle differs'); console.log('triangle-native');"], { encoding: 'utf8', timeout: 30_000 });
  expect(value.trim()).toBe('triangle-native');
});
