import { expect, test } from 'vitest';
import { COLOUR_LUT_EDGE, COLOUR_LUT_CHANNELS } from '@wildshard/format/colourLut';
import { LUT_SIZE } from '../src/client/engine/render/lut';
import { colourLutSampleTransform } from '../src/sharddev/bake/materialGraph';

test('native cube storage and author texel centres retain the fitted 33-cube contract', () => {
  expect(COLOUR_LUT_EDGE).toBe(33);
  expect(COLOUR_LUT_CHANNELS).toBe(4);
  expect(LUT_SIZE).toBe(33);
  const transform = colourLutSampleTransform();
  expect(transform).toEqual({ scale: (33 - 1) / 33, offset: 0.5 / 33 });
  for (const value of [0, 0.1, 0.5, 0.9, 1])
    expect(value * transform.scale + transform.offset).toBe(value * ((33 - 1) / 33) + 0.5 / 33);
  expect(colourLutSampleTransform()).not.toBe(transform);
});
