// SA29 (meta SHARD-AUTHORING-PLAN): engine takes shard-format v0.4.7, whose grid is the 7 × 7 (`GRID_RADIUS` 3,
// `GRID_CELL_COUNT` 49 as a maximum, any cell empty). J305's 25 still read as they are; SA34 draws the 7 × 7
// (`test/grid-void-floor.test.ts`): ring 3 is admitted, ring 4 refused.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { GRID_CELL_COUNT, GRID_RADIUS } from '@wildshard/format/contentBounds';
import { CONTENT_CAPS } from '../src/shared/engine/core/config';
import { DRAWN_GRID_RADIUS, parseGridCatalogue } from '../src/shared/game/grid/catalogue';
import { FAR_RING, GRID_SIGHTLINE } from '../src/shared/game/grid/farProxy';
import catalogue from '../src/shared/game/grid/singleplayer.json' with { type: 'json' };

const pinned = (JSON.parse(readFileSync('test/pins/catalogue.json', 'utf8')) as { grid: unknown }).grid;
type Grid = { cells: { instance: string; slug: string; cell: [number, number] }[] };
const base = (): Grid => structuredClone(catalogue.grid) as unknown as Grid;

test('the format is the 7 × 7 and the client draws the 7 × 7 (SA34)', () => {
  expect([GRID_RADIUS, GRID_CELL_COUNT, DRAWN_GRID_RADIUS]).toEqual([3, 49, 3]);
  expect(GRID_SIGHTLINE).toBeCloseTo(2 * 3.5 * CONTENT_CAPS.pitch * Math.SQRT2, 9);
  expect([FAR_RING.domeRadius, FAR_RING.drawDistance]).toEqual([5800, 6000]);
  expect(FAR_RING.domeRadius).toBeGreaterThan(GRID_SIGHTLINE);
});

test("J305's 25 cells read back unchanged, in-tree and pinned", () => {
  expect(parseGridCatalogue(catalogue.grid)).toEqual(catalogue.grid);
  expect(parseGridCatalogue(pinned)).toEqual(pinned);
});

test('a grid may leave cells empty; ring 3 is admitted and a cell past it refused', () => {
  const short = base(); short.cells.pop();
  expect(parseGridCatalogue(short).cells).toHaveLength(24);
  for (const cell of [[0, 3], [-3, 3], [3, -3]] as [number, number][]) {
    const ring = base(); ring.cells.push({ instance: 'ring-cell', slug: 'ring-cell', cell });
    expect(parseGridCatalogue(ring).cells).toHaveLength(26);
  }
  for (const cell of [[4, 0], [0, -4], [-4, 4]] as [number, number][]) {
    const far = base(); far.cells.push({ instance: 'far-cell', slug: 'far-cell', cell });
    expect(() => parseGridCatalogue(far)).toThrow(/Expected (<|>)=-?3 /u);
  }
  const twin = base(); twin.cells.push({ ...twin.cells[0]!, instance: 'twin' });
  expect(() => parseGridCatalogue(twin)).toThrow(/unique stable instance identities and cells/u);
});
