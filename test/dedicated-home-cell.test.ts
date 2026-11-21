// ONE-FORMAT OF31h1: an unset WORLD_CELLS opens the grid's home cell, read from the placement rather than a slug in code.
import { expect, test } from 'vitest';
import { homeCell, worldCells } from '../src/server/host/dedicated/gridCells';

test('the default cell is the grid home at (0, 0), and it opens as WORLD_CELLS did before', () => {
  const home = homeCell();
  expect(home).toBe('driftwood-isle');
  expect(worldCells(home, ['driftwood-isle', 'pine-hollow'])).toEqual(['driftwood-isle']);
});
