import { afterEach, expect, test } from 'vitest';
import * as v from 'valibot';
import { CONTENT_CAPS } from '../src/shared/engine/core/config';
import { PlacementSchema } from '../src/shared/game/grid/placementRows';
import { gridBoardLimitAt } from '../src/shared/game/grid/rules';
import { forgetPlacedCells, gridAssembly, placeCell, placedCells } from '../src/server/host/dedicated/gridCells';

// QA 11-15 row 8: the server reads no manifest, so a cell the API places keeps a road-class shard's 30 m/s board only if the
// placement file's row carries the grid row's `speedClass` through `placeCell` into `gridAssembly()`.
afterEach(() => { forgetPlacedCells(); });
const P = CONTENT_CAPS.pitch;
const file = (speedClass?: string): unknown => ({ kind: 'placement', channel: 'staging', serial: 1,
  cells: [{ instance: 'open-plot-thin-ice', slug: 'open-plot-thin-ice', cell: [0, 3], ...(speedClass === undefined ? {} : { speedClass }) }] });

test('a placement row keeps road speed class, and refuses any other', () => {
  expect(v.parse(PlacementSchema, file('road')).cells[0]?.speedClass).toBe('road');
  expect(v.parse(PlacementSchema, file()).cells[0]).not.toHaveProperty('speedClass');
  expect(v.safeParse(PlacementSchema, file('shard')).success).toBe(false);
});

test('a placed road-class cell caps the board at 30 m/s on the server; a plain one at 14', () => {
  const feet = { x: 0, y: 10, z: 3 * P };
  const [road] = v.parse(PlacementSchema, file('road')).cells;
  if (road === undefined) throw new Error('one row');
  expect(placeCell(road)).toBe(true);
  expect(placedCells()[0]?.speedClass).toBe('road');
  expect(gridAssembly().cells.find(row => row.instance === road.instance)?.speedClass).toBe('road');
  expect(gridBoardLimitAt(gridAssembly(), feet)).toBe(30);
  forgetPlacedCells();
  const [plain] = v.parse(PlacementSchema, file()).cells;
  if (plain === undefined) throw new Error('one row');
  expect(placeCell(plain)).toBe(true);
  expect(gridBoardLimitAt(gridAssembly(), feet)).toBe(14);
});
