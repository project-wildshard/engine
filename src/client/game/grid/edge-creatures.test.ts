import { expect, test } from 'vitest';
import { drawnPlace, roadPlaceOf } from './edgeCreatures';

// MMO-PLAN MP5.2b: a page on the road draws the road's rows of its home's creatures in the home's own metres; in a cell, a row's x/z.
test('a road place is nonzero and above the node floor; an older room\'s rows say none', () => {
  expect(roadPlaceOf(-312.5, 40)).toEqual({ x: -312.5, z: 40 });
  expect(roadPlaceOf(0, 0), 'zero in a cell').toBeNull();
  expect(roadPlaceOf(-2048, -2048), 'a room older than wire 1.3').toBeNull();
  expect(roadPlaceOf(undefined, undefined), 'a build without the columns').toBeNull();
});

test('on the road a creature is drawn in its home\'s metres; a row with no road place is not drawn there; in a cell x/z stand', () => {
  const sunscar = { x: -562.5, z: 0 };
  expect(drawnPlace({ x: -260, z: 40, roadX: -332.5, roadZ: 40 }, sunscar), '20 m inside Sunscar\'s east edge').toEqual({ x: 230, z: 40 });
  expect(drawnPlace({ x: 12, z: -40, roadX: 0, roadZ: 0 }, sunscar), 'no road place: not the road page\'s').toBeNull();
  expect(drawnPlace({ x: 12, z: -40 }, null), 'in a cell').toEqual({ x: 12, z: -40 });
});
