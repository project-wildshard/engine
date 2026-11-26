import { expect, test, vi } from 'vitest';
import { exploreZones, readExploreOrder } from '../src/client/app/exploreZones';
import type { CatalogueDocument } from '../src/shared/game/grid/catalogueSlot';
import type { TitleManifest } from '../src/client/game/shard/titleList';

const title = (slug: string, name: string, status: TitleManifest['status'] = 'live'): TitleManifest => ({
  slug, name, status, biome: '', card: { thumb: '/thumb.jpg', portrait: '/portrait.jpg', landscape: '/landscape.jpg' },
});
const titles = [title('mossgate', 'Mossgate'), title('driftwood-isle', 'Driftwood Isle'), title('open-plot-0-0', 'Open plot'),
  title('secret-zone', 'Secret', 'hidden'), title('not-placed', 'Unplaced')];
const catalogue: CatalogueDocument = {
  placements: [],
  grid: { cells: [...titles.slice(0, 4), { slug: 'new-cell' }].map(row => ({ instance: row.slug, slug: row.slug })) },
  shards: [{ slug: 'new-cell', name: 'New cell', uploadNumber: 1, hash: 'a'.repeat(64) }],
};

test('the offline list shows every visible placement in title order (OF31i4: no built Featured list)', () => {
  expect(exploreZones(catalogue, titles).map(zone => zone.slug)).toEqual(['mossgate', 'driftwood-isle', 'new-cell']);
});

test('the served staging cards order and name installed zones without duplicating them', async () => {
  const read = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
    channel: 'staging', serial: 4,
    featured: [{ slug: 'mossgate', name: 'Mossgate Hollow' }],
    popular: [{ slug: 'mossgate', name: 'Mossgate' }, { slug: 'driftwood-isle', name: 'Driftwood Isle' }],
    new: [{ slug: 'open-plot-0-0', name: 'Open plot' }, { slug: 'unavailable', name: 'Unavailable' }],
  }));
  expect(exploreZones(catalogue, titles, await readExploreOrder(read, 'https://example.invalid'))).toEqual([
    { slug: 'mossgate', name: 'Mossgate Hollow', image: '/landscape.jpg' },
    { slug: 'driftwood-isle', name: 'Driftwood Isle', image: '/landscape.jpg' },
    { slug: 'new-cell', name: 'New cell' },
  ]);
  expect(read).toHaveBeenCalledWith('https://example.invalid/api/zone-select?channel=staging', expect.objectContaining({ credentials: 'omit' }));
});

test('offline, HTTP errors and a malformed API response fall back to the build', async () => {
  const reads = [
    vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline')),
    vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 })),
    vi.fn<typeof fetch>().mockResolvedValue(Response.json({ channel: 'production', featured: [] })),
    vi.fn<typeof fetch>().mockResolvedValue(Response.json({ channel: 'staging', featured: [{ slug: '../bad', name: 'Bad' }], new: [], popular: [] })),
  ];
  for (const read of reads) {
    const result = await readExploreOrder(read, '');
    expect(result).toBeNull();
    expect(exploreZones(catalogue, titles, result)).toEqual(exploreZones(catalogue, titles));
  }
});
