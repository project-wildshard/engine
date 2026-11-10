import {expect, test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Execute the real private selection function against native scene objects.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Erase only types from the repository function.
import {stripTypeScriptTypes} from 'node:module';
// oxlint-disable-next-line import/no-nodejs-modules -- Inject Three primitives, never a copied visibility implementation.
import {runInNewContext} from 'node:vm';
import * as THREE from 'three';

test('a parked first-view census matches entry without changing visibility or including hidden siblings', () => {
  const source = readFileSync(new URL('precompile.ts', import.meta.url), 'utf8');
  const start = source.indexOf('function drawnFrom('), end = source.indexOf('\n/**', start);
  if (start === -1 || end < start) throw new Error('First-view selector missing');
  const factory: unknown = runInNewContext(stripTypeScriptTypes(`(${source.slice(start, end)})`), {THREE});
  if (typeof factory !== 'function') throw new Error('First-view selector is not callable');
  const select = (camera: THREE.Camera, root?: THREE.Object3D): ((object: THREE.Object3D) => boolean) => {
    const predicate: unknown = Reflect.apply(factory, undefined, [camera, root]);
    if (typeof predicate !== 'function') throw new Error('Missing first-view predicate');
    return object => Reflect.apply(predicate, undefined, [object]) === true;
  };
  const scene = new THREE.Scene(), root = new THREE.Group(), sibling = new THREE.Group(), hidden = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100), geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial();
  geometry.computeBoundingSphere();
  const make = (parent: THREE.Object3D, x = 0, z = -5): THREE.Mesh => {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, 0, z); parent.add(mesh); return mesh;
  };
  const front = make(root), outside = make(root, 100), behind = make(root, 0, 5), nested = make(hidden), other = make(sibling), layer = make(root);
  layer.layers.set(3); hidden.visible = false; sibling.visible = false; root.visible = false;
  const empty = new THREE.InstancedMesh(geometry, material, 1); empty.count = 0; root.add(empty);
  root.add(hidden); scene.add(root, sibling); scene.updateMatrixWorld(true);
  const objects = [front, outside, behind, nested, other, layer, empty];
  const flags = objects.map(object => [object.visible, object.parent, object.layers.mask]);
  const initial = select(camera, root), ordinary = select(camera);
  try {
    expect(objects.map(ordinary)).toEqual([false, false, false, false, false, false, false]);
    const intended = objects.map(initial);
    expect(intended).toEqual([true, false, false, false, false, false, false]);
    expect(root.visible).toBe(false); expect(sibling.visible).toBe(false); expect(hidden.visible).toBe(false);
    expect(objects.map(object => [object.visible, object.parent, object.layers.mask])).toEqual(flags);
    expect(front.geometry).toBe(geometry); expect(front.material).toBe(material); expect(empty.count).toBe(0);
    // Once admitted, the ordinary predicate must pick the exact same inventory.
    root.visible = true;
    expect(objects.map(select(camera))).toEqual(intended);
    root.visible = false;
    scene.visible = false;
    expect(initial(front)).toBe(false); // An unrelated hidden ancestor is never ignored.
  } finally {empty.dispose(); geometry.dispose(); material.dispose();}
});

test('D12: what the camera carries is in the first view however its own parts are hidden', () => {
  const source = readFileSync(new URL('precompile.ts', import.meta.url), 'utf8');
  const start = source.indexOf('function drawnFrom('), end = source.indexOf('\n/**', start);
  const factory: unknown = runInNewContext(stripTypeScriptTypes(`(${source.slice(start, end)})`), {THREE});
  if (typeof factory !== 'function') throw new Error('First-view selector is not callable');
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100), geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial();
  const gloves = new THREE.Group(), glove = new THREE.Mesh(geometry, material), sword = new THREE.Mesh(geometry, material), behind = new THREE.Mesh(geometry, material);
  gloves.visible = false; gloves.add(glove); sword.visible = false; behind.position.set(0, 0, 5);
  camera.add(gloves, sword, behind); scene.add(camera); scene.updateMatrixWorld(true);
  const select = (): ((object: THREE.Object3D) => boolean) => {
    const predicate: unknown = Reflect.apply(factory, undefined, [camera]);
    if (typeof predicate !== 'function') throw new Error('Missing first-view predicate');
    return object => Reflect.apply(predicate, undefined, [object]) === true;
  };
  try {
    expect([glove, sword, behind].map(select())).toEqual([true, true, true]);
    expect(gloves.visible).toBe(false); expect(sword.visible).toBe(false);
    glove.layers.set(3);
    expect(select()(glove)).toBe(false); // the camera's layers still decide
    camera.visible = false;
    expect(select()(sword)).toBe(false); // a hidden camera (or anything above it) is never ignored
  } finally {geometry.dispose(); material.dispose();}
});

test('the overlapping census constructs only scene jobs; final preparation still constructs every other phase', async () => {
  const source = readFileSync(new URL('precompile.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export async function precompileLevel(');
  if (start === -1) throw new Error('Level preparation missing');
  const scene = new THREE.Scene(), root = new THREE.Group(), owner = {onDispose: (): void => undefined};
  const built: string[] = [], submitted: string[][] = [];
  let standIns = 0;
  const job = (name: string): {root: THREE.Group; target: THREE.Scene} => {built.push(name); return {root: new THREE.Group(), target: scene};};
  const make = (name: string) => (): {root: THREE.Group; target: THREE.Scene}[] => [job(name)];
  const discover = (): {jobs: {root: THREE.Group; target: THREE.Scene}[]; materials: number} => ({jobs: [job('scene')], materials: 1});
  const selectorStart = source.indexOf('function drawnFrom('), selectorEnd = source.indexOf('\n/**', selectorStart);
  if (selectorStart === -1 || selectorEnd < selectorStart) throw new Error('First-view selector missing');
  const method: unknown = runInNewContext(stripTypeScriptTypes(`${source.slice(selectorStart, selectorEnd)}\n${source.slice(start).replace('export async', 'async')}\nprecompileLevel`), {
    THREE, performance, pageScope: owner, resourceScope: () => owner, bootTraceActive: () => false,
    // DL10: the early scene-only pass runs before buildComposer() and draws to a stand-in target
    earlyTarget: () => { standIns += 1; return null; },
    prepareSceneResources: (): Promise<void> => Promise.resolve(), shadowDepthResolver: () => undefined,
    entryFrameExclusions: () => new Set(), workSlice: () => ({due: () => false, yield: (): Promise<void> => Promise.resolve()}),
    materialsOf: () => [], pacedSceneJobs: (): Promise<ReturnType<typeof discover>> => Promise.resolve(discover()), sceneJobs: discover,
    familyCompileJobs: make('family'), offscreenJobs: make('offscreen'), shadowJobs: make('shadow'),
    backgroundJob: () => job('background'), postJobs: make('post'), exteriorJobs: make('exterior'),
    exclusiveMaterials: () => new Set(), includeFutureLights: (): void => undefined,
    readbackPreparation: () => ({...job('readback'), kind: 'readback'}), collectTextures: () => [],
    runPrecompile: (_renderer: unknown, _camera: unknown, jobs: {kind?: string}[]): Promise<{materials: number}> => {
      submitted.push(jobs.map(item => item.kind ?? 'unclassified')); return Promise.resolve({materials: 1});
    },
  });
  if (typeof method !== 'function') throw new Error('Level preparation is not callable');
  const game = {scene, rootScene: scene, camera: new THREE.PerspectiveCamera(), composer: {inputBuffer: null}, composerBuilt: false,
    renderer: {shadowMap: {type: THREE.PCFShadowMap}}, level: {boot: {shaders: {}}}};
  const common = {owner, chunkCasters: false, futureLighting: root};
  await Reflect.apply(method, undefined, [game, undefined, {...common, sceneOnly: true, drawnOnly: true}]);
  expect(built).toEqual(['scene']); expect(submitted).toEqual([['scene-other']]); expect(standIns).toBe(1);
  built.length = 0; game.composerBuilt = true;
  await Reflect.apply(method, undefined, [game, undefined, common]);
  expect(standIns).toBe(1); // the final preparation draws to the composer's input buffer
  expect(built).toEqual(['scene', 'family', 'offscreen', 'shadow', 'background', 'post', 'shadow', 'exterior', 'readback']);
  expect(submitted[1]).toEqual(['scene-other', 'family', 'offscreen', 'shadow', 'background', 'post', 'previous-shadow', 'exterior', 'readback']);
});

test('PL6: what the first frame\'s warm turns show is in the boot\'s first view', () => {
  const source = readFileSync(new URL('precompile.ts', import.meta.url), 'utf8');
  const start = source.indexOf('function drawnFrom('), end = source.indexOf('\n/**', start);
  const factory: unknown = runInNewContext(stripTypeScriptTypes(`(${source.slice(start, end)})`), {THREE});
  if (typeof factory !== 'function') throw new Error('First-view selector is not callable');
  const scene = new THREE.Scene(), rig = new THREE.Group(), camera = new THREE.PerspectiveCamera(60, 0.5, 0.1, 100);
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial();
  const at = (x: number, y: number, z: number): THREE.Mesh => { const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); scene.add(mesh); return mesh; };
  rig.position.set(10, 0, 0); rig.add(camera); scene.add(rig);
  const ahead = at(10, 0, -5), behind = at(10, 0, 5), beside = at(15, 0, 0), overhead = at(10, 60, 0), past = at(10, 0, 150);
  scene.updateMatrixWorld(true);
  const select = (turns?: number[]): ((object: THREE.Object3D) => boolean) => {
    const predicate: unknown = Reflect.apply(factory, undefined, turns === undefined ? [camera] : [camera, undefined, turns]);
    if (typeof predicate !== 'function') throw new Error('Missing first-view predicate');
    return object => Reflect.apply(predicate, undefined, [object]) === true;
  };
  const objects = [ahead, behind, beside, overhead, past];
  try {
    expect(objects.map(select())).toEqual([true, false, false, false, false]);
    // Game.warmTurn's quarter-turns: a square 100° level view each way, from the parented camera's eye, to its far plane
    expect(objects.map(select([Math.PI / 2, Math.PI, 3 * Math.PI / 2]))).toEqual([true, true, true, false, false]);
    expect(camera.quaternion.equals(new THREE.Quaternion())).toBe(true); expect(camera.fov).toBe(60);
  } finally {geometry.dispose(); material.dispose();}
});

test('DL23: a boot census reaches scene discovery as its include, in place of the view and turns', async () => {
  const source = readFileSync(new URL('precompile.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export async function precompileLevel(');
  const selectorStart = source.indexOf('function drawnFrom('), selectorEnd = source.indexOf('\n/**', selectorStart);
  if (start === -1 || selectorStart === -1 || selectorEnd < selectorStart) throw new Error('Level preparation missing');
  const scene = new THREE.Scene(), owner = {onDispose: (): void => undefined}, includes: unknown[] = [];
  const none = (): never[] => [];
  const method: unknown = runInNewContext(stripTypeScriptTypes(`${source.slice(selectorStart, selectorEnd)}\n${source.slice(start).replace('export async', 'async')}\nprecompileLevel`), {
    THREE, performance, pageScope: owner, resourceScope: () => owner, bootTraceActive: () => false, earlyTarget: () => null,
    prepareSceneResources: (): Promise<void> => Promise.resolve(), shadowDepthResolver: () => undefined,
    entryFrameExclusions: () => new Set(), workSlice: () => ({due: () => false, yield: (): Promise<void> => Promise.resolve()}),
    materialsOf: () => [], sceneJobs: () => ({jobs: [], materials: 0}),
    pacedSceneJobs: (...args: unknown[]): Promise<{jobs: never[]; materials: number}> => { includes.push(args[7]); return Promise.resolve({jobs: [], materials: 0}); },
    familyCompileJobs: none, offscreenJobs: none, shadowJobs: none, backgroundJob: () => null, postJobs: none, exteriorJobs: none,
    exclusiveMaterials: () => new Set(), includeFutureLights: (): void => undefined, readbackPreparation: () => ({root: new THREE.Group(), target: scene}),
    collectTextures: () => [], runPrecompile: (): Promise<{materials: number}> => Promise.resolve({materials: 0}),
  });
  if (typeof method !== 'function') throw new Error('Level preparation is not callable');
  const game = {scene, rootScene: scene, camera: new THREE.PerspectiveCamera(), composer: {inputBuffer: null}, composerBuilt: true,
    renderer: {shadowMap: {type: THREE.PCFShadowMap}}, level: {boot: {shaders: {}}}};
  const census = (): boolean => true, arrival = (): boolean => false;
  await Reflect.apply(method, undefined, [game, undefined, {owner, chunkCasters: false, drawnOnly: true, firstFrame: census, turns: [Math.PI]}]);
  await Reflect.apply(method, undefined, [game, undefined, {owner, chunkCasters: false, drawnOnly: true, turns: [Math.PI]}]);
  await Reflect.apply(method, undefined, [game, undefined, {owner, chunkCasters: false, firstFrame: census, arrival}]);
  expect(includes[0]).toBe(census); // the census, not drawnFrom's view
  expect(typeof includes[1]).toBe('function'); expect(includes[1]).not.toBe(census); // drawnFrom, as before
  expect(includes[2]).toBe(arrival); // an arrival's set still wins
});
