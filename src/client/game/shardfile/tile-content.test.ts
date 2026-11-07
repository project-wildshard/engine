import { TILES_PER_SIDE, type CellTile } from '../../../shared/game/shardfile/tileOrder';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { bucketByTile, CELL_RING, compactResident, followTile, ring, ringRadius, tileKey, tileRanges } from './tileContent';
import { jsonSlot } from '@wildshard/engine/saves/slots';
import { LEVEL_DOWNLOAD_SLOT, runtimePacksOn } from '@wildshard/engine/boot/loadingPacks';

const download = jsonSlot(LEVEL_DOWNLOAD_SLOT, 'device'), previous = download.read();
beforeAll(() => { download.write('shardfile'); expect(runtimePacksOn()).toBe(false); });
afterAll(() => { download.write(previous); });

const TILES = TILES_PER_SIDE * TILES_PER_SIDE;

// Historical contract oracle; production consumers use the data-driven owners.
/** The tile of a key. */
function keyTile(key: number): CellTile {
  if (!Number.isInteger(key) || key < 0 || key >= TILES) throw new RangeError('Not a tile key');
  return { i: key % TILES_PER_SIDE, j: Math.floor(key / TILES_PER_SIDE) };
}



test('T3: copies bucket by the tile of their pose, in input order', () => {
  const poses = [{ x: -249, z: -249 }, { x: 10, z: 10 }, { x: -240, z: -200 }, { x: 249, z: 249 }, { x: 300, z: 0 }];
  const buckets = bucketByTile(poses, pose => pose);
  expect(buckets.get(0)).toEqual([0, 2]);
  expect(buckets.get(tileKey({ i: 4, j: 4 }))).toEqual([1]);
  expect(buckets.get(63)).toEqual([3]);
  // outside the cell clamps to its edge tile
  expect(buckets.get(tileKey({ i: 7, j: 4 }))).toEqual([4]);
  expect(keyTile(tileKey({ i: 3, j: 6 }))).toEqual({ i: 3, j: 6 });
});

test('T3: instances sort by tile; the resident tiles compact to the front, one draw', () => {
  // four instances of stride 3 (x, y, z): tiles 36, 0, 36, 63
  const values = [10, 1, 10, -249, 2, -249, 20, 3, 20, 249, 4, 249];
  const ranges = tileRanges(values, 3, 0, 2);
  expect(Array.from(ranges.order)).toEqual([1, 0, 2, 3]);
  expect([ranges.start[36], ranges.count[36]]).toEqual([1, 2]);
  const target = new Float32Array(values.length);
  expect(compactResident(ranges, new Set([36]), values, target, 3)).toBe(2);
  expect(Array.from(target.slice(0, 6))).toEqual([10, 1, 10, 20, 3, 20]);
  expect(compactResident(ranges, new Set([0, 63]), values, target, 3)).toBe(2);
  expect(Array.from(target.slice(0, 6))).toEqual([-249, 2, -249, 249, 4, 249]);
  expect(() => compactResident(ranges, new Set([0, 36, 63]), values, new Float32Array(6), 3)).toThrow('exceed');
});

test('FR2: a product declaring ring: cell enters with the whole cell; any other keeps the device ring', () => {
  expect(ringRadius({ ring: 'cell' }, () => 2)).toBe(CELL_RING);
  expect(ring({ i: 0, j: 7 }, CELL_RING).size).toBe(64);
  expect(ringRadius({}, () => 1)).toBe(1);
});

test('T3: the ring clips to the cell; the followed tile waits out its hysteresis', () => {
  expect(ring({ i: 0, j: 0 }, 1).size).toBe(4);
  expect(ring({ i: 4, j: 4 }, 2).size).toBe(25);
  expect(ring({ i: 4, j: 4 }, 7).size).toBe(64);
  expect(() => ring({ i: 4, j: 4 }, 8)).toThrow('0 to 7');
  const start = followTile(null, 1, 1);
  expect(start).toEqual({ i: 4, j: 4 });
  // 1 m over the edge into the next tile: stays; 5 m in: moves
  expect(followTile(start, 63.5, 30)).toEqual(start);
  expect(followTile(start, 67.5, 30)).toEqual({ i: 5, j: 4 });
  // a jump landing 3 m inside a far tile (the King's clearing from the spawn, a respawn) moves at once; back 1 m: stays
  const far = followTile(start, 128, -30);
  expect(far).toEqual({ i: 6, j: 3 });
  expect(followTile(far, 124, -30)).toEqual(far);
});
