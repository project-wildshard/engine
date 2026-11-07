import { expect, test } from 'vitest';
import { clipEntryPolygon, entryFootprints, obstructsEntry, type EntryVertex } from '@wildshard/format/entryGeometry';
import { Rng } from '../src/shared/engine/core/rng';

// obstructsEntry's early exit (a triangle wholly past one footprint side) beside the full clip it skips: the same verdict
// for random triangles near, across and far from every edge footprint, including ones touching a side exactly.
function reference(vertices: readonly EntryVertex[], rect: ReturnType<typeof entryFootprints>[number]): boolean {
  const clipped = clipEntryPolygon(vertices, rect), above: EntryVertex[] = [];
  for (let i = 0; i < clipped.length; i++) {
    const a = clipped[i], b = clipped[(i + 1) % clipped.length]; if (a === undefined || b === undefined) continue;
    if (a.y >= 0) above.push(a);
    if ((a.y < 0) !== (b.y < 0)) { const t = a.y / (a.y - b.y); above.push({ x: a.x + (b.x - a.x) * t, y: 0, z: a.z + (b.z - a.z) * t }); }
  }
  if (!above.some(point => point.y > 0)) return false;
  const x = above.reduce((sum, p) => sum + p.x, 0) / above.length, z = above.reduce((sum, p) => sum + p.z, 0) / above.length;
  return x > rect.minX && x < rect.maxX && z > rect.minZ && z < rect.maxZ;
}
test('the early exit gives the full clip\'s verdict for every triangle', () => {
  const rects = entryFootprints([{ edge: 'north', width: 8 }, { edge: 'south', width: 8 }, { edge: 'east', width: 8 }, { edge: 'west', width: 8 }]);
  const rng = new Rng(9), r = (lo: number, hi: number): number => lo + (hi - lo) * rng.next();
  let hits = 0, n = 0;
  for (let i = 0; i < 40000; i++) {
    const rect = rects[i % rects.length]; if (rect === undefined) throw new Error('rect');
    const cx = r(rect.minX - 8, rect.maxX + 8), cz = r(rect.minZ - 8, rect.maxZ + 8), s = r(0.2, 6);
    const snap = (v: number, edges: readonly number[]): number => (rng.next() < 0.15 ? edges[Math.floor(rng.next() * edges.length)] ?? v : v);
    const tri: EntryVertex[] = [0, 1, 2].map(() => ({ x: snap(cx + r(-s, s), [rect.minX, rect.maxX]), y: r(-1, 3), z: snap(cz + r(-s, s), [rect.minZ, rect.maxZ]) }));
    const a = obstructsEntry(tri, rect), b = reference(tri, rect); n++; if (b) hits++;
    expect(a).toBe(b);
  }
  expect(hits).toBeGreaterThan(1000); expect(n).toBe(40000);
  expect(obstructsEntry([], rects[0] ?? { minX: 0, maxX: 1, minZ: 0, maxZ: 1 })).toBe(false);
});
