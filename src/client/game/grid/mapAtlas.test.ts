// @vitest-environment happy-dom
import { expect, test, vi } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { ResidencyAllocator } from '../../../shared/game/grid/allocator';
import { loadGridMapAtlas } from './mapAtlas';
import { GridAssembly } from '../../../shared/game/grid/assembly';
import { CellMinimaps, fullMapOverlay, installAuthorMap, minimapOverlay } from './minimapBlend';
import type { MapExtras } from '@wildshard/engine/ui/Minimap';
import { GridCellEvents } from '../../../shared/game/grid/cellEvents';
import { CHUNK_HALF } from '@wildshard/engine/core/config';

const spec = { url: '/atlas.webp', compressed: 99, width: 512, height: 256, tileSize: 256, slugs: ['a', 'b'] };
test('a standalone author page shares one cook tile between the minimap and Bag map', async () => {
  const scope = new Scope('author-map');
  const bitmap = { width: 1024, height: 1024, close: vi.fn() };
  const fetch = vi.fn(() => Promise.resolve(new Response(new Blob())));
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.resolve(bitmap)));
  const minimap = vi.fn<(source: (() => MapExtras | null) | null) => void>();
  const fullMap = vi.fn<(source: (() => MapExtras | null) | null) => void>();
  try {
    installAuthorMap({ setExtras: minimap }, { setExtras: fullMap }, scope, '/cooked-map-v1.png');
    const extras = fullMap.mock.calls[0]?.[0];
    expect(minimap.mock.calls[0]?.[0]).toBe(extras);
    await vi.waitFor(() => {
      expect(extras?.()).toMatchObject({ baseAlpha: 0, images: [{ image: bitmap, x: 0, z: 0, alpha: 1 }] });
    });
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/cooked-map-v1.png');
  } finally { scope.dispose(); vi.unstubAllGlobals(); }
  expect(bitmap.close).toHaveBeenCalledTimes(1);
  expect(minimap).toHaveBeenLastCalledWith(null);
  expect(fullMap).toHaveBeenLastCalledWith(null);
});
test('one charged decode supplies crops until its owner retires', async () => {
  const scope = new Scope('atlas'), allocator = new ResidencyAllocator(); let reads = 0, closed = 0;
  const image = document.createElement('canvas');
  const reports: unknown[] = [];
  const tile = await loadGridMapAtlas(scope, allocator, spec, async () => { reads++; await Promise.resolve(); return { image, width: 512, height: 256, close: () => { closed++; } }; },
    (error, tags) => { reports.push([String(error), tags.screen, tags.shard]); });
  expect(tile('a')?.image).toBe(tile('b')?.image); expect(tile('b')?.crop).toEqual([256, 0, 256, 256]); expect(reads).toBe(1);
  expect(allocator.entries().find(row => row.id.includes('world-map'))?.bytes).toBe(512 * 256 * 4);
  // QA-FEEDBACK 2026-11-13 row 44: a slug with no tile never throws (it blanked the Map tab); one warning a slug
  expect(tile('missing')).toBeNull(); expect(tile('missing')).toBeNull(); expect(tile('other')).toBeNull();
  expect(reports).toEqual([['Error: Missing world map tile: missing', 'map-tile-missing', 'missing'], ['Error: Missing world map tile: other', 'map-tile-missing', 'other']]);
  scope.dispose(); expect(closed).toBe(1); expect(allocator.entries()).toHaveLength(0); expect(() => tile('a')).toThrow('retired');
});
test('refusal and cancellation release their charge and close only decoded images', async () => {
  for (const fail of ['read', 'dimensions', 'cancel']) {
    const scope = new Scope('atlas'), allocator = new ResidencyAllocator(); let closed = 0;
    const image = document.createElement('canvas');
    await expect(loadGridMapAtlas(scope, allocator, spec, async () => {
      await Promise.resolve(); if (fail === 'read') throw new Error('Read refused'); if (fail === 'cancel') scope.dispose();
      return { image, width: 1, height: 1, close: () => { closed++; } };
    })).rejects.toThrow();
    expect(allocator.entries()).toHaveLength(0); scope.dispose(); expect(closed).toBe(fail === 'read' ? 0 : 1);
  }
});
test('every current placement has an image on the first map open without reading any resident product', () => {
  const assembly = new GridAssembly({ developer: true, devserver: true }), home = assembly.cells[0];
  if (home === undefined) throw new Error('Missing home');
  const image = document.createElement('canvas'), requested: string[] = [];
  const overlay = fullMapOverlay({ assembly, home, cells: new GridCellEvents(), worldFeet: () => home.origin,
    name: cell => `Open Plot · ${cell.slug}`, image: () => { throw new Error('Resident product read'); } }, [], slug => {
    requested.push(slug); return { image, crop: [0, 0, 256, 256] };
  });
  expect(overlay.images).toHaveLength(assembly.cells.length); expect(overlay.labels).toHaveLength(assembly.cells.length); expect(overlay.baseAlpha).toBe(0);
  expect(requested).toEqual(assembly.cells.map(cell => cell.slug));
  for (const label of overlay.labels) { expect(label.width).toBeLessThan(500); expect(label.short).not.toContain('Open Plot'); }
});

test('a placed cell the atlas has no tile for draws its own map, or a plain plot until it loads (QA 2026-11-13 row 44)', () => {
  const assembly = new GridAssembly({ developer: true, devserver: true }), home = assembly.cells[0], placed = assembly.cells[1];
  if (home === undefined || placed === undefined) throw new Error('Missing cells');
  const atlasImage = document.createElement('canvas'), own = document.createElement('canvas');
  let ownLoaded = false; const asked: string[] = [];
  const host = { assembly, home, cells: new GridCellEvents(), worldFeet: () => home.origin, name: (cell: { slug: string }) => cell.slug,
    image: (instance: string) => { asked.push(instance); return ownLoaded ? own : null; } };
  const tile = (slug: string) => slug === placed.slug ? null : { image: atlasImage, crop: [0, 0, 256, 256] as [number, number, number, number] };
  const first = fullMapOverlay(host, [], tile);
  expect(first.images).toHaveLength(assembly.cells.length - 1); expect(first.labels).toHaveLength(assembly.cells.length); expect(asked).toEqual([placed.instance]);
  expect(first.rects.filter(r => r.color === '#69704f')).toEqual([{ x: placed.origin.x - home.origin.x, z: placed.origin.z - home.origin.z, hx: CHUNK_HALF, hz: CHUNK_HALF, color: '#69704f' }]);
  ownLoaded = true;
  const loaded = fullMapOverlay(host, [], tile);
  expect(loaded.images).toHaveLength(assembly.cells.length); expect(loaded.images.find(row => row.image === own)).toMatchObject({ x: placed.origin.x - home.origin.x, alpha: 1 });
  expect(loaded.rects.filter(r => r.color === '#69704f')).toEqual([]);
});

test('the full map spans the whole drawn 7 by 7, not the placed rectangle (J455, QA 2026-11-19 row 31: staging showed 6 by 6)', () => {
  const assembly = new GridAssembly({ developer: true, devserver: true }), home = assembly.cells[0];
  if (home === undefined) throw new Error('Missing home');
  const host = { assembly, home, cells: new GridCellEvents(), worldFeet: () => home.origin, name: (cell: { slug: string }) => cell.slug, image: () => null };
  const overlay = fullMapOverlay(host, [], () => null), p = assembly.pitch;
  expect(overlay.grid).toEqual({ x0: -3.5 * p - home.origin.x, z0: -3.5 * p - home.origin.z, pitch: p, cells: 7 });
  expect(overlay.rects[0]).toMatchObject({ x: 0 - home.origin.x, z: 0 - home.origin.z, hx: 3.5 * p, hz: 3.5 * p });
  // every cell of the 49 the grid does not place is an empty square
  expect(overlay.rects.filter(r => r.color === '#2c3029')).toHaveLength(49 - assembly.cells.length);
  // a lone shard keeps its own map
  const lone = new GridAssembly({ developer: true, devserver: true }, undefined, home.slug), only = lone.cells[0];
  if (only === undefined) throw new Error('Missing lone cell');
  expect(fullMapOverlay({ ...host, assembly: lone, home: only }, [], () => null).grid).toBeUndefined();
});

test('the road minimap draws the atlas, not each cell\'s product (ZONE-ENTRY ZE14: offline it read every cell\'s whole product)', () => {
  const assembly = new GridAssembly({ developer: true, devserver: true }), home = assembly.cells[0], placed = assembly.cells[1];
  if (home === undefined || placed === undefined) throw new Error('Missing cells');
  const atlasImage = document.createElement('canvas'), asked: string[] = [];
  // the feet on the road, past the home's east edge
  const host = { assembly, home, cells: new GridCellEvents(), worldFeet: () => ({ x: home.origin.x + CHUNK_HALF + 20, z: home.origin.z }), name: (cell: { slug: string }) => cell.slug,
    image: (instance: string) => { asked.push(instance); return null; } };
  const tile = (slug: string) => slug === placed.slug ? null : { image: atlasImage, crop: [0, 0, 256, 256] as [number, number, number, number] };
  const road = minimapOverlay(host, [], tile);
  // only the home's own layer and the one cell the atlas lacks are asked for; every other cell is its atlas tile, faded
  expect(asked.filter(instance => instance !== home.instance)).toEqual([placed.instance]);
  // MAP-NEXT MN14: the home with no map of its own is its atlas tile too, not painted ground
  expect(road.images.filter(row => row.image === atlasImage)).toHaveLength(assembly.cells.length - 1); expect(road.baseAlpha).toBe(0);
  expect(road.images.every(row => row.alpha < 1)).toBe(true);
});

test('MAP-NEXT MN9: with every zone\'s map the 7 by 7 is 49 cells, no plain plot, every name free to fill its cell', () => {
  const assembly = new GridAssembly({ developer: true, devserver: true }), home = assembly.cells[0];
  if (home === undefined) throw new Error('Missing home');
  const image = document.createElement('canvas');
  const overlay = fullMapOverlay({ assembly, home, cells: new GridCellEvents(), worldFeet: () => home.origin, name: cell => cell.slug, image: () => null },
    [], () => ({ image, crop: [0, 0, 256, 256] }));
  const empty = overlay.rects.filter(r => r.color === '#2c3029');
  expect(overlay.images.length + empty.length).toBe(49);
  expect(overlay.rects.filter(r => r.color === '#69704f')).toEqual([]);
  // QA 11-23-b row 16: each empty cell carries 3 survey lines each way, not one flat grey block
  expect(overlay.rects.filter(r => r.color === '#3d4436')).toHaveLength(6 * empty.length);
  for (const [i, cell] of assembly.cells.entries()) {
    expect(overlay.labels[i]?.fill).toEqual({ x: cell.origin.x - home.origin.x, z: cell.origin.z - home.origin.z, width: assembly.pitch - 24, height: 2 * CHUNK_HALF - 32 });
  }
});

test('MAP-NEXT MN14 (a): a flat author map with no cook\'s map is no map, and the home draws its atlas tile, not painted ground', async () => {
  // a build-pinned slug (Mossgate) has no placed cooked map to fall back to: its flat look/map counts as none
  const bitmap = { width: 4, height: 4, close: vi.fn() };
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob()) })));
  vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.resolve(bitmap)));
  const scope = new Scope('flat-map');
  try {
    let maps: CellMinimaps | undefined;
    const retained = await new Promise<unknown>(resolve => {
      maps = new CellMinimaps(scope, () => Promise.resolve({ url: '/map.webp', retained: resolve }), () => true, undefined, () => true);
      expect(maps.image('mossgate')).toBeNull();
    });
    expect(retained).toBeNull(); expect(bitmap.close).toHaveBeenCalledOnce();
    expect(maps?.image('mossgate')).toBeNull(); expect(maps?.peek('mossgate')).toBeNull();
  } finally { scope.dispose(); vi.unstubAllGlobals(); }
  // standing in the home with no map of its own: its atlas tile at full strength, no painted ground under it
  const assembly = new GridAssembly({ developer: true, devserver: true }), home = assembly.cells[0];
  if (home === undefined) throw new Error('Missing home');
  const atlasImage = document.createElement('canvas'), cells = new GridCellEvents();
  cells.enter(home);
  const host = { assembly, home, cells, worldFeet: () => home.origin, name: (cell: { slug: string }) => cell.slug, image: () => null };
  const inside = minimapOverlay(host, [], () => ({ image: atlasImage, crop: [0, 0, 256, 256] }));
  expect(inside.baseAlpha).toBe(0);
  expect(inside.images).toEqual([{ image: atlasImage, crop: [0, 0, 256, 256], x: 0, z: 0, size: 2 * CHUNK_HALF, alpha: 1 }]);
});

test('MAP-NEXT MN14 (b): the HUD minimap and the Bag map choose the same source for every cell', () => {
  const assembly = new GridAssembly({ developer: true, devserver: true }), [home, loaded, upload] = assembly.cells;
  if (home === undefined || loaded === undefined || upload === undefined) throw new Error('Missing cells');
  // the home and one neighbour have their own maps loaded; one placed upload has no atlas tile; the rest are atlas only
  const own = new Map([[home.instance, document.createElement('canvas')], [loaded.instance, document.createElement('canvas')], [upload.instance, document.createElement('canvas')]]);
  const atlasImage = document.createElement('canvas');
  const host = { assembly, home, cells: new GridCellEvents(), worldFeet: () => ({ x: home.origin.x + CHUNK_HALF + 20, z: home.origin.z }), name: (cell: { slug: string }) => cell.slug,
    image: (instance: string) => own.get(instance) ?? null, peek: (instance: string) => instance === upload.instance ? null : own.get(instance) ?? null };
  const tile = (slug: string) => slug === upload.slug ? null : { image: atlasImage, crop: [0, 0, 256, 256] as [number, number, number, number] };
  const source = (row: { image: unknown; crop?: unknown; x: number; z: number }) => [`${row.x},${row.z}`, [row.image, row.crop]] as const;
  const road = new Map(minimapOverlay(host, [], tile).images.map(source)), bag = new Map(fullMapOverlay(host, [], tile).images.map(source));
  expect(road.size).toBe(assembly.cells.length); expect(road).toEqual(bag);
  expect(bag.get('0,0')?.[0]).toBe(own.get(home.instance));
  expect(bag.get(`${loaded.origin.x - home.origin.x},${loaded.origin.z - home.origin.z}`)?.[0]).toBe(own.get(loaded.instance));
  expect(bag.get(`${upload.origin.x - home.origin.x},${upload.origin.z - home.origin.z}`)?.[0]).toBe(own.get(upload.instance));
});
