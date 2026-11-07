import { expect, test } from 'vitest';
import { Box3, Group, Vector3 } from 'three';
import type { Placed } from './place';
import { placedWithin } from './sets';

test('spatial copy views keep distinct bounds/centre policies', () => {
  const boxes = [new Box3(new Vector3(-1, 0, -1), new Vector3(11, 2, 1)), new Box3(new Vector3(-0.2, 0, -0.2), new Vector3(0.2, 2, 0.2)), new Box3(new Vector3(20, 0, 0), new Vector3(21, 2, 1))];
  const source: Placed = { model: 'fixture/poles', object: new Group(), colliders: [{ kind: 'box', x: 0, y: 1, z: 0, hx: 1, hy: 1, hz: 1 }],
    copies: boxes.length, drawnAs: 'instanced', cull: () => undefined, registered: Promise.resolve(), nearest: () => -1,
    copyBox: (i, target) => { const box = boxes[i]; if (box === undefined) throw new Error('Missing fixture copy'); return target.copy(box); } };
  const bounds = placedWithin(source, 0, 0, 1, 'bounds'), centre = placedWithin(source, 0, 0, 1, 'centre');
  expect(bounds?.copies).toBe(2);
  expect(centre?.copies).toBe(1);
  expect(centre?.copyBox(0, new Box3()).equals(boxes[1] ?? new Box3())).toBe(true);
  expect(bounds?.object).toBe(source.object);
  expect(bounds?.colliders).toEqual([]);
  expect(source.colliders).toHaveLength(1);
  expect(bounds?.nearest(new Vector3())).toBe(0);
  expect(placedWithin(source, 0, 0, 10, 'centre')?.nearest(new Vector3())).toBe(1);
  expect(placedWithin(source, 0, 0, 100, 'bounds')).toBe(source);
  expect(placedWithin(source, -100, 0, 1, 'bounds')).toBeNull();
});
