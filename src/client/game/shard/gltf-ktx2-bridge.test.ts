// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { CompressedTexture, Mesh, MeshStandardMaterial } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { installGltfKtx2 } from '@wildshard/engine/core/ktx2';
import * as files from '@wildshard/engine/boot/gpuFiles';
import * as textures from '@wildshard/engine/core/ktx2';
import { withShardHooks } from './load';

afterEach(() => { vi.restoreAllMocks(); });

test('explicit setup preserves constructor identity and wraps the original parser once', async () => {
  const mode = vi.spyOn(files, 'texMode').mockReturnValue('img');
  const file = await new GLTFLoader().parseAsync(JSON.stringify({asset:{version:'2.0'},scene:0,scenes:[{nodes:[]}],nodes:[]}), '');
  const texture = new CompressedTexture([], 1, 1), mesh = new Mesh(undefined, new MeshStandardMaterial({map:texture}));
  file.scene.add(mesh);
  const calls: {data: unknown; path: string}[] = [];
  class OriginalLoader extends GLTFLoader {
    override parse(...[data, path, onLoad]: Parameters<GLTFLoader['parse']>): void { calls.push({data,path}); onLoad(file); }
  }
  const original: unknown = Object.getOwnPropertyDescriptor(OriginalLoader.prototype, 'parse')?.value;
  installGltfKtx2(OriginalLoader);
  const installed: unknown = Object.getOwnPropertyDescriptor(OriginalLoader.prototype, 'parse')?.value;
  expect(installed).not.toBe(original);
  installGltfKtx2(OriginalLoader);
  expect(Object.getOwnPropertyDescriptor(OriginalLoader.prototype, 'parse')?.value).toBe(installed);
  const loader = new OriginalLoader().setKTX2Loader(new KTX2Loader());
  const before = texture.onUpdate;
  expect(await loader.parseAsync('image-input', 'images/')).toBe(file);
  expect(texture.onUpdate).toBe(before);
  mode.mockReturnValue('ktx2'); // Sample the resolved mode at parse, after construction.
  expect(await loader.parseAsync('compressed-input', 'compressed/')).toBe(file);
  expect(texture.onUpdate).not.toBe(before);
  expect(calls).toEqual([{data:'image-input',path:'images/'},{data:'compressed-input',path:'compressed/'}]);
  mesh.geometry.dispose(); mesh.material.dispose(); texture.dispose();
});

test('the explicit bridge forwards the original parser failure and receiver', async () => {
  vi.spyOn(files, 'texMode').mockReturnValue('ktx2');
  const failure = new ErrorEvent('error', {message:'original failure'}), receivers: GLTFLoader[] = [];
  class OriginalLoader extends GLTFLoader {
    override parse(...args: Parameters<GLTFLoader['parse']>): void { receivers.push(this); args[3]?.(failure); }
  }
  installGltfKtx2(OriginalLoader);
  const loader = new OriginalLoader().setKTX2Loader(new KTX2Loader());
  await expect(loader.parseAsync('bad', '')).rejects.toBe(failure);
  expect(receivers).toEqual([loader]);
});


test('shard hooks run without configuring raw loaders (LD8 retired the frozen-copy bridge)', async () => {
  vi.spyOn(files, 'texMode').mockReturnValue('img');
  const configure = vi.spyOn(textures, 'installGltfKtx2');
  expect(await withShardHooks({ground:{structures:true}}, (_name, work) => Promise.resolve(work()), () => Promise.resolve('ordinary'))).toBe('ordinary');
  expect(configure).not.toHaveBeenCalled();
});
