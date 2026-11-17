import { expect, test } from 'vitest';
import { floorAtRects } from '@wildshard/engine/physics/box';
import { insidePolygon, yawLocal } from '@wildshard/engine/world/yawFrame';
import { ForestRoofMask } from './forestRoofMask';

test('rain cover keeps the reference roof grid for turned decks and cave polygons', () => {
  const floors = [
    { x: -8, z: 5, y: 3, rot: Math.PI / 3, hw: 4, hd: 2 },
    { x: 2, z: 5, y: 2, rot: 0, hw: 2, hd: 1.5 },
  ];
  const roofs = [{
    frame: { x: 5, z: -5, yaw: -Math.PI / 5 },
    polygon: [[-2, -1], [2, -1], [2, 2], [0, 0], [-2, 2]] as const,
  }];
  const mask = new ForestRoofMask({ floors, roofs });
  const expected = (x: number, z: number): boolean => floorAtRects(floors, x, z, 'first') !== undefined || roofs.some(({ frame, polygon }) => {
    const [lx, lz] = yawLocal(frame, x, z);
    return insidePolygon(polygon, lx, lz);
  });
  const actual = [], reference = [];
  for (let z = -10; z <= 10; z += 0.125) for (let x = -14; x <= 10; x += 0.125) {
    actual.push(mask.contains(x, z));
    reference.push(expected(x, z));
  }
  expect(actual).toEqual(reference);
  expect(mask.contains(4, 6.5)).toBe(true);
  expect(mask.contains(4 + 1e-6, 6.5)).toBe(false);
});
