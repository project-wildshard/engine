import { expect, test } from 'vitest';
import { physicsEntryFailures, physicsEntryPierReady } from '../scripts/physics-grid-entry.mjs';

const standalone = { registered: { pier: 63, wreck: 21 }, native: { pier: 63, wreck: 21 }, total: 100,
  pier: { y: 0.5, owner: 'pier' }, grid: null };

test('grid collision parity ignores platform shapes but requires each authored native owner', () => {
  expect(physicsEntryFailures(standalone, { ...standalone, total: 180, grid: 'driftwood-isle' })).toEqual([]);
  // The live bug registered the pier in the neutral shell while the active region kept its other 955 colliders.
  const grid = { ...standalone, total: 955, native: { wreck: 21 }, registered: { wreck: 21 } };
  expect(physicsEntryFailures(standalone, grid)).toEqual(['pier: registered 0, standalone 63', 'pier: native 0, standalone 63']);
  expect(physicsEntryFailures(standalone, { ...standalone, native: { wreck: 21 } })).toContain('pier: native 0, standalone 63');
});

test('a terrain or water hit cannot stand in for the native pier floor', () => {
  expect(physicsEntryFailures(standalone, { ...standalone, pier: { y: -0.8686, owner: null } })).toContain('Pier deck is not the same solid native floor');
  expect(physicsEntryFailures(standalone, { ...standalone, pier: null })).toContain('Pier deck is not the same solid native floor');
});

test('a streamed pier floor keeps exact registered/native counts and the same ray height', () => {
  // Observed on T9 a80ea662b5: the first-pier ray hits its live tile c3.
  const tile = { registered: { 'pier.c3': 20 }, native: { 'pier.c3': 20 }, total: 1183,
    pier: { y: 1.2000000476837158, owner: 'pier.c3' }, grid: null };
  expect(physicsEntryPierReady(standalone)).toBe(true);
  expect(physicsEntryPierReady(tile)).toBe(true);
  expect(physicsEntryFailures(tile, { ...tile, grid: 'driftwood-isle' })).toEqual([]);
  expect(physicsEntryPierReady({ ...tile, native: {} })).toBe(false);
  expect(physicsEntryPierReady({ ...tile, registered: {} })).toBe(false);
  expect(physicsEntryPierReady({ ...tile, registered: { 'pier.c3': 0 }, native: { 'pier.c3': 0 } })).toBe(false);
  expect(physicsEntryFailures(tile, { ...tile, pier: { ...tile.pier, y: 1.21 } })).toContain('Pier deck is not the same solid native floor');
  for (const owner of ['terrain', 'pier.c64', 'pier.c03', 'pier.other', null]) {
    expect(physicsEntryPierReady({ ...tile, pier: { ...tile.pier, owner } })).toBe(false);
    expect(physicsEntryFailures(tile, { ...tile, pier: { ...tile.pier, owner } })).toContain('Pier deck is not the same solid native floor');
  }
});
