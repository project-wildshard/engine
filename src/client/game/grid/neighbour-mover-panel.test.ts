import { expect, test } from 'vitest';
import { Mesh, Object3D } from 'three';
import { moverPanelPose } from './neighbourPanels';

// TEMPLATE-E2E TC-E5b: a mover's panel, baked at the mover's rest, follows the wire's pose about the mover's own origin.
test('a lift panel rises with its pose, and a hinge panel turns about the mover origin', () => {
  const lift = new Object3D(); lift.position.set(4, 0.1, 4);
  const pose = moverPanelPose(lift, { at: { x: 4, y: 0, z: 4 }, euler: { x: 0, y: 0, z: 0 } });
  pose({ position: { x: 4, y: 3, z: 4 }, euler: { x: 0, y: 0, z: 0 }, enabled: true });
  expect(lift.position.toArray().map(v => Number(v.toFixed(6)))).toEqual([4, 3.1, 4]);

  const door = new Mesh(); door.position.set(1, 1, 0); // a leaf 1 m east of its hinge at the origin
  const turn = moverPanelPose(door, { at: { x: 0, y: 0, z: 0 }, euler: { x: 0, y: 0, z: 0 } });
  turn({ position: { x: 0, y: 0, z: 0 }, euler: { x: 0, y: Math.PI / 2, z: 0 }, enabled: true });
  expect(door.position.toArray().map(v => Number(v.toFixed(6)))).toEqual([0, 1, -1]);
  turn({ position: { x: 0, y: 0, z: 0 }, euler: { x: 0, y: 0, z: 0 }, enabled: false });
  expect(door.visible).toBe(false);
});
