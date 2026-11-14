import { registeredJsonSchema } from '../src/shared/host/formatJsonSchema';
import { fixtureFolderFile, fixtureJsonCheck } from './fixtures/folderFile';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { Scope } from '../src/shared/engine/app/scope';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';
import { realGc } from '@wildshard/engine/test/realGc';
import type { Renderer } from '../src/client/engine/render/renderer';
import { TIER, initializeTier } from '../src/client/engine/core/tier';
import * as ktx2 from '../src/client/engine/core/ktx2';
import * as gpuFiles from '../src/client/engine/boot/gpuFiles';
import { SkyRig } from '../src/client/engine/world/skyRig';
import { WorldRegistry } from '../src/client/engine/world/registry';
import { modelContext } from '../src/client/engine/models/model';
import { bindFlatTerrain } from '@wildshard/engine/test/terrain';
import { staticGlb } from '../src/sharddev/bake/glb';
import { bakeRawColourPixels } from '../src/sharddev/bake/rawTexture';
import { emptyShardfile } from '../src/shared/host/author';
import { emitNamedBlobs, nameBlob } from '../src/sharddev/blobs';
import { parseExplorerCatalogue } from '@wildshard/format/explorerCatalogue';
import { createShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { SceneDressing } from '../src/client/game/shardfile/sceneDressing';
import type { ShardContext } from '../src/client/game/plugin/context';
import { explorerRoster } from '../src/client/game/models/explorerCatalogue';
import { awaitSpecimenAssets, defineSpecimenCatalogue, loadBoundSpecimen, prepareSpecimenCatalogue } from '../src/client/game/models/specimenCatalogue';

let decoder: KTX2Loader | undefined;
const originalTier = TIER;
beforeAll(() => {
  const detect = vi.spyOn(KTX2Loader.prototype, 'detectSupport').mockImplementation(function detectSupport(this: KTX2Loader) {
    this.workerConfig = { astcSupported: false, astcHDRSupported: false, etc1Supported: false, etc2Supported: false, dxtSupported: false, bptcSupported: false, pvrtcSupported: false }; return this;
  });
  vi.spyOn(KTX2Loader.prototype, 'init').mockResolvedValue(undefined);
  vi.spyOn(gpuFiles, 'texMode').mockReturnValue('ktx2');
  ktx2.initKtx2(legacyDouble<Renderer>({}));
  const made = detect.mock.contexts[0]; if (!(made instanceof KTX2Loader)) throw new Error('Missing configured KTX2 decoder'); decoder = made;
});
afterEach(() => { initializeTier(originalTier); });
afterAll(() => { decoder?.dispose(); vi.restoreAllMocks(); });

function glb(width: number): Uint8Array {
  const geometry = new THREE.BoxGeometry(width, 2, 3), material = new THREE.MeshStandardMaterial();
  try { return staticGlb([{ name: 'crate', geometry, material }]); } finally { geometry.dispose(); material.dispose(); }
}
function fixture() {
  const model = glb(2), phone = glb(8), pixels = Uint8ClampedArray.from({ length: 4 * 2 * 4 }, (_, index) => (index * 37 + 19) % 256);
  const atlas = bakeRawColourPixels({ width: 4, height: 2, pixels }), phonePixels = Uint8ClampedArray.from(pixels, value => 255 - value), phoneAtlas = bakeRawColourPixels({ width: 4, height: 2, pixels: phonePixels });
  const sampler = { wrapS: 10497, wrapT: 33071, minFilter: 9987, magFilter: 9729, anisotropy: 4, colourSpace: 'srgb' } as const;
  const asset = { url: { file: 'models/crate.glb', bytes: model.length }, phoneUrl: { file: 'models/crate-phone.glb', bytes: phone.length },
    atlas: { file: 'textures/crate.ktx2', bytes: atlas.length, ...sampler }, phoneAtlas: { file: 'textures/crate-phone.ktx2', bytes: phoneAtlas.length, ...sampler }, material: { id: 'crate-atlas', family: 'painterly' } as const };
  const rows = [{ key: 'crate', model: { id: 'fixture/crate', name: 'Crate', category: 'props', pipeline: 'code', file: 'fixture.json', defaults: {} }, source: { kind: 'asset', asset } }];
  const files = new Map([[asset.url.file, model], [asset.phoneUrl.file, phone], [asset.atlas.file, atlas], [asset.phoneAtlas.file, phoneAtlas]]);
  return { asset, rows, files, pixels, phonePixels, model, atlas };
}
function skyFixture(): SkyRig {
  const sky: unknown = Object.create(SkyRig.prototype); if (!(sky instanceof SkyRig)) throw new Error('Missing fixture sky');
  Reflect.set(sky, 'csm', { lights: [] }); Reflect.set(sky, 'sunDir', new THREE.Vector3(0, 1, 0));
  vi.spyOn(sky, 'setupMaterial').mockImplementation(() => undefined); return sky;
}
function isDataTexture(value: unknown): value is THREE.DataTexture { return value instanceof THREE.DataTexture; }
function pixelBytes(texture: THREE.Texture | null): Uint8Array {
  if (!isDataTexture(texture)) throw new Error('Missing product atlas texture');
  const data: unknown = texture.image.data; if (!(data instanceof Uint8Array)) throw new Error('Missing atlas pixels'); return data;
}

test.each(['desktop', 'phone'] as const)('selected %s geometry and atlas preserve every pixel and the complete sampler without asset fetches', async tier => {
  initializeTier(tier); const f = fixture(), sky = skyFixture(), selected = tier === 'phone' ? [f.asset.phoneUrl.file, f.asset.phoneAtlas.file] : [f.asset.url.file, f.asset.atlas.file];
  const read = vi.fn((name: string): Promise<Uint8Array> => { const bytes = f.files.get(name); if (bytes === undefined) throw new Error('Undeclared fixture file'); return Promise.resolve(bytes); });
  const nativeFetch = globalThis.fetch.bind(globalThis), fetch = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('data:application/wasm;base64,')) return Promise.reject(new Error('No specimen asset URL fallback')); return nativeFetch(input, init);
  });
  try {
    const files = await prepareSpecimenCatalogue({ file: read, hasFile: name => selected.includes(name) }, f.rows);
    expect(read.mock.calls.map(([name]) => name)).toEqual(selected);
    const asset = await loadBoundSpecimen(sky, f.asset, files);
    try {
      const pixels = tier === 'phone' ? f.phonePixels : f.pixels;
      expect(Buffer.compare(pixelBytes(asset.map), Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength))).toBe(0);
      expect(asset.geometry.boundingBox?.max.x).toBe(tier === 'phone' ? 4 : 1);
      expect(asset.map).toMatchObject({ wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter, anisotropy: 4, colorSpace: THREE.SRGBColorSpace, flipY: false, generateMipmaps: true, mipmaps: [] });
      expect(asset.material).toHaveProperty('map', asset.map);
      for (const [input] of fetch.mock.calls) expect(typeof input === 'string' && input.startsWith('data:application/wasm;base64,')).toBe(true);
    } finally { asset.geometry.dispose(); asset.material.dispose(); asset.map?.dispose(); }
  } finally { fetch.mockRestore(); }
});

test('missing, conflicting, legacy and ambiguous atlas bindings refuse before any product read', async () => {
  initializeTier('desktop'); const f = fixture(), read = vi.fn(() => Promise.resolve(f.model));
  await expect(prepareSpecimenCatalogue({ file: read, hasFile: name => name !== f.asset.atlas.file }, f.rows)).rejects.toThrow('Missing binary source');
  await expect(prepareSpecimenCatalogue({ file: read }, f.rows, undefined, [], [{ ...f.asset, atlas: { ...f.asset.atlas, bytes: f.asset.atlas.bytes + 1 } }])).rejects.toThrow('Conflicting binary source lengths');
  expect(() => prepareSpecimenCatalogue({ file: read }, [], undefined, [], [{ ...f.asset, atlas: { ...f.asset.atlas, file: f.asset.url.file, bytes: f.asset.url.bytes } }])).toThrow('Conflicting specimen source encodings');
  expect(() => prepareSpecimenCatalogue({ file: read }, [], undefined, [], [{ ...f.asset, url: '/assets/legacy/crate.glb' }])).toThrow('owned GLB');
  expect(() => prepareSpecimenCatalogue({ file: read }, [], undefined, [], [{ ...f.asset, material: { ...f.asset.material, texture: { url: '/assets/legacy/map.webp', phoneUrl: '/assets/legacy/map-phone.webp', name: 'map' } } }])).toThrow('Conflicting specimen atlas material');
  expect(read).not.toHaveBeenCalled();
});

test('wrong or malformed atlas bytes and unprepared definitions cannot publish a catalogue', async () => {
  initializeTier('desktop'); const f = fixture();
  const reader = (atlas: Uint8Array) => ({ file: (name: string): Promise<Uint8Array> => Promise.resolve(name === f.asset.url.file ? f.model : atlas) });
  await expect(prepareSpecimenCatalogue(reader(f.atlas.subarray(1)), f.rows)).rejects.toThrow('byte count');
  const invalid = f.atlas.slice(); invalid[0] = 0;
  await expect(prepareSpecimenCatalogue(reader(invalid), f.rows)).rejects.toThrow('KTX2');
  expect(() => defineSpecimenCatalogue(f.rows, undefined, {}, new Map([[f.asset.url.file, f.model]]))).toThrow('atlas source was not prepared');
});

test('equal model bytes with separate atlas identities do not alias materials, while a live hit shares its resources', async () => {
  initializeTier('desktop'); const f = fixture(), sky = skyFixture();
  const first = await loadBoundSpecimen(sky, f.asset, f.files), again = await loadBoundSpecimen(sky, f.asset, f.files);
  const secondFiles = new Map(f.files); secondFiles.set(f.asset.atlas.file, f.atlas.slice());
  const second = await loadBoundSpecimen(sky, f.asset, secondFiles);
  try {
    expect(again).toBe(first); expect(second.geometry).toBe(first.geometry); expect(second.map).not.toBe(first.map); expect(second.material).not.toBe(first.material);
    expect(second.material).toHaveProperty('map', second.map); expect(first.material).toHaveProperty('map', first.map);
  } finally { first.geometry.dispose(); first.material.dispose(); second.material.dispose(); first.map?.dispose(); second.map?.dispose(); }
});

test('a rejected atlas parse can retry the same prepared source', async () => {
  initializeTier('desktop'); const f = fixture(), sky = skyFixture(), error = new Error('Atlas decode refused');
  const parse = vi.spyOn(ktx2, 'parseKtx2Bytes').mockRejectedValueOnce(error);
  try {
    await expect(loadBoundSpecimen(sky, f.asset, f.files)).rejects.toBe(error);
    const asset = await loadBoundSpecimen(sky, f.asset, f.files);
    expect(pixelBytes(asset.map).length).toBe(f.pixels.length); expect(parse).toHaveBeenCalledTimes(2);
    asset.geometry.dispose(); asset.material.dispose(); asset.map?.dispose();
  } finally { parse.mockRestore(); }
});

test('retiring an atlas invalidates the bound result and reparses that source with a fresh material', async () => {
  initializeTier('desktop'); const f = fixture(), sky = skyFixture(), parse = vi.spyOn(ktx2, 'parseKtx2Bytes');
  const first = await loadBoundSpecimen(sky, f.asset, f.files);
  first.map?.dispose();
  const current = await loadBoundSpecimen(sky, f.asset, f.files);
  try {
    expect(current).not.toBe(first); expect(current.geometry).toBe(first.geometry);
    expect(current.map).not.toBe(first.map); expect(current.material).not.toBe(first.material);
    expect(current.material).toHaveProperty('map', current.map); expect(parse).toHaveBeenCalledTimes(2);
    expect(Buffer.compare(pixelBytes(current.map), Buffer.from(f.pixels))).toBe(0);
  } finally { first.geometry.dispose(); first.material.dispose(); current.material.dispose(); current.map?.dispose(); parse.mockRestore(); }
});

test('an owner retired during the atlas read cannot admit late bytes', async () => {
  initializeTier('desktop'); const f = fixture(), scope = new Scope('late-atlas');
  let finish: (bytes: Uint8Array) => void = () => { throw new Error('Missing atlas resolver'); }, started: () => void = () => { throw new Error('Missing atlas start'); };
  const waiting = new Promise<void>(resolve => { started = resolve; }), reply = new Promise<Uint8Array>(resolve => { finish = resolve; });
  const pending = prepareSpecimenCatalogue({ file: name => { if (name === f.asset.url.file) return Promise.resolve(f.model); started(); return reply; } }, f.rows, scope);
  await waiting; scope.dispose(); finish(f.atlas); await expect(pending).rejects.toThrow('retired');
});

test('Explorer, direct dressing and generated encounter adapters prepare the same admitted atlas', async () => {
  initializeTier('desktop'); const f = fixture(), book = 'models/cover-phone.json';
  const declared = emitNamedBlobs([...f.files].map(([name, bytes]) => nameBlob(name, name.endsWith('.ktx2') ? 'ktx2' : 'glb', bytes))
    .concat(nameBlob(book, 'json', new TextEncoder().encode(JSON.stringify({ rows: f.rows, materials: {} })), {jsonSchema:registeredJsonSchema(book)})));
  const product = createShardFolder({ slug: 'atlas-fixture', revision: 1,
    shardfile: emptyShardfile({ slug: 'atlas-fixture', name: 'Atlas fixture', author: 'Fixture', revision: 1, seed: 1 }),
    sections: new Map([['explore/catalogue', parseExplorerCatalogue({ version: 1, entries: [{ kind: 'specimen', id: 'atlas-crate', books: { phone: book, desktop: book }, model: 'crate' }] })]]),
    files: new Map(declared.files.flatMap(row => row.name === undefined ? [] : [[row.name, fixtureFolderFile(row.name, { hash: row.hash, url: row.hash })]])),
    jsonCheck:fixtureJsonCheck, read: hash => { const bytes = declared.assets.get(hash); if (bytes === undefined) throw new Error('Missing admitted atlas fixture'); return Promise.resolve(bytes); }, check: true });
  const sky = skyFixture(), registry = new WorldRegistry(), scope = new Scope('atlas-adapters'), root = new THREE.Group(), restore = bindFlatTerrain({ heightAt: () => 0 });
  try {
    const roster = await explorerRoster(product), card = roster[0]; if (card === undefined) throw new Error('Missing atlas Explorer card');
    card.list(modelContext(sky), () => [], registry);
    const model = registry.get('model:atlas-crate')?.model; if (model === undefined) throw new Error('Missing atlas Explorer model');
    const specimen = model.object(); await awaitSpecimenAssets(sky); await Promise.resolve();
    let mapped = 0;
    const inspect = (object: THREE.Object3D): void => { object.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      const material: unknown = child.material;
      if (!(material instanceof THREE.Material)) throw new Error('Missing adapter material');
      const map: unknown = Reflect.get(material, 'map');
      if (!isDataTexture(map)) throw new Error('Missing adapter atlas');
      expect(Buffer.compare(pixelBytes(map), Buffer.from(f.pixels))).toBe(0); mapped++;
    }); };
    inspect(specimen); expect(mapped).toBe(1);
    const ctx = legacyDouble<ShardContext>({ scope, root, product, system: vi.fn<ShardContext['system']>(), app: legacyDouble<ShardContext['app']>({ registry }),
      game: legacyDouble<ShardContext['game']>({ runtime: legacyDouble<NonNullable<ShardContext['game']['runtime']>>({ world: legacyDouble<NonNullable<NonNullable<ShardContext['game']['runtime']>['world']>>({ sky }) }) }) });
    const host = await SceneDressing.install(ctx, { name: 'atlas-adapter', catalogues: [], packs: {}, geometry: { crate: { kind: 'asset', row: f.asset } }, materials: { crate: { kind: 'asset', row: f.asset } },
      staticModels: [{ model: { id: 'fixture/atlas-statue', name: 'Statue', category: 'props', pipeline: 'code', file: 'fixture.json', defaults: {} }, geometry: 'crate', material: 'crate' }], layers: [], statics: [], animations: [],
      sites: [{ name: 'statues', model: 'fixture/atlas-statue', rows: { name: 'statues', label: 'Statue', file: 'fixture.json', surface: 'stone', variants: [''], variantCycle: [0], sink: 0,
        generated: f.asset, collider: { hw: 1, hd: 1, top: 2, bottom: 0 }, sites: [{ x: 1, z: 2, yaw: 0, scale: 1 }] } }] });
    await awaitSpecimenAssets(sky); await Promise.resolve();
    const site = host.sites.get('statues'); if (site === undefined) throw new Error('Missing generated atlas encounter');
    inspect(site.sites.object); expect(mapped).toBeGreaterThan(1); expect(SceneDressing.current(ctx)).toBe(host);
  } finally { scope.dispose(); restore(); }
  expect(root.children).toHaveLength(0);
});

const lifetime = 'live atlas geometry and materials release borrowed files and loader declarations';
test(lifetime, async () => {
  await realGc('test/specimen-product-atlas.test.ts', lifetime, async collect => {
    const prepare = async () => {
      initializeTier('desktop'); const f = fixture(), row = { ...f.asset, context: new Uint8Array(1024 * 1024) };
      return { asset: await loadBoundSpecimen(skyFixture(), row, f.files), row: new WeakRef(row), context: new WeakRef(row.context.buffer),
        files: new WeakRef(f.files), model: new WeakRef(f.model), modelBacking: new WeakRef(f.model.buffer), atlas: new WeakRef(f.atlas), atlasBacking: new WeakRef(f.atlas.buffer) };
    };
    const result = await prepare();
    for (const reference of [result.row, result.context, result.files, result.model, result.modelBacking, result.atlas, result.atlasBacking]) await collect(reference);
    expect(result.asset.geometry.getAttribute('position').count).toBe(24); expect(pixelBytes(result.asset.map).length).toBe(32);
    result.asset.geometry.dispose(); result.asset.material.dispose(); result.asset.map?.dispose();
  });
});
