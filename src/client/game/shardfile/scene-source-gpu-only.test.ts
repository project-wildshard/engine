import { expect, test, vi, type Mock } from 'vitest';
import { BufferGeometry, DataTexture, Mesh, MeshStandardMaterial, type Texture } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Scope } from '@wildshard/engine/app/scope';
import * as rig from '@wildshard/engine/anim/rig';
import { SkyRig } from '@wildshard/engine/world/skyRig';
import { parseWorldScenes } from '@wildshard/format/worldScenes';
import { worldSceneSourceMaterial } from './worldSceneMaterials';
import { installTextureUploadEvents, type TextureUploadRenderer } from '@wildshard/engine/render/textureUploadEvents';

// A source material row's file: two materials over one aliased texture (one's map and normal map, the other's map) and
// a second texture, each with its own upload hook.
async function source() {
  const shared = new DataTexture(new Uint8Array(4), 1, 1), normal = new DataTexture(new Uint8Array(4), 1, 1);
  const hooks = new Map<Texture, Mock<(texture: Texture) => void>>([[shared, vi.fn<(texture: Texture) => void>()], [normal, vi.fn<(texture: Texture) => void>()]]);
  for (const [texture, hook] of hooks) texture.onUpdate = hook;
  const a = new MeshStandardMaterial({ map: shared, normalMap: shared }), b = new MeshStandardMaterial({ map: shared, normalMap: normal });
  const geometry = new BufferGeometry(), file = await new GLTFLoader().parseAsync(JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }], nodes: [] }), '');
  file.scene.add(new Mesh(geometry, a), new Mesh(geometry, b));
  const sky: unknown = Object.create(SkyRig.prototype), setup = vi.fn();
  if (!(sky instanceof SkyRig)) throw new Error('Missing sky fixture');
  Object.defineProperty(sky, 'setupMaterial', { value: setup });
  const row = parseWorldScenes({ version: 1, libraries: [], materials: [{ id: 'sculpt', kind: 'source', url: '/sculpt.glb', anisotropy: 4, gpuOnlyMaps: true }], steps: [] }).materials[0];
  if (row?.kind !== 'source') throw new Error('Missing source fixture');
  return { shared, normal, hooks, a, b, geometry, file, sky, setup, row };
}

test('a GPU-only source releases once across aliased slots while keeping its native upload hook', async () => {
  const { shared, normal, hooks, a, file, sky, row } = await source(), owner = new Scope('sculpt');
  const load = vi.spyOn(rig, 'loadRigFile').mockResolvedValue(file);
  const versions = new WeakMap<object, { __version: number }>();
  const renderer: TextureUploadRenderer = { properties: { get: object => typeof object === 'object' && object !== null ? versions.get(object) : undefined },
    initTexture: texture => { renderer.properties.get(texture); texture.onUpdate?.(texture); versions.set(texture, { __version: texture.version }); versions.set(texture.source, { __version: texture.source.version }); },
    render: () => undefined };
  installTextureUploadEvents(renderer);
  try {
    expect(await worldSceneSourceMaterial(row, sky, { url: name => name }, owner)).toBe(a);
    for (const texture of [shared, normal]) {
      const hook = hooks.get(texture);
      expect(texture.onUpdate).toBe(hook);
      renderer.initTexture(texture);
      expect(hook).toHaveBeenCalledOnce(); expect(texture.onUpdate).toBe(hook);
      // one release: the CPU copy is gone and a later upload runs only the original hook
      expect(texture.image.data?.length).toBe(0);
      texture.onUpdate?.(texture);
      expect(hook).toHaveBeenCalledTimes(2); expect(texture.onUpdate).toBe(hook);
    }
  } finally { owner.dispose(); load.mockRestore(); }
});

test('a load held across its cell retiring takes nothing up: no sky setup, no arming, its resources released with the owner', async () => {
  const { shared, normal, hooks, a, b, geometry, file, sky, setup, row } = await source(), cell = new Scope('cell'), owner = cell.child('sculpt');
  let release = (): void => undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  const load = vi.spyOn(rig, 'loadRigFile').mockImplementation(async () => { await held; return file; });
  const disposed = [a, b, shared, normal, geometry].map(resource => vi.spyOn(resource, 'dispose'));
  try {
    const material = worldSceneSourceMaterial(row, sky, { url: name => name }, owner);
    cell.onDispose(() => undefined);
    const steps = cell.disposeSteps(); steps.next();
    expect(owner.disposing).toBe(true);
    release();
    await expect(material).rejects.toThrow('Scene material owner is disposed');
    expect(setup).not.toHaveBeenCalled(); expect(shared.anisotropy).toBe(1); expect(a.envMapIntensity).toBe(1);
    for (const [texture, hook] of hooks) expect(texture.onUpdate).toBe(hook);
    for (let step = steps.next(); step.done !== true; step = steps.next()) { /* finish the retirement */ }
    for (const dispose of disposed) expect(dispose).toHaveBeenCalledOnce();
  } finally { cell.dispose(); load.mockRestore(); }
});
