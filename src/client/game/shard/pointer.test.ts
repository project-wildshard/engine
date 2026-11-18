// @vitest-environment happy-dom
// ONE-FORMAT OF8: one pointer, `shardfile`, for every shard; `gridShardfile` is still read until M9.
import { expect, test } from 'vitest';
import type { RuntimeCost } from '@wildshard/format/runtimeCost';
import { parseShardSlug } from '../../../shared/game/shard/slug';
import { dataPointer, runtimePagePointer } from './pointer';
import { listedArrival } from './titleList';
import { useOwnedGridHome } from '../grid/pageShell';
import { preparePageResidency } from '../shardfile/clientSource';

const PATH = '/shardfiles/pine-hollow/shard.json';

test('a client-plan shard names its runtime descriptor as shardfile, and the old key still works', () => {
  expect(runtimePagePointer({ shardfile: PATH, clientPlanRuntime: true })).toBe(PATH);
  expect(dataPointer({ shardfile: PATH, clientPlanRuntime: true })).toBeUndefined();
  expect(runtimePagePointer({ gridShardfile: PATH, clientPlanRuntime: true })).toBe(PATH);
  expect(runtimePagePointer({ gridShardfile: PATH })).toBe(PATH);
  // a shard's shardfile stays plain data admission
  expect(runtimePagePointer({ shardfile: PATH })).toBeUndefined();
  expect(dataPointer({ shardfile: PATH })).toBe(PATH);
  expect(runtimePagePointer({})).toBeUndefined();
  // naming two different files would let the page and the grid admit different descriptors
  expect(() => dataPointer({ shardfile: PATH, gridShardfile: '/shardfiles/other/shard.json', clientPlanRuntime: true })).toThrow('names its shardfile once');
});

test('a manifest with only shardfile and a runtime declaration owns its grid home, as gridShardfile did', () => {
  expect(useOwnedGridHome('grid', { slug: 'pine-hollow', clientPlanRuntime: true, shardfile: PATH })).toBe(true);
  expect(useOwnedGridHome('grid', { slug: 'pine-hollow', clientPlanRuntime: true, gridShardfile: PATH })).toBe(true);
  expect(() => useOwnedGridHome('grid', { slug: 'pine-hollow', shardfile: PATH })).toThrow('cannot be an owned region');
});

// shard-driftwood's reviewed home reading (the shape `preparePageResidency` admits standalone)
const COST: RuntimeCost = { webContentMB: 634.916944, glMB: 269.1803, engineBaseMB: 299, residentBaseMB: 442.731048,
  rev: 'f3a42924f51424d2a653597c945451f69505ed14', device: 'iOS Simulator Safari compressed matched pre-entry increment, three cold runs',
  evidence: 'progress/memory/g258-accounting/summary.json' };

test('a shardfile-named runtime home is measured standalone like a gridShardfile one; a shard is not', () => {
  const slug = parseShardSlug('pine-hollow');
  for (const pointer of [{ shardfile: PATH }, { gridShardfile: PATH }]) {
    const page = preparePageResidency({ slug, clientPlanRuntime: true, runtimeCost: COST, ...pointer });
    expect(page.instance).toBe('pine-hollow');
    page.residency?.dispose();
  }
  expect(preparePageResidency({ slug, shardfile: PATH, runtimeCost: COST }).instance).toBeNull();
});

// staging v0.1.38: an API-uploaded zone (Mossgate, Mirror Salt, Glowfen) enters on another shard's page. Its row names only
// `shardfile`; the page's own manifest is a client-plan hybrid on `gridShardfile`. The arrival must not carry both.
const PAGE = { slug: 'driftwood-isle', name: 'Driftwood Isle', clientPlanRuntime: true as const, gridShardfile: '/shardfiles/driftwood-isle/shard.json' };
const UPLOADED = { slug: 'mossgate', name: 'Mossgate', shardfile: '/shardfiles/mossgate/shard.json' };

test('an uploaded zone arriving on a hybrid page boots as plain data on its own pointer', () => {
  const arrival = listedArrival(PAGE, UPLOADED);
  expect(arrival.slug).toBe('mossgate');
  expect(dataPointer(arrival)).toBe(UPLOADED.shardfile);
  expect(runtimePagePointer(arrival)).toBeUndefined();
  expect('gridShardfile' in arrival || 'clientPlanRuntime' in arrival).toBe(false);
  expect(preparePageResidency({ ...arrival, slug: parseShardSlug(arrival.slug) }).instance).toBeNull();
});

test('both pointers naming the same file are one pointer; only two different files are refused', () => {
  expect(runtimePagePointer({ shardfile: PATH, gridShardfile: PATH, clientPlanRuntime: true })).toBe(PATH);
  expect(dataPointer({ shardfile: PATH, gridShardfile: PATH })).toBeUndefined();
  expect(() => runtimePagePointer({ shardfile: PATH, gridShardfile: '/shardfiles/other/shard.json' })).toThrow('names its shardfile once');
});
