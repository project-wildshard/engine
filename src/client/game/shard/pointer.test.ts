// @vitest-environment happy-dom
// ONE-FORMAT OF8: one pointer, `shardfile`, for every shard; `gridShardfile` is still read until M9.
import { expect, test } from 'vitest';
import type { RuntimeCost } from '@wildshard/format/runtimeCost';
import { parseShardSlug } from '../../../shared/game/shard/slug';
import { dataPointer, hybridPointer } from './pointer';
import { useOwnedGridHome } from '../grid/pageShell';
import { preparePageResidency } from '../shardfile/clientSource';

const PATH = '/shardfiles/pine-hollow/shard.json';

test('a client-plan shard names its hybrid descriptor as shardfile, and the old key still works', () => {
  expect(hybridPointer({ shardfile: PATH, clientPlanRuntime: true })).toBe(PATH);
  expect(dataPointer({ shardfile: PATH, clientPlanRuntime: true })).toBeUndefined();
  expect(hybridPointer({ gridShardfile: PATH, clientPlanRuntime: true })).toBe(PATH);
  expect(hybridPointer({ gridShardfile: PATH })).toBe(PATH);
  // a data shard's shardfile stays plain data admission
  expect(hybridPointer({ shardfile: PATH })).toBeUndefined();
  expect(dataPointer({ shardfile: PATH })).toBe(PATH);
  expect(hybridPointer({})).toBeUndefined();
  // naming both would let the page and the grid admit different descriptors
  expect(() => hybridPointer({ shardfile: PATH, gridShardfile: PATH })).toThrow('names its shardfile once');
  expect(() => dataPointer({ shardfile: PATH, gridShardfile: PATH, clientPlanRuntime: true })).toThrow('names its shardfile once');
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

test('a shardfile-named hybrid home is measured standalone like a gridShardfile one; a data shard is not', () => {
  const slug = parseShardSlug('pine-hollow');
  for (const pointer of [{ shardfile: PATH }, { gridShardfile: PATH }]) {
    const page = preparePageResidency({ slug, clientPlanRuntime: true, runtimeCost: COST, ...pointer });
    expect(page.instance).toBe('pine-hollow');
    page.residency?.dispose();
  }
  expect(preparePageResidency({ slug, shardfile: PATH, runtimeCost: COST }).instance).toBeNull();
});
