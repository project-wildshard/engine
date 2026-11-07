import {afterEach, expect, test, vi} from 'vitest';
import {saves} from '../src/shared/engine/saves/runtime';
import {startGridPrefetch, gridPrefetchStatus} from '../src/client/game/grid/prefetch';

afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals();});

test('grid prefetch asks for persistence through the page\'s one save-store request, never directly (I10, D133)', async () => {
  const direct = vi.fn(() => Promise.resolve(true));
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('location', {href: 'http://localhost/', origin: 'http://localhost'});
  vi.stubGlobal('navigator', {onLine: true, storage: {persist: direct, estimate: () => Promise.resolve({usage: 0, quota: 1024 ** 3})}});
  vi.stubGlobal('Worker', undefined);
  vi.stubGlobal('caches', {open: () => Promise.reject(new Error('No product is prefetched')), delete: () => Promise.resolve(true)});
  const once = vi.spyOn(saves, 'persist').mockResolvedValue(true);
  startGridPrefetch([]);
  await vi.waitFor(() => {expect(gridPrefetchStatus()?.phase).toBe('done');});
  expect(once).toHaveBeenCalledTimes(1);
  expect(direct).not.toHaveBeenCalled();
});
