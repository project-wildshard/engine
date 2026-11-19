// @vitest-environment happy-dom
// ONE-FORMAT OF8/OF9b: one pointer, `shardfile`, for every shard; an older product's key is lifted as it enters.
import { expect, test } from 'vitest';
import type { RuntimeCost } from '@wildshard/format/runtimeCost';
import { parseShardSlug } from '../../../shared/game/shard/slug';
import { dataPointer, runtimePagePointer } from './pointer';
import { listedArrival, titleMetadata } from './titleList';
import { liftLegacyPointer } from './legacyPointer';
import { useOwnedGridHome } from '../grid/pageShell';
import { preparePageResidency } from '../shardfile/clientSource';

const PATH = '/shardfiles/pine-hollow/shard.json';

test('a client-plan shard names its runtime descriptor as shardfile', () => {
  expect(runtimePagePointer({ shardfile: PATH, clientPlanRuntime: true })).toBe(PATH);
  expect(dataPointer({ shardfile: PATH, clientPlanRuntime: true })).toBeUndefined();
  // a shard's shardfile stays plain data admission
  expect(runtimePagePointer({ shardfile: PATH })).toBeUndefined();
  expect(dataPointer({ shardfile: PATH })).toBe(PATH);
  expect(runtimePagePointer({})).toBeUndefined();
});

// OF9b: products built before it (Driftwood, Pine, Nine Dragon and Nalati up to their M8 moves) name the runtime page's
// descriptor under the old key; it enters as `shardfile`, so old uploads still load.
const OLD = { slug: 'pine-hollow', name: 'Pine Hollow', biome: 'forest', status: 'live', card: {}, gridShardfile: PATH } as const;

test("an old product's pointer is lifted to shardfile as it enters", () => {
  expect(liftLegacyPointer(OLD)).toEqual({ slug: 'pine-hollow', name: 'Pine Hollow', biome: 'forest', status: 'live', card: {}, shardfile: PATH });
  expect(liftLegacyPointer({ ...OLD, shardfile: PATH })).toMatchObject({ shardfile: PATH });
  expect(liftLegacyPointer({ ...OLD, gridShardfile: undefined })).not.toHaveProperty('shardfile');
  expect(titleMetadata(OLD as unknown as Parameters<typeof titleMetadata>[0])).toMatchObject({ shardfile: PATH });
  expect('gridShardfile' in titleMetadata(OLD as unknown as Parameters<typeof titleMetadata>[0])).toBe(false);
  const plain = { slug: 'mossgate', shardfile: '/shardfiles/mossgate/shard.json' };
  expect(liftLegacyPointer(plain)).toBe(plain);
  // naming two different files would let the page and the grid admit different descriptors
  expect(() => liftLegacyPointer({ ...OLD, shardfile: '/shardfiles/other/shard.json' })).toThrow('names its shardfile once');
});

test('a manifest with only shardfile and a runtime declaration owns its grid home, as gridShardfile did', () => {
  expect(useOwnedGridHome('grid', { slug: 'pine-hollow', clientPlanRuntime: true, shardfile: PATH })).toBe(true);
  expect(() => useOwnedGridHome('grid', { slug: 'pine-hollow', shardfile: PATH })).toThrow('cannot be an owned region');
});

// shard-driftwood's reviewed home reading (the shape `preparePageResidency` admits standalone)
const COST: RuntimeCost = { webContentMB: 634.916944, glMB: 269.1803, engineBaseMB: 299, residentBaseMB: 442.731048,
  rev: 'f3a42924f51424d2a653597c945451f69505ed14', device: 'iOS Simulator Safari compressed matched pre-entry increment, three cold runs',
  evidence: 'progress/memory/g258-accounting/summary.json' };

test('a shardfile-named runtime home is measured standalone; a plain shard is not', () => {
  const slug = parseShardSlug('pine-hollow');
  const page = preparePageResidency({ slug, clientPlanRuntime: true, runtimeCost: COST, shardfile: PATH });
  expect(page.instance).toBe('pine-hollow');
  page.residency?.dispose();
  expect(preparePageResidency({ slug, shardfile: PATH, runtimeCost: COST }).instance).toBeNull();
});

// staging v0.1.38: an API-uploaded zone (Mossgate, Mirror Salt, Glowfen) enters on another shard's page. Its row names only
// `shardfile`; the page's own manifest is a client-plan runtime shard. The arrival must not carry its runtime.
const PAGE = { slug: 'driftwood-isle', name: 'Driftwood Isle', clientPlanRuntime: true as const, shardfile: '/shardfiles/driftwood-isle/shard.json' };
const UPLOADED = { slug: 'mossgate', name: 'Mossgate', shardfile: '/shardfiles/mossgate/shard.json' };

test('an uploaded zone arriving on a runtime shard page boots as plain data on its own pointer', () => {
  const arrival = listedArrival(PAGE, UPLOADED);
  expect(arrival.slug).toBe('mossgate');
  expect(dataPointer(arrival)).toBe(UPLOADED.shardfile);
  expect(runtimePagePointer(arrival)).toBeUndefined();
  expect('clientPlanRuntime' in arrival).toBe(false);
  expect(preparePageResidency({ ...arrival, slug: parseShardSlug(arrival.slug) }).instance).toBeNull();
});
