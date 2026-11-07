import {expect, test, vi} from 'vitest';
import {BoxGeometry, DataTexture, DirectionalLight, Fog, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, WebGLRenderer, type Object3D} from 'three';
import {Scope} from '../../../shared/engine/app/scope';
import {prepareSceneRoots, registerExteriorLighting} from './precompile';
import {noteEnvironment} from './drawnEnvironment';
import {compileSceneSource} from './compileLights';
import { linkedGl } from '../../../test/engine/linkedGl';

function fixture() {
  const scope = new Scope('root-preparation'), scene = new Scene(), camera = new PerspectiveCamera();
  const geometry = new BoxGeometry(), material = new MeshBasicMaterial(), root = new Group(), excluded = new Group();
  material.name = 'borrowed'; root.name = 'requested'; excluded.name = 'parked';
  const plain = new Mesh(geometry, material), receiver = new Mesh(geometry, material), duplicate = new Mesh(geometry, material);
  receiver.receiveShadow = true; root.add(plain, receiver, duplicate); root.visible = false;
  const light = new DirectionalLight(); scene.add(root, excluded, light); scene.fog = new Fog(0x123456, 1, 10);
  for (let i = 0; i < 10; i++) excluded.add(new Mesh(geometry, material));
  registerExteriorLighting(scene, scope, excluded, null);
  const renderer: unknown = Object.create(WebGLRenderer.prototype);
  if (!(renderer instanceof WebGLRenderer)) throw new Error('Renderer fixture missing');
  const compiled: {material: string; receiver: boolean; fog: unknown; lights: number; environment: unknown}[] = [];
  const compile = (job: Object3D, _camera: PerspectiveCamera, target: Scene): void => {
    expect(compileSceneSource(target)).toBe(scene);
    let lights = 0; target.traverseVisible(object => {if (object instanceof DirectionalLight) lights++;});
    job.traverseVisible(object => {if (object instanceof DirectionalLight) lights++;});
    job.traverse(object => {if (object instanceof Mesh && object.material instanceof MeshBasicMaterial) compiled.push({material: object.material.name,
      receiver: object.receiveShadow, fog: target.fog, lights, environment: target.environment});});
  };
  for (const [key, value] of Object.entries({info: {programs: []}, extensions: {has: () => false},
    properties: {get: () => ({}), has: () => false}, getContext: linkedGl, getRenderTarget: () => null, setRenderTarget: () => undefined,
    compile, initTexture: () => undefined})) Reflect.set(renderer, key, value);
  const dispose = (): void => {scope.dispose(); geometry.dispose(); material.dispose();};
  return {scope, scene, camera, geometry, material, root, excluded, light, renderer, compiled, dispose};
}

test('root preparation skips unused parked-material inventories and retains exact variants and live flags', async () => {
  const f = fixture(), walk = vi.spyOn(f.excluded, 'traverse');
  let clock = 0;
  // This case counts cheap-work barriers; the costly-discovery case below owns budget expiry.
  const time = vi.spyOn(performance, 'now').mockImplementation(() => {clock += .05; return clock;});
  let pauses = 0;
  try {
    await prepareSceneRoots(f.renderer, f.camera, f.scene, null, [f.root], () => true, () => {
      pauses++; expect(f.root.visible).toBe(false); expect(f.root.parent).toBe(f.scene); return Promise.resolve();
    });
    expect(walk).not.toHaveBeenCalled();
    expect(f.compiled).toEqual([false, true, false, true].map(receiver => ({material: 'borrowed', receiver, fog: f.scene.fog, lights: 1, environment: null})));
    expect(pauses).toBe(1); // Only the final native compile barrier; cheap CPU discovery stays in this slice.
    expect(f.material.version).toBe(0);
    expect(f.scene.children).toEqual([f.root, f.excluded, f.light]);
  } finally {time.mockRestore(); walk.mockRestore(); f.dispose();}
});

test('root discovery retains each road environment layout without changing borrowed scene state', async () => {
  const f = fixture(), own = new DataTexture(new Uint8Array(4), 1, 1), peer = new DataTexture(new Uint8Array(8), 1, 2);
  f.scene.environment = own; noteEnvironment(peer);
  try {
    await prepareSceneRoots(f.renderer, f.camera, f.scene, null, [f.root], () => true, () => Promise.resolve());
    expect(f.compiled.map(row => [row.receiver, row.environment])).toEqual([
      [false,own], [true,own], [false,own], [true,own], [false,peer], [true,peer],
    ]);
    expect(f.scene.environment).toBe(own); expect(f.root.visible).toBe(false);
    expect(f.compiled.every(row => row.lights === 1 && row.fog === f.scene.fog)).toBe(true);
  } finally {f.dispose(); own.dispose(); peer.dispose();}
});

test('costly light discovery yields between objects and cancellation stops before compilation', async () => {
  const f = fixture();
  let clock = 100000000, visits = 0, atPause = 0, current = true, pauses = 0;
  const time = vi.spyOn(performance, 'now').mockImplementation(() => clock);
  for (let i = 0; i < 20; i++) {
    const group = new Group();
    Object.defineProperty(group, 'visible', {get: () => {clock += 2; visits++; return true;}});
    f.scene.add(group);
  }
  try {
    await expect(prepareSceneRoots(f.renderer, f.camera, f.scene, null, [f.root], () => current, () => {
      pauses++;
      expect(visits - atPause).toBeLessThanOrEqual(4); atPause = visits;
      if (visits >= 8) current = false;
      return Promise.resolve();
    })).rejects.toThrow('Shader preparation owner left');
    expect(pauses).toBe(2); expect(visits).toBe(8); expect(f.compiled).toEqual([]);
    expect(f.root.visible).toBe(false); expect(f.root.parent).toBe(f.scene);
  } finally {time.mockRestore(); f.dispose();}
});

test('a parked group borrows its installing scene environment while retaining page lighting', async () => {
  const f = fixture(), road = new DataTexture(new Uint8Array(4), 1, 1), regional = new DataTexture(new Uint8Array(8), 1, 2);
  f.scene.environment = road;
  try {
    await prepareSceneRoots(f.renderer, f.camera, f.scene, null, [f.root], () => true, () => Promise.resolve(), undefined, true, f.root, regional);
    expect(f.compiled.slice(0, 2).map(row => row.environment)).toEqual([regional, regional]);
    expect(f.compiled.slice(0, 2).every(row => row.lights === 1 && row.fog === f.scene.fog)).toBe(true);
    expect(f.scene.environment).toBe(road); expect(f.root.visible).toBe(false);
  } finally { f.dispose(); road.dispose(); regional.dispose(); }
});


test('owner-only equipment omits exterior programs while world roots retain them by default', async () => {
  const f = fixture();
  try {
    await prepareSceneRoots(f.renderer, f.camera, f.scene, null, [f.root], () => true, () => Promise.resolve(), undefined, true, f.root, undefined, false);
    expect(f.compiled.map(row => row.receiver)).toEqual([false, true]);
    expect(f.root.visible).toBe(false); expect(f.root.parent).toBe(f.scene);
    expect(f.compiled.every(row => row.fog === f.scene.fog && row.lights === 1)).toBe(true);
  } finally { f.dispose(); }
});

test('world prefix skips unrelated inventories and borrows future lighting', async () => {
  const f = fixture(), container = new Group(), material = new MeshBasicMaterial(), page = new Mesh(f.geometry, material);
  material.name = 'page'; container.add(f.root, page); f.scene.add(container); f.excluded.visible = false;
  const futureLight = new DirectionalLight(); f.root.add(futureLight);
  const parked = vi.spyOn(f.excluded, 'traverse');
  try {
    const roots = [f.root];
    await prepareSceneRoots(f.renderer, f.camera, f.scene, null, roots, () => true, () => Promise.resolve(), undefined, true, f.root, undefined, false);
    expect(f.compiled).toEqual([false, true].map(receiver => ({material: 'borrowed', receiver, fog: f.scene.fog, lights: 2, environment: null})));
    expect(f.root.parent).toBe(container); expect(f.root.visible).toBe(false); expect(page.parent).toBe(container);
    expect(parked).not.toHaveBeenCalled();
  } finally {parked.mockRestore(); material.dispose(); futureLight.dispose(); f.dispose();}
});
