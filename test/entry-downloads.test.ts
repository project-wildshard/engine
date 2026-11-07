import {expect, test, vi} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Own and remove the complete output-metadata fixture.
import {mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Address only this fixture's owned files.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Pin original metadata bytes exactly like the compiler.
import {createHash} from 'node:crypto';
import {emptyShardfile} from '@wildshard/engine/host/author';
import {outputSectionPayloads} from '@wildshard/format/outputFields';
import {writeEntryBootstrap, writeSpawnManifests} from '../scripts/app-build/appCook';
import {readSpawnManifest} from '../src/shared/game/shardfile/spawnManifest';
import {serverPackPart} from '../src/shared/game/shardfile/serverPack';
import {gridEntryDownloads} from '../src/cook/game/gridEntryDownloads';
import {startGridStripDownload, gridStripDownloadRows} from '../src/client/game/grid/entryDownloads';
import {entryReadSet} from '../src/cook/game/entryReadSet';
import {wholeGeometryInputs} from '../src/shared/game/shardfile/wholeInputs';

test('named native assembly declares the same ordered whole inputs it actually reads', () => {
  const source = emptyShardfile({slug: 'example', name: 'Example', author: 'Test', revision: 1, seed: 1});
  const [fine, extra, coarse, library] = ['1', '2', '3', '4'].map(value => value.repeat(64));
  if (fine === undefined || extra === undefined || coarse === undefined || library === undefined) throw new Error('Missing input fixture');
  source.props = {version: 1, family: 'fixture', tiles: [
    {lod: 0, x: 6, z: 4, file: fine, additionalFiles: [extra]}, {lod: 0, x: 7, z: 4, file: fine},
    {lod: 1, x: 3, z: 2, file: coarse},
  ], wholeLibrary: [library], models: [], panels: [], colliders: [], textures: [], far: null};
  source.files.push(...[fine, extra, coarse, library].map(hash => ({hash, kind: 'glb' as const, compressed: 1,
    decoded: 1, gpu: 0, triangles: 0, draws: 0, dependencies: [], critical: false})));
  source.library.push(library);
  // Input order and duplicates form the native geometry-cache identity.
  expect(wholeGeometryInputs(source.props, false)).toEqual([fine, extra, fine]);
  expect(wholeGeometryInputs(source.props, true)).toEqual([fine, extra, fine, library]);
  const index = {files: source.files.map(row => ({...row, kind: 'glb' as const, path: `blobs/glb/${row.hash}.glb`})), sections: [], schemas: []};
  const required = entryReadSet(source, 'phone', index, new Map());
  expect([...required]).toEqual([library]);
  const sections = new Map<string, unknown>([['client/plan', {version: 1, features: [
    {kind: 'world.assembly', library: 'fixture', catalogue: 'models.json', rows: {stages: [{kind: 'group', id: 'root', label: 'Root', part: 'root'}]}},
  ]}]]);
  const named = entryReadSet(source, 'phone', index, sections);
  expect([...named]).toEqual([library, fine, extra]); expect(named.has(coarse)).toBe(false);
});

test('DL20: a read a phone recorded stays in its set, whatever tier the file is tagged', () => {
  const source = emptyShardfile({slug: 'example', name: 'Example', author: 'Test', revision: 1, seed: 1});
  const [recorded, other] = ['5', '6'].map(value => value.repeat(64));
  if (recorded === undefined || other === undefined) throw new Error('Missing input fixture');
  source.files.push(...[recorded, other].map(hash => ({hash, kind: 'glb' as const, compressed: 1, decoded: 1, gpu: 0, triangles: 0, draws: 0, dependencies: [], critical: false})));
  const index = {files: source.files.map(row => ({...row, kind: 'glb' as const, path: `blobs/glb/${row.hash}.glb`, tier: 'desktop' as const})), sections: [], schemas: []};
  expect([...entryReadSet(source, 'phone', index, new Map(), false, new Set([recorded]))]).toEqual([recorded]);
});

test('plain build publishes exact tier spawn files and rejects changed section bytes', async () => {
  mkdirSync('tmp/entry-downloads', {recursive: true});
  const root = mkdtempSync(resolve('tmp/entry-downloads/compiler-')), product = resolve(root, 'out/example'), out = resolve(root, 'dist');
  const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
  try {
    mkdirSync(product, {recursive: true}); mkdirSync(resolve(out, 'assets'), {recursive: true});
    const source = emptyShardfile({slug: 'example', name: 'Example', author: 'Test', revision: 1, seed: 1});
    const bodies = ['000', '111', '222'], hashes = bodies.map(digest);
    mkdirSync(resolve(product, 'blobs/bin'), {recursive: true});
    hashes.forEach((hash, i) => {writeFileSync(resolve(product, `blobs/bin/${hash}.bin`), bodies[i] ?? '');});
    const files = hashes.map((hash, i) => ({hash, kind: 'bin' as const, name: `${i}.bin`, path: `blobs/bin/${hash}.bin`,
      compressed: 3, decoded: 3, gpu: 0, triangles: 0, draws: 0, dependencies: [], critical: false,
      ...i < 2 ? {tier: i === 0 ? 'phone' as const : 'desktop' as const} : {}}));
    source.files.push(...files.map(({tier: _tier, path: _path, name: _name, ...row}) => ({...row, kind: 'binary' as const})));
    source.library.push(...hashes); source.late = [{hash: hashes[2] ?? ''}];
    source.budgets.library = {compressed: 9, resident: 9};
    const sections = [...outputSectionPayloads(source)].map(([name, value]) => {
      const path = `sections/${name}.json`, text = JSON.stringify(value);
      mkdirSync(resolve(product, path, '..'), {recursive: true}); writeFileSync(resolve(product, path), text);
      return {name, path, bytes: Buffer.byteLength(text), hash: digest(text), schema: `wildshard:${name}@1`};
    });
    const packs = hashes.map((hash, i) => ({path: `blobs/pack/${digest(`pack-${i}`)}.pack`, hash: digest(`pack-${i}`), bytes: 3, entries: [{hash, offset: 0, bytes: 3}]}));
    const index = {format: 'wildshard.shardfile', formatVersion: 2, sdk: '0.2', version: source.version, identity: source.identity,
      build: {sourceHash: digest('source'), validator: 'test'}, requires: source.requires,
      admission: {budgets: source.budgets, serverBudget: source.serverBudget, authorCaps: source.authorCaps,
        critical: source.critical, library: source.library, late: source.late}, sections, schemas: [], files, packs, runtime: null};
    const indexBytes = JSON.stringify(index); writeFileSync(resolve(product, 'shard.json'), indexBytes);
    // The default (Shardfile) book: each tier's own file. The packs book (DL16, Runtime packs) is the whole level and
    // adds the untiered late library file: 'late' is only a schedule.
    const expected = Buffer.byteLength(indexBytes) + sections.reduce((sum, row) => sum + row.bytes, 0) + 3;
    const manifests = await writeSpawnManifests(out, {common: [], client: [], grid: [], selection: {}, optional: {files: [], groups: {}},
      products: {'/shardfiles/example/': [Buffer.byteLength(indexBytes), 1_000_000]}, extras: {}, code: {entries: {}}}, {}, root);
    const spawn = manifests.client['example']; if (spawn === undefined) throw new Error('Missing spawn manifests');
    expect(spawn.phone.totalBytes).toBe(expected); expect(spawn.desktop.totalBytes).toBe(expected);
    const phone = readFileSync(resolve(out, spawn.phone.url.slice(1)), 'utf8');
    expect(phone).toContain(hashes[0]); expect(phone).not.toContain(hashes[1]); expect(phone).not.toContain(hashes[2]);
    const whole = manifests.packs.client['example']; if (whole === undefined) throw new Error('Missing packs manifests');
    expect(whole.phone.totalBytes).toBe(expected + 3);
    const wholePhone = readFileSync(resolve(out, whole.phone.url.slice(1)), 'utf8');
    expect(wholePhone).toContain(hashes[0]); expect(wholePhone).not.toContain(hashes[1]); expect(wholePhone).toContain(hashes[2]);
    // DL15: each part row carries its q11 body's exact size, the file the build serves.
    const wholeParts = readSpawnManifest(JSON.parse(wholePhone)).parts ?? [];
    expect(wholeParts.length).toBeGreaterThan(0);
    for (const part of wholeParts) expect(part.wireBytes).toBe(statSync(resolve(out, part.url.slice(1))).size);
    const moduleBank = {common: [], client: [], grid: [], selection: {}, optional: {files: [], groups: {}},
      products: {'/shardfiles/example/': [Buffer.byteLength(indexBytes), 1_000_000]}, extras: {}};
    writeFileSync(resolve(out, 'index.html'), `<head><script type="application/json" id="boot-module-files">${JSON.stringify(moduleBank)}</script></head>`);
    writeFileSync(resolve(out, 'version.json'), JSON.stringify({build: 'fixture-build'}));
    await writeEntryBootstrap(out, root);
    const html = readFileSync(resolve(out, 'index.html'), 'utf8'), match = /id="boot-module-files">([^<]+)</u.exec(html);
    const bank: unknown = JSON.parse(match?.[1] ?? 'null');
    if (typeof bank !== 'object' || bank === null) throw new Error('Missing complete compiler bank');
    // DL16: the page's bank is the default book only; the packs book is this build's own file.
    const published: unknown = Reflect.get(bank, 'spawnManifests'), {packs: packsBook, serverPacks, ...defaults} = manifests;
    expect(Object.values(serverPacks).filter(pack => serverPackPart(pack, 'shard.json') !== undefined)).toHaveLength(Object.keys(serverPacks).length);
    expect(published).toEqual(defaults); expect(html).not.toContain('"packs"'); expect(html).not.toContain('/assets/spawn/parts/');
    expect(JSON.parse(readFileSync(resolve(out, 'assets/spawn/packs-fixture-build.json'), 'utf8'))).toEqual({book: 'packs', build: 'fixture-build', cacheName: manifests.cacheName, ...packsBook});
    expect(html).not.toContain('entryTotals'); expect(html).not.toContain('installEntryTransport');
    expect(html).not.toContain('blobs/pack');
    const first = sections[0]; if (first === undefined) throw new Error('Missing original section');
    writeFileSync(resolve(product, first.path), '{}');
    await expect(writeEntryBootstrap(out, root)).rejects.toThrow('Spawn section differs from index');
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('grid tap selects only its original mode/home page, never outer or another layout', () => {
  mkdirSync('tmp/entry-downloads', {recursive: true});
  const root=mkdtempSync(resolve('tmp/entry-downloads/grid-')),folder=resolve(root,'out/.app');
  const digest=(value:string):string=>createHash('sha256').update(value).digest('hex');
  try {
    mkdirSync(resolve(folder,'grid-strip-pages'),{recursive:true});
    const source=digest('layout'),other=digest('other-layout');
    const header={url:`/assets/grid-strip-page-${digest('header').slice(0,8)}.json`,bytes:3,sha256:digest('header')};
    const body={url:`/assets/grid-strip-mesh-${digest('body').slice(0,8)}.bin`,bytes:3,sha256:digest('body')};
    const text=JSON.stringify({version:1,pages:[{source,home:'example',header,body},{source,home:'example:outer',header,body}]});
    const directory={url:`/assets/grid-strip-book-${digest(text).slice(0,8)}.json`,bytes:Buffer.byteLength(text),sha256:digest(text)};
    writeFileSync(resolve(folder,'grid-strip-pages',directory.url.split('/').at(-1)??''),text);
    writeFileSync(resolve(folder,'grid-strip-index.json'),JSON.stringify({geometry:{directory,homes:['example','example:outer']}}));
    writeFileSync(resolve(folder,'grid-strip-entry-modes.json'),JSON.stringify({'100':source,'000':other}));
    const rows=gridEntryDownloads(root);
    expect(rows['100']).toEqual({example:[directory,header,body]});expect(rows['000']).toEqual({});
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    vi.stubGlobal('document',{getElementById:()=>({textContent:JSON.stringify({gridEntryDownloads:rows})})});
    const read=vi.spyOn(globalThis,'fetch').mockImplementation(()=>Promise.resolve(new Response(new Uint8Array([1,2,3]))));
    try {
      expect(gridStripDownloadRows({developer:true,devserver:false,nineDragon:false},'example')).toEqual([directory,header,body].map(({url,bytes})=>({url,bytes})));
      expect(read).not.toHaveBeenCalled();
      startGridStripDownload({developer:false,devserver:false,nineDragon:false},'example');expect(read).not.toHaveBeenCalled();
      startGridStripDownload({developer:true,devserver:false,nineDragon:false},'example');
      expect(read.mock.calls.map(([url])=>url)).toEqual([directory.url,header.url,body.url]);
      for(const [,options]of read.mock.calls)expect(options).toMatchObject({keepalive:true,priority:'low'});
      startGridStripDownload({developer:true,devserver:false,nineDragon:false},'example:outer');expect(read).toHaveBeenCalledTimes(3);
      vi.stubGlobal('document',{getElementById:()=>({textContent:JSON.stringify({gridEntryDownloads:{'100':{example:[directory,header,{url:'/outside.bin',bytes:1}]}}})})});
      expect(gridStripDownloadRows({developer:true,devserver:false,nineDragon:false},'example')).toEqual([]);
      startGridStripDownload({developer:true,devserver:false,nineDragon:false},'example');expect(read).toHaveBeenCalledTimes(3);
    }finally{
      if (previousDocument === undefined) Reflect.deleteProperty(globalThis, 'document');
      else Object.defineProperty(globalThis, 'document', previousDocument);
      read.mockRestore();
    }
    writeFileSync(resolve(folder,'grid-strip-pages',directory.url.split('/').at(-1)??''),'{}');
    expect(()=>gridEntryDownloads(root)).toThrow('Grid entry directory differs');
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('grid metadata can cross navigation while geometry waits for code and stays document-owned', () => {
  const directory = {url: '/assets/grid-strip-book-aaaaaaaa.json', bytes: 3};
  const header = {url: '/assets/grid-strip-page-bbbbbbbb.json', bytes: 3};
  const body = {url: '/assets/grid-strip-mesh-cccccccc.bin', bytes: 3};
  const mode = {developer: true, devserver: false, nineDragon: false};
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  vi.stubGlobal('document', {getElementById: () => ({textContent: JSON.stringify({gridEntryDownloads: {'100': {example: [directory, header, body]}}})})});
  const read = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response(new Uint8Array([1, 2, 3]))));
  try {
    startGridStripDownload(mode, 'example', 'metadata');
    expect(read.mock.calls.map(([url]) => url)).toEqual([directory.url, header.url]);
    expect(read.mock.calls.every(([, options]) => options?.keepalive === true && options.priority === 'low')).toBe(true);
    // The composition root calls this phase only after its code barrier.
    startGridStripDownload(mode, 'example', 'mesh');
    expect(read.mock.calls.map(([url]) => url)).toEqual([directory.url, header.url, body.url]);
    expect(read.mock.calls[2]?.[1]).toMatchObject({keepalive: false, priority: 'low'});
  } finally {
    if (previousDocument === undefined) Reflect.deleteProperty(globalThis, 'document');
    else Object.defineProperty(globalThis, 'document', previousDocument);
    read.mockRestore();
  }
});
