// J65's front door: a pin is the bytes the API serves for its hash, and nothing else gets into `out/`.
/* oxlint-disable import/no-nodejs-modules -- It runs the tool against a local server, as Node. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { restorePacks, type PackedIndex } from '../src/scripts/pin-packs.ts';
import { fetchPinnedPublicAssets, pinnedPublicAssets } from '../src/scripts/pin-assets.ts';
import {wholeBrasscapProduct} from '../src/scripts/pin-format.ts';
import {writeTar} from '@wildshard/format/tar';
import {openShardfile, serverRows} from '../src/cook/game/shardCook';

/** The tool's stderr, once it exits. */
const pinsTool = (cwd: string, env: NodeJS.ProcessEnv, ...args: readonly string[]): Promise<string> => new Promise(resolve => {
  const child = spawn(process.execPath, [resolvePath('src/scripts/pins.ts'), ...args], { cwd, env });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  child.on('close', () => { resolve(stderr); });
});
const install = (cwd: string, env: NodeJS.ProcessEnv): Promise<string> => pinsTool(cwd, env, 'install');
/** Stderr without the format's deprecation warnings: a pinned head on an old spelling still installs (FP6, format 0.68). */
const refusals = (stderr: string): string => stderr.split('\n').filter(line => line !== '' && !line.startsWith('warning ')).join('\n');
const pins = JSON.parse(readFileSync('test/pins/shardfiles.json', 'utf8')) as { api: string; shards: { slug: string; revision: number; hash: string; bytes: number }[] };
const servers: Server[] = [], folders: string[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

test('frozen product image fallbacks retain exact producer bytes and reject a corrupted pin',()=>{
  const root=mkdtempSync(resolvePath('tmp/pinned-images-'));folders.push(root);
  mkdirSync(join(root,'test/pins'),{recursive:true});
  const local=JSON.parse(readFileSync('test/pins/assets.json','utf8')) as {version:number;assets:{remote?:true}[]};
  writeFileSync(join(root,'test/pins/assets.json'),JSON.stringify({...local,assets:local.assets.filter(row=>row.remote!==true)}));
  cpSync('test/pins/assets',join(root,'test/pins/assets'),{recursive:true});
  const manifest=JSON.parse(readFileSync(join(root,'test/pins/assets.json'),'utf8')) as {assets:{file:string;slug:string;url:string;source:{path:string}}[]};
  const owners=[...new Set(manifest.assets.map(row=>row.slug))];
  const all=pinnedPublicAssets(root,owners);
  expect(all.map(row=>row.url)).toEqual(manifest.assets.map(row=>row.url));
  for(const owner of owners)expect(pinnedPublicAssets(root,[owner]).map(row=>row.url)).toEqual(manifest.assets.filter(row=>row.slug===owner).map(row=>row.url));
  const first=manifest.assets[0];if(first===undefined)throw new Error('Expected a real fallback asset');
  const file=join(root,first.file),body=readFileSync(file);
  writeFileSync(file,Buffer.concat([body,Buffer.from([0])]));
  expect(()=>pinnedPublicAssets(root,owners)).toThrow('Pinned public asset bytes differ');
  writeFileSync(file,body);
  const alias=first.url.replace('/tex/','/tex/./');
  manifest.assets[0]={...first,url:alias,source:{...first.source,path:`public${alias}`}};
  writeFileSync(join(root,'test/pins/assets.json'),JSON.stringify({version:1,...manifest}));
  expect(()=>pinnedPublicAssets(root,owners)).toThrow('Invalid pinned public asset');
  manifest.assets[0]={...first,file:'../outside.jpg'};
  writeFileSync(join(root,'test/pins/assets.json'),JSON.stringify({version:1,...manifest}));
  expect(()=>pinnedPublicAssets(root,owners)).toThrow('Invalid pinned public asset');
});

test('remote fallback publication refuses wrong and oversized HTTP bodies and verifies its held cache',async()=>{
  const root=mkdtempSync(resolvePath('tmp/pinned-http-'));folders.push(root);
  const body=Buffer.from('authored fallback model'),sha256=createHash('sha256').update(body).digest('hex');
  const row={slug:'dawn-isle',url:'/assets/dawn-isle/model.glb',file:`test/pins/assets/${sha256}.glb`,sha256,bytes:body.length,remote:true,
    source:{repo:'shard-dawn',commit:'a'.repeat(40),path:'public/assets/dawn-isle/model.glb',blob:createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex')}};
  mkdirSync(join(root,'test/pins'),{recursive:true});writeFileSync(join(root,'test/pins/assets.json'),JSON.stringify({version:1,assets:[row]}));
  let reply=Buffer.from('wrong'),requests=0;
  const server=createServer((_,response)=>{requests++;response.end(reply);});servers.push(server);
  await new Promise<void>(resolve=>{server.listen(0,'127.0.0.1',()=>{resolve();});});
  const address=server.address();if(address===null||typeof address==='string')throw new Error('No fixture port');
  let expectedUrl=`https://raw.githubusercontent.com/project-wildshard/shard-dawn/${'a'.repeat(40)}/public/assets/dawn-isle/model.glb`;
  const request:typeof fetch=(input,init)=>{expect(input).toBe(expectedUrl);return fetch(`http://127.0.0.1:${address.port}`,init);};
  const cache=join(root,'cache');
  await expect(fetchPinnedPublicAssets(root,undefined,cache,request)).rejects.toThrow('Pinned public asset bytes differ');
  expect(existsSync(cache)).toBe(false);
  reply=Buffer.concat([body,Buffer.from('extra')]);
  await expect(fetchPinnedPublicAssets(root,undefined,cache,request)).rejects.toThrow('Pinned public asset bytes differ');
  expect(existsSync(cache)).toBe(false);
  reply=body;await fetchPinnedPublicAssets(root,undefined,cache,request);
  expect(Buffer.from(pinnedPublicAssets(root,undefined,cache)[0]?.body??[])).toEqual(body);
  await fetchPinnedPublicAssets(root,undefined,cache,request);expect(requests).toBe(3);
  writeFileSync(join(cache,`${sha256}.glb`),Buffer.alloc(body.length));
  await expect(fetchPinnedPublicAssets(root,undefined,cache,request)).rejects.toThrow('Pinned public asset bytes differ');
  expect(requests).toBe(3);
  const held=join(cache,`${sha256}.glb`),temporary=`${held}.${process.pid}`,victim=join(root,'unrelated-file');
  rmSync(held);writeFileSync(victim,'untouched');symlinkSync(victim,temporary);
  await expect(fetchPinnedPublicAssets(root,undefined,cache,request)).rejects.toThrow('EEXIST');
  expect(readFileSync(victim,'utf8')).toBe('untouched');expect(existsSync(temporary)).toBe(true);
  rmSync(temporary);
  const legacy={...row,source:{...row.source,repo:'Raynos/project-wildshard-singleplayer'}};
  const unselected={...row,slug:'night-isle',url:'/assets/night-isle/model.glb',sha256:'f'.repeat(64),file:`test/pins/assets/${'f'.repeat(64)}.glb`,source:{...row.source,path:'public/assets/night-isle/model.glb'}};
  writeFileSync(join(root,'test/pins/assets.json'),JSON.stringify({version:1,assets:[legacy,unselected]}));
  expectedUrl=`https://raw.githubusercontent.com/Raynos/project-wildshard-singleplayer/${'a'.repeat(40)}/public/assets/dawn-isle/model.glb`;
  await fetchPinnedPublicAssets(root,['absent'],cache,request);expect(requests).toBe(4);
  await fetchPinnedPublicAssets(root,['dawn-isle'],cache,request);expect(requests).toBe(5);
  expect(pinnedPublicAssets(root,['dawn-isle'],cache).map(asset=>asset.url)).toEqual([row.url]);
  expect(existsSync(join(cache,`${'f'.repeat(64)}.glb`))).toBe(false);
});

test('every pin names a live head by its hash, and the catalogue holds the same heads', () => {
  expect(pins.api).toBe('https://api.wildshard.io');
  const { shards } = JSON.parse(readFileSync('test/pins/catalogue.json', 'utf8')) as { shards: { slug: string; hash: string }[] };
  const heads = new Map(shards.map(row => [row.slug, row.hash]));
  expect(pins.shards.length).toBeGreaterThan(0);
  for (const pin of pins.shards) {
    expect(pin.hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(pin.bytes).toBeGreaterThan(0);
    expect(heads.get(pin.slug)).toBe(pin.hash);
  }
});

test('every asset mount of an installed head is published', () => {
  for (const folder of existsSync('out') ? readdirSync('out') : []) {
    const file = join('out', folder, 'cook.json');
    if (!existsSync(file)) continue;
    const { mounts } = JSON.parse(readFileSync(file, 'utf8')) as { mounts?: readonly { url: string }[] };
    expect((mounts ?? []).map(row => row.url).filter(url => /^\/(?:assets|programs)\//u.test(url) && !existsSync(`public${url}`))).toEqual([]);
  }
});

test('bytes that are not the pin never reach the cache or out/', async () => {
  const body = Buffer.from('not the shardfile the pin names');
  const hash = createHash('sha256').update('the pinned bytes').digest('hex');
  const server = createServer((_, response) => { response.end(body); });
  servers.push(server);
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', () => { resolve(); }); });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No port');
  const root = mkdtempSync(join(tmpdir(), 'pins-'));
  folders.push(root);
  mkdirSync(join(root, 'test/pins'), { recursive: true });
  writeFileSync(join(root, 'test/pins/shardfiles.json'), JSON.stringify({ api: 'local', shards: [{ slug: 'tampered', revision: 1, hash, bytes: body.length }] }));
  writeFileSync(join(root, 'package.json'), '{}');
  writeFileSync(join(root, 'pnpm-lock.yaml'), '');
  // The dead mirror is a miss that may pass, so the tool retries it (QA 11-25 row 39); this test is about the bytes, so
  // the retries wait 1 ms, not 5 s and 20 s (main AMBER 110dedfc1e: this file at 60.2 s of 60 s, 26 s of it here).
  const env = { ...process.env, WILDSHARD_API: `http://127.0.0.1:${address.port}`, WILDSHARD_PIN_MIRROR: 'http://127.0.0.1:1', WILDSHARD_PIN_CACHE: join(root, 'cache'), WILDSHARD_PIN_RETRY_MS: '1' };
  expect(await install(root, env)).toMatch(/is not the pin/u);
  expect(existsSync(join(root, 'cache'))).toBe(false);
  expect(existsSync(join(root, 'out/tampered'))).toBe(false);
});

/** A tree with one pin, whose API answers 404 and whose mirror holds `held` by hash, as a head J85 dropped. */
async function droppedHead(held: boolean): Promise<{ root: string; env: NodeJS.ProcessEnv; hash: string }> {
  const body = Buffer.from('a pinned tarball'), hash = createHash('sha256').update(body).digest('hex');
  const server = createServer((request, response) => {
    if (held && request.url === `/mirror/${hash}.tar`) { response.end(body); return; }
    response.statusCode = 404;
    response.end();
  });
  servers.push(server);
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', () => { resolve(); }); });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No port');
  const root = mkdtempSync(join(tmpdir(), 'pins-'));
  folders.push(root);
  mkdirSync(join(root, 'test/pins'), { recursive: true });
  writeFileSync(join(root, 'test/pins/shardfiles.json'), JSON.stringify({ api: 'local', shards: [{ slug: 'dropped', revision: 1, hash, bytes: body.length }] }));
  return { root, hash, env: { ...process.env, WILDSHARD_API: `http://127.0.0.1:${address.port}`, WILDSHARD_PIN_MIRROR: `http://127.0.0.1:${address.port}/mirror`, WILDSHARD_PIN_CACHE: join(root, 'cache') } };
}

test('a head the API has dropped still installs from the mirror (J85)', async () => {
  const { root, env, hash } = await droppedHead(true);
  expect(await pinsTool(root, env, 'keep', 'kept')).toBe('');
  expect(createHash('sha256').update(readFileSync(join(root, 'kept', `${hash}.tar`))).digest('hex')).toBe(hash);
});

test('a head neither source holds stops the build, and says so', async () => {
  const { root, env } = await droppedHead(false);
  expect(await pinsTool(root, env, 'keep', 'kept')).toMatch(/neither the mirror nor the API holds/u);
});

test('a slice comes from the head it was cut from, and Ring 1 names only pinned products', () => {
  const rings = JSON.parse(readFileSync('test/pins/rings.json', 'utf8')) as Record<string, { products: string[]; slices: string[] }>;
  const { slices } = JSON.parse(readFileSync('test/pins/slices.json', 'utf8')) as { slices: { slug: string; from: string; hash: string }[] };
  const heads = new Map(pins.shards.map(row => [row.slug, row.hash]));
  // J434: every Ring 1 product is a pinned head (Brasscap Mesa and Dunes); none is a retired template.
  for (const slug of rings['1']?.products ?? []) expect(heads.has(slug)).toBe(true);
  expect(rings['1']?.products.filter(slug => /template/u.test(slug))).toEqual([]);
  expect(slices.map(row => row.slug)).toEqual(rings['1']?.slices);
  for (const row of slices) expect(heads.get(row.slug)).toBe(row.from);
});

/** A pinned Brasscap Mesa head and its Ring 1 server slice, served by a local API whose mirror holds nothing. */
async function sliceFixture() {
  const root = mkdtempSync(resolvePath('tmp/pin-slice-rebuild-')); folders.push(root);
  const product = wholeBrasscapProduct(), shard = openShardfile(product.bytes);
  const files = new Map(serverRows(shard).map(row => [row.path, shard.read(row.path)]));
  const body = writeTar(files), hash = createHash('sha256').update(body).digest('hex');
  const row = {slug: product.pin.slug, from: product.pin.hash, hash, bytes: body.length, files: files.size};
  mkdirSync(join(root, 'test/pins'), {recursive: true});
  const save = (name: string, value: unknown): void => { writeFileSync(join(root, 'test/pins', name), JSON.stringify(value)); };
  save('shardfiles.json', {api: 'local', shards: [product.pin]});
  save('assets.json', {version: 1, assets: []});
  save('slices.json', {slices: [row]});
  save('rings.json', {'1': {products: [row.slug], slices: [row.slug]}});
  save('catalogue.json', {shards: [{slug: row.slug}], placements: [], grid: {cells: []}});
  const server = createServer((request, response) => {
    if (request.url === `/api/shardfiles/${product.pin.hash}`) response.end(product.bytes);
    else {response.statusCode = 404; response.end();}
  }); servers.push(server);
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (address === null || typeof address === 'string') throw new Error('No fixture port');
  const origin = `http://127.0.0.1:${address.port}`, cache = join(root, 'cache');
  const env = {...process.env, WILDSHARD_API: origin, WILDSHARD_PIN_MIRROR: `${origin}/mirror`, WILDSHARD_PIN_CACHE: cache, GIT_CEILING_DIRECTORIES: root};
  return {root, env, row, hash, body, cache, save, shard};
}

// Split from one test (main red 45456209066: its seven tool runs passed the 30 s timeout on a loaded hosted runner,
// 7 s alone); the same facts, each half under the limit with room (RULES 11).
test('a missing mirrored slice rebuilds exact pinned bytes', async () => {
  const {root, env, row, hash, body, cache, shard} = await sliceFixture();
  expect(refusals(await install(root, env))).toBe('');
  const full = join(root, 'out', row.slug, 'validation.json'), before = readFileSync(full);
  expect(existsSync(join(root, 'out/.slices', row.slug))).toBe(false);
  expect(refusals(await pinsTool(root, env, 'install', '--ring-slices', '1'))).toBe('');
  expect(readFileSync(join(root, 'out/.slices', row.slug, 'shard.json'))).toEqual(Buffer.from(shard.header));
  expect(readFileSync(full)).toEqual(before);
  expect(existsSync(join(root, 'out/.ring-catalogue.json'))).toBe(false);
  expect(refusals(await pinsTool(root, env, 'install', '--ring', '1'))).toBe('');
  expect(readFileSync(join(cache, `${hash}.tar`))).toEqual(Buffer.from(body));
  expect(readFileSync(join(root, 'out/.slices', row.slug, 'shard.json'))).toEqual(Buffer.from(shard.header));
});

test('a missing mirrored slice refuses changed descriptors and another head', async () => {
  const {root, env, row, hash, cache, save} = await sliceFixture();
  // A refusal also removes the slice a good install left.
  expect(refusals(await pinsTool(root, env, 'install', '--ring', '1'))).toBe('');
  expect(existsSync(join(root, 'out/.slices', row.slug))).toBe(true);
  for (const changed of [{hash: '0'.repeat(64)}, {bytes: row.bytes + 1}, {files: row.files + 1}]) {
    rmSync(join(cache, `${hash}.tar`), {force: true});
    save('slices.json', {slices: [{...row, ...changed}]});
    expect(await pinsTool(root, env, 'install', '--ring', '1')).toContain('reconstructed slice differs from the pin');
    expect(existsSync(join(root, 'out/.slices', row.slug))).toBe(false);
  }
  save('slices.json', {slices: [{...row, from: '0'.repeat(64)}]});
  expect(await pinsTool(root, env, 'install', '--ring', '1')).toContain('slice belongs to another head');
});

test('a pack a thin head left out comes back from its members, and a carried one stays as it came', () => {
  const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
  const row = (path: string, text: string): { path: string; hash: string; bytes: number } => ({ path, hash: sha(text), bytes: text.length });
  const index = { sections: [row('sections/a.json', 'ab')], schemas: [], files: [row('blobs/json/b.json', 'cde')],
    packs: [{ path: 'blobs/pack/left.pack', hash: sha('abcde'), bytes: 5, entries: [{ hash: sha('ab'), offset: 0, bytes: 2 }, { hash: sha('cde'), offset: 2, bytes: 3 }] },
      { path: 'blobs/pack/held.pack', hash: sha('ab'), bytes: 2, entries: [{ hash: sha('ab'), offset: 0, bytes: 2 }] }] } as unknown as PackedIndex;
  const files = new Map(([['sections/a.json', 'ab'], ['blobs/json/b.json', 'cde'], ['blobs/pack/held.pack', 'ab']] as const).map(([path, text]) => [path, Buffer.from(text)] as [string, Uint8Array]));
  const restored = restorePacks(index, files);
  expect([...restored.keys()]).toStrictEqual(['blobs/pack/left.pack']);
  expect(Buffer.from(restored.get('blobs/pack/left.pack') ?? []).toString()).toBe('abcde');
  files.delete('blobs/json/b.json');
  expect(() => restorePacks(index, files)).toThrow(/blobs\/json\/b.json/u);
});
