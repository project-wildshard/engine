import { expect, test } from 'vitest';
import { decodeTerrainTile, encodeTerrainTile, terrainTileHeight } from '@wildshard/format/terrainTileBytes';
import { tileHeightAt } from '../src/server/game/plugin/simulation';

// `boot-smoke --case-group=grid` on the flip: a road-hover into a Template cell stood at x -254 on a tile that ends at -250, and
// the height query threw "Point outside terrain", which stopped the whole server.
const ground = decodeTerrainTile(encodeTerrainTile({ resolution: 3, x: -2, z: -2, size: 4, heights: Float32Array.from([0, 1, -2, 3.5, 4, 6, 2, -3, 1]) }));

test('inside a tile the server reads the same sample', () => {
  const heightAt = tileHeightAt(ground);
  for (const [x, z] of [[-2, -2], [-1.5, -0.2], [0, 0], [0.75, 1.75], [2, 2]] as const) expect(heightAt(x, z)).toBe(terrainTileHeight(ground, x, z));
});

test('past a tile, on a road, the server reads its edge and keeps running', () => {
  const heightAt = tileHeightAt(ground);
  expect(() => terrainTileHeight(ground, -2.5, 0)).toThrow('Point outside terrain');
  expect(heightAt(-2.5, 0)).toBe(terrainTileHeight(ground, -2, 0));
  expect(heightAt(9, 2)).toBe(terrainTileHeight(ground, 2, 2));
});
