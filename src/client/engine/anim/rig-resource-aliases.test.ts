import { DefaultLoadingManager, LoaderUtils } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { loadRigFile } from '@wildshard/engine/anim/rig';

// loadRigFile imports rigParser on first use, and its chain (core/ktx2 -> boot/bytes, since OF17 e4cb7b1f) installs the
// page's own URL modifier as it loads. Load it first, so it can't replace the modifier a test sets.
beforeAll(async () => { await import('./rigParser'); });

const pageLocation = location;
afterEach(() => { DefaultLoadingManager.setURLModifier(undefined); vi.restoreAllMocks(); vi.stubGlobal('location', pageLocation); });

it('keeps default tier routing for aliases and isolates each file from the shared loader', async () => {
  vi.stubGlobal('location', { href: 'https://game.example/play/' });
  DefaultLoadingManager.setURLModifier(path => `https://game.example${path}?tier=phone`);
  const file = await new GLTFLoader().parseAsync(JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }], nodes: [] }), '');
  const reads: { shared: boolean; image: string; ordinary: string }[] = [];
  vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(function loadFixture(this: GLTFLoader) {
    reads.push({ shared: this.manager === DefaultLoadingManager,
      image: this.manager.resolveURL('/assets/scan/wood.png'), ordinary: this.manager.resolveURL('/assets/scan/metal.png') });
    return Promise.resolve(file);
  });
  await loadRigFile('/first.glb');
  await loadRigFile('/second.gltf', { '/assets/scan/wood.png': '/assets/packed/wood.webp' });
  await loadRigFile('/third.glb');
  expect(reads.map(row => row.shared)).toEqual([true, false, true]);
  expect(reads.map(row => row.image)).toEqual(['https://game.example/assets/scan/wood.png?tier=phone',
    'https://game.example/assets/packed/wood.webp?tier=phone', 'https://game.example/assets/scan/wood.png?tier=phone']);
  expect(reads.every(row => row.ordinary === 'https://game.example/assets/scan/metal.png?tier=phone')).toBe(true);
});

it('resolves root and relative images from the original aliased model before tier routing', async () => {
  vi.stubGlobal('location', { href: 'https://game.example/play/' });
  const original = '/assets/models/crate/crate.gltf';
  DefaultLoadingManager.setURLModifier(path => path === original ? '/assets/gpu/crate.gltf'
    : path === '/assets/models/crate/textures/wood.jpg' ? '/assets/models/crate/textures/wood.phone.webp' : path);
  const file = await new GLTFLoader().parseAsync(JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }], nodes: [] }), '');
  const reads: { model: string; root: string; relative: string; external: string; blob: string }[] = [];
  vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(function readFixture(this: GLTFLoader, url) {
    const base = this.resourcePath || LoaderUtils.extractUrlBase(url);
    const dependency = (uri: string): string => this.manager.resolveURL(LoaderUtils.resolveURL(uri, base));
    reads.push({ model: this.manager.resolveURL(url), root: dependency('/assets/pine/wood.ktx2'),
      relative: dependency('textures/wood.jpg'), external: dependency('https://cdn.example/metal.jpg'), blob: dependency('blob:https://game.example/resource') });
    return Promise.resolve(file);
  });
  await loadRigFile(original, { '/assets/gpu/crate.gltf': '/assets/compact/crate.gltf' });
  expect(reads).toEqual([{ model: '/assets/compact/crate.gltf', root: '/assets/pine/wood.ktx2',
    relative: '/assets/models/crate/textures/wood.phone.webp', external: 'https://cdn.example/metal.jpg', blob: 'blob:https://game.example/resource' }]);
});

it('reads an aliased model\'s hand-made phone copy on the phone (SF5d)', async () => {
  // Pine Hollow's rock scene material names rock_moss_set_01_lod.glb; its cooked alias table names both product files, and
  // the phone set holds only the .phone.glb, so a phone that read the desktop file got a 404 from the cook store.
  vi.stubGlobal('location', { href: 'https://game.example/play/' });
  DefaultLoadingManager.setURLModifier(path => path);
  const { TIER_CONFIG } = await import('@wildshard/engine/core/tier');
  const file = await new GLTFLoader().parseAsync(JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }], nodes: [] }), '');
  const reads: string[] = [];
  vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(function readFixture(this: GLTFLoader, url) {
    reads.push(this.manager.resolveURL(url));
    return Promise.resolve(file);
  });
  const model = '/assets/pine/rock/rock_lod.glb', aliases = { [model]: 'https://cook.example/blobs/desktop.bin',
    '/assets/pine/rock/rock_lod.phone.glb': 'https://cook.example/blobs/phone.bin' };
  const was = TIER_CONFIG.maxTexture;
  try {
    TIER_CONFIG.maxTexture = 2048;
    await loadRigFile(model, aliases);
    TIER_CONFIG.maxTexture = 1024;
    await loadRigFile(model, aliases);
    await loadRigFile(model, { [model]: 'https://cook.example/blobs/desktop.bin' });
  } finally { TIER_CONFIG.maxTexture = was; }
  expect(reads).toEqual(['https://cook.example/blobs/desktop.bin', 'https://cook.example/blobs/phone.bin', 'https://cook.example/blobs/desktop.bin']);
});
