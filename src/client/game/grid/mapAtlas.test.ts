// @vitest-environment happy-dom
import { expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { ResidencyAllocator } from '../../../shared/game/grid/allocator';
import { loadGridMapAtlas } from './mapAtlas';
import { GridAssembly } from '../../../shared/game/grid/assembly';
import { fullMapOverlay } from './minimapBlend';
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
  expect(overlay.images).toHaveLength(25); expect(overlay.labels).toHaveLength(25); expect(overlay.baseAlpha).toBe(0);
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
  expect(first.images).toHaveLength(24); expect(first.labels).toHaveLength(25); expect(asked).toEqual([placed.instance]);
  expect(first.rects).toEqual([{ x: placed.origin.x - home.origin.x, z: placed.origin.z - home.origin.z, hx: CHUNK_HALF, hz: CHUNK_HALF, color: '#69704f' }]);
  ownLoaded = true;
  const loaded = fullMapOverlay(host, [], tile);
  expect(loaded.images).toHaveLength(25); expect(loaded.images.find(row => row.image === own)).toMatchObject({ x: placed.origin.x - home.origin.x, alpha: 1 });
  expect(loaded.rects).toEqual([]);
});
