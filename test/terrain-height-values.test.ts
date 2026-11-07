import { expect, test } from 'vitest';
import { terrainTileHeight, type TerrainTileData } from '@wildshard/format/terrainTileBytes';

// Frozen before the D180 closure cut; preserve the original coordinate,
// fallback and floating-point operation order independently of the new reader.
function originalTerrainHeight(data: TerrainTileData, x: number, z: number, policy?: { layout?: 'column-major'; boundary?: 'clamp' }): number {
  if (policy?.boundary !== 'clamp' && (![x, z].every(Number.isFinite) || x < data.x || z < data.z || x > data.x + data.size || z > data.z + data.size)) throw new Error('Point outside terrain');
  const n = data.resolution - 1, column = policy?.layout === 'column-major', step = data.size / n;
  const gridX = column ? (x - data.x) / step : (x - data.x) / data.size * n, gridZ = column ? (z - data.z) / step : (z - data.z) / data.size * n;
  const gx = policy?.boundary === 'clamp' ? Math.min(n, Math.max(0, gridX)) : gridX, gz = policy?.boundary === 'clamp' ? Math.min(n, Math.max(0, gridZ)) : gridZ;
  const ix = Math.min(n - 1, Math.floor(gx)), iz = Math.min(n - 1, Math.floor(gz)), u = gx - ix, v = gz - iz;
  const at = (dx: number, dz: number): number => data.heights[column ? (ix + dx) * data.resolution + iz + dz : (iz + dz) * data.resolution + ix + dx] ?? (column ? Number.NaN : 0);
  return u + v <= 1 ? at(0, 0) + (at(1, 0) - at(0, 0)) * u + (at(0, 1) - at(0, 0)) * v : at(1, 1) + (at(0, 1) - at(1, 1)) * (1 - u) + (at(1, 0) - at(1, 1)) * (1 - v);
}

test('every lattice triangle retains exact original row and column sampling', () => {
  let compared = 0;
  for (const resolution of [2, 3, 17, 257]) {
    const data: TerrainTileData = { resolution, x: -17, z: -23, size: 500,
      heights: Float32Array.from({ length: resolution ** 2 }, (_, index) => ((Math.imul(index, 73) % 1024) - 512) / 64) };
    for (const column of [false, true]) {
      const policy = column ? { layout: 'column-major' as const } : undefined;
      for (let ix = 0; ix < resolution - 1; ix++) for (let iz = 0; iz < resolution - 1; iz++) {
        for (const [u, v] of [[0.2, 0.3], [0.8, 0.7], [0.5, 0.5]]) {
          if (u === undefined || v === undefined) throw new Error('Missing triangle control');
          const x = data.x + (ix + u) / (resolution - 1) * data.size, z = data.z + (iz + v) / (resolution - 1) * data.size;
          const actual = terrainTileHeight(data, x, z, policy), before = originalTerrainHeight(data, x, z, policy);
          if (!Object.is(actual, before)) throw new Error(`Changed triangle ${resolution}/${column}/${ix}/${iz}/${u}/${v}`);
          compared++;
        }
      }
    }
  }
  expect(compared).toBe(394782);
});

test('clamping, boundary failures and original short-field fallbacks remain exact', () => {
  for (const heights of [new Float32Array([-0, 1.25, -2.5, 3.75]), new Float32Array([-0])]) {
    const data: TerrainTileData = { resolution: 2, x: -2, z: -3, size: 8, heights };
    for (const column of [false, true]) for (const clamp of [false, true]) {
      const policy = { ...(column ? { layout: 'column-major' as const } : {}), ...(clamp ? { boundary: 'clamp' as const } : {}) };
      for (const x of [-Infinity, -3, -2, 0, 6, 7, Infinity, Number.NaN]) for (const z of [-Infinity, -4, -3, 0, 5, 6, Infinity, Number.NaN]) {
        let expected: number;
        try { expected = originalTerrainHeight(data, x, z, policy); }
        catch { expect(() => terrainTileHeight(data, x, z, policy)).toThrow('Point outside terrain'); continue; }
        expect(Object.is(terrainTileHeight(data, x, z, policy), expected)).toBe(true);
      }
    }
  }
});
