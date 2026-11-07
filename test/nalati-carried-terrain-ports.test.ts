import { expect, expectTypeOf, test } from 'vitest';
import { carriedQuestRows } from '../src/sharddev/rows';
import { parseCarriedQuest } from '@wildshard/format/questSteps';
import { paintedTerrainAttributes } from '../src/sharddev/bake/terrain';
import { PAINTED_TERRAIN_ATTRIBUTES } from '@wildshard/format/materialFamilies';
import { carriedQuestRows as original } from './fixtures/nalati-carried-quest';

test('carried quest admission retains full native output and continuation refusals', () => {
  expectTypeOf<ReturnType<typeof carriedQuestRows>>().toEqualTypeOf<ReturnType<typeof parseCarriedQuest>>();
  expect(JSON.stringify(carriedQuestRows(original))).toBe(JSON.stringify(parseCarriedQuest(original)));
  for (const bad of [
    { ...original, state: {} },
    { ...original, events: [...original.events, ...original.events] },
    { ...original, update: () => 0 },
    { ...original, floorWindow: Infinity },
  ]) {
    expect(() => parseCarriedQuest(bad)).toThrow();
    expect(() => carriedQuestRows(bad)).toThrow();
  }
});

test('terrain authors receive the exact native channel layout, sizes and fills', () => {
  expectTypeOf<ReturnType<typeof paintedTerrainAttributes>>().toEqualTypeOf<typeof PAINTED_TERRAIN_ATTRIBUTES>();
  expect(paintedTerrainAttributes()).toBe(PAINTED_TERRAIN_ATTRIBUTES);
  expect(paintedTerrainAttributes()).toEqual({
    mask: { name: '_surf', size: 4, fill: [9, 0, 0, 0] },
    track: { name: '_rdir', size: 2, fill: [1, 0] },
    zone: { name: '_zone', size: 3, fill: [0, 0, 0] },
  });
});
