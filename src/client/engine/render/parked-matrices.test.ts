import { expect, test } from 'vitest';
import { Group, Object3D } from 'three';
import { freezeParkedMatrices } from './precompile';

// G580 T2: a parked (invisible) destination's subtree is brought up to date once, then skipped while it stays hidden.
test('a frozen parked root updates once, skips while hidden, updates when shown and refreshes on thaw', () => {
  const scene = new Group(), root = new Group(), child = new Object3D();
  root.visible = false; root.add(child); scene.add(root);
  child.position.set(1, 2, 3);
  const thaw = freezeParkedMatrices(root);
  expect(child.matrixWorld.elements[12]).toBe(1);
  child.position.x = 5; scene.updateMatrixWorld();
  expect(child.matrixWorld.elements[12]).toBe(1); // hidden: skipped
  root.visible = true; scene.updateMatrixWorld();
  expect(child.matrixWorld.elements[12]).toBe(5); // a warm-up draw that shows it updates it
  root.visible = false; child.position.x = 7;
  thaw();
  expect(child.matrixWorld.elements[12]).toBe(7);
  expect(Object.hasOwn(root, 'updateMatrixWorld')).toBe(false);
  child.position.x = 9; scene.updateMatrixWorld();
  expect(child.matrixWorld.elements[12]).toBe(9); // thawed: three's own update again
});

test('a warm-up that only needs pipelines skips its shown draws too, and the thaw still refreshes', () => {
  const scene = new Group(), root = new Group(), child = new Object3D();
  root.visible = false; root.add(child); scene.add(root); child.position.set(1, 0, 0);
  const thaw = freezeParkedMatrices(root, { shown: 'skip' });
  child.position.x = 4; root.visible = true; scene.updateMatrixWorld();
  expect(child.matrixWorld.elements[12]).toBe(1);
  thaw(); expect(child.matrixWorld.elements[12]).toBe(4);
});
