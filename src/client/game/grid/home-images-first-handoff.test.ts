// @vitest-environment happy-dom
// GC21, QA-FEEDBACK 2026-11-12 row 53: desktop Nalati and Sky Reach stopped at finish with "Home residency differs from the
// admitted whole-runtime cost". The boot prices the home before the page can resolve its texture mode, so it held the compressed
// reading; the grid entry (`regionalRuntimeAccountedBytes`) charges the reading of the mode it loads, and a desktop with no KTX2
// set for its tier loads images. Both boot sites now admit the images-first reading beside the claim, and the handoff settles on
// it; any other cost is still refused. The phone (KTX2) keeps the boot reading. Driftwood has no images-first reading.
import { afterEach, expect, test } from 'vitest';
import { runtimeAccountedBytes, type RuntimeCost } from '@wildshard/format/runtimeCost';
import { preparePageResidency } from '../shardfile/clientSource';
import { clientResidency } from '../shardfile/clientResidency';
import { PageResidency } from './pageResidency';
import { regionalRuntimeAccountedBytes } from './regionalRuntime';
import { pageGridIntents } from './intent';
import { setPageMode } from '../../../shared/game/grid/pageMode';
import { parseShardSlug } from '../../../shared/game/shard/slug';

// shard-nalati src/shards/nalati-grasslands/data/runtimeCost.json: a matched increment, and a whole-page images-first reading
const NALATI: RuntimeCost = {
  webContentMB: 634.916944, glMB: 269.1803, engineBaseMB: 299, residentBaseMB: 685.345862,
  rev: 'f3a42924f51424d2a653597c945451f69505ed14', device: 'iOS Simulator Safari compressed matched pre-entry increment, three cold runs',
  evidence: 'progress/memory/g258-accounting/summary.json',
  imagesFirst: { webContentMB: 606, glMB: 236.8, engineBaseMB: 299, rev: '91f97bdfc',
    device: 'iOS Simulator iPhone 17 Pro Safari + desktop labelled GL census', evidence: 'progress/memory/sf22a-2026-10-04.json' },
};
// shard-sky-reach far-reach: its declared client page's `budgets.client`
const SKY_REACH: RuntimeCost = {
  webContentMB: 641.55256, glMB: 180.34796, engineBaseMB: 299, residentBaseMB: 660.691638,
  rev: 'b49135480be3997209baa933345d8b135c101951', device: 'iOS Simulator Safari G257 max worst-pose minus pre-entry road, three cold runs',
  evidence: 'progress/memory/g258-accounting/summary.json',
  imagesFirst: { webContentMB: 270.994576, glMB: 267.71368, engineBaseMB: 299, rev: '5357804745121cdda8f9492b62d3266244f4ac1b',
    device: 'iOS Simulator iPhone 17 Pro Safari + desktop labelled GL census', evidence: 'progress/memory/sf22a-runtime-homes-535780474/summary.json' },
};
const { imagesFirst: _none, ...DRIFTWOOD } = { ...NALATI, residentBaseMB: 442.731048 };

const SKY_BUDGETS = { client: SKY_REACH, library: { compressed: 32_938_633, downloadAllowance: 32_938_633, resident: 151_870_129 }, overlap: 0,
  sim: { compressed: 36_920, resident: 1_360_444 } } as const;

/** The entry's admitted product for a hybrid runtime home (Nalati, Driftwood): its declared cost matches its manifest's. */
function hybrid(slug: string, cost: RuntimeCost): Parameters<typeof regionalRuntimeAccountedBytes>[0] {
  return { source: { identity: { slug }, runtime: { cost }, sections: [], budgets: { sim: { resident: 1 } } } } as unknown as Parameters<typeof regionalRuntimeAccountedBytes>[0];
}
/** The entry's admitted product for a declared client page home (Sky Reach). */
function declaredPage(slug: string): Parameters<typeof regionalRuntimeAccountedBytes>[0] {
  return { source: { identity: { slug }, runtime: null, budgets: SKY_BUDGETS, questHost: { page: { version: 1 } } } } as unknown as Parameters<typeof regionalRuntimeAccountedBytes>[0];
}

/** The grid page's boot, as entry.ts runs it: a Shard Select intent for the cell, then `preparePageResidency`. */
function bootGridHome(slug: string, cost: RuntimeCost): PageResidency {
  pageGridIntents().set({ instance: slug, slug });
  const page = preparePageResidency({ slug: parseShardSlug(slug), runtimeCost: cost });
  expect(page.mode).toBe('grid');
  if (page.residency === undefined) throw new Error('The grid boot admits no residency');
  return page.residency;
}

const live: PageResidency[] = [];
afterEach(() => { for (const row of live.splice(0)) row.dispose(); setPageMode('shard'); });

test.each([
  ['desktop, images', 'img'],
  ['phone, KTX2', 'ktx2'],
] as const)('Nalati: the grid entry hands off its %s cost against the boot claim', (_label, mode) => {
  const residency = bootGridHome('nalati-grasslands', NALATI); live.push(residency);
  const home = residency.home(), boot = runtimeAccountedBytes(NALATI);
  expect(home.bytes, 'the boot holds the compressed reading').toBe(boot);
  const entry = regionalRuntimeAccountedBytes(hybrid('nalati-grasslands', NALATI), { slug: parseShardSlug('nalati-grasslands'), runtimeCost: NALATI }, mode);
  if (mode === 'img') expect(entry, 'a desktop with no KTX2 set charges another reading').not.toBe(boot);
  const lease = home.handoff(entry);
  expect(home.bytes).toBe(entry);
  expect(residency.allocator.entries().find(row => row.id === 'sim:nalati-grasslands')).toMatchObject({ bytes: entry, refs: 1 });
  lease.release();
  expect(residency.allocator.has('sim:nalati-grasslands')).toBe(false);
});

test.each(['img', 'ktx2'] as const)('Sky Reach: its declared page hands off its %s cost against the boot claim', mode => {
  setPageMode('grid');
  const residency = new PageResidency(); live.push(residency);
  const { home } = clientResidency({ budgets: SKY_BUDGETS, runtime: null }, { instance: 'far-reach', residency });
  if (home === undefined) throw new Error('The declared page admits no home');
  const entry = regionalRuntimeAccountedBytes(declaredPage('far-reach'), { slug: parseShardSlug('far-reach') }, mode);
  const lease = home.handoff(entry);
  expect(residency.allocator.entries().find(row => row.id === 'sim:far-reach')).toMatchObject({ bytes: entry, refs: 1 });
  lease.release();
});

test('Driftwood (no images-first reading) hands off the same cost in either mode', () => {
  const residency = bootGridHome('driftwood-isle', DRIFTWOOD); live.push(residency);
  const manifest = { slug: parseShardSlug('driftwood-isle'), runtimeCost: DRIFTWOOD };
  const img = regionalRuntimeAccountedBytes(hybrid('driftwood-isle', DRIFTWOOD), manifest, 'img');
  expect(regionalRuntimeAccountedBytes(hybrid('driftwood-isle', DRIFTWOOD), manifest, 'ktx2')).toBe(img);
  residency.home().handoff(img).release();
});

test('the guard still refuses any cost that is neither admitted reading', () => {
  const residency = bootGridHome('nalati-grasslands', NALATI); live.push(residency);
  const home = residency.home(), boot = home.bytes;
  expect(() => home.handoff(boot + 1)).toThrow('Home residency differs from the admitted whole-runtime cost');
  expect(home.bytes, 'a refused handoff keeps the boot reading').toBe(boot);
  expect(residency.allocator.entries().find(row => row.id === 'sim:nalati-grasslands')).toMatchObject({ bytes: boot, refs: 1 });
});

test('a settle needs the sole, unused boot reference and leaves the claim alone otherwise', () => {
  const residency = new PageResidency(); live.push(residency);
  const home = residency.admitHome('fixture', 1000, false, { bytes: 2000, measuredPage: false });
  const retained = home.retain();
  expect(() => home.handoff(2000)).toThrow('sole boot reference');
  retained.release();
  expect(residency.allocator.entries().find(row => row.id === 'sim:fixture')).toMatchObject({ bytes: 1000, refs: 1 });
  expect(home.handoff(2000).id).toBe('sim:fixture');
});
