import { expect, test } from 'vitest';
import { CONTENT_CAPS } from '@wildshard/engine/core/config';
import { ResidencyAllocator } from '../../../shared/game/grid/allocator';
import { budgetBreakdown, PLATFORM_OWNER } from './budgetPoints';

const MB = 1_000_000;

test('G628 M2: worlds + shared + cells add up to the headline', () => {
  const allocator = new ResidencyAllocator({ playing: 1e12 });
  const claim = (id: string, owner: string, category: 'sim' | 'library' | 'far' | 'near' | 'l0' | 'commons' | 'page', bytes: number) => {
    expect(allocator.reserve({ id, owner, category, bytes, distance: 0, needed: true })).not.toBeNull();
  };
  claim('sim:driftwood', 'driftwood', 'sim', 289 * MB); claim('lib:driftwood', 'driftwood', 'library', 21 * MB);
  claim('sim:sky', 'sky', 'sim', 180 * MB);
  for (let i = 0; i < 24; i++) { claim(`far:c${i}`, `c${i}`, 'far', 1_500_000 + i * 7919); claim(`near:c${i}`, `c${i}`, 'near', 2_100_000 + i * 104_729); }
  claim('l0:road', PLATFORM_OWNER, 'l0', 40 * MB); claim('commons:road', PLATFORM_OWNER, 'commons', 33_333_333);
  claim('page:kept-programs', PLATFORM_OWNER, 'page', 96 * MB); claim('page:composer', PLATFORM_OWNER, 'page', 12_345_678);
  const cost = allocator.cost(), parts = budgetBreakdown(allocator.entries(), cost);
  const sum = [...parts.worlds, ...parts.shared].reduce((total, part) => total + part.bytes, 0) + parts.cells.bytes;
  expect(parts.headline).toBe(cost.playing);
  expect(Math.abs(sum - parts.headline)).toBeLessThan(MB);
  expect(parts.worlds.map(world => world.owner)).toEqual(['driftwood', 'sky']);
  expect(parts.worlds[0]?.bytes).toBeCloseTo(310 * MB * CONTENT_CAPS.residentFactor, 0);
  expect(parts.cells.count).toBe(24);
  expect(parts.shared.map(part => part.label)).toEqual(['engine base', 'kept-programs', 'composer', 'road + commons', 'decode overlap']);
});

test('G628 M2: an empty page is the engine base and the overlap', () => {
  const allocator = new ResidencyAllocator({ playing: 1e12 }), parts = budgetBreakdown(allocator.entries(), allocator.cost());
  expect(parts.worlds).toEqual([]);
  expect(parts.cells).toEqual({ count: 0, bytes: 0 });
  expect(parts.shared.reduce((total, part) => total + part.bytes, 0)).toBe(parts.headline);
});
