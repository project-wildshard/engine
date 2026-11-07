import { expect, test } from 'vitest';
import * as THREE from 'three';
import { installCompileShadowSkip } from './compileShadows';

// three's compile() asks for a whole shadow pass first; once every shadow light has its map that pass is skipped inside
// compile only: frames, and a compile whose lights still lack a map, keep the pass
test('compile skips its shadow pass only while every shadow light has a map', () => {
  const light = new THREE.DirectionalLight(), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  light.castShadow = true;
  let passes = 0;
  const shadowMap = { render: (_lights: THREE.Light[], _scene: THREE.Object3D, _camera: THREE.Camera): void => { passes++; } };
  const renderer = {
    shadowMap,
    compile: (s: THREE.Object3D, c: THREE.Camera, target?: THREE.Scene | null): Set<THREE.Material> => { renderer.shadowMap.render([light], target ?? s, c); return new Set(); },
  };
  installCompileShadowSkip(renderer);
  renderer.compile(scene, camera);
  expect(passes).toBe(1); // no map yet: the pass makes it
  const map = new THREE.WebGLRenderTarget(4, 4);
  light.shadow.map = map;
  renderer.compile(scene, camera);
  expect(passes).toBe(1);
  renderer.shadowMap.render([light], scene, camera);
  expect(passes).toBe(2); // a frame's own pass is never skipped
  map.dispose(); light.dispose();
});
