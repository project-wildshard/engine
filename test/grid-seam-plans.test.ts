import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Native strict equality compares the complete seam result and typed-array bytes without enumerating every index.
import { deepStrictEqual } from 'node:assert';
import * as v from 'valibot';
import fixture from './fixtures/grid-seam-cache.json';
import { CONTENT_CAPS } from '@wildshard/format/contentBounds';
import { EdgeProfilesSchema } from '@wildshard/format/edgeProfiles';
import { generatePlatform, generatePlatformSliced, type PlatformCell } from '@wildshard/engine/sim/strips';

const empty = { roadHeight: 0, heights: Array.from({ length: 257 }, () => 0), colours: Array.from({ length: 257 }, () => [0.25, 0.25, 0.25]) };
function cells(): PlatformCell[] {
  return ['pine-hollow', 'driftwood-isle', '_template'].map((slug, i) => {
    const product = fixture.products.find(row => row.slug === slug);
    if (product === undefined) throw new Error('Missing real edge fixture');
    const observe = (edge: string) => ({ entryWidth: product.entryways.find(row => row.edge === edge)?.width ?? 0,
      ...(product.sea ? { waterSurface: 0 } : {}) });
    return { instance: slug, cell: [0, i], origin: { x: 0, z: i * CONTENT_CAPS.pitch }, edges: v.parse(EdgeProfilesSchema, product.edge),
      observations: { north: observe('north'), east: observe('east'), south: observe('south'), west: observe('west') } };
  });
}

test('build plans preserve every mesh, duplicate, feature and turn-in byte', async () => {
  const input = cells(), plans = new Map<string, readonly number[][]>();
  const original = generatePlatform(input, empty, plans);
  expect(plans.size).toBeGreaterThan(1);
  const serialized = JSON.stringify([...plans]);
  const wire: unknown = JSON.parse(serialized);
  const schema = v.array(v.tuple([v.string(), v.array(v.array(v.number()))]));
  const baked = new Map(v.parse(schema, wire)), count = baked.size;
  deepStrictEqual(await generatePlatformSliced(input, empty, () => Promise.resolve(), 12, baked), original);
  expect(baked.size).toBe(count);
  // A changed field cannot reuse the older field's retained rows.
  const first = input[0]; if (first === undefined) throw new Error('Missing cell');
  const changed = { ...first, observations: undefined };
  const next: PlatformCell = { instance: changed.instance, cell: changed.cell, origin: changed.origin, edges: changed.edges };
  const revised = [next, ...input.slice(1)];
  deepStrictEqual(generatePlatform(revised, empty, baked), generatePlatform(revised, empty));
  expect(baked.size).toBeGreaterThan(count);
});

test('malformed build plans fail closed', () => {
  const input = cells(), plans = new Map<string, readonly number[][]>();
  generatePlatform(input, empty, plans);
  for (const key of plans.keys()) plans.set(key, [[0, 0]]);
  expect(() => generatePlatform(input, empty, plans)).toThrow('Invalid baked seam lattice');
});
