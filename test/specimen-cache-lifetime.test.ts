import { expect, test, vi } from 'vitest';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { sdkBuiltAsset } from './fixtures/sdk-built/assets';
import { loadSpecimenAsset, loadBoundSpecimen } from '../src/client/game/models/specimenCatalogue';
import { SkyRig } from '../src/client/engine/world/skyRig';
import { realGc } from '@wildshard/engine/test/realGc';

const name = 'a live cached specimen does not retain the consumed loader row';
test(name, async () => {
  await realGc('test/specimen-cache-lifetime.test.ts', name, async collect => {
    const bytes = sdkBuiltAsset('specimen.glb');
    const parsed = await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, '');
    const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(parsed);
    const prepare = async () => {
      const row = { url: '/assets/specimen-cache-lifetime.glb', context: new Uint8Array(1024 * 1024) };
      const weak = new WeakRef(row), backing = new WeakRef(row.context.buffer);
      return { asset: await loadSpecimenAsset(row), weak, backing };
    };
    const result = await prepare();
    try {
      await collect(result.weak); await collect(result.backing);
      expect(result.asset.geometry.getAttribute('position').count).toBe(24);
      expect(await loadSpecimenAsset({ url: '/assets/specimen-cache-lifetime.glb' })).toBe(result.asset);
      expect(load).toHaveBeenCalledOnce();
      result.asset.geometry.dispose();
      const fresh = await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, '');
      load.mockResolvedValueOnce(fresh);
      const replacement = await loadSpecimenAsset({ url: '/assets/specimen-cache-lifetime.glb' });
      expect(replacement).not.toBe(result.asset); expect(load).toHaveBeenCalledTimes(2);
      result.asset.geometry.dispose();
      expect(await loadSpecimenAsset({ url: '/assets/specimen-cache-lifetime.glb' })).toBe(replacement);
      replacement.geometry.dispose();
    } finally {
      result.asset.geometry.dispose();  vi.restoreAllMocks();
    }
  });
});

const boundName = 'a live bound specimen does not retain its consumed asset declaration';
test(boundName, async () => {
  await realGc('test/specimen-cache-lifetime.test.ts', boundName, async collect => {
    const bytes = sdkBuiltAsset('bound-specimen.glb');
    const parsed = await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, '');
    const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(parsed);
    const sky: unknown = Object.create(SkyRig.prototype);
    if (!(sky instanceof SkyRig)) throw new Error('Missing fixture sky');
    Reflect.set(sky, 'setupMaterial', () => undefined);
    const prepare = async () => {
      const row = { url: '/assets/bound-specimen-cache-lifetime.glb',
        material: { id: 'cache-lifetime', family: 'lowpoly' as const }, context: new Uint8Array(1024 * 1024) };
      return { asset: await loadBoundSpecimen(sky, row), weak: new WeakRef(row), backing: new WeakRef(row.context.buffer) };
    };
    const result = await prepare();
    try {
      await collect(result.weak); await collect(result.backing);
      expect(result.asset.geometry.getAttribute('position').count).toBe(24);
      expect(await loadBoundSpecimen(sky, { url: '/assets/bound-specimen-cache-lifetime.glb',
        material: { id: 'cache-lifetime', family: 'lowpoly' } })).toBe(result.asset);
      expect(load).toHaveBeenCalledOnce();
    } finally {
      result.asset.geometry.dispose(); result.asset.material.dispose();
       vi.restoreAllMocks();
    }
  });
});

test('failed specimen acquisition keeps its error and a later request can retry', async () => {
  const bytes = sdkBuiltAsset('retry-specimen.glb');
  const parsed = await new GLTFLoader().parseAsync(Uint8Array.from(bytes).buffer, '');
  const error = new Error('Specimen transport refused');
  const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockRejectedValueOnce(error).mockResolvedValue(parsed);
  try {
    await expect(loadSpecimenAsset({ url: '/assets/retry-specimen-cache-lifetime.glb' })).rejects.toBe(error);
    const asset = await loadSpecimenAsset({ url: '/assets/retry-specimen-cache-lifetime.glb' });
    expect(asset.geometry.getAttribute('position').count).toBe(24);
    expect(load).toHaveBeenCalledTimes(2); asset.geometry.dispose();
  } finally {  vi.restoreAllMocks(); }
});
