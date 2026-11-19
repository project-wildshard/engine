import { ShardSlugSchema } from '@wildshard/format/uploadWire';
import { expect, test } from 'vitest';
import { safeParse } from 'valibot';
import { FEATURED_ZONES } from '../src/server/game/zoneSelect/featured';

test('Featured names eight distinct catalogue slugs in editorial order', () => {
  expect(FEATURED_ZONES).toEqual([
    'driftwood-isle', 'pine-hollow', 'nalati-grasslands', 'nine-dragon-stack',
    'mossgate', 'brasscap-mesa', 'sunscar-dunes', 'far-reach',
  ]);
  expect(new Set(FEATURED_ZONES).size).toBe(8);
  expect(FEATURED_ZONES.every(slug => safeParse(ShardSlugSchema, slug).success)).toBe(true);
});
