import { expect, test } from 'vitest';
import { GridAssembly } from '../../../shared/game/grid/assembly';
import { ResidencyAllocator } from '../../../shared/game/grid/allocator';
import { FAR_RING } from '../../../shared/game/grid/farProxy';
import { TileStreamer, type RingCatalogue, type RingPorts } from '@wildshard/engine/world/tileStreamer';

// SF88c (G526): from anywhere on the 5 × 5's outer road, every cell of the layout keeps its far proxy (no whole cell pops), inside the
// far ring's unchanged budget (9 charges of 1.6 MB), each proxy charged its own bytes once loaded.
const assembly = new GridAssembly({ developer: true, devserver: true });
const cells = assembly.cells.map((cell) => ({ instance: cell.instance, origin: cell.origin }));
const PROXY = 480_000, SLOT = 1_600_000, EDGE = 2.5 * assembly.pitch;

function drive(path: readonly (readonly [number, number])[]): { far: number; seen: Set<number> } {
  const loaded = new Set<string>();
  // like the session: a full slot until the proxy has loaded, then its own bytes
  const catalogue: RingCatalogue = (instance, level) => (level === 'far' ? (loaded.has(instance) ? PROXY : SLOT) : null);
  const ports: RingPorts<string> = {
    fetch: (tile, done) => { loaded.add(tile.instance); done(tile.instance); },
    upload: () => ({ mask: () => undefined, shadow: () => undefined, dispose: () => undefined }),
  };
  const rings = new TileStreamer(cells, new ResidencyAllocator(), catalogue, ports, { farRadius: FAR_RING.reach });
  const seen = new Set<number>();
  for (const [x, z] of path) for (let i = 0; i < 30; i++) { rings.step({ x, z, vx: 0, vz: 0 }); if (i === 29) seen.add(rings.stats().resident.far); }
  rings.dispose();
  return { far: cells.length, seen };
}

test('the far ring holds every cell along the outer road', () => {
  const lap: [number, number][] = [];
  for (let s = -EDGE; s <= EDGE; s += assembly.pitch / 2) lap.push([s, EDGE], [EDGE, -s], [-s, -EDGE], [-EDGE, s]);
  const { far, seen } = drive(lap);
  expect([...seen]).toEqual([far]);
});

test('the sightline covers the 5 × 5 inside the far plane and the dome', () => {
  expect(FAR_RING.reach).toBeGreaterThan(3900);
  expect(FAR_RING.domeRadius).toBeGreaterThan(FAR_RING.reach);
  expect(FAR_RING.drawDistance).toBeGreaterThan(FAR_RING.domeRadius);
});
