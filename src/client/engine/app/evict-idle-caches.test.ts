import { expect, test } from 'vitest';
import { AssetService } from './assets';

/** ZONE-ENTRY ZE10a3: a same-page entry drops every idle module cache, as a fresh page would; leased caches and retained
 *  engine assets stay. */
test('evictIdleCaches disposes idle caches only', () => {
  const disposed: string[] = [], made = (name: string) => ({ dispose: () => { disposed.push(name); } });
  const assets = new AssetService();
  assets.register('idle', made('idle'), { retain: true, cache: true });
  assets.register('leased', made('leased'), { retain: true, cache: true });
  assets.register('engine', made('engine'), { retain: true });
  assets.acquire('leased');
  expect(assets.evictIdleCaches()).toBe(1);
  expect(disposed).toEqual(['idle']);
  expect(assets.has('idle')).toBe(false);
  expect(assets.has('leased')).toBe(true);
  expect(assets.has('engine')).toBe(true);
  assets.release('leased');
  expect(assets.evictIdleCaches()).toBe(1);
  expect(disposed).toEqual(['idle', 'leased']);
});
