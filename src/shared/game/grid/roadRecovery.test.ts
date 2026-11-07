import { expect, test } from 'vitest';
import { GridAssembly } from './assembly';
import { ROAD_HALF } from './roadLayout';
import { onRoad, RoadRecovery, type RoadGrid } from './roadRecovery';

/** Frozen pre-cut range calculation; recovery policy must not change. */
function original(grid: RoadGrid, x: number, z: number): boolean {
  const xs = grid.cells.map(row => row.cell[0]), zs = grid.cells.map(row => row.cell[1]), p = grid.pitch;
  const margin = p / 2 + ROAD_HALF - .5;
  if (x < Math.min(...xs) * p - margin || x > Math.max(...xs) * p + margin || z < Math.min(...zs) * p - margin || z > Math.max(...zs) * p + margin) return false;
  const across = (value: number): number => value - (Math.round((value - p / 2) / p) * p + p / 2);
  return Math.abs(across(x)) <= ROAD_HALF - .5 || Math.abs(across(z)) <= ROAD_HALF - .5;
}

test.each([false, true])('road ranges preserve every admitted cell edge and outer kerb, Developer=%s', developer => {
  const grid = new GridAssembly({ developer, devserver: false });
  const points = new Set([Number.NaN, Infinity, -Infinity, -0, 0]);
  for (const row of grid.cells) for (const axis of row.cell) {
    for (const centre of [axis * grid.pitch, (axis + .5) * grid.pitch, (axis - .5) * grid.pitch]) {
      for (const offset of [0, ROAD_HALF - .5, -ROAD_HALF + .5, ROAD_HALF - .5 + .000001, -ROAD_HALF + .5 - .000001]) points.add(centre + offset);
    }
  }
  for (const x of points) for (const z of points) expect(onRoad(grid, x, z)).toBe(original(grid, x, z));
});

test('road ranges read current placements and pitch without retaining bounds', () => {
  const coordinate: [number, number] = [0, 0], grid = { pitch: 555, cells: [{ cell: coordinate }] };
  expect(onRoad(grid, 277.5, 0)).toBe(true);
  coordinate[0] = 4;
  expect(onRoad(grid, 277.5, 0)).toBe(false);
  expect(onRoad(grid, 4.5 * grid.pitch, 0)).toBe(true);
  grid.pitch = 400;
  expect(onRoad(grid, 4.5 * grid.pitch, 0)).toBe(true);
  for (const cells of [[], [{ cell: [0, 0] as const }], [{ cell: [Number.NaN, Infinity] as const }]]) {
    for (const x of [0, 200, Infinity, Number.NaN]) expect(onRoad({ pitch: 400, cells }, x, 0)).toBe(original({ pitch: 400, cells }, x, 0));
  }
});

test('range reads keep x-then-z-then-pitch order and remain local under getter reentry', () => {
  const reads: string[] = [], inner = { pitch: 20, cells: [{ cell: [7, 3] as const }] };
  let armed = true;
  const rows = [0, 1].map(index => {
    const cell: [number, number] = [index, -index];
    Object.defineProperty(cell, '0', { get() {
      reads.push(`x${index}`);
      if (armed) { armed = false; expect(onRoad(inner, 150, 60)).toBe(original(inner, 150, 60)); }
      return index;
    } });
    Object.defineProperty(cell, '1', { get() { reads.push(`z${index}`); return -index; } });
    return { cell };
  });
  const grid = { get cells() { reads.push('cells'); return rows; }, get pitch() { reads.push('pitch'); return 555; } };
  const expected = original(grid, 277.5, 0), order = reads.splice(0);
  armed = true;
  expect(onRoad(grid, 277.5, 0)).toBe(expected);
  expect(reads).toEqual(order);
  expect(reads).toEqual(['cells', 'x0', 'x1', 'cells', 'z0', 'z1', 'pitch']);
});

test('road observations retain lane snapping and the last safe road point', () => {
  const grid = { pitch: 555, cells: [{ cell: [0, 0] as const }] }, road = new RoadRecovery(grid);
  road.observe({ x: 12, y: 0, z: 279 }, 1, true);
  expect(road.lastRoad()).toEqual({ x: 12, z: 281.1, yaw: 1 });
  road.observe({ x: 0, y: 0, z: 0 }, 2, true);
  expect(road.target()).toEqual({ x: 12, z: 281.1, yaw: 1 });
  road.observe({ x: 12, y: 3, z: 279 }, 3, true);
  expect(road.lastRoad()).toEqual({ x: 12, z: 281.1, yaw: 1 });
});
