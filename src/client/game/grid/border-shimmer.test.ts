import { expect, test } from 'vitest';
import { nearShimmerSides } from './borderShimmer';

// NINE-DRAGON-BENCHMAX NB8 (mini-nb8h): the shimmer draws only the sides some of whose ribbon is within reach of the eye
// across the ground (its fragment shader discards everything past the fade's end).
test('a side is near when any point of it, not only an end, is within reach across the ground', () => {
  // side 0 runs along x from -100 to 100 at z 0; side 1 is a short one 300 m north; side 2 runs along z at x 200
  const ends = Float32Array.from([-100, 0, 100, 0, -5, 300, 5, 300, 200, -100, 200, 100]);
  expect(nearShimmerSides(ends, 3, 0, 140, 150)).toEqual([0]);
  expect(nearShimmerSides(ends, 3, 0, 160, 150)).toEqual([1]);
  expect(nearShimmerSides(ends, 3, 0, 150, 150)).toEqual([0, 1]);
  // the eye 149 m from the middle of side 0, both its ends further than reach
  expect(nearShimmerSides(ends, 3, 0, -149, 150)).toEqual([0]);
  expect(nearShimmerSides(ends, 3, 0, -151, 150)).toEqual([]);
  // past the end of side 2 along its own line
  expect(nearShimmerSides(ends, 3, 200, 240, 150)).toEqual([2]);
  expect(nearShimmerSides(ends, 3, 200, 251, 150)).toEqual([]);
});
