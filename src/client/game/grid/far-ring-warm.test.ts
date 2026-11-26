import { expect, test } from 'vitest';
import { farRingWarmVariants } from './farView';

// Meta QA 11-25 row 105: the far ring's stand-ins serve neighbours only. A one-cell world (J522 (4): every measuring tool's)
// linked the pbr, toon and painterly stand-ins and the haze band for cells it doesn't have: Brasscap phone Low counted 49
// programs, four of them those, drawn by nothing.
test('a one-cell world links no far ring stand-ins; any neighbour brings every variant', () => {
  expect(farRingWarmVariants([{ instance: 'brasscap-mesa' }], 'brasscap-mesa')).toEqual([]);
  expect(farRingWarmVariants([], 'brasscap-mesa')).toEqual([]);
  const ring = farRingWarmVariants([{ instance: 'brasscap-mesa' }, { instance: 'pine-hollow' }], 'brasscap-mesa');
  expect(ring).toEqual([['pbr', true], ['pbr', false], ['toon', false], ['painterly', false]]);
});
