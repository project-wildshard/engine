// @vitest-environment happy-dom
import { expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { ResidencyAllocator } from '../../../shared/game/grid/allocator';
import { loadGridMapAtlas } from './mapAtlas';
import { GridAssembly } from '../../../shared/game/grid/assembly';
import { fullMapOverlay, minimapOverlay } from './minimapBlend';
import { GridCellEvents } from '../../../shared/game/grid/cellEvents';
import { CHUNK_HALF } from '@wildshard/engine/core/config';

const spec = { url: '/atlas.webp', compressed: 99, width: 512, height: 256, tileSize: 256, slugs: ['a', 'b'] };
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
  expect(overlay.images).toHaveLength(24); expect(overlay.labels).toHaveLength(24); expect(overlay.baseAlpha).toBe(0);
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
  expect(first.images).toHaveLength(23); expect(first.labels).toHaveLength(24); expect(asked).toEqual([placed.instance]);
  expect(first.rects.slice(1)).toEqual([{ x: placed.origin.x - home.origin.x, z: placed.origin.z - home.origin.z, hx: CHUNK_HALF, hz: CHUNK_HALF, color: '#69704f' }]);
  ownLoaded = true;
  const loaded = fullMapOverlay(host, [], tile);
  expect(loaded.images).toHaveLength(24); expect(loaded.images.find(row => row.image === own)).toMatchObject({ x: placed.origin.x - home.origin.x, alpha: 1 });
  expect(loaded.rects.slice(1)).toEqual([]);
});

test('the full map spans the whole drawn 7 by 7, not the placed rectangle (J455, QA 2026-11-19 row 31: staging showed 6 by 6)', () => {
  const assembly = new GridAssembly({ developer: true, devserver: true }), home = assembly.cells[0];
  if (home === undefined) throw new Error('Missing home');
  const host = { assembly, home, cells: new GridCellEvents(), worldFeet: () => home.origin, name: (cell: { slug: string }) => cell.slug, image: () => null };
  const overlay = fullMapOverlay(host, [], () => null), p = assembly.pitch;
  expect(overlay.grid).toEqual({ x0: -3.5 * p - home.origin.x, z0: -3.5 * p - home.origin.z, pitch: p, cells: 7 });
  expect(overlay.rects[0]).toMatchObject({ x: 0 - home.origin.x, z: 0 - home.origin.z, hx: 3.5 * p, hz: 3.5 * p });
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
  expect(road.images.filter(row => row.image === atlasImage)).toHaveLength(assembly.cells.length - 2);
  expect(road.images.every(row => row.alpha < 1)).toBe(true);
});
