import { expect, test, vi } from 'vitest';
import { readGridEdges } from '../src/client/game/grid/edgeSources';
import { installShards } from '../src/client/game/shard/list';
import type { EdgeObservationsRows as EdgeObservations } from '@wildshard/format/edgeObservations';

const row = { heights: [0, 0], colours: [[0.2, 0.3, 0.1], [0.2, 0.3, 0.1]] as [number, number, number][], roadHeight: 0 as const };
const edge = { north: row, east: row, south: row, west: row };
const cell = { instance: 'pr6f2-cell', slug: 'pr6f2-cell', cell: [0, 0] as const, origin: { x: 0, y: 0, z: 0 } };

async function observed(edgeObservations?: EdgeObservations) {
  installShards([]);
  const fetch = vi.fn(() => Promise.resolve(new Response('', { status: 404 })));
  const source = await readGridEdges(cell, { fetch, edges: () => Promise.resolve({ edge, entryways: [{ edge: 'north', at: [0, 0, 250], width: 8 }], ...(edgeObservations === undefined ? {} : { edgeObservations }) }) });
  if (source.kind !== 'declared') throw new Error('expected declared edges');
  return source.observations;
}

test('PR6f2: a product\'s own edge observations decide each side over the registry', async () => {
  const sides = await observed({ north: { geometry: 'void' }, east: { waterSurface: 1.5 }, south: {}, west: { geometry: 'ground', waterSurface: -2 } });
  expect(sides).toEqual({
    north: { entryWidth: 8, geometry: 'void' },
    east: { entryWidth: 0, geometry: 'ground', waterSurface: 1.5 },
    south: { entryWidth: 0, geometry: 'ground' },
    // water below the road datum is not reported, as for the registry's open water
    west: { entryWidth: 0, geometry: 'ground' },
  });
});

test('PR6f2: a product without the field keeps the registry rule', async () => {
  expect((await observed()).north).toEqual({ entryWidth: 8, geometry: 'ground' });
});
