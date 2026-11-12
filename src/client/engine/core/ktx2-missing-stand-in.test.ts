import { afterEach, expect, test, vi } from 'vitest';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { installGltfKtx2 } from './ktx2';
import { isRegisteredGpuFile, registerGpuFiles, standIn } from '../boot/gpuFiles';
import { onFault, type Fault } from '../../../shared/engine/core/faults';

// WILDSHARD-GAME-89: Pine Hollow's live shardfile (rev 1) names desktop KTX2 stand-ins for its NPC GLBs
// (`/assets/gpu/pine-hollow/npcs/miller-2d664352.glb`) that it does not carry, so every desktop entry died at
// spawnDetail on a 404. A stand-in that answers 404 is retired for the page and the tier's own file loads instead,
// reported once as a recoverable fault.
const SERVED = '/assets/game89/npcs/miller.glb', GPU = '/assets/gpu/game89/npcs/miller-2d664352.glb';
registerGpuFiles({ phone: { [SERVED]: GPU }, desktop: { [SERVED]: GPU } });

class HttpError extends Error {
  readonly response: { status: number; url: string };
  constructor(message: string, response: { status: number; url: string }) { super(message); this.name = 'HttpError'; this.response = response; }
}
/** GLTFLoader's load contract: the page's modifier swaps the stand-in in; a 404 rejects with three's HttpError. */
class FakeLoader {
  static served = new Set<string>([SERVED]);
  readonly asked: string[] = [];
  load(url: string, onLoad: (gltf: unknown) => void, _onProgress?: unknown, onError?: (error: unknown) => void): void {
    const resolved = standIn(url, 'ktx2') ?? url;
    this.asked.push(resolved);
    queueMicrotask(() => {
      if (FakeLoader.served.has(resolved)) onLoad({ url: resolved });
      else onError?.(new HttpError(`fetch for "https://play.wildshard.io${resolved}" responded with 404: `, { status: 404, url: `https://play.wildshard.io${resolved}` }));
    });
  }
  parse(): void { /* unused here */ }
}
installGltfKtx2(FakeLoader as unknown as typeof GLTFLoader);
const load = (loader: FakeLoader, url: string): Promise<unknown> => new Promise((resolve, reject) => { loader.load(url, resolve, undefined, reject); });

afterEach(() => { vi.restoreAllMocks(); });

test('a stand-in that answers 404 falls back to the served file, is retired for the page and is reported once', async () => {
  const faults: Fault[] = [], off = onFault(f => { faults.push(f); });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  expect(isRegisteredGpuFile(GPU)).toBe(true);
  const first = new FakeLoader();
  await expect(load(first, SERVED)).resolves.toEqual({ url: SERVED });
  expect(first.asked).toEqual([GPU, SERVED]);
  expect(standIn(SERVED, 'ktx2')).toBeUndefined();
  const second = new FakeLoader();
  await expect(load(second, SERVED)).resolves.toEqual({ url: SERVED });
  expect(second.asked).toEqual([SERVED]);
  off();
  expect(faults).toHaveLength(1);
  expect(faults[0]).toMatchObject({ system: 'assets.gpu', verdict: 'retry' });
  expect(String(faults[0]?.error)).toContain(GPU);
  expect(warn).toHaveBeenCalledTimes(1);
});

test('a 404 on a file that is no stand-in still fails as before', async () => {
  const loader = new FakeLoader();
  await expect(load(loader, '/assets/game89/npcs/gone.glb')).rejects.toThrow('responded with 404');
  expect(loader.asked).toEqual(['/assets/game89/npcs/gone.glb']);
});
