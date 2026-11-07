import { expect, test } from 'vitest';
import { Group, PerspectiveCamera, Vector3 } from 'three';
import { StreamingCamera, streamingDistance, streamingOrder, streamingVisible, type StreamingPoint } from './streamingView';

test('a high camera prioritizes its visible tile over a nearer point behind it', () => {
  const root = new Group(), camera = new PerspectiveCamera(50, 0.5, 0.1, 500);
  camera.position.set(0, 160, 0); camera.lookAt(90, 40, -25);
  const view = new StreamingCamera(root, () => camera).read();
  const front: StreamingPoint = { x: 95, y: 50, z: -30, bounds: { min: [62.5, 0, -62.5], max: [125, 100, 0] } };
  const behind = { x: -10, y: 160, z: 0 };
  expect(streamingDistance(behind, view)).toBeLessThan(streamingDistance(front, view));
  expect(streamingVisible(front, view)).toBe(true);
  expect(streamingVisible(behind, view)).toBe(false);
  expect(streamingOrder(front, behind, view)).toBeLessThan(0);
});

test('distance includes height and wide declared bounds can meet the view without their centre', () => {
  const root = new Group(), camera = new PerspectiveCamera(60, 1, 0.1, 500);
  camera.position.set(0, 120, 0); camera.lookAt(0, 120, -100);
  const view = new StreamingCamera(root, () => camera).read();
  expect(streamingDistance({ x: 0, y: 110, z: -20 }, view)).toBeLessThan(streamingDistance({ x: 0, y: 0, z: -20 }, view));
  const wide: StreamingPoint = { x: 0, y: 120, z: 5, bounds: { min: [-10, 110, -30], max: [10, 130, 40] } };
  expect(streamingVisible({ x: wide.x, y: 120, z: wide.z }, view)).toBe(false);
  expect(streamingVisible(wide, view)).toBe(true);
  const read = new StreamingCamera(root, () => camera), side = { x: 90, y: 120, z: -100 };
  expect(streamingVisible(side, read.read())).toBe(false);
  camera.fov = 120; camera.updateProjectionMatrix();
  expect(streamingVisible(side, read.read())).toBe(true);
});

test('the page eye and frustum are read in the actual translated and rotated cell frame', () => {
  const root = new Group(), camera = new PerspectiveCamera(60, 1, 0.1, 500);
  root.position.set(500, 20, -500); root.rotation.y = Math.PI / 2; root.updateMatrixWorld(true);
  const eye = root.localToWorld(new Vector3(0, 130, 100)), target = root.localToWorld(new Vector3(0, 0, 0));
  camera.position.copy(eye); camera.lookAt(target);
  const read = new StreamingCamera(root, () => camera), view = read.read();
  expect(view.eye.x).toBeCloseTo(0); expect(view.eye.y).toBeCloseTo(130); expect(view.eye.z).toBeCloseTo(100);
  expect(streamingVisible({ x: 0, y: 0, z: 0 }, view)).toBe(true);
  expect(streamingVisible({ x: 0, y: 130, z: 200 }, view)).toBe(false);
  camera.position.y += 10;
  expect(read.read().eye.y).toBeCloseTo(140);
});
