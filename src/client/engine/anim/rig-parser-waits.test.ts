// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createRigLoader } from './rigParser';
import { bootWaits } from '../../../shared/engine/boot/waits';
import * as slices from '../../../shared/engine/core/workSlice';

afterEach(() => { vi.restoreAllMocks(); });

const empty = JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }], nodes: [] });

test('a held GLTF decode identifies the active parser and its queued neighbour without starting it', async () => {
  const file = await new GLTFLoader().parseAsync(empty, ''), loader = createRigLoader();
  const completed: ((file: GLTF) => void)[] = [], paths: string[] = [];
  const parse = vi.spyOn(GLTFLoader.prototype, 'parse').mockImplementation((_data, path, onLoad) => {
    paths.push(path); completed.push(onLoad);
  });
  const first = loader.parseAsync(empty, '/first/'), second = loader.parseAsync(empty, '/neighbour/');
  try {
    await vi.waitFor(() => { expect(paths).toEqual(['/first/']); });
    expect(bootWaits().filter(wait => wait.label.startsWith('GLTF ')).map(wait => wait.label)).toEqual([
      'GLTF decode /first/',
    ]);
    completed[0]?.(file); expect(await first).toBe(file);
    await vi.waitFor(() => { expect(paths).toEqual(['/first/', '/neighbour/']); });
    expect(bootWaits().filter(wait => wait.label.startsWith('GLTF ')).map(wait => wait.label)).toEqual(['GLTF decode /neighbour/']);
    completed[1]?.(file); expect(await second).toBe(file);
    expect(bootWaits().filter(wait => wait.label.startsWith('GLTF '))).toEqual([]);
  } finally {
    parse.mockImplementation((_data, _path, onLoad) => { onLoad(file); });
    for (const finish of completed) finish(file);
    await Promise.all([first, second]);
  }
});

test('a refused parser releases its wait and the same serial slot for the queued neighbour', async () => {
  const file = await new GLTFLoader().parseAsync(empty, ''), loader = createRigLoader(), failure = new Error('original GLTF refusal');
  const calls: string[] = [];
  vi.spyOn(GLTFLoader.prototype, 'parse').mockImplementation((_data, path, onLoad) => {
    calls.push(path);
    if (path === '/broken/') throw failure;
    onLoad(file);
  });
  const first = loader.parseAsync(empty, '/broken/'), second = loader.parseAsync(empty, '/next/');
  await expect(first).rejects.toBe(failure);
  expect(await second).toBe(file);
  expect(calls).toEqual(['/broken/', '/next/']);
  expect(bootWaits().filter(wait => wait.label.startsWith('GLTF '))).toEqual([]);
});

test('owned-byte parsing retains its original native result and leaves no decode wait', async () => {
  const bytes = new TextEncoder().encode(empty), original = bytes.slice();
  const file = await createRigLoader().parseBytesAsync(bytes, '');
  expect(file.asset.version).toBe('2.0');
  expect(file.scene.children).toEqual([]);
  expect(bytes).toEqual(original);
  expect(bootWaits().filter(wait => wait.label.startsWith('GLTF '))).toEqual([]);
});

test('a paced parser reports its existing draw wait before starting native decoding', async () => {
  const file = await new GLTFLoader().parseAsync(empty, ''), loader = createRigLoader();
  let release = (): void => undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  vi.spyOn(slices, 'workSlice').mockReturnValue({ check: () => held, due: () => true, yield: () => held });
  const parse = vi.spyOn(GLTFLoader.prototype, 'parse').mockImplementation((_data, _path, onLoad) => { onLoad(file); });
  const pending = loader.parseAsync(empty, '/paced/');
  try {
    await vi.waitFor(() => { expect(bootWaits().filter(wait => wait.label.startsWith('GLTF ')).map(wait => wait.label)).toEqual(['GLTF decode pacing']); });
    expect(parse).not.toHaveBeenCalled();
  } finally {
    release(); await pending;
    if (previousWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
    else Object.defineProperty(globalThis, 'window', previousWindow);
  }
  expect(parse).toHaveBeenCalledOnce();
  expect(bootWaits().filter(wait => wait.label.startsWith('GLTF '))).toEqual([]);
});
