import { expect, test } from 'vitest';
import { bootCaseBrowser, bootCases, bootJobs, gameplayProbeTime, gridStandsIn, navigationCut } from '../src/scripts/parity/boot-smoke.mjs';

const catalogue = [
  { slug: 'driftwood-isle', status: 'live', legacy: false },
  { slug: 'nine-dragon-stack', status: 'experimental', legacy: false },
  { slug: 'sunscar-dunes', status: 'experimental', legacy: false },
  { slug: 'far-reach', status: 'experimental', legacy: false },
  { slug: 'brasscap-mesa', status: 'hidden', legacy: false },
  { slug: 'open-plot-alien-plain', status: 'hidden', legacy: false, shardSelect: false },
  { slug: 'nine-dragon-stack-legacy', status: 'live', legacy: true },
];

test('required public, Developer and grid legs cover every existing case exactly once', () => {
  const combined = (['public', 'developer', 'grid'] as const).flatMap(group => bootCases(catalogue, group));
  expect(combined).toEqual(bootCases(catalogue));
  expect(new Set(combined.map(row => JSON.stringify(row))).size).toBe(combined.length);
  expect(combined.some(row => row[1].endsWith('-legacy'))).toBe(false);
  expect(combined.some(row => row[1] === 'open-plot-alien-plain')).toBe(false);
});

test('the independent grid leg keeps the actual public home and the mandatory road driver', () => {
  expect(bootCases(catalogue, 'grid')).toEqual([['grid', 'driftwood-isle', false]]);
  expect(bootCases(catalogue, 'developer')).toEqual([
    ['standalone', 'nine-dragon-stack', true], ['standalone', 'sunscar-dunes', true],
    ['standalone', 'far-reach', true], ['standalone', 'brasscap-mesa', true],
  ]);
  // CHUNK-PARAM CP16 (J522): the public-policy case (an address link to Nine's locked card) retired with the address
  expect(bootCases(catalogue, 'public').some(([mode]) => mode !== 'standalone')).toBe(false);
});

test('BB2: boot cases run on their own slots, the grid retires only its own slot, and --jobs is bounded', async () => {
  const calls: string[] = [];
  const pool = { browser: async (slot: number) => { calls.push(`browser ${slot}`); return slot; },
    release: async (slot: number) => { calls.push(`release ${slot}`); } };
  expect(await bootCaseBrowser(pool, 'standalone', 2)).toBe(2);
  expect(await bootCaseBrowser(pool, 'grid', 1)).toBe(1);
  expect(await bootCaseBrowser(pool, 'standalone')).toBe(0);
  expect(calls).toEqual(['browser 2', 'release 1', 'browser 1', 'browser 0']);
  expect(bootJobs(undefined)).toBe(1);
  expect(bootJobs('3')).toBe(3);
  for (const bad of ['0', '9', '2.5', '', ' 3', 'three']) expect(() => bootJobs(bad)).toThrow('--jobs=1..8');
});

test('FS30 an independent gameplay probe leaves the boot capture budget intact', async () => {
  const deadline = 140_000;
  let now = 90_000;
  const probeMs = await gameplayProbeTime(async () => { now += 97_000; }, () => now);
  expect(deadline + probeMs - now).toBe(50_000);
  await expect(gameplayProbeTime(() => Promise.reject(new Error('probe failed')), () => now)).rejects.toThrow('probe failed');
});

// CP16 (J522), main red 45750864926: cook-to-play's standalone tap opened the zone's grid page and the wait's read died
// with its document; a read a navigation cut short is read again, any other failure still throws
test('a read a navigation cut short is not a boot failure', () => {
  expect(navigationCut(new Error('page.evaluate: Execution context was destroyed, most likely because of a navigation'))).toBe(true);
  expect(navigationCut(new Error('Fatal boot: shader link failed'))).toBe(false);
  expect(navigationCut('Execution context was destroyed')).toBe(false);
});

// main red 45750864926, second cause: cook-to-play's world shows Brasscap in Pine Hollow's cell, so a tap on Brasscap
// stands in instance pine-hollow; the zone is the cell's slug
test('a grid stands in a zone by its cell\'s instance or the slug that cell shows', () => {
  const grid = (current: string, ready = true) => ({ cells: [{ instance: 'pine-hollow', slug: 'brasscap-mesa' }, { instance: 'sunscar-dunes', slug: 'sunscar-dunes' }],
    live: { live: { current, gameplayReady: ready } } });
  expect(gridStandsIn(grid('pine-hollow'), 'brasscap-mesa')).toBe(true);
  expect(gridStandsIn(grid('sunscar-dunes'), 'sunscar-dunes')).toBe(true);
  expect(gridStandsIn(grid('_sunscar-dunes'), 'sunscar-dunes')).toBe(true);
  expect(gridStandsIn(grid('sunscar-dunes'), 'brasscap-mesa')).toBe(false);
  expect(gridStandsIn(grid('pine-hollow', false), 'brasscap-mesa')).toBe(false);
});
