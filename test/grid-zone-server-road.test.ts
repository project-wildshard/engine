// oxlint-disable-next-line import/no-nodejs-modules -- Real Rapier bytes.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { castRay } from '../src/shared/engine/physics/query';
import { createSimHost, type SimHost } from '../src/server/engine/sim';
import { GridAssembly } from '../src/shared/game/grid/assembly';
import { GridSimulation, type GridResident } from '../src/server/game/grid/simulation';
import { addZoneWalls, ROAD } from '../src/server/host/standalone/roadWorld';
import { BUFFER_DEPTH } from '../src/shared/game/grid/zoneWalls';

// ZONE-ENTRY ZE11 (J352): the in-page server is walled as the page is. On 2026-11-15 the laptop's road-memory probe slid a board
// from Driftwood's road into Pine Hollow and an open plot: the server's road crossed a walker into any cell within 6 m, past the
// page's walls, and the page followed. Now only the home is entered from the road; every other cell's entryway leads to its gate.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))); });
const resident = (host: SimHost): GridResident => ({ host, dispose: () => { host.dispose(); } });

test('the in-page server crosses a walker only into its home; another cell within 6 m stays the road', () => {
  const assembly = new GridAssembly({ developer: false, devserver: false }), [home, other] = assembly.cells;
  if (home === undefined || other === undefined) throw new Error('Missing cells');
  const road = createSimHost(ROAD, { rapier });
  const grid = new GridSimulation(assembly, { highway: resident(road), enterable: instance => instance === home.instance,
    load: () => Promise.reject(new Error('no world loads here')) });
  try {
    const near = (cell: typeof home): { x: number; y: number; z: number } => ({ x: cell.origin.x + CHUNK_HALF + 3, y: 0, z: cell.origin.z });
    expect(grid.target(near(home))).toBe(home.instance);
    expect(grid.target(near(other))).toBeNull(); // red before ZE11: the 6 m band entered any cell
    expect(grid.target({ ...other.origin, y: 0 })).toBeNull();
  } finally { grid.dispose(); }
});

test('the server road walls every cell but the home: its edge stands, its buffer is floored and its gate shut', () => {
  const assembly = new GridAssembly({ developer: false, devserver: false }), [home, other] = assembly.cells;
  if (home === undefined || other === undefined) throw new Error('Missing cells');
  const road = createSimHost(ROAD, { rapier });
  try {
    addZoneWalls(road, assembly.cells, home.instance);
    road.physics.world.step();
    const hits = (from: { x: number; y: number; z: number }, to: { x: number; z: number }): boolean => {
      const dx = to.x - from.x, dz = to.z - from.z, length = Math.hypot(dx, dz);
      return castRay(road.physics, from, { x: dx / length, y: 0, z: dz / length }, length, ['WORLD']) !== null;
    };
    // east side of each: along the edge 40 m off the entryway, a walk in meets the wall; through the entryway it reaches the gate
    const east = (cell: typeof home, along: number, depth: number): { x: number; y: number; z: number } => ({ x: cell.origin.x + CHUNK_HALF - depth, y: 1, z: cell.origin.z + along });
    const outsideOf = (cell: typeof home, along: number): { x: number; y: number; z: number } => east(cell, along, -6);
    expect(hits(outsideOf(other, 40), east(other, 40, 6))).toBe(true);
    expect(hits(outsideOf(other, 0), east(other, 0, BUFFER_DEPTH - 2))).toBe(false); // into the buffer
    expect(hits(outsideOf(other, 0), east(other, 0, BUFFER_DEPTH + 2))).toBe(true); // the gate
    expect(castRay(road.physics, east(other, 0, 5), { x: 0, y: -1, z: 0 }, 3, ['WORLD'])).not.toBeNull(); // the buffer's floor
    expect(hits(outsideOf(home, 40), east(home, 40, 20))).toBe(false); // the home stands open
  } finally { road.dispose(); }
});
