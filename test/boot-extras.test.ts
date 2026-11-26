import { expect, test } from 'vitest';
import { sceneSourceUrls } from '../src/scripts/app-build/bootExtras';

test('lists exactly the model reader preloads, deduplicating URLs and excluding unused mappings/specimen metadata', () => {
  expect(sceneSourceUrls('models', { rows: {
    meshes: ['one'], meshUrls: { one: '/assets/one.glb', unused: '/assets/unused.glb' },
    hd: ['two'], hdUrls: { two: '/assets/two.glb' }, geometryPools: [{ url: '/assets/pool.glb', parts: [] }],
    paintedModels: [{ url: '/assets/two.glb', geometry: 'one' }],
    rigs: { bodies: { creatures: ['body'], urls: { body: '/assets/body.glb', unused: '/assets/no.glb' } } },
  }, specimens: [{ image: '/assets/not-read.png' }] })).toEqual(['/assets/one.glb', '/assets/two.glb', '/assets/pool.glb', '/assets/body.glb']);
  expect(sceneSourceUrls('baked', { rows: { first: {}, second: {} }, urls: { first: '/assets/first.glb', second: '/assets/second.glb', unused: '/assets/no.glb' },
    resources: [{ url: '/assets/extra.bin' }] })).toEqual(['/assets/first.glb', '/assets/second.glb', '/assets/extra.bin']);
  expect(() => sceneSourceUrls('models', { rows: { meshes: ['missing'], meshUrls: {}, hd: [], hdUrls: {} } })).toThrow('Invalid boot source URL');
});
