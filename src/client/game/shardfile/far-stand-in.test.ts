import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry } from 'three';
import { GROUND_SLACK, withoutGround } from './farStandIn';

// G748: the entered cell's far stand-in keeps the near view's drawn world and leaves its ground to the real terrain.
test('a triangle with no corner above the terrain is ground (a skirt under it too); anything standing on it stays', () => {
  const geometry = new BufferGeometry();
  // corners 0-2: a ground triangle on a 2 m slope; 3-5: a rock face rising 6 m from that ground; 6-8: a flat roof 8 m up;
  // 9-11: a region skirt hanging 4 m under the ground's edge
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from([
    0, 0, 0, 10, 2, 0, 0, 0, 10,
    0, 0, 0, 10, 2, 0, 5, 6, 5,
    0, 8, 0, 10, 8, 0, 0, 8, 10,
    0, 0, 0, 10, 2, 0, 0, -4, 0,
  ]), 3));
  geometry.setIndex([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  const slope = (x: number): number => x * 0.2;
  const kept = withoutGround(geometry, slope);
  expect(Array.from(kept.index?.array ?? [])).toEqual([3, 4, 5, 6, 7, 8]);
  expect(kept.getAttribute('position')).toBe(geometry.getAttribute('position'));
  // a corner just inside the slack is still ground
  geometry.getAttribute('position').setY(1, 2 + GROUND_SLACK - 0.01);
  expect(Array.from(withoutGround(geometry, slope).index?.array ?? [])).toEqual([3, 4, 5, 6, 7, 8]);
});
