import { expect, test } from 'vitest';
import { Bone, Group, Matrix4 } from 'three';
import { AnimalGroup, type MatrixOwner } from './animalMatrices';

/** A near animal (pose not frozen) with a two-bone chain; `poseVersion` as AnimalView counts its pose updates. */
function animal() {
  const mesh = new Group(), hip = new Bone(), knee = new Bone();
  mesh.add(hip); hip.add(knee); knee.position.set(0, -1, 0);
  const owner: { mesh: Group; poseFrozen: boolean; lastHitT: number; poseVersion: number } = { mesh, poseFrozen: false, lastHitT: 0, poseVersion: 0 };
  return { owner, hip, knee };
}

test('a pose version the group has proved skips without comparing; a new version is compared (G639)', () => {
  const group = new AnimalGroup(), { owner, hip, knee } = animal(), typed: MatrixOwner = owner;
  group.add(owner.mesh); group.own(typed);
  group.updateMatrixWorld(true);
  expect(group.last).toEqual({ skipped: 0, updated: 1 });
  // no pose update since: skipped on its version alone
  group.updateMatrixWorld();
  expect(group.last).toEqual({ skipped: 1, updated: 0 });
  // a pose update that moved nothing: compared, still skipped, and that version is now proved
  owner.poseVersion++;
  group.updateMatrixWorld();
  expect(group.last).toEqual({ skipped: 1, updated: 0 });
  // a pose update that moved a bone: compared, the subtree updated, its world matrix the moved one
  owner.poseVersion++; hip.rotation.z = 0.5;
  group.updateMatrixWorld();
  expect(group.last).toEqual({ skipped: 0, updated: 1 });
  const expected = new Matrix4().makeRotationZ(0.5).multiply(new Matrix4().makeTranslation(0, -1, 0));
  for (const [i, value] of knee.matrixWorld.elements.entries()) expect(value).toBeCloseTo(expected.elements[i] ?? 0, 12);
  // the next frame without a pose update skips again
  group.updateMatrixWorld();
  expect(group.last).toEqual({ skipped: 1, updated: 0 });
});

test('an owner without a version keeps comparing every pass, as before', () => {
  const group = new AnimalGroup(), { owner, hip } = animal();
  const legacy: MatrixOwner = { mesh: owner.mesh, poseFrozen: false, lastHitT: 0 };
  group.add(owner.mesh); group.own(legacy);
  group.updateMatrixWorld(true);
  group.updateMatrixWorld();
  expect(group.last).toEqual({ skipped: 1, updated: 0 });
  hip.rotation.z = 0.25;
  group.updateMatrixWorld();
  expect(group.last).toEqual({ skipped: 0, updated: 1 });
});

test('pose records retain exact native matrices as topology and matrix ownership change', () => {
  const group = new AnimalGroup(), baseline = new Group(), next = animal(), before = animal();
  for (const [id, node] of [next.owner.mesh, next.hip, next.knee].entries()) node.name = `node-${id}`;
  for (const [id, node] of [before.owner.mesh, before.hip, before.knee].entries()) node.name = `node-${id}`;
  group.add(next.owner.mesh); group.own(next.owner); baseline.add(before.owner.mesh);
  const afterExtra = new Bone(), beforeExtra = new Bone();
  afterExtra.name = beforeExtra.name = 'extra';
  for (let tick = 0; tick < 360; tick++) {
    for (const entry of [next, before]) {
      entry.hip.rotation.x = Math.sin(tick / 10);
      entry.knee.position.y = -1 - Math.cos(tick / 7) / 10;
      if (tick === 90) entry.knee.matrixAutoUpdate = false;
      if (tick >= 90 && tick < 120) entry.knee.matrix.makeRotationY(tick / 20).setPosition(0, -1, .2);
      if (tick === 120) entry.knee.matrixAutoUpdate = true;
    }
    if (tick === 60) { next.knee.add(afterExtra); before.knee.add(beforeExtra); }
    if (tick === 150) { next.knee.remove(afterExtra); before.knee.remove(beforeExtra); }
    if (tick === 180) { next.knee.add(afterExtra); before.knee.add(beforeExtra); }
    group.position.x = baseline.position.x = tick % 5;
    next.owner.poseVersion++;
    group.updateMatrixWorld(); baseline.updateMatrixWorld();
    next.owner.mesh.traverse(node => {
      const expected = before.owner.mesh.getObjectByName(node.name);
      if (expected === undefined) throw new Error('Missing native counterpart');
      expect(node.matrixWorld.elements).toEqual(expected.matrixWorld.elements);
    });
  }
  next.owner.poseVersion++;
  group.updateMatrixWorld();
  expect(group.last).toEqual({ skipped: 1, updated: 0 });
});
