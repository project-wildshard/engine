import { afterEach, expect, test, vi } from 'vitest';
import { BoxGeometry, Group } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createRigLoader } from '@wildshard/engine/anim/rigParser';
import { TileStreamer } from '@wildshard/engine/world/tileStreamer';
import { ResidencyAllocator } from '../../../shared/game/grid/allocator';
import { farRingPorts, type FarPrepared } from './farView';
import { NearPlaceholders } from './nearPlaceholderView';

afterEach(() => { vi.restoreAllMocks(); });

test.each([false, true])('CF2: visible far startup precedes a slow near decode (ordered=%s)', async ordered => {
  const empty = JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }], nodes: [] });
  const original = await new GLTFLoader().parseAsync(empty, ''), loader = createRigLoader();
  const root = new Group(), allocator = new ResidencyAllocator(), paths: string[] = [];
  const reads: Promise<FarPrepared>[] = [];
  let finishNear: ((file: GLTF) => void) | undefined;
  vi.spyOn(GLTFLoader.prototype, 'parse').mockImplementation((_bytes, path, finish) => {
    paths.push(path);
    if (path === '/near/') finishNear = finish;
    else finish(original);
  });
  const read = (path: string): Promise<FarPrepared> => {
    const work = loader.parseAsync(empty, path).then((): FarPrepared => ({
      geometry: new BoxGeometry(), look: { family: 'toon', haze: { colour: [1, 1, 1] } },
    }));
    reads.push(work); return work;
  };
  let releaseFar = (): void => undefined;
  const bytesReady = new Promise<void>(resolve => { releaseFar = resolve; });
  const farWork = bytesReady.then(() => read('/far/')); reads.push(farWork);
  const cell = { instance: 'neighbour', slug: 'content', cell: [1, 0] as const, origin: { x: 562.5, y: 0, z: 0 } };
  const far = farRingPorts({ root: () => root, load: () => farWork });
  const rings = new TileStreamer([cell], allocator, (_id, level) => level === 'far' ? 100 : null, far);
  const cover = vi.fn();
  const near = new NearPlaceholders({ allocator, cells: [cell], pitch: 562.5, root: () => root,
    readyToRefine: () => !ordered || rings.ready(),
    load: async () => ({ prepared: await read('/near/'), bytes: 100, owns: true }),
    cover: (instance, covered) => { cover(instance, covered); }, mask: () => new Set<number>() });
  const eye = { x: 0, z: 0 }, pose = { ...eye, vx: 0, vz: 0 };
  try {
    // Home gameplay is already live. A visible far request still owns startup;
    // optional near content must not take the shared parser ahead of it.
    rings.step(pose);
    near.update(eye, null);
    // The far file is still arriving while cached near bytes could decode now.
    // Resolve the file on a later task, preserving that real ordering race.
    await new Promise<void>(resolve => { setTimeout(resolve, 0); });
    releaseFar();
    if (!ordered) {
      await new Promise<void>(resolve => { setTimeout(resolve, 0); });
      rings.step(pose);
      expect(paths).toEqual(['/near/']);
      expect(rings.ready()).toBe(false);
      expect(far.waiting()).toMatchObject([{ instance: cell.instance, phase: 'load' }]);
      if (finishNear === undefined) throw new Error('Missing blocking optional decode');
      finishNear(original);
      await vi.waitFor(() => { rings.step(pose); expect(rings.ready()).toBe(true); });
      expect(paths).toEqual(['/near/', '/far/']);
      return;
    }
    await vi.waitFor(() => { rings.step(pose); expect(rings.ready()).toBe(true); });
    expect(paths).toEqual(['/far/']); expect(far.waiting()).toEqual([]);
    expect(rings.waiting()).toEqual([]);
    expect(near.owns(cell.instance)).toBe(false);
    expect(cover).not.toHaveBeenCalled();

    near.update(eye, null);
    await vi.waitFor(() => { expect(paths).toEqual(['/far/', '/near/']); });
    expect(rings.ready()).toBe(true); expect(near.shows(cell.instance)).toBe(false);
    if (finishNear === undefined) throw new Error('Missing held optional decode');
    finishNear(original);
    await vi.waitFor(() => { expect(near.shows(cell.instance)).toBe(true); });
    expect(cover).toHaveBeenCalledExactlyOnceWith(cell.instance, true);
  } finally {
    near.dispose(); rings.dispose(); releaseFar(); finishNear?.(original);
    await Promise.allSettled(reads);
    expect(allocator.entries()).toEqual([]);
  }
});
