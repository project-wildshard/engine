import { expect, test } from 'vitest';
import { GridAssembly } from '../../../shared/game/grid/assembly';
import { ResidencyAllocator } from '../../../shared/game/grid/allocator';
import { FAR_RING } from '../../../shared/game/grid/farProxy';
import { TileStreamer, type RingCatalogue, type RingPorts } from '@wildshard/engine/world/tileStreamer';

// ringsReady: ready() waits on every visible cell, and the far ring requests a proxy only while its charge fits the
// 14.4 MB budget. Charging unloaded proxies the 1.6 MB cap left the 12th visible cell of a corner spawn unrequested (the
// reveal's 20 s ceiling at 4x CPU); charged their declared bytes, every visible cell is requested within the same budget.
const assembly = new GridAssembly({ developer: true, devserver: true });
const cells = assembly.cells.map((cell) => ({ instance: cell.instance, origin: cell.origin }));
const SLOT = 1_600_000, DECLARED = 740_000;

function corner(charge: number): { requested: number; unrequested: readonly string[]; omittedVisible: number } {
  const catalogue: RingCatalogue = (_instance, level) => (level === 'far' ? charge : null);
  const ports: RingPorts<string> = { fetch: () => undefined, upload: () => ({ mask: () => undefined, shadow: () => undefined, dispose: () => undefined }) };
  const rings = new TileStreamer(cells, new ResidencyAllocator(), catalogue, ports, { farRadius: FAR_RING.reach, maxInFlight: 64 });
  rings.step({ x: 270, z: 270, vx: 0, vz: 0 }); // near the home cell's corner: the most cells in view
  const waiting = rings.waiting(), plan = rings.farPlan();
  rings.dispose();
  return { requested: waiting.filter((row) => row.far === 'fetching').length, unrequested: waiting.filter((row) => row.far === 'unrequested').map((row) => row.instance),
    omittedVisible: plan.omitted.filter((row) => row.visible).length };
}

test('placeholder charges leave a visible cell unrequested, so ready() could only time out', () => {
  const run = corner(SLOT);
  expect(run.unrequested.length).toBeGreaterThan(0);
  expect(run.omittedVisible).toBe(run.unrequested.length);
});

test('declared charges request every visible cell inside the unchanged budget', () => {
  const run = corner(DECLARED);
  expect(run.unrequested).toEqual([]);
  expect(run.omittedVisible).toBe(0);
  expect(run.requested).toBeGreaterThanOrEqual(9);
});
