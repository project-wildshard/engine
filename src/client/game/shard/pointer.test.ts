// @vitest-environment happy-dom
// ONE-FORMAT OF8/OF9b: one pointer, `shardfile`, for every shard (FORMAT-PRUNE FP8: the old key is migrated, never read).
import { expect, test } from 'vitest';
import type { RuntimeCost } from '@wildshard/format/runtimeCost';
import { parseShardSlug } from '../../../shared/game/shard/slug';
import { dataPointer, runtimePagePointer } from './pointer';
import { listedArrival } from './titleList';
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

test('a manifest with only shardfile and a runtime declaration owns its grid home', () => {
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
