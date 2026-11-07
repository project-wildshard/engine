// @vitest-environment happy-dom
import { expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { ResidencyAllocator } from '../../../shared/game/grid/allocator';
import { loadGridMapAtlas } from './mapAtlas';
import { GridAssembly } from '../../../shared/game/grid/assembly';
import { fullMapOverlay } from './minimapBlend';
import { GridCellEvents } from '../../../shared/game/grid/cellEvents';

const spec = { url: '/atlas.webp', compressed: 99, width: 512, height: 256, tileSize: 256, slugs: ['a', 'b'] };
test('one charged decode supplies crops until its owner retires', async () => {
  const scope = new Scope('atlas'), allocator = new ResidencyAllocator(); let reads = 0, closed = 0;
  const image = document.createElement('canvas');
  const tile = await loadGridMapAtlas(scope, allocator, spec, async () => { reads++; await Promise.resolve(); return { image, width: 512, height: 256, close: () => { closed++; } }; });
  expect(tile('a').image).toBe(tile('b').image); expect(tile('b').crop).toEqual([256, 0, 256, 256]); expect(reads).toBe(1);
  expect(allocator.entries().find(row => row.id.includes('world-map'))?.bytes).toBe(512 * 256 * 4);
  expect(() => tile('missing')).toThrow('Missing world map tile');
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
