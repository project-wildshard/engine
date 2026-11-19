// QA-FEEDBACK 2026-11-19 row 55 (Jake, 16:16 Cancún, staging v0.1.52): back in the app after a Zone Select left him on the road, SOMETHING
// BROKE with "render: Error: Page coverage requires a measured whole-page claim", again on KEEP PLAYING, every frame from present().
// The page booted Driftwood as its home on a measured whole-page reading; standing on the road, the grid's first region was another
// one, so road-start recovery released the home's boot claim (`releasePending`). Driftwood was later claimed the ordinary way under the
// same `sim:` id, and the next composer allocation (the app coming back resizes it) still named that id as its cover.
import { expect, test } from 'vitest';
import { ResidencyAllocator } from '../../../shared/game/grid/allocator';
import { PageResidency } from './pageResidency';
import { Scope } from '@wildshard/engine/app/scope';

const MB = 1_000_000;

test('a road start that released the measured home leaves the composer uncovered, never a throw', () => {
  const allocator = new ResidencyAllocator(), residency = new PageResidency(allocator), scope = new Scope('test.renderer');
  let allocate: (bytes: number) => void = () => undefined;
  residency.admitHome('driftwood-isle', 200 * MB, true);
  residency.bindComposer({ observeComposerAllocation: listen => { allocate = listen; return () => undefined; } }, scope, 'phone');
  allocate(10 * MB);
  expect(allocator.entries().find(row => row.id === 'page:composer')?.coveredBy, 'the measured home covers the composer').toBe('sim:driftwood-isle');
  // on the road: the first region is another one, so the boot claim goes; Driftwood comes back as an ordinary claim
  residency.home().releasePending();
  const ordinary = allocator.reserve({ id: 'sim:driftwood-isle', category: 'sim', owner: 'driftwood-isle', bytes: 200 * MB, distance: 0, needed: true });
  expect(ordinary).not.toBeNull();
  expect(() => { allocate(12 * MB); }, 'the app comes back and the composer grows').not.toThrow();
  expect(allocator.entries().find(row => row.id === 'page:composer')?.coveredBy, 'charged uncovered').toBeUndefined();
  scope.dispose();
});

test('the allocator charges a page component uncovered when its cover is not a measured whole page', () => {
  const allocator = new ResidencyAllocator();
  allocator.reserve({ id: 'sim:far-reach', category: 'sim', owner: 'far-reach', bytes: 200 * MB, distance: 0, needed: true });
  const lease = allocator.reservePageComponent('page:composer', 10 * MB, 10 * MB, 'sim:far-reach');
  expect(lease).not.toBeNull();
  expect(allocator.entries().find(row => row.id === 'page:composer')?.coveredBy).toBeUndefined();
  expect(() => allocator.reservePageComponent('page:composer', 11 * MB, 10 * MB, 'sim:far-reach')).not.toThrow();
});
