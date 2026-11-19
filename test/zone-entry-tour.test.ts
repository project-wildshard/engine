import { expect, test } from 'vitest';
import { zoneEntryTour } from '../scripts/zone-entry-tour.mjs';

const cells = [
  {instance:'driftwood-isle', cell:[0, 0]},
  {instance:'far-reach', cell:[0, -1]},
  {instance:'west', cell:[-1, 0]},
  {instance:'south-west', cell:[-1, -1]},
] as const;

test('opens with Driftwood into Sky Reach and walks both directions of every live edge in one circuit', (): void => {
  const route = zoneEntryTour(cells);
  expect(route[0]).toEqual({from:cells[0], to:cells[1]});
  expect(route).toHaveLength(8);
  const directions = new Set(route.map(({from, to}): string => `${from.instance}/${to.instance}`));
  expect(directions.size).toBe(8);
  for (const [index, {from, to}] of route.entries()) {
    expect(from).toBe(index === 0 ? cells[0] : route[index-1]?.to);
    expect(Math.abs(from.cell[0]-to.cell[0])+Math.abs(from.cell[1]-to.cell[1])).toBe(1);
    expect(directions.has(`${to.instance}/${from.instance}`)).toBe(true);
  }
  expect(route.at(-1)?.to).toBe(cells[0]);
});

test('refuses a partial tour when a live cell is disconnected', (): void => {
  expect((): void => { zoneEntryTour([...cells, {instance:'stranded', cell:[3, 3]}]); }).toThrow(/outside the walking tour/u);
});
