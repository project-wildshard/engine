import { expect, test } from 'vitest';
import { workerTable, worldCrossing, worldSettings } from '../src/server/host/dedicated/workerTable';

// J182, J185: which worker runs which cell, fixed at startup, on a worker count the bench sets.
const REST = ['_template', 'blender-template', 'ink-cel-valley', 'pastel-plain', ...Array.from({ length: 16 }, (_unused, index) => `open-plot-${String(index)}`)];
const ALL = ['driftwood-isle', 'nalati-grasslands', 'nine-dragon-stack', 'pine-hollow', 'sunscar-dunes', 'far-reach', ...REST];

const sorted = (rows: readonly string[]): string[] => [...rows].sort();

test('the first test: one cell, one worker, whatever the count', () => { expect(workerTable(['driftwood-isle'], 4)).toEqual([['driftwood-isle']]); });

test('at 8 the four big cells each get a worker, Dunes and Sky Reach share one, and the rest share the others', () => {
  const table = workerTable(ALL, 8);
  expect(table).toHaveLength(8);
  expect(table.slice(0, 5)).toEqual([['nalati-grasslands'], ['nine-dragon-stack'], ['pine-hollow'], ['driftwood-isle'], ['sunscar-dunes', 'far-reach']]);
  expect(sorted(table.flat())).toEqual(sorted(ALL));
  expect(table.slice(5).map(row => row.length)).toEqual([7, 7, 6]);
});

test('production\'s 4 and staging\'s 2 hold every cell, and the last row takes what is left', () => {
  for (const workers of [4, 2]) {
    const table = workerTable(ALL, workers);
    expect(table).toHaveLength(workers);
    expect(sorted(table.flat())).toEqual(sorted(ALL));
  }
  expect(workerTable(ALL, 4).slice(0, 3)).toEqual([['nalati-grasslands'], ['nine-dragon-stack'], ['pine-hollow']]);
  expect(workerTable(ALL, 4)[3]?.[0]).toBe('driftwood-isle');
});

// GRID-CROSSING GC31: a crossing runs only between cells on one worker, so staging's `WORLD_WORKERS=1` must open one worker. It opened
// two (Nalati alone), which walled Nalati off Driftwood's road.
test('one worker holds every cell', () => {
  const table = workerTable(ALL, 1);
  expect(table).toHaveLength(1);
  expect(sorted(table[0] ?? [])).toEqual(sorted(ALL));
});

test('the same cells give the same table, whatever order they were listed in', () => {
  expect(workerTable([...ALL].reverse(), 8)).toEqual(workerTable(ALL, 8));
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
  expect(worldCrossing('worker')).toBe(true);
  expect(worldCrossing('off')).toBe(false);
  expect(() => worldCrossing('on')).toThrow(/only worker/u);
});
