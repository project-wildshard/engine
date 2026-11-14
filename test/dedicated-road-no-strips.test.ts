import { expect, test } from 'vitest';
import { roomBench } from './fixtures/dedicated/roomBench';

// ROAD-RESIDENT RR4 (meta docs/plans/ROAD-RESIDENT-PLAN.md; Jake 11-13 ~10:35: crossing always on, "no walls anywhere"),
// replacing GRID-CROSSING GC28's rule. A crossing worker whose server book has no grid pack reads no road strips. GC28 opened
// its cells lone then, so a walker left the cell and fell back onto its edge: a server whose players can't leave. Now the
// worker refuses its boot: `World.open` rejects, `/health` never comes up, and `wildshard-config`'s rollback keeps the last
// good server.
const CELLS = ['driftwood-isle', 'sunscar-dunes', 'far-reach', 'nalati-grasslands'];

test('a crossing worker with no grid strips refuses its boot', { timeout: 120_000 }, async () => {
  await expect(roomBench({ cells: CELLS, workers: 2, crossing: true, strips: async () => [] })).rejects.toThrow('No road: the grid pack read 0 strips');
});
