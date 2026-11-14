import { expect, test } from 'vitest';
import { cellCost, COSTS_MEASURED, workerTable, worldCrossing, worldSettings } from '../src/server/host/dedicated/workerTable';

// J182, J185: which worker runs which cell, fixed at startup, on a worker count the bench sets.
const REST = ['_template', 'blender-template', 'ink-cel-valley', 'pastel-plain', ...Array.from({ length: 16 }, (_unused, index) => `open-plot-${String(index)}`)];
const ALL = ['driftwood-isle', 'nalati-grasslands', 'nine-dragon-stack', 'pine-hollow', 'sunscar-dunes', 'far-reach', ...REST];
// The grid as production opens it (`WORLD_CELLS=grid`): instances, as `server.listening` names them.
const GRID = ['driftwood-isle', 'pine-hollow', 'template-2', 'sunscar-dunes', 'nalati-grasslands', 'far-reach', 'pastel-plain', 'blender-template', 'nine-dragon-stack',
  'ink-cel-valley', ...['0-0', '1-0', '2-0', '3-0', '4-0', '0-1', '4-1', '0-2', '4-2', '0-3', '4-3', '0-4', '2-4', '3-4', '4-4'].map(at => `open-plot-${at}`)];

const sorted = (rows: readonly string[]): string[] => [...rows].sort();
const load = (row: readonly string[]): number => row.reduce((total, slug) => total + cellCost(slug), 0);

test('the first test: one cell, one worker, whatever the count', () => { expect(workerTable(['driftwood-isle'], 4)).toEqual([['driftwood-isle']]); });

// SERVER-CELLS SC8: the table is weighed by each cell's measured awake cost, so the busiest worker carries as little as the cells
// allow. The name table it replaces put 22 of 25 cells on one of production's 4 workers (GC13 then spread them by count).
test('SC8: every worker carries close to an even share of the grid\'s awake cost', () => {
  const whole = load(GRID), heaviest = Math.max(...GRID.map(cellCost));
  for (const workers of [2, 3, 4, 5, 8]) {
    const table = workerTable(GRID, workers);
    expect(table).toHaveLength(workers);
    expect(sorted(table.flat())).toEqual(sorted(GRID));
    // LPT's bound: no row passes an even share by more than the heaviest cell
    for (const row of table) expect(load(row), row.join(',')).toBeLessThanOrEqual(whole / workers + heaviest);
    expect(table.find(row => row.includes('sunscar-dunes'))).toContain('far-reach');
  }
  // production's 4: each within 5 % of a quarter
  for (const row of workerTable(GRID, 4)) expect(load(row)).toBeLessThan(whole / 4 * 1.05);
});

test('SC8: the costs are measured, and a cell with none weighs as an Open Plot', () => {
  expect(COSTS_MEASURED).toMatch(/cell-mem-bench/u);
  for (const slug of GRID) expect(cellCost(slug), slug).toBeGreaterThan(0);
  expect(cellCost('nalati-grasslands')).toBeGreaterThan(cellCost('open-plot-0-0'));
  expect(cellCost('open-plot-new')).toBeGreaterThan(0);
  expect(cellCost('open-plot-new')).toBeLessThan(cellCost('driftwood-isle'));
});

test('with a worker for each, every cell (or the pair that shares) has its own', () => {
  const table = workerTable(ALL, ALL.length);
  expect(table).toHaveLength(ALL.length - 1);
  expect(table.find(row => row.includes('far-reach'))).toEqual(['sunscar-dunes', 'far-reach']);
});

// GC15 (3)'s benches: staging's 2 workers put Nalati on one and Driftwood with its south neighbour on the other.
test('the crossing benches\' tables: Nalati apart from Driftwood and Far Reach', () => {
  expect(workerTable(['driftwood-isle', 'far-reach', 'nalati-grasslands'], 2)).toEqual([['nalati-grasslands'], ['driftwood-isle', 'far-reach']]);
  expect(workerTable(['driftwood-isle', 'far-reach', 'sunscar-dunes', 'nalati-grasslands'], 2)).toEqual([['nalati-grasslands'], ['driftwood-isle', 'sunscar-dunes', 'far-reach']]);
});

// GRID-CROSSING GC31: staging's `WORLD_WORKERS=1` must open one worker.
test('one worker holds every cell', () => {
  const table = workerTable(ALL, 1);
  expect(table).toHaveLength(1);
  expect(sorted(table[0] ?? [])).toEqual(sorted(ALL));
});

test('the same cells give the same table, whatever order they were listed in', () => {
  expect(workerTable([...ALL].reverse(), 8)).toEqual(workerTable(ALL, 8));
  expect(workerTable([...GRID].reverse(), 4)).toEqual(workerTable(GRID, 4));
});

test('each channel starts on its own count and cap, and the bench\'s answer is one env var', () => {
  expect(worldSettings('production', {})).toEqual({ workers: 4, seats: 32 });
  expect(worldSettings('staging', {})).toEqual({ workers: 2, seats: 16 });
  expect(worldSettings('production', { WORLD_WORKERS: '8', WORLD_SEATS: '50' })).toEqual({ workers: 8, seats: 50 });
  expect(() => worldSettings('preview', {})).toThrow(/No game server/u);
});

// GRID-CROSSING GC35 (J322): crossing is on by default; only an explicit off keeps a server's cells lone.
test('a world with no WORLD_CROSSING setting crosses; only off turns it off', () => {
  expect(worldCrossing(undefined)).toBe(true);
  expect(worldCrossing('')).toBe(true);
  expect(worldCrossing('worker')).toBe(true);
  expect(worldCrossing('off')).toBe(false);
  expect(() => worldCrossing('on')).toThrow(/only worker/u);
});
