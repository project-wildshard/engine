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
const RANGER = '/assets/game89/npcs/ranger.glb', RANGER_GPU = '/assets/gpu/game89/npcs/ranger-c5f60d88.glb';
registerGpuFiles({ phone: { [SERVED]: GPU, [RANGER]: RANGER_GPU }, desktop: { [SERVED]: GPU, [RANGER]: RANGER_GPU } });

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

test('concurrent loads that all saw the 404 all fall back, and it is reported once (Codex review)', async () => {
  FakeLoader.served.add(RANGER);
  const faults: Fault[] = [], off = onFault(f => { faults.push(f); });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const a = new FakeLoader(), b = new FakeLoader();
  await expect(Promise.all([load(a, RANGER), load(b, RANGER)])).resolves.toEqual([{ url: RANGER }, { url: RANGER }]);
  expect([a.asked, b.asked]).toEqual([[RANGER_GPU, RANGER], [RANGER_GPU, RANGER]]);
  off();
  expect(faults).toHaveLength(1);
});

test('an absolute URL with a query names the stand-in by its page path', async () => {
  const { retireGpuFile } = await import('../boot/gpuFiles');
  expect(retireGpuFile('https://play.wildshard.io/assets/gpu/game89/npcs/none-00000000.glb?v=1')).toBeUndefined();
  expect(retireGpuFile(`https://play.wildshard.io${GPU}?v=1`)).toBe('retired');
});

test('a 404 on a file that is no stand-in still fails as before', async () => {
  const loader = new FakeLoader();
  await expect(load(loader, '/assets/game89/npcs/gone.glb')).rejects.toThrow('responded with 404');
  expect(loader.asked).toEqual(['/assets/game89/npcs/gone.glb']);
});
