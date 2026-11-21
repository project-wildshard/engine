// OF31i: Zone Select's featured order and the retired-slug aliases are world data. The placement file carries them as
// optional fields an old box drops, and each beats the build's own list (zoneSelect/featured.json, slugNames.json).
import { expect, test } from 'vitest';
import * as v from 'valibot';
import { PlacementSchema, type PlacementFile } from '../src/shared/game/grid/placementRows';
import { PlacementWatch } from '../src/server/host/dedicated/placementFile';
import { zoneSelectTabs } from '../src/server/host/dedicated/zoneSelect';
import { FEATURED_ZONES } from '../src/server/game/zoneSelect/featured';
import { SLUG_NAMES, retiredSlugs } from '../src/shared/game/slugNames';
import { currentSlug, slugOfPath } from '../src/client/app/slugPath';

const cell = { instance: 'pine-hollow', slug: 'pine-hollow', cell: [1, 0] as const };
const file = (serial: number, extra: Partial<PlacementFile> = {}): PlacementFile => ({ kind: 'placement', channel: 'staging', serial, cells: [cell], ...extra });

test('a placement file may carry featured and aliases; a box from before OF31i drops them and reads the rest', () => {
  const body = file(4, { featured: ['pine-hollow', 'driftwood-isle'], aliases: { 'old-pine': 'pine-hollow' } });
  expect(v.parse(PlacementSchema, body)).toEqual(body);
  expect(v.parse(PlacementSchema, file(4))).toEqual(file(4));
  expect(() => v.parse(PlacementSchema, { ...body, featured: ['Not A Slug'] })).toThrow();
  expect(() => v.parse(PlacementSchema, { ...body, aliases: Object.fromEntries(Array.from({ length: 65 }, (_, n) => [`old-${String(n)}`, 'pine-hollow'])) })).toThrow();
  // the schema every box before OF31i shipped (placementRows.ts at b34876186): `v.object` drops a key it doesn't know
  const before = v.object({ kind: v.literal('placement'), channel: v.picklist(['production', 'staging']), serial: v.number(),
    cells: v.array(v.object({ instance: v.string(), slug: v.string(), cell: v.tuple([v.number(), v.number()]) })) });
  expect(v.parse(before, body)).toEqual(file(4));
});

test('Zone Select takes the placement file\'s featured order; without one the build\'s list stands', () => {
  const slugs = ['driftwood-isle', 'pine-hollow', 'nalati-grasslands'];
  const built = zoneSelectTabs('staging', { serial: 1, slugs }, [], []).featured.map(card => card.slug);
  expect(built).toEqual(FEATURED_ZONES.filter(slug => slugs.includes(slug)));
  const placed = zoneSelectTabs('staging', { serial: 1, slugs, featured: ['nalati-grasslands', 'pine-hollow', 'not-open'] }, [], []);
  expect(placed.featured.map(card => card.slug)).toEqual(['nalati-grasslands', 'pine-hollow']);
});

test('the box\'s watch keeps the newest file\'s featured order and lays its aliases over slugNames.json', async () => {
  let next = file(1);
  const watch = new PlacementWatch({ channel: 'staging', everyMs: 3_600_000, failed: () => undefined, read: () => Promise.resolve(next),
    open: cells => Promise.resolve(cells.map(row => row.instance)) });
  try {
    await watch.look();
    expect(watch.featured).toBeUndefined();
    expect(slugOfPath('/slug/old-pine/')).toBe('old-pine');
    next = file(2, { featured: ['pine-hollow'], aliases: { 'old-pine': 'pine-hollow' } });
    await watch.look();
    expect(watch.featured).toEqual(['pine-hollow']);
    expect(slugOfPath('/slug/old-pine/')).toBe('pine-hollow');
    expect(currentSlug('old-pine')).toBe('pine-hollow');
    expect(retiredSlugs()).toContainEqual(['old-pine', 'pine-hollow']);
    expect(SLUG_NAMES['blender-template'], 'the built map stays under it').toBe('brasscap-mesa');
    next = file(3); await watch.look();
    expect(watch.featured, 'a file naming none hands the order back to the build').toBeUndefined();
  } finally { watch.dispose(); }
});
