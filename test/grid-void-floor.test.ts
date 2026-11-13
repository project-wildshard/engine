// @vitest-environment node
// SA34 (meta SHARD-AUTHORING-PLAN, J314, grill Q9 and Q12): the 7 × 7's empty cells are walkable void floor at road level,
// the rail stands on the 7 × 7's outer shoulder, and an auto-placed shard has no Shard Select card.
import { afterAll, afterEach, expect, test } from 'vitest';
import { fixtureBytes } from '@wildshard/engine/test/nativeBytes';
import { CONTENT_CAPS } from '../src/shared/engine/core/config';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { GridAssembly } from '../src/shared/game/grid/assembly';
import { autoPlaced, installCatalogue } from '../src/shared/game/grid/catalogueSlot';
import { GAP_HALF, gridRail, roadLayout, RAIL_OFFSET } from '../src/shared/game/grid/roadLayout';
import { voidFloorBoxes } from '../src/shared/game/grid/voidFloor';
import { openRoad } from '../src/server/host/standalone/roadWorld';
import catalogue from '../src/shared/game/grid/singleplayer.json' with { type: 'json' };

const p = CONTENT_CAPS.pitch, disposers: (() => void)[] = [];
afterAll(() => { for (const dispose of disposers.reverse()) dispose(); });
afterEach(() => { Reflect.deleteProperty(globalThis, Symbol.for('game.catalogue')); });
const j305 = new GridAssembly({ developer: false, devserver: false }, catalogue.grid);
const covered = (x: number, z: number, cells: readonly { cell: readonly [number, number] }[] = j305.cells): boolean =>
  voidFloorBoxes(cells, p).some(box => Math.abs(x - box.x) <= box.hx && Math.abs(z - box.z) <= box.hz);

test("J305's 25: ring 3 and the band to the rail are floor; no slab lies under a cell or a strip", () => {
  const rail = gridRail(p), outer = 2 * p + p / 2 + GAP_HALF;
  expect(rail.maxX).toBeCloseTo(3 * p + p / 2 + RAIL_OFFSET, 9);
  for (const [x, z] of [[0, 3], [3, 3], [-3, 0], [2, -3], [-3, -3]] as const) expect(covered(x * p, z * p)).toBe(true);
  expect(covered(0, outer + 1)).toBe(true); // just past the outer strip
  expect(covered(rail.maxX + 10, 0)).toBe(true); // just past the rail
  for (const cell of j305.cells) expect(covered(cell.origin.x, cell.origin.z)).toBe(false);
  expect(covered(0, outer - 1)).toBe(false); // the outer strip itself
  expect(covered(p / 2, 0)).toBe(false); // an inner road
});

test('a placed ring-3 cell: its row\'s empty cells are floor squares, its own square is not', () => {
  const cells = [...j305.cells, { cell: [0, 3] as const }];
  expect(covered(0, 3 * p, cells)).toBe(false);
  for (const x of [-2, -1, 1, 2]) expect(covered(x * p, 3 * p, cells)).toBe(true);
  expect(covered(0, 3 * p + p / 2, cells)).toBe(false); // the new outer strip north of it
  expect(roadLayout(new GridAssembly({ developer: false, devserver: false }, { ...catalogue.grid, cells: [...catalogue.grid.cells, { instance: 'ring', slug: 'ring', cell: [0, 3] }] }), s => s).holes).toHaveLength(4);
});

test('the road world stands a player on the void at road level and stops them at the rail', async () => {
  const rapier = await loadRapier(Uint8Array.from(fixtureBytes(new URL('../public/assets/physics/rapier.wasm', import.meta.url))));
  const road = openRoad(rapier, j305.cells, [], j305.cells); disposers.push(() => { road.dispose(); });
  const { R, world } = road.physics, rail = gridRail(p);
  road.physics.step();
  const down = (x: number, z: number): number => { const hit = world.castRay(new R.Ray({ x, y: 50, z }, { x: 0, y: -1, z: 0 }), 400, true); return hit === null ? Number.NaN : 50 - hit.timeOfImpact; };
  expect(down(0, 3 * p)).toBeCloseTo(0, 3); // an empty ring-3 cell
  expect(down(3 * p, -3 * p)).toBeCloseTo(0, 3); // its corner
  expect(down(0, 2 * p + p / 2 + GAP_HALF + 5)).toBeCloseTo(0, 3); // the band past the outer road
  const out = world.castRay(new R.Ray({ x: 0, y: 1, z: 3 * p }, { x: 0, y: 0, z: 1 }), 1000, true);
  expect(out === null ? Number.NaN : 3 * p + out.timeOfImpact).toBeCloseTo(rail.maxZ - 0.25, 3); // the rim on the rail
});

test('Q12: a grid slug with no placement row is auto-placed; carded shards are not', () => {
  expect(autoPlaced({ slug: 'driftwood-isle' })).toBe(false); // no installed catalogue
  installCatalogue({ ...catalogue, grid: { ...catalogue.grid, cells: [...catalogue.grid.cells, { instance: 'thin-ice-2', slug: 'thin-ice-2', cell: [0, 3] }] } });
  expect(autoPlaced({ slug: 'thin-ice-2' })).toBe(true);
  for (const cell of catalogue.grid.cells) expect(autoPlaced({ slug: cell.slug })).toBe(false);
  expect(autoPlaced({ slug: 'open-plot-thin-ice' })).toBe(false); // off the grid
});
