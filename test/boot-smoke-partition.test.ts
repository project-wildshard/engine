import { expect, test } from 'vitest';
import { bootCases } from '../scripts/parity/boot-smoke.mjs';

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
