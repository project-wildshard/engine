import { expect, test } from 'vitest';
import { cellCost, declaredCell, declaredCells, workerTable, worldSettings, type DeclaredCells } from '../src/server/host/dedicated/workerTable';
// J182, J185: which worker runs which cell, fixed at startup, on a worker count the bench sets.
const REST = ['blender-template', 'ink-cel-valley', 'pastel-plain', ...Array.from({ length: 16 }, (_unused, index) => `open-plot-${String(index)}`)];
const ALL = ['driftwood-isle', 'nalati-grasslands', 'nine-dragon-stack', 'pine-hollow', 'sunscar-dunes', 'far-reach', ...REST];
// The grid as production opens it (`WORLD_CELLS=grid`): instances, as `server.listening` names them.
const GRID = ['driftwood-isle', 'pine-hollow', 'sunscar-dunes', 'nalati-grasslands', 'far-reach', 'pastel-plain', 'blender-template', 'nine-dragon-stack',
  'ink-cel-valley', ...['0-0', '1-0', '2-0', '3-0', '4-0', '0-1', '4-1', '0-2', '4-2', '0-3', '4-3', '0-4', '2-4', '3-4', '4-4'].map(at => `open-plot-${at}`)];
const sorted = (rows: readonly string[]): string[] => [...rows].sort();
/** ONE-FORMAT OF31h3/OF31h4: what each shard's own file declares (`admission.serverBudget`): the awake costs cell-mem-bench
 *  measured on 2026-11-14 (ms per tick), and Far Reach sharing Sunscar Dunes' worker. The engine keeps no table of its own. */
const DECLARED: DeclaredCells = new Map(Object.entries({
  'nalati-grasslands': 2.741, 'driftwood-isle': 1.755, 'pine-hollow': 1.594, 'blender-template': 1.311, 'far-reach': 0.866,
  'sunscar-dunes': 0.682, 'nine-dragon-stack': 0.63, 'pastel-plain': 0.608, 'ink-cel-valley': 0.576,
}).map(([cell, awakeMs]) => [cell, cell === 'far-reach' ? { awakeMs, shares: 'sunscar-dunes' } : { awakeMs }]));
const load = (row: readonly string[]): number => row.reduce((total, slug) => total + cellCost(slug, DECLARED), 0);

test('the first test: one cell, one worker, whatever the count', () => { expect(workerTable(['driftwood-isle'], 4)).toEqual([['driftwood-isle']]); });
test('no cells, no workers: never a worker with nothing to run', () => { expect(workerTable([], 4)).toEqual([]); });

// SERVER-CELLS SC8: the table is weighed by each cell's measured awake cost, so the busiest worker carries as little as the cells
// allow. The name table it replaces put 22 of 25 cells on one of production's 4 workers (GC13 then spread them by count).
test('SC8: every worker carries close to an even share of the grid\'s awake cost', () => {
  const whole = load(GRID), heaviest = Math.max(...GRID.map(cell => cellCost(cell, DECLARED)));
  for (const workers of [2, 3, 4, 5, 8]) {
    const table = workerTable(GRID, workers, DECLARED);
    expect(table).toHaveLength(workers);
    expect(sorted(table.flat())).toEqual(sorted(GRID));
    // LPT's bound: no row passes an even share by more than the heaviest cell
    for (const row of table) expect(load(row), row.join(',')).toBeLessThanOrEqual(whole / workers + heaviest);
    expect(table.find(row => row.includes('sunscar-dunes'))).toContain('far-reach');
  }
  // production's 4: each within 5 % of a quarter
  for (const row of workerTable(GRID, 4, DECLARED)) expect(load(row)).toBeLessThan(whole / 4 * 1.05);
});

test('OF31h4: a cell weighs what its shard declares, and one that declares none weighs as an Open Plot', () => {
  for (const slug of GRID) expect(cellCost(slug, DECLARED), slug).toBeGreaterThan(0);
  expect(cellCost('nalati-grasslands', DECLARED)).toBeGreaterThan(cellCost('open-plot-0-0', DECLARED));
  expect(cellCost('open-plot-new')).toBeGreaterThan(0);
  expect(cellCost('open-plot-new')).toBeLessThan(cellCost('driftwood-isle', DECLARED));
  // no engine table: an undeclared shard is an Open Plot, and shares no worker
  expect(cellCost('nalati-grasslands')).toBe(cellCost('open-plot-new'));
  expect(workerTable(['sunscar-dunes', 'far-reach'], 2)).toEqual([['far-reach'], ['sunscar-dunes']]);
});

test('with a worker for each, every cell (or the pair that shares) has its own', () => {
  const table = workerTable(ALL, ALL.length, DECLARED);
  expect(table).toHaveLength(ALL.length - 1);
  expect(table.find(row => row.includes('far-reach'))).toEqual(['far-reach', 'sunscar-dunes']);
});

// GC15 (3)'s benches: staging's 2 workers put Nalati on one and Driftwood with its south neighbour on the other.
test('the crossing benches\' tables: Nalati apart from Driftwood and Far Reach', () => {
  expect(workerTable(['driftwood-isle', 'far-reach', 'nalati-grasslands'], 2, DECLARED)).toEqual([['nalati-grasslands'], ['driftwood-isle', 'far-reach']]);
  expect(workerTable(['driftwood-isle', 'far-reach', 'sunscar-dunes', 'nalati-grasslands'], 2, DECLARED)).toEqual([['nalati-grasslands'], ['driftwood-isle', 'far-reach', 'sunscar-dunes']]);
});

// GRID-CROSSING GC31: staging's `WORLD_WORKERS=1` must open one worker.
test('one worker holds every cell', () => {
  const table = workerTable(ALL, 1);
  expect(table).toHaveLength(1);
  expect(sorted(table[0] ?? [])).toEqual(sorted(ALL));
});

test('the same cells give the same table, whatever order they were listed in', () => {
  expect(workerTable([...ALL].reverse(), 8, DECLARED)).toEqual(workerTable(ALL, 8, DECLARED));
  expect(workerTable([...GRID].reverse(), 4, DECLARED)).toEqual(workerTable(GRID, 4, DECLARED));
});

test('each channel starts on its own count and cap, and the bench\'s answer is one env var', () => {
  expect(worldSettings('production', {})).toEqual({ workers: 4, seats: 32 });
  expect(worldSettings('staging', {})).toEqual({ workers: 2, seats: 16 });
  expect(worldSettings('production', { WORLD_WORKERS: '8', WORLD_SEATS: '50' })).toEqual({ workers: 8, seats: 50 });
  expect(() => worldSettings('preview', {})).toThrow(/No game server/u);
});

// ONE-FORMAT OF31h2: a shard's own file says what it costs awake and whose worker it shares; since OF31h4 nothing else does.
const header = (budget: Record<string, unknown>): unknown => ({ admission: { serverBudget: { tickMicros: 1000, memory: 1, entities: 1, commandsPerTick: 1, ...budget } } });
test('OF31h2: a declared awake cost and shared worker set the table', async () => {
  expect(declaredCell(header({}))).toBeUndefined();
  expect(declaredCell(header({ awakeMicros: 3000, shareWorker: 'pine-hollow' }))).toEqual({ awakeMs: 3, shares: 'pine-hollow' });
  expect(declaredCell(header({ awakeMicros: 'heavy', shareWorker: 'Pine Hollow' }))).toBeUndefined();
  // Far Reach declares 9 ms and no shared worker, so it runs alone.
  const declared = await declaredCells(['far-reach', 'sunscar-dunes', 'driftwood-isle'], cell => (cell === 'far-reach' ? Promise.resolve(header({ awakeMicros: 9000 })) : Promise.reject(new Error('no pack'))));
  expect(cellCost('far-reach', declared)).toBe(9);
  expect(cellCost('sunscar-dunes', declared)).toBe(cellCost('sunscar-dunes'));
  expect(workerTable(['driftwood-isle', 'far-reach', 'sunscar-dunes'], 2, declared)).toEqual([['far-reach'], ['driftwood-isle', 'sunscar-dunes']]);
  // Driftwood declares that it shares Nalati's worker: the two go together on two workers.
  expect(workerTable(['driftwood-isle', 'far-reach', 'nalati-grasslands'], 2, new Map([['driftwood-isle', { shares: 'nalati-grasslands' }]])))
    .toEqual([['driftwood-isle', 'nalati-grasslands'], ['far-reach']]);
});
