import {expect, test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Own and remove the isolated compiler fixture.
import {mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep all fixture writes inside the repository.
import {resolve} from 'node:path';
import {readPacksSet, writeSpawnManifests} from '../scripts/app-build/appCook';
import {desktopFence} from '../src/cook/game/entryTotals';
import {emptyShardfile} from '@wildshard/engine/host/author';
import {outputSectionPayloads} from '@wildshard/format/outputFields';
// oxlint-disable-next-line import/no-nodejs-modules -- Pin this compiler fixture's original bytes.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Match the deployed precompressed native representation exactly.
import {brotliCompressSync, constants} from 'node:zlib';
import {readBuiltSpawnManifest} from '../src/cook/game/engineHalf';
import {downloadSpawnManifest} from '../src/client/game/boot/spawnDownload';

test('spawn manifests prioritize code stably without changing bytes or the complete download barrier', async () => {
  mkdirSync('tmp/entry-totals', {recursive: true});
  const root = mkdtempSync(resolve('tmp/entry-totals/fixture-'));
  try {
    const output = resolve(root, 'dist'), product = resolve(root, 'out/example');
    mkdirSync(resolve(output, 'assets'), {recursive: true}); mkdirSync(product, {recursive: true});
    const digest = (text: string): string => createHash('sha256').update(text).digest('hex');
    const source = emptyShardfile({slug: 'example', name: 'Example', author: 'Test', revision: 1, seed: 1});
    const sections = [...outputSectionPayloads(source)].map(([name, value]) => {
      const path = `sections/${name}.json`, text = JSON.stringify(value);
      mkdirSync(resolve(product, path, '..'), {recursive: true}); writeFileSync(resolve(product, path), text);
      return {name, path, bytes: Buffer.byteLength(text), hash: digest(text), schema: `wildshard:${name}@1`};
    });
    const index = JSON.stringify({format: 'wildshard.shardfile', formatVersion: 2, sdk: '0.2', version: source.version, identity: source.identity,
      build: {sourceHash: digest('source'), validator: 'test'}, requires: source.requires,
      admission: {budgets: source.budgets, serverBudget: source.serverBudget, authorCaps: source.authorCaps,
        critical: source.critical, library: source.library, late: source.late}, sections, schemas: [], files: [], runtime: null});
    writeFileSync(resolve(product, 'shard.json'), index);
    const metadata = Buffer.byteLength(index) + sections.reduce((sum, row) => sum + row.bytes, 0);
    for (const [name, bytes] of [['shared.js', 10], ['client.js', 20], ['grid.js', 30], ['model.js', 5], ['seam.bin', 9]] as const)
      writeFileSync(resolve(output, 'assets', name), new Uint8Array(bytes));
    const input = {common: [['/assets/shared.js', 10]], client: [['/assets/client.js', 20]], grid: [['/assets/shared.js', 10], ['/assets/grid.js', 30]],
      optional: {files: [['/assets/shared.js', 10], ['/assets/model.js', 5]], groups: {'home:/shardfiles/example/': [0, 1]}},
      products: {'/shardfiles/example/': [3, 1000, 100, 200]}, extras: {},
      code: {entries: {example: ['/assets/code/pack.pack', 7, 100, [0]]}}};
    const strips = {'100': {example: [{url: '/assets/seam.bin', bytes: 9}]}};
    const totals = await writeSpawnManifests(output, input, strips, root);
    expect(totals.client['example']?.phone.totalBytes).toBe(metadata + 35);
    expect(totals.grid['100']?.['example']?.phone.totalBytes).toBe(metadata + 54);
    expect(await writeSpawnManifests(output, input, strips, root)).toEqual(totals);
    const address = totals.client['example']?.phone; if (address === undefined) throw new Error('Missing manifest');
    const text = readFileSync(resolve(output, address.url.slice(1)), 'utf8');
    expect(address.wireBytes).toBeDefined(); expect(address.wireBytes).toBeLessThan(address.totalBytes);
    expect(text).not.toContain('code/pack.pack');
    await expect(writeSpawnManifests(output, {...input, products: {'/shardfiles/example/': [3, -1]}}, {}, root)).rejects.toThrow();
    await expect(writeSpawnManifests(output, {...input, optional: {...input.optional, groups: {'home:/shardfiles/example/': [9]}}}, {}, root)).rejects.toThrow('module index');
    const physics=Uint8Array.from({length:4096},(_byte,i)=>(i*77+i%7)%251),physicsPath=resolve(root,'public/assets/physics/rapier.wasm');
    mkdirSync(resolve(physicsPath,'..'),{recursive:true});writeFileSync(physicsPath,physics);
    const native=await writeSpawnManifests(output,input,strips,root),nativeAddress=native.client['example']?.phone;
    if(nativeAddress===undefined)throw new Error('Missing native manifest');
    const nativeManifest=readBuiltSpawnManifest(output,nativeAddress);
    const row=nativeManifest.files.find(file=>file.url.startsWith('/assets/physics/rapier.wasm?'));
    expect(row?.bytes).toBe(physics.length);
    expect(row?.wireBytes).toBe(brotliCompressSync(physics,{params:{[constants.BROTLI_PARAM_QUALITY]:11}}).length);
    const original = readBuiltSpawnManifest(output, address);
    // Adding native code changes no existing URL, hash, size or relative order.
    expect(nativeManifest.files.filter(file => file !== row)).toEqual(original.files);
    const code = nativeManifest.files.filter(file => /\.(?:js|wasm)(?:\?|$)/u.test(file.url));
    expect(code.map(file => new URL(file.url, 'https://example.test').pathname)).toEqual([
      '/assets/physics/rapier.wasm', '/assets/shared.js', '/assets/client.js', '/assets/model.js',
    ]);
    expect(nativeManifest.files.slice(0, code.length)).toEqual(code);
    const content = nativeManifest.files.slice(code.length);
    expect(content.map(file => new URL(file.url, 'https://example.test').pathname)).toEqual([
      '/shardfiles/example/shard.json', ...sections.map(section => `/shardfiles/example/${section.path}`),
    ]);
    let release = (): void => {throw new Error('Missing content release');};
    const held = new Promise<void>(_resolve => {release = _resolve;});
    let codeReady = (): void => {throw new Error('Missing code observation');};
    const codeDone = new Promise<void>(_resolve => {codeReady = _resolve;});
    const reads: string[] = [];
    const download = downloadSpawnManifest(nativeAddress, {cached: () => Promise.resolve(undefined), fetch: async url => {
      if (new URL(url).pathname.startsWith('/assets/spawn/')) return new Response(readFileSync(resolve(output, new URL(url).pathname.slice(1))));
      const file = nativeManifest.files.find(candidate => new URL(candidate.url, 'https://example.test').href === url);
      if (file === undefined) throw new Error('Unexpected spawn file');
      reads.push(file.url);
      if (content.includes(file)) await held;
      return new Response(new Uint8Array(file.bytes));
    }}, 'https://example.test');
    download.subscribe(snapshot => {if (snapshot.filesDone === code.length) codeReady();});
    let complete = false;
    void download.ready.then(() => {complete = true; return undefined;});
    await codeDone;
    expect(reads.slice(0, code.length)).toEqual(code.map(file => file.url));
    expect(complete).toBe(false);
    expect(download.snapshot()).toMatchObject({complete: false, filesDone: code.length, totalBytes: nativeAddress.totalBytes});
    release(); await download.ready;
    expect(download.snapshot()).toMatchObject({complete: true, filesDone: nativeAddress.files, completedBytes: nativeAddress.totalBytes});
    expect([...reads].sort()).toEqual(nativeManifest.files.map(file => file.url).sort());
    expect(await writeSpawnManifests(output,input,strips,root)).toEqual(native);
  } finally {rmSync(root, {recursive: true, force: true});}
});

// DL5 (G1012): a shard's packs book holds the whole level unless its folder says 'fence' (Pine: what its boot reads
// before control); a malformed choice fails the build rather than silently packing the whole level.
test('a shard packs the whole level unless its packs-set.json selects the fence set', () => {
  mkdirSync('tmp/entry-totals', {recursive: true});
  const root = mkdtempSync(resolve('tmp/entry-totals/packs-set-'));
  try {
    const file = resolve(root, 'packs-set.json');
    expect(readPacksSet(file)).toBe('whole');
    writeFileSync(file, JSON.stringify({version: 1, set: 'fence'}));
    expect(readPacksSet(file)).toBe('fence');
    for (const bad of [{version: 1, set: 'whole'}, {version: 2, set: 'fence'}, {version: 1, set: 'fence', extra: true}]) {
      writeFileSync(file, JSON.stringify(bad)); expect(() => readPacksSet(file)).toThrow();
    }
    expect(readPacksSet(resolve('src/shards/pine-hollow/packs-set.json'))).toBe('fence');
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('S3: a desktop reads a phone fence read as its own copy, and a phone pack as nothing', () => {
  const urls = ['/assets/gpu/npcs/trader.glb', '/assets/gpu/npcs/trader-0e7c7ea7.glb', '/assets/gpu/npcs/trader.phone-50f93677.glb',
    '/assets/gpu/fire.desktop-9ecfac78.gltf', '/assets/gpu/fire.phone-9f8b3138.gltf', '/assets/baked/rain.bin', '/assets/baked/rain.phone.bin',
    '/assets/packs/pine-hollow.phone-d343d44d.bin', '/assets/baked/navmesh.bin'];
  expect(desktopFence(['/assets/gpu/npcs/trader.phone-50f93677.glb', '/assets/gpu/fire.phone-9f8b3138.gltf', '/assets/baked/rain.phone.bin',
    '/assets/packs/pine-hollow.phone-d343d44d.bin', '/assets/baked/navmesh.bin'], urls))
    .toEqual(['/assets/gpu/npcs/trader-0e7c7ea7.glb', '/assets/gpu/fire.desktop-9ecfac78.gltf', '/assets/baked/rain.bin', '/assets/baked/navmesh.bin']);
});

test('S4: a desktop reads a 6×6 overlay read as its own copy, whatever the overlay file is named', () => {
  const urls = ['/assets/gpu/npcs/trader-0e7c7ea7.glb', '/assets/gpu/tex/wall/diffuse-1a2b3c4d.ktx2', '/assets/pine-hollow/astc6/npcs/trader.phone-11112222.glb', '/assets/pine-hollow/astc6/tex/wall/diffuse-33334444.ktx2'];
  expect(desktopFence(['/assets/pine-hollow/astc6/npcs/trader.phone-11112222.glb', '/assets/pine-hollow/astc6/tex/wall/diffuse-33334444.ktx2'], urls))
    .toEqual(['/assets/gpu/npcs/trader-0e7c7ea7.glb', '/assets/gpu/tex/wall/diffuse-1a2b3c4d.ktx2']);
});
