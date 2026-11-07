import { expect, test } from 'vitest';
import { TileStreamer, type RingCell, type RingLevel, type RingTile, type TileKind } from '@wildshard/engine/world/tileStreamer';
import { ResidencyAllocator } from '../../../shared/game/grid/allocator';

const camera = { x: 0, z: 0, vx: 0, vz: 0 };
function rectangle(type: TileKind, width: number, depth: number) {
  const allocator = new ResidencyAllocator(), masks = new Map<string, Set<number>>();
  const queried: { level: RingLevel; x: number; z: number; type: TileKind | undefined }[] = [], uploaded: RingTile[] = [], parents: boolean[] = [];
  const cell: RingCell = { instance: 'strip', origin: { x: 0, z: 0 }, type, extent: { width, depth } };
  const streamer = new TileStreamer([cell], { reserve: claim => allocator.reserve(claim), now: () => 0 },
    (_instance, level, x, z, kind) => { queried.push({ level, x, z, type: kind }); return 1000; }, {
      fetch: (tile, done) => {
        if (tile.level !== 'far') parents.push(masks.has(tile.level === 'l1' ? 'strip:far' : `strip:l1/${String(Math.floor(tile.x / 2))}/${String(Math.floor(tile.z / 2))}`));
        done(tile.key);
      },
      upload: tile => { uploaded.push(tile); masks.set(tile.key, new Set()); return {
        mask: excluded => { masks.set(tile.key, new Set(excluded)); }, shadow: () => undefined,
        dispose: () => { masks.delete(tile.key); },
      }; },
    });
  return { streamer, allocator, masks, queried, uploaded, parents };
}

test.each([
  { type: 'road', width: 55, depth: 500, nx: 1, nz: 8 },
  { type: 'road', width: 500, depth: 55, nx: 8, nz: 1 },
  { type: 'junction', width: 55, depth: 55, nx: 1, nz: 1 },
  { type: 'junction', width: 130, depth: 75, nx: 3, nz: 2 },
] as const)('rectangle %o keeps clipped tile coverage and parent masks', async ({ type, width, depth, nx, nz }) => {
  const f = rectangle(type, width, depth), keys = Array.from({ length: nz }, (_row, z) => Array.from({ length: nx }, (_column, x) => z * 8 + x)).flat();
  const required = f.streamer.require('strip', keys);
  try {
    for (let step = 0; step < 40; step++) f.streamer.step(camera);
    await required.ready;
    const fine = f.uploaded.filter(tile => tile.level === 'l0');
    expect(fine).toHaveLength(nx * nz); expect(f.parents.every(Boolean)).toBe(true);
    expect(fine.every(tile => tile.type === type)).toBe(true);
    let area = 0;
    for (const tile of fine) {
      const box = f.streamer.bounds(tile);
      expect(box.minX).toBeGreaterThanOrEqual(-width / 2); expect(box.maxX).toBeLessThanOrEqual(width / 2);
      expect(box.minZ).toBeGreaterThanOrEqual(-depth / 2); expect(box.maxZ).toBeLessThanOrEqual(depth / 2);
      area += (box.maxX - box.minX) * (box.maxZ - box.minZ);
    }
    expect(area).toBe(width * depth);
    const expectedFar = new Set<number>();
    for (const coarse of f.uploaded.filter(tile => tile.level === 'l1')) {
      expectedFar.add(coarse.x + 4 * coarse.z);
      const children = fine.filter(tile => Math.floor(tile.x / 2) === coarse.x && Math.floor(tile.z / 2) === coarse.z);
      expect(f.masks.get(coarse.key)).toEqual(new Set(children.map(tile => tile.x % 2 + 2 * (tile.z % 2))));
    }
    expect(f.masks.get('strip:far')).toEqual(expectedFar);
    for (const row of f.queried) {
      const size = row.level === 'l0' ? 62.5 : row.level === 'l1' ? 125 : 500;
      expect(row.x).toBeLessThan(Math.ceil(width / size)); expect(row.z).toBeLessThan(Math.ceil(depth / size));
      expect(row.type).toBe(type);
    }
    expect(() => f.streamer.bounds({ instance: 'strip', level: 'l0', x: nx, z: 0 })).toThrow('outside rectangle');
    if (nx < 8) expect(() => f.streamer.require('strip', [nx])).toThrow('required tile key');
  } finally { required.release(); f.streamer.dispose(); }
  expect(f.masks.size).toBe(0); expect(f.allocator.entries()).toHaveLength(0);
});

test.each([0, -1, 501, Number.NaN, Number.POSITIVE_INFINITY])('invalid rectangle extent %s refuses before admission', width => {
  expect(() => rectangle('road', width, 55)).toThrow('Invalid tile rectangle');
  expect(() => rectangle('junction', 55, width)).toThrow('Invalid tile rectangle');
});

test('kinds share unique instance ids, and admitted extent snapshots cannot drift with author rows', () => {
  const allocator = new ResidencyAllocator(), extent = { width: 55, depth: 55 };
  const budget = { reserve: () => { throw new Error('No admission expected'); }, now: () => 0 };
  const ports = { fetch: () => { throw new Error('No fetch expected'); }, upload: () => { throw new Error('No upload expected'); } };
  const streamer = new TileStreamer([{ instance: 'cross', type: 'junction', origin: { x: 0, z: 0 }, extent }], budget, () => null, ports);
  extent.width = 500;
  expect(streamer.bounds({ instance: 'cross', level: 'far', x: 0, z: 0 })).toEqual({ minX: -27.5, minZ: -27.5, maxX: 27.5, maxZ: 27.5 });
  streamer.dispose();
  expect(() => new TileStreamer([
    { instance: 'same', type: 'road', origin: { x: 0, z: 0 } },
    { instance: 'same', type: 'junction', origin: { x: 10, z: 0 } },
  ], allocator, () => null, ports)).toThrow('Invalid ring cells');
});
