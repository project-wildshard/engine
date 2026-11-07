import { expect, test } from 'vitest';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { modelPoseMatrix, type ModelPose } from './modelPose';

function original(pose: ModelPose): Matrix4 {
  return new Matrix4().compose(new Vector3(pose.x, pose.y, pose.z),
    new Quaternion().setFromEuler(new Euler(pose.pitch ?? 0, pose.yaw, pose.roll ?? 0, 'YXZ')),
    new Vector3(pose.scale, pose.scale, pose.scale));
}

test('private pose scratch preserves exact native words and returns independent matrices', () => {
  const poses: ModelPose[] = [
    { x: -0, y: 0, z: -0, yaw: 0, scale: 1 },
    { x: 17.25, y: -3, z: 127, yaw: 1.234, pitch: -.37, roll: .19, scale: .001 },
    { x: -112, y: 1.25, z: .125, yaw: -2.7, pitch: .8, roll: -1.1, scale: -1.25 },
  ];
  const made = poses.map(modelPoseMatrix), saved = made.map(matrix => matrix.elements.slice());
  for (const [index, pose] of poses.entries()) expect(made[index]?.elements).toEqual(original(pose).elements);
  modelPoseMatrix({ x: 99, y: 88, z: 77, yaw: 6, scale: 4 });
  for (const [index, matrix] of made.entries()) expect(matrix.elements).toEqual(saved[index]);
  expect(new Set(made).size).toBe(poses.length);
});

test('reentrant numeric accessors cannot corrupt an outer pose', () => {
  const inner: ModelPose = { x: 100, y: 200, z: 300, yaw: .5, scale: 10 };
  let scales = 0;
  const outer: ModelPose = {
    get x() { expect(modelPoseMatrix(inner).elements).toEqual(original(inner).elements); return 1; },
    y: 2, z: 3, yaw: .75,
    get scale() { modelPoseMatrix(inner); return ++scales; },
  };
  const actual = modelPoseMatrix(outer), expected = new Matrix4().compose(new Vector3(1, 2, 3),
    new Quaternion().setFromEuler(new Euler(0, .75, 0, 'YXZ')), new Vector3(1, 2, 3));
  expect(actual.elements).toEqual(expected.elements); expect(scales).toBe(3);
});
