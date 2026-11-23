import { expect, test } from 'vitest';
import * as THREE from 'three';
import { FOLD_EXEMPT, foldScene, installEnvironmentFold, isFoldEnvironment, programFold, PROGRAM_FOLD_DEFAULT } from './programFold';
import { programReuse } from './programReuse';

// DF8 (mini-df8b): a scene with no environment draws and compiles with a black one of the page's cube height, so its lit
// programs are the environment variant (one program for the road and the cell); restored as each call returns
function stubRenderer(): { renderer: THREE.WebGLRenderer; seen: (THREE.Texture | null)[]; clears: number } {
  const seen: (THREE.Texture | null)[] = [];
  const state = { clears: 0, target: null as THREE.WebGLRenderTarget | null };
  const renderer = {
    render: (scene: THREE.Scene) => { seen.push(scene.environment); },
    compile: (_scene: THREE.Object3D, _camera: THREE.Camera, target?: THREE.Scene | null) => { seen.push(target?.environment ?? null); return new Set(); },
    compileAsync: (scene: THREE.Scene) => { seen.push(scene.environment); return Promise.resolve(scene); },
    getRenderTarget: () => state.target, setRenderTarget: (t: THREE.WebGLRenderTarget | null) => { state.target = t; },
    getClearColor: (c: THREE.Color) => c.set(0), getClearAlpha: () => 1, setClearColor: () => undefined, clear: () => { state.clears++; },
  };
  return { renderer: renderer as unknown as THREE.WebGLRenderer, seen, get clears() { return state.clears; } };
}

test('the slot is off unless set', () => {
  expect(PROGRAM_FOLD_DEFAULT).toBe(false);
  expect(programFold(null)).toBe(false);
  expect(programFold(true)).toBe(true);
  expect(programFold('on')).toBe(true);
  expect(programFold(false)).toBe(false);
});

test('DF8 (mini-dwfps2): unset at phone Low, fold and reuse are on; a saved pick still wins', () => {
  expect(programFold(null, true)).toBe(true);
  expect(programFold(false, true)).toBe(false);
  expect(programReuse(null, true)).toBe(true);
  expect(programReuse(null)).toBe(false);
  expect(programReuse('off', true)).toBe(false);
});

test('a scene with no environment draws with a black one of the latest height, and gets none back', async () => {
  const stub = stubRenderer();
  let height: number | null = null;
  const undo = installEnvironmentFold(stub.renderer, () => height);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  stub.renderer.render(scene, camera);
  expect(stub.seen.pop()).toBe(null); // no height recorded yet: unchanged
  height = 256;
  stub.renderer.render(scene, camera);
  const black = stub.seen.pop();
  expect(isFoldEnvironment(black)).toBe(true);
  expect(black?.mapping).toBe(THREE.CubeUVReflectionMapping);
  expect(Reflect.get(black?.image ?? {}, 'height')).toBe(256);
  expect(scene.environment).toBe(null);
  // the compile key reads the target scene's environment; the black atlas is made (cleared) once per height
  stub.renderer.compile(new THREE.Group(), camera, scene);
  expect(stub.seen.pop()).toBe(black);
  await stub.renderer.compileAsync(scene, camera);
  expect(stub.seen.pop()).toBe(black);
  expect(stub.clears).toBe(1);
  // a scene's own environment is left alone
  const own = new THREE.Texture(); scene.environment = own;
  stub.renderer.render(scene, camera);
  expect(stub.seen.pop()).toBe(own);
  undo();
  scene.environment = null;
  stub.renderer.render(scene, camera);
  expect(stub.seen.pop()).toBe(null);
});

// mini-df8c: a creature's card shot draws its own scene with none at boot (before any height) and in play: exempt, both
// draws key the one unfolded program
test('an exempt scene draws with no environment whatever the height', () => {
  const stub = stubRenderer();
  const undo = installEnvironmentFold(stub.renderer, () => 256);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  scene.userData[FOLD_EXEMPT] = true;
  stub.renderer.render(scene, camera);
  expect(stub.seen.pop()).toBe(null);
  stub.renderer.compile(new THREE.Group(), camera, scene);
  expect(stub.seen.pop()).toBe(null);
  const unfold = foldScene(stub.renderer, scene);
  expect(scene.environment).toBe(null);
  unfold();
  undo();
});

test('DF14 (mini-dwfps): unset on desktop, fold and reuse are on; a saved pick still wins; phone Low keeps its own', () => {
  expect(programFold(null, false, true)).toBe(true);
  expect(programFold(false, false, true)).toBe(false);
  expect(programReuse(null, false, true)).toBe(true);
  expect(programReuse('off', false, true)).toBe(false);
  expect(programReuse(null, false, false)).toBe(false);
});
