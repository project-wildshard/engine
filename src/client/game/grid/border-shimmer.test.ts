import { expect, test } from 'vitest';
import { nearShimmerSides } from './borderShimmer';

// NINE-DRAGON-BENCHMAX NB8 (mini-nb8h): the shimmer draws only the sides some of whose ribbon is within reach of the eye
// across the ground (its fragment shader discards everything past the fade's end).
test('a side is near when any point of it, not only an end, is within reach across the ground', () => {
  // side 0 runs along x from -100 to 100 at z 0; side 1 is a short one 300 m north; side 2 runs along z at x 200
  const ends = Float32Array.from([-100, 0, 100, 0, -5, 300, 5, 300, 200, -100, 200, 100]);
  expect(nearShimmerSides(ends, 3, 0, 140, 150)).toEqual([0]);
  expect(nearShimmerSides(ends, 3, 0, 160, 150)).toEqual([1]);
  expect(nearShimmerSides(ends, 3, 0, 150, 150)).toEqual([0, 1]);
  // the eye 149 m from the middle of side 0, both its ends further than reach
  expect(nearShimmerSides(ends, 3, 0, -149, 150)).toEqual([0]);
  expect(nearShimmerSides(ends, 3, 0, -151, 150)).toEqual([]);
  // past the end of side 2 along its own line
  expect(nearShimmerSides(ends, 3, 200, 240, 150)).toEqual([2]);
  expect(nearShimmerSides(ends, 3, 200, 251, 150)).toEqual([]);
});

// DF11 (mini-df11): the save panel's border search scores sides in locals; this pins it to the old candidate-list pick
// (north, south, east, west per cell, strict `<`, the first one on a tie).
test('the save panel stands on the nearest border, as the candidate list chose it', async () => {
  const { installBorderShimmer } = await import('./borderShimmer');
  const { CHUNK_HALF } = await import('@wildshard/engine/core/config');
  const { Group } = await import('three');
  const stub = { createElement: () => ({ width: 0, height: 0, getContext: () => null }) };
  const prior: unknown = Reflect.get(globalThis, 'document');
  Reflect.set(globalThis, 'document', stub);
  try {
    const cells = [{ x: 0, z: 0, edges: null }, { x: 2 * CHUNK_HALF + 40, z: 0, edges: null }, { x: 0, z: 2 * CHUNK_HALF + 40, edges: null }];
    let feet = { x: 0, z: 0 };
    const scene = new Group();
    const shimmer = installBorderShimmer({ cells, scene, scope: { onDispose: () => undefined }, time: () => 1,
      ports: { feet: () => feet, status: () => 'failed', text: () => 'x' } });
    const panel = scene.getObjectByName('grid-border-save');
    if (panel === undefined) throw new Error('no panel');
    const expected = (fx: number, fz: number): { x: number; z: number; ry: number; d: number } | null => {
      let best: { x: number; z: number; ry: number; d: number } | null = null;
      for (const cell of cells) {
        const lx = fx - cell.x, lz = fz - cell.z;
        const sx = Math.max(-CHUNK_HALF + 1.5, Math.min(CHUNK_HALF - 1.5, lx)), sz = Math.max(-CHUNK_HALF + 1.5, Math.min(CHUNK_HALF - 1.5, lz));
        const candidates = [{ x: cell.x + sx, z: cell.z + CHUNK_HALF, d: Math.abs(lz - CHUNK_HALF) + Math.abs(lx - sx), ry: lz > CHUNK_HALF ? 0 : Math.PI },
          { x: cell.x + sx, z: cell.z - CHUNK_HALF, d: Math.abs(lz + CHUNK_HALF) + Math.abs(lx - sx), ry: lz < -CHUNK_HALF ? Math.PI : 0 },
          { x: cell.x + CHUNK_HALF, z: cell.z + sz, d: Math.abs(lx - CHUNK_HALF) + Math.abs(lz - sz), ry: lx > CHUNK_HALF ? Math.PI / 2 : -Math.PI / 2 },
          { x: cell.x - CHUNK_HALF, z: cell.z + sz, d: Math.abs(lx + CHUNK_HALF) + Math.abs(lz - sz), ry: lx < -CHUNK_HALF ? -Math.PI / 2 : Math.PI / 2 }];
        for (const c of candidates) if (best === null || c.d < best.d) best = c;
      }
      return best;
    };
    let shown = 0;
    for (let x = -CHUNK_HALF - 30; x <= 3 * CHUNK_HALF + 60; x += 7.5) {
      for (let z = -CHUNK_HALF - 30; z <= 3 * CHUNK_HALF + 60; z += 7.5) {
        feet = { x, z };
        shimmer.step();
        const want = expected(x, z);
        if (want === null || want.d > 40) { expect(panel.visible).toBe(false); continue; }
        shown++;
        expect(panel.visible).toBe(true);
        expect([panel.position.x, panel.position.z, panel.rotation.y]).toEqual([want.x, want.z, want.ry]);
      }
    }
    expect(shown).toBeGreaterThan(50);
  } finally { Reflect.set(globalThis, 'document', prior); }
});
