import { expect, test, vi } from 'vitest';
import { CompressedTexture, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, BufferGeometry, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Scope } from '../src/shared/engine/app/scope';
import { App } from '../src/client/engine/app/app';
import { AssetService } from '../src/client/engine/app/assets';
import { createLevelInstallation } from '../src/client/engine/level/installation';
import { app } from '../src/client/engine/app/runtime';
import * as rig from '../src/client/engine/anim/rig';
import { SkyRig } from '../src/client/engine/world/skyRig';
import { parseWorldScenes } from '@wildshard/format/worldScenes';
import { worldSceneSourceMaterial } from '../src/client/game/shardfile/worldSceneMaterials';
import { UploadOwnership } from '../src/client/engine/render/uploadOwnership';
import { patchShader } from '../src/client/engine/render/shaderPatches';
import type { Renderer } from '../src/client/engine/render/renderer';
import { linkStandIn, ownSceneResource, ownSceneTree, sceneResourceOwner } from '../src/client/engine/app/sceneOwnership';
import { assertCompressedMipmapsUnchanged, compressedTextureKey, finalizeCompressedMipmaps, registerCompressedMipmaps } from '../src/client/engine/render/compressedMipmaps';
import { uploadCompressedTexture } from '../src/client/engine/render/compressedUpload';
import { pageScope } from '../src/shared/engine/app/resources';
/** A product whose file names are their own URLs: these rows' sources and aliases are /-rooted public URLs (d9cf71547f). */
const identityFolder = { url: (name: string): string => name };

function retiredTexture(): CompressedTexture {
  const texture = new CompressedTexture([{ data: new Uint8Array(16), width: 4, height: 4 }], 4, 4);
  registerCompressedMipmaps(texture);
  finalizeCompressedMipmaps(texture);
  return texture;
}

test('a retired texture reuses its live version even when a provisional sampler key differs', async () => {
  const renderer: unknown = Object.create(WebGLRenderer.prototype);
  if (!(renderer instanceof WebGLRenderer)) throw new Error('Missing renderer fixture');
  const texture = new CompressedTexture([{ data: new Uint8Array(16), width: 4, height: 4 }], 4, 4);
  registerCompressedMipmaps(texture); texture.needsUpdate = true;
  const sibling = texture.clone();
  registerCompressedMipmaps(sibling); finalizeCompressedMipmaps(sibling);
  const records = new WeakMap<object, Record<string, unknown>>();
  const get = (object: object): Record<string, unknown> => {
    let record = records.get(object);
    if (record === undefined) { record = {}; records.set(object, record); }
    return record;
  };
  const initialize = vi.fn(() => {
    const native = get(texture);
    // Three's real setTexture2D gates sampler/storage updates on texture.version.
    if (native['__version'] === texture.version) return;
    native['__webglTexture'] = {}; native['__version'] = texture.version;
    native['__cacheKey'] = compressedTextureKey(texture);
    get(texture.source)['__version'] = texture.source.version;
  });
  const fields: Record<string, unknown> = { properties: { get }, initTexture: initialize,
    getContext: () => ({ isContextLost: () => false, NO_ERROR: 0, getError: () => 0 }),
    renderBufferDirect: () => { renderer.properties.get(texture); } };
  for (const [key, value] of Object.entries(fields)) Reflect.set(renderer, key, value);
  const raf = vi.spyOn(pageScope, 'raf').mockImplementation(fn => { queueMicrotask(() => { fn(0); }); return 0; });
  const timeout = vi.spyOn(pageScope, 'timeout').mockImplementation((_ms, fn) => { queueMicrotask(fn); return 0; });
  try {
    await uploadCompressedTexture(renderer, texture, () => true, false);
    const provisional = texture.version, sourceVersion = texture.source.version;
    texture.anisotropy = 4;
    await uploadCompressedTexture(renderer, texture);
    expect(texture.version).toBe(provisional);
    expect(texture.source.version).toBe(sourceVersion);
    expect(() => { assertCompressedMipmapsUnchanged(sibling); }).not.toThrow();
    expect(get(texture)['__cacheKey']).not.toBe(compressedTextureKey(texture));
    renderer.renderBufferDirect(new PerspectiveCamera(), new Scene(), new BufferGeometry(), new MeshBasicMaterial(), new Mesh(), { start: 0, count: 0, materialIndex: 0 });
    expect(texture.mipmaps).toHaveLength(0);
    await expect(uploadCompressedTexture(renderer, texture)).resolves.toBeUndefined();
    expect(initialize).toHaveBeenCalledTimes(2);
    records.delete(texture); // Three removes these properties when the allocation retires.
    await expect(uploadCompressedTexture(renderer, texture)).rejects.toThrow('lost its allocation after mip retirement');
  } finally { raf.mockRestore(); timeout.mockRestore(); texture.dispose(); sibling.dispose(); }
});

test('a second scene keeps a retired compressed texture alive after the first scene leaves', () => {
  const first = new Scope('first cell'), second = new Scope('second cell'), texture = retiredTexture();
  const dispose = vi.spyOn(texture, 'dispose');
  ownSceneResource(texture, first);
  ownSceneResource(texture, second);
  ownSceneResource(texture, second);
  first.dispose();
  expect(texture.mipmaps).toHaveLength(0);
  expect(dispose).not.toHaveBeenCalled();
  expect(sceneResourceOwner(texture)).toBe(second);
  second.dispose();
  expect(dispose).toHaveBeenCalledTimes(1);
});

test('shared scene resources retire once in either order, including a common parent teardown', () => {
  for (const order of ['first', 'second', 'parent']) {
    const page = new Scope('page'), first = page.child('first'), second = page.child('second');
    const texture = retiredTexture(), dispose = vi.spyOn(texture, 'dispose');
    ownSceneResource(texture, first); ownSceneResource(texture, second);
    if (order === 'parent') page.dispose();
    else {
      (order === 'first' ? first : second).dispose();
      expect(dispose).not.toHaveBeenCalled();
      (order === 'first' ? second : first).dispose();
      page.dispose();
    }
    expect(dispose).toHaveBeenCalledTimes(1);
  }
});

test('a delegated tree final capture does not reacquire its already released texture', () => {
  const owner = new Scope('tree'), root = new Group(), texture = retiredTexture();
  ownSceneTree(root, owner, { isAcquired: () => false });
  root.add(new Mesh(new BufferGeometry(), new MeshBasicMaterial({ map: texture })));
  const dispose = vi.spyOn(texture, 'dispose');
  ownSceneResource(texture, owner);
  owner.dispose();
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(root.children).toHaveLength(0);
});

test('level root cleanup respects a texture still owned by another scene', () => {
  const level = new Scope('entered level'), resident = new Scope('resident scene'), texture = retiredTexture();
  const installation = createLevelInstallation(new App(), level, {}, () => ({ set: () => undefined, detail: () => undefined }));
  const mesh = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ map: texture }));
  installation.context.root.add(mesh);
  ownSceneResource(texture, resident);
  const dispose = vi.spyOn(texture, 'dispose');
  level.dispose();
  expect(dispose).not.toHaveBeenCalled();
  expect(mesh.parent).toBe(installation.context.root);
  resident.dispose();
  expect(dispose).toHaveBeenCalledTimes(1);
});

test('a source scene releases a cached texture through its authoritative asset references', () => {
  const source = new Scope('source material'), assets = new AssetService(), texture = retiredTexture();
  assets.register('shared map', texture, { retain: true, cache: true });
  assets.acquire('shared map');
  ownSceneResource(texture, source, assets);
  const dispose = vi.spyOn(texture, 'dispose');
  expect(assets.retained()[0]?.refs).toBe(2);
  source.dispose();
  expect(assets.retained()[0]?.refs).toBe(1);
  expect(assets.evictCached('shared map')).toBe(false);
  expect(dispose).not.toHaveBeenCalled();
  assets.release('shared map');
  expect(assets.evictCached('shared map')).toBe(true);
  expect(dispose).toHaveBeenCalledTimes(1);
});

test('PBR source retirement cannot free the cached atlas another cell still uses', async () => {
  const owner = new Scope('PBR source'), texture = retiredTexture(), key = 'tx1:cached-atlas';
  const material = new MeshStandardMaterial({ map: texture, normalMap: texture, roughnessMap: texture });
  const file = await new GLTFLoader().parseAsync(JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }], nodes: [] }), '');
  file.scene.add(new Mesh(new BufferGeometry(), material));
  const load = vi.spyOn(rig, 'loadRigFile').mockResolvedValue(file), dispose = vi.spyOn(texture, 'dispose');
  const sky: unknown = Object.create(SkyRig.prototype);
  if (!(sky instanceof SkyRig)) throw new Error('Missing sky fixture');
  Object.defineProperty(sky, 'setupMaterial', { value: () => undefined });
  const row = parseWorldScenes({ version: 1, libraries: [], materials: [{ id: 'atlas', kind: 'source', url: '/tx1.glb', anisotropy: 1 }], steps: [] }).materials[0];
  if (row?.kind !== 'source') throw new Error('Missing source fixture');
  app.assets.register(key, texture, { retain: true, cache: true });
  app.assets.acquire(key);
  try {
    expect(await worldSceneSourceMaterial(row, sky, identityFolder, owner)).toBe(material);
    expect(await worldSceneSourceMaterial(row, sky, identityFolder, owner)).toBe(material);
    expect(load).toHaveBeenCalledTimes(1);
    expect(app.assets.retained().find(entry => entry.key === key)?.refs).toBe(2);
    owner.dispose();
    expect(dispose).not.toHaveBeenCalled();
    expect(app.assets.evictCached(key)).toBe(false);
    app.assets.release(key);
    expect(app.assets.evictCached(key)).toBe(true);
    expect(dispose).toHaveBeenCalledTimes(1);
  } finally {
    owner.dispose(); load.mockRestore();
    if (app.assets.has(key)) { app.assets.release(key); app.assets.evictCached(key); }
  }
});

test.each([[false, false], [true, false], [false, true], [true, true]] as const)('a page sampler outside cell roots retains its texture (cached=%s, compiled=%s)', (cached, compiled) => {
  const page = new Scope('page'), source = new Scope('source cell'), assets = new AssetService(), texture = retiredTexture();
  if (cached) assets.register('atlas', texture, { retain: true, cache: true });
  ownSceneResource(texture, source, assets);
  const properties = { has: () => false, get: (object: unknown) => object,
    remove: () => undefined, update: () => undefined, dispose: () => undefined };
  const renderer = { properties, renderBufferDirect: vi.fn<Renderer['renderBufferDirect']>(() => { properties.get(texture); }),
    compile: vi.fn<Renderer['compile']>(() => new Set()) };
  new UploadOwnership(page, assets).attach(renderer);
  const material = new MeshBasicMaterial({ map: texture }), geometry = new BufferGeometry(), object = new Mesh(geometry, material);
  const draw = (): void => { renderer.renderBufferDirect(new PerspectiveCamera(), new Scene(), geometry, material, object, { start: 0, count: 0, materialIndex: 0 }); };
  const dispose = vi.spyOn(texture, 'dispose');
  if (compiled) renderer.compile(new Scene().add(object), new PerspectiveCamera()); else { draw(); draw(); }
  if (cached) expect(assets.retained()[0]?.refs).toBe(2);
  source.dispose();
  if (cached) expect(assets.evictCached('atlas')).toBe(false);
  expect(dispose).not.toHaveBeenCalled();
  draw();
  if (cached) expect(assets.retained()[0]?.refs).toBe(1);
  page.dispose();
  if (cached) expect(assets.evictCached('atlas')).toBe(true);
  expect(dispose).toHaveBeenCalledTimes(1);
});

test.each(['map', 'declared', 'compiled'] as const)('a compiled destination retains its private sampler before its first draw (%s)', mode => {
  const page = new Scope('renderer'), source = new Scope('source'), destination = new Scope('destination');
  const texture = retiredTexture(), root = new Group(), material = new MeshBasicMaterial({ map: texture });
  if (mode !== 'map') material.map = null;
  if (mode === 'declared') {
    patchShader(material, 'borrowed sampler', 100, () => undefined, { textures: [texture] });
  }
  root.add(new Mesh(new BufferGeometry(), material));
  ownSceneTree(root, destination, { isAcquired: () => false });
  ownSceneResource(texture, source);
  const renderer = { properties: { has: () => false, get: (object: unknown) => object,
    remove: () => undefined, update: () => undefined, dispose: () => undefined },
    renderBufferDirect: vi.fn<Renderer['renderBufferDirect']>(), compile: vi.fn<Renderer['compile']>(() => {
      if (mode === 'compiled') patchShader(material, 'borrowed sampler', 100, () => undefined, { textures: [texture] });
      return new Set();
    }) };
  new UploadOwnership(page, new AssetService()).attach(renderer);
  renderer.compile(root, new PerspectiveCamera());
  const dispose = vi.spyOn(texture, 'dispose');
  source.dispose();
  expect(dispose).not.toHaveBeenCalled();
  destination.dispose(); page.dispose();
  expect(dispose).toHaveBeenCalledTimes(1);
});

test('a late stand-in compile keeps its retired source owner instead of adopting it as page content', () => {
  const page = new Scope('page'), source = new Scope('source'), root = new Group(), texture = retiredTexture();
  const mesh = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ map: texture }));
  root.add(mesh); ownSceneTree(root, source, { isAcquired: () => false });
  ownSceneResource(texture, source);
  const copy = mesh.clone(false); linkStandIn(copy, mesh);
  const renderer = { properties: { has: () => false, get: (object: unknown) => object,
    remove: () => undefined, update: () => undefined, dispose: () => undefined },
    renderBufferDirect: vi.fn<Renderer['renderBufferDirect']>(), compile: vi.fn<Renderer['compile']>(() => new Set()) };
  new UploadOwnership(page, new AssetService()).attach(renderer);
  const dispose = vi.spyOn(texture, 'dispose');
  source.dispose(); renderer.compile(copy, new PerspectiveCamera());
  expect(sceneResourceOwner(texture)).toBe(source);
  page.dispose(); expect(dispose).toHaveBeenCalledTimes(1);
});

test('G598 a stepped owner frees its scene tree 16 resources a step, a whole dispose at once, each resource once', () => {
  const build = (): { root: Group; geometries: BufferGeometry[]; disposed: () => number } => {
    const root = new Group(), geometries = Array.from({ length: 40 }, () => new BufferGeometry()), material = new MeshBasicMaterial();
    for (const geometry of geometries) root.add(new Mesh(geometry, material));
    let count = 0;
    for (const geometry of geometries) geometry.addEventListener('dispose', () => { count++; });
    return { root, geometries, disposed: () => count };
  };
  const whole = build(), wholeOwner = new Scope('whole');
  ownSceneTree(whole.root, wholeOwner, { isAcquired: () => false });
  wholeOwner.dispose();
  expect(whole.disposed()).toBe(40);
  const stepped = build(), owner = new Scope('stepped');
  ownSceneTree(stepped.root, owner, { isAcquired: () => false });
  const steps = owner.disposeSteps();
  steps.next(); steps.next();
  expect(stepped.disposed()).toBeLessThanOrEqual(16);
  let count = 2; while (steps.next().done !== true) count++;
  expect(count).toBeGreaterThanOrEqual(4);
  expect(stepped.disposed()).toBe(40);
  expect(stepped.root.children).toHaveLength(0);
});
