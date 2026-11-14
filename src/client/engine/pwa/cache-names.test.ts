import { expect, test } from 'vitest';
import { cacheChannel, cacheName, isForeign, ownsCache } from './cacheNames';

// OFFLINE OF12: the channel comes from the build's stamp, as the home icons read it; production keeps its names.
test('OF12: the stamp names the channel, and every channel but production carries it in its cache names', () => {
  expect(cacheChannel(undefined)).toBe('preview');
  expect(cacheChannel({ release: 'https://packs.wildshard.io/releases/production.json', key: 'k' })).toBe('production');
  expect(cacheChannel({ release: 'https://packs.wildshard.io/releases/staging.json', key: 'k' })).toBe('staging');
  expect(['ws-assets-v1', 'ws-builds-v1', 'ws-shell-v3-', 'ws-content-v1'].map(base => cacheName(base, 'production')))
    .toEqual(['ws-assets-v1', 'ws-builds-v1', 'ws-shell-v3-', 'ws-content-v1']);
  expect(cacheName('ws-assets-v1', 'preview')).toBe('ws-preview-assets-v1');
  expect(cacheName('ws-shell-v3-', 'staging')).toBe('ws-staging-shell-v3-');
  // production's prefix tests never match another channel's names
  expect(ownsCache('ws-preview-shell-v3-A', 'production')).toBe(false);
  expect(ownsCache('ws-shell-v3-A', 'production')).toBe(true);
  expect(ownsCache('ws-shell-v3-A', 'staging')).toBe(false);
});

test('OF12: another channel\'s caches are foreign; production\'s names are foreign to staging only where production ran', () => {
  expect(isForeign('ws-staging-assets-v1', 'preview', false)).toBe(true);
  expect(isForeign('ws-preview-assets-v1', 'production', false)).toBe(true);
  expect(isForeign('ws-assets-v1', 'staging', true)).toBe(true);
  expect(isForeign('ws-assets-v1', 'staging', false), 'the origin\'s own pre-OF12 cache').toBe(false);
  expect(isForeign('ws-staging-assets-v1', 'staging', true)).toBe(false);
});
