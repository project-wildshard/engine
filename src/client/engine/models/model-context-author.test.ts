// @vitest-environment node
// oxlint-disable-next-line import/no-nodejs-modules -- Inspect the real model entry's emitted module graph, without loading its output.
import { resolve } from 'node:path';
import { build } from 'vite';
import { expect, test } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import { modelContext, seedOf } from './model';
import { cacheUntilDisposed } from '../app/disposalCache';
import { dispatchRebind } from '../../../shared/engine/app/scope';

test('the native model entry has no application, renderer or cached asset-service value closure', async () => {
  const result = await build({ configFile: false, logLevel: 'silent', build: { write: false, minify: false,
    lib: { entry: resolve('src/client/engine/models/model.ts'), formats: ['es'] },
    rolldownOptions: { external: ['three'], output: { codeSplitting: false } } } });
  const output = Array.isArray(result) ? result[0] : result;
  if (output === undefined || !('output' in output)) throw new Error('Missing native model bundle');
  const chunks = output.output.filter(row => row.type === 'chunk');
  expect(chunks).toHaveLength(1);
  const modules = chunks.flatMap(chunk => Object.keys(chunk.modules));
  expect(modules.some(path => path.endsWith('/app/disposalCache.ts'))).toBe(true);
  expect(modules.some(path => path.endsWith('/app/sceneOwnership.ts'))).toBe(true);
  for (const path of ['/app/runtime.ts', '/app/cachedAssets.ts', '/render/renderer.ts'])
    expect(modules.some(module => module.endsWith(path)), path).toBe(false);
});

test('native context preserves undefined, synchronous failure and exact seeded values', () => {
  const context = modelContext(null), error = new Error('retry construction');
  expect(context.renderer).toBeNull();
  expect(context.visitPlacement).toBeUndefined();
  expect(() => context.sky).toThrow('this level has no Sky');
  let absentMakes = 0;
  context.once<undefined>('undefined', () => { absentMakes++; return undefined; });
  context.once<undefined>('undefined', () => { throw error; });
  expect(absentMakes).toBe(1);
  expect(() => context.once('retry', () => { throw error; })).toThrow(error);
  const value = {};
  expect(context.once('retry', () => value)).toBe(value);
  expect(seedOf({ id: 'abc' })).toBe(0x1a47e90b);
  expect(seedOf({ id: 'abc', seed: 0 })).toBe(0);
  expect(seedOf({ id: 'abc', seed: -5 })).toBe(-5);
});

test('native context keeps original promises, retries rejection and tracks resolved resources', async () => {
  const context = modelContext(null), geometry = new BoxGeometry(), error = new Error('source rejected');
  const failed = Promise.reject(error);
  expect(context.once('pending', () => failed)).toBe(failed);
  expect(context.once('pending', () => { throw new Error('must share'); })).toBe(failed);
  await expect(failed).rejects.toBe(error);
  const value = { geometry }, ready = Promise.resolve(value);
  expect(context.once('pending', () => ready)).toBe(ready);
  expect(await ready).toBe(value);
  dispatchRebind(geometry);
  expect(context.once('pending', () => { throw new Error('rebind must retain'); })).toBe(ready);
  geometry.dispose();
  const fresh = {};
  expect(context.once('pending', () => fresh)).toBe(fresh);
  geometry.dispose();
  expect(context.once('pending', () => { throw new Error('old disposal must not evict'); })).toBe(fresh);
});

test('the extracted tracker sees scene and container resources but never owns their disposal', () => {
  const geometry = new BoxGeometry(), texture = new Texture(), material = new MeshStandardMaterial({ map: texture });
  const root = new Group(); root.add(new Mesh(geometry, material));
  let sceneRetired = 0, containerRetired = 0, materialDisposed = 0;
  material.addEventListener('dispose', () => { materialDisposed++; });
  const container = new Map([['resources', { geometry, material }]]);
  expect(cacheUntilDisposed(root, () => { sceneRetired++; })).toBe(root);
  expect(cacheUntilDisposed(container, () => { containerRetired++; })).toBe(container);
  dispatchRebind(geometry);
  expect([sceneRetired, containerRetired, materialDisposed]).toEqual([0, 0, 0]);
  geometry.dispose();
  expect([sceneRetired, containerRetired, materialDisposed]).toEqual([1, 1, 0]);
  material.dispose(); texture.dispose();
  expect([sceneRetired, containerRetired, materialDisposed]).toEqual([1, 1, 1]);
});
