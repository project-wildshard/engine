import { expect, test } from 'vitest';
import { bootCaseBrowser, bootCases, bootJobs } from '../scripts/parity/boot-smoke.mjs';

const catalogue = [
  { slug: 'driftwood-isle', status: 'live', legacy: false },
  { slug: 'nine-dragon-stack', status: 'experimental', legacy: false },
  { slug: 'sunscar-dunes', status: 'experimental', legacy: false },
  { slug: 'far-reach', status: 'experimental', legacy: false },
  { slug: '_template', status: 'hidden', legacy: false },
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
    ['standalone', 'far-reach', true], ['standalone', '_template', true],
  ]);
  expect(bootCases(catalogue, 'public')).toContainEqual(['public-policy', 'nine-dragon-stack', false]);
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
