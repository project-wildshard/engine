import { expect, test } from 'vitest';
import { writtenBundle } from '../scripts/app-build/writtenBundle';
import { buildWithBootModules } from './fixtures/written-build';
import { emptyShardfile } from '@wildshard/engine/host/author';
// oxlint-disable-next-line import/no-nodejs-modules -- Own and remove the tiny compiler fixture.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve fixture files without changing cwd.
import { resolve, dirname } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Give the fixture its actual admitted hashes.
import { createHash } from 'node:crypto';
import { sceneSourceUrls, homeExtraFiles } from '../scripts/app-build/bootExtras';
import { homeClientModuleGroups, productDownloadTotal } from '../scripts/app-build/bootProducts';

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

test('a real emitted image and admitted source produce only the selected home bank', async () => {
  mkdirSync('tmp/vite-boot-extras', { recursive: true });
  const root = mkdtempSync(resolve('tmp/vite-boot-extras/case-'));
  try {
    mkdirSync(resolve(root, 'src/shards/home'), { recursive: true });
    mkdirSync(resolve(root, 'public/assets/physics'), { recursive: true });
    mkdirSync(resolve(root, 'out/home'), { recursive: true });
    mkdirSync(resolve(root, 'out/.app'), { recursive: true });
    writeFileSync(resolve(root, 'src/card.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>');
    writeFileSync(resolve(root, 'src/preview.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><circle r="2"/></svg>');
    writeFileSync(resolve(root, 'src/card.ts'), 'import url from "./card.svg"; import preview from "./preview.svg"; export const value = [url, preview];');
    mkdirSync(resolve(root, 'src/client/game/shardfile'), { recursive: true });
    writeFileSync(resolve(root, 'src/client/game/shardfile/client.ts'), 'export const client = 1;');
    mkdirSync(resolve(root, 'src/client/game/grid'), { recursive: true });
    writeFileSync(resolve(root, 'src/client/game/grid/session.ts'), 'export const grid = 1;');
    writeFileSync(resolve(root, 'out/.app/discovery.home.generated.ts'), 'export default { slug: "home" };');
    writeFileSync(resolve(root, 'src/catalogueRows.ts'), 'export { default as home } from "../out/.app/discovery.home.generated";');
    writeFileSync(resolve(root, 'src/client/app/entry.ts'), "window.client = () => import('./game/client/shardfile/client'); window.grid = () => import('./game/client/grid/session'); window.selected = () => import('../out/.app/discovery.home.generated'); window.catalogue = () => import('./catalogueRows'); async function startSelected() { return import('./card'); } void startSelected();");
    writeFileSync(resolve(root, 'index.html'), '<html><head></head><body><script type="module" src="/src/client/app/entry.ts"></script></body></html>');
    writeFileSync(resolve(root, 'public/assets/required.webp'), new Uint8Array(3));
    writeFileSync(resolve(root, 'public/assets/model.glb'), new Uint8Array(11));
    mkdirSync(resolve(root, 'src/client/game/data'), { recursive: true });
    writeFileSync(resolve(root, 'public/assets/pickup.bin'), new Uint8Array(17));
    const geometry = { attrs: [], count: 0, index: null, indexCount: 0, box: false, expand: false };
    writeFileSync(resolve(root, 'src/client/game/data/pickupCatalogue.json'), JSON.stringify({
      file: 'pickups', seed: 1, coin: 'coin', looks: [], geometries: [
        { key: 'coin', seed: 1, geometry, file: '/assets/pickup.bin' },
        { key: 'shared', seed: 1, geometry, file: '/assets/pickup.bin' },
        { key: 'inline', seed: 1, geometry, data: 'inline' },
      ],
    }));
    writeFileSync(resolve(root, 'public/assets/early.webp'), new Uint8Array(5));
    writeFileSync(resolve(root, 'public/assets/late.webp'), new Uint8Array(7));
    writeFileSync(resolve(root, 'public/assets/physics/rapier.wasm'), new Uint8Array(13));
    const source = emptyShardfile({ slug: 'home', name: 'Home', author: 'Test', revision: 1, seed: 9 });
    const models = JSON.stringify({ rows: { meshes: ['one'], meshUrls: { one: '/assets/model.glb', unused: '/assets/never.glb' }, hd: [], hdUrls: {},
      rigs: { bodies: { creatures: ['owned', 'public'], urls: { owned: 'geometry/rigs/body.glb', public: '/assets/model.glb' } } } } });
    const hash = createHash('sha256').update(models).digest('hex'), sourcePath = `blobs/json/${hash}.json`;
    mkdirSync(resolve(root, 'out/home/blobs/json'), { recursive: true });
    writeFileSync(resolve(root, 'out/home', sourcePath), models);
    const sections = Object.entries({ 'quests/host': { questHost: { page: { version: 1 } } },
      'ui/level': { manifest: { card: { thumb: '/shardfiles/home/blobs/image/card.jpg', portrait: 'data:,', landscape: 'data:,' },
        explore: { art: { world: '/shardfiles/home/blobs/image/preview.jpg' } }, boot: { precache: ['/assets/required.webp'] } } },
      'look/painted': { look: { sky: { kind: 'strips', row: { strips: [{ key: 'early', url: '/assets/early.webp' }, { key: 'late', url: '/assets/late.webp' }] } } } },
      'world/scenes': { version:1,libraries: [{ id:'fixture-models',kind: 'models', file: 'source.json' }],materials:[],steps:[] } }).map(([name, rows]) => {
      const value = JSON.stringify(rows), path = `sections/${name}.json`;
      mkdirSync(dirname(resolve(root, 'out/home', path)), { recursive: true });
      writeFileSync(resolve(root, 'out/home', path), value);
      return { name, path, bytes: Buffer.byteLength(value), hash: createHash('sha256').update(value).digest('hex'), schema: `wildshard:${name}@1` };
    });
    const rig = new Uint8Array(19), rigHash = createHash('sha256').update(rig).digest('hex'), rigPath = `blobs/glb/${rigHash}.glb`;
    mkdirSync(resolve(root, 'out/home/blobs/glb'), { recursive: true }); writeFileSync(resolve(root, 'out/home', rigPath), rig);
    const index = { format: 'wildshard.shardfile', formatVersion: 2, sdk: '0.2', version: source.version, identity: source.identity,
      requires: source.requires, build: { sourceHash: hash, validator: 'test' },
      admission: { budgets: source.budgets, serverBudget: source.serverBudget, authorCaps: source.authorCaps, critical: source.critical, library: source.library },
      sections, schemas: [], files: [{ name: 'source.json', kind: 'json', path: sourcePath, hash, compressed: Buffer.byteLength(models), decoded: Buffer.byteLength(models), gpu: 0, triangles: 0, draws: 0, dependencies: [], critical: false },
        { name: 'geometry/rigs/body.glb', kind: 'glb', path: rigPath, hash: rigHash, compressed: rig.length, decoded: rig.length, gpu: 0, triangles: 0, draws: 0, dependencies: [], critical: false }], runtime: null };
    writeFileSync(resolve(root, 'out/home/shard.json'), JSON.stringify(index));
    expect(homeClientModuleGroups(root, 'home')).toContain('models.gltf');
    const outDir = await buildWithBootModules(root, { assetsInlineLimit: 0 });
    const rows = homeExtraFiles(root, 'home');
    if (rows === null) throw new Error('Missing declared home files');
    // A shard's own images count in its product's bank, so no row names them.
    expect(rows.some(([file]) => file.startsWith('/shardfiles/'))).toBe(false);
    expect(rows).toEqual([['/assets/required.webp', 3], ['/assets/model.glb', 11], ['/assets/pickup.bin', 17], ['/assets/physics/rapier.wasm', 13], ['/assets/early.webp', 5], ['/assets/late.webp', 7]].sort(([left], [right]) => String(left).localeCompare(String(right))));
    const metadataName = Object.keys(writtenBundle(outDir, root)).find(name => /^assets\/boot-home-[a-f0-9]{8}\.json$/u.test(name));
    if (metadataName === undefined) throw new Error('Missing per-home metadata');
    const metadata = readFileSync(resolve(outDir, metadataName), 'utf8');
    expect(JSON.parse(metadata)).toEqual(rows);
    const html = readFileSync(resolve(outDir, 'index.html'), 'utf8');
    expect(html).toContain(`/${metadataName}`);
    expect(html).not.toContain('/assets/model.glb');
    expect(html).toContain(createHash('sha256').update(metadata).digest('hex'));
    const cataloguePath = resolve(root, 'src/client/game/data/pickupCatalogue.json');
    const originalCatalogue = readFileSync(cataloguePath, 'utf8');
    const originalRows: unknown = JSON.parse(originalCatalogue);
    if (typeof originalRows !== 'object' || originalRows === null) throw new Error('Missing pickup fixture');
    const bankBytes = readFileSync(resolve(root, 'public/assets/pickup.bin'));
    writeFileSync(resolve(root, 'public/assets/pickup-bank.bin'), bankBytes);
    try {
      writeFileSync(cataloguePath, JSON.stringify({ ...originalRows, banks: [{ file: '/assets/pickup-bank.bin', bytes: bankBytes.length,
        members: [{ file: '/assets/pickup.bin', offset: 0, bytes: bankBytes.length, sha256: createHash('sha256').update(bankBytes).digest('hex') }] }] }));
      const banked = homeExtraFiles(root, 'home');
      expect(banked).toEqual(rows.map(([file, bytes]) => [file === '/assets/pickup.bin' ? '/assets/pickup-bank.bin' : file, bytes])
        .sort(([left], [right]) => String(left).localeCompare(String(right))));
      expect(banked?.filter(([file]) => file === '/assets/pickup-bank.bin')).toHaveLength(1);
      expect(banked).not.toContainEqual(['/assets/pickup.bin', 17]);
    } finally { writeFileSync(cataloguePath, originalCatalogue); }
    const withoutRig = { ...index, files: index.files.filter(file => file.hash !== rigHash) };
    expect(productDownloadTotal(index, 100)[1] - productDownloadTotal(withoutRig, 100)[1]).toBe(rig.length);
    writeFileSync(resolve(root, 'out/home/shard.json'), JSON.stringify(withoutRig));
    expect(() => homeExtraFiles(root, 'home')).toThrow('Unsafe boot source URL');
    writeFileSync(resolve(root, 'out/home/shard.json'), JSON.stringify(index));
    const native = JSON.stringify({ rows: { meshes: [], meshUrls: {}, hd: [], hdUrls: {},
      geometryPools: [{ url: 'geometry/rigs/body.glb', parts: ['body'], native: { first: true } }],
      rigs: { bodies: { creatures: ['body'], urls: { body: 'geometry/rigs/body.glb' } } }, rigLoad: 'manual' } });
    writeFileSync(resolve(root, 'out/home', sourcePath), native);
    const nativeIndex = { ...index, files: [{ ...index.files[0], name: 'source.json', kind: 'json', path: sourcePath,
      compressed: Buffer.byteLength(native), decoded: Buffer.byteLength(native), hash: createHash('sha256').update(native).digest('hex') }] };
    writeFileSync(resolve(root, 'out/home/shard.json'), JSON.stringify(nativeIndex));
    expect(homeClientModuleGroups(root, 'home')).toContain('models.gltf');
    const manual = JSON.stringify({ rows: { meshes: [], hd: [], rigs: { bodies: { creatures: ['body'] } }, rigLoad: 'manual' } });
    writeFileSync(resolve(root, 'out/home', sourcePath), manual);
    writeFileSync(resolve(root, 'out/home/shard.json'), JSON.stringify({ ...nativeIndex, files: [{ ...nativeIndex.files[0],
      compressed: Buffer.byteLength(manual), decoded: Buffer.byteLength(manual), hash: createHash('sha256').update(manual).digest('hex') }] }));
    expect(homeClientModuleGroups(root, 'home')).not.toContain('models.gltf');
    writeFileSync(resolve(root, 'out/home/shard.json'), JSON.stringify(index));
    writeFileSync(resolve(root, 'out/home', sourcePath), '{}');
    expect(() => homeClientModuleGroups(root, 'home')).toThrow('differs from its index');
    expect(() => homeExtraFiles(root, 'home')).toThrow('differs from its index');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
