import { expect, test } from 'vitest';
import * as THREE from 'three';
import { FrameCamera } from './frameCamera';

// pose() reads the camera's own world matrix: the page camera's children (the viewmodel) are left to the scene's walk
test('a frame camera poses from the camera alone, at its current transform', () => {
  const scene = new THREE.Scene(), frame = new THREE.Group(), camera = new THREE.PerspectiveCamera(60, 0.5, 0.1, 900);
  frame.position.set(100, 0, -40); scene.add(frame, camera); scene.updateMatrixWorld(true);
  let childWalks = 0;
  const child = new THREE.Group(); child.updateMatrixWorld = (): void => { childWalks++; }; camera.add(child);
  camera.position.set(103, 2, -35); camera.rotation.set(0, 0.4, 0);
  const local = new FrameCamera(frame).pose(camera);
  expect(childWalks).toBe(0);
  expect(local.position.x).toBeCloseTo(3); expect(local.position.y).toBeCloseTo(2); expect(local.position.z).toBeCloseTo(5);
  expect(local.aspect).toBe(0.5); expect(local.far).toBe(900);
  const inverse = camera.matrixWorld.clone().invert();
  for (let i = 0; i < 16; i++) expect(camera.matrixWorldInverse.elements[i]).toBeCloseTo(inverse.elements[i] ?? Number.NaN);
});
