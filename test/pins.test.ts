// J65's front door: a pin is the bytes the API serves for its hash, and nothing else gets into `out/`.
/* oxlint-disable import/no-nodejs-modules -- It runs the tool against a local server, as Node. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { restorePacks, type PackedIndex } from '../scripts/pin-packs.ts';
import { fetchPinnedPublicAssets, pinnedPublicAssets } from '../scripts/pin-assets.ts';

/** The tool's stderr, once it exits. */
const pinsTool = (cwd: string, env: NodeJS.ProcessEnv, ...args: readonly string[]): Promise<string> => new Promise(resolve => {
  const child = spawn(process.execPath, [resolvePath('scripts/pins.ts'), ...args], { cwd, env });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  child.on('close', () => { resolve(stderr); });
});
const install = (cwd: string, env: NodeJS.ProcessEnv): Promise<string> => pinsTool(cwd, env, 'install');
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
  const request:typeof fetch=async(input,init)=>{expect(String(input)).toBe(`https://raw.githubusercontent.com/project-wildshard/shard-dawn/${'a'.repeat(40)}/public/assets/dawn-isle/model.glb`);return fetch(`http://127.0.0.1:${address.port}`,init);};
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
  const env = { ...process.env, WILDSHARD_API: `http://127.0.0.1:${address.port}`, WILDSHARD_PIN_MIRROR: 'http://127.0.0.1:1', WILDSHARD_PIN_CACHE: join(root, 'cache') };
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
  for (const slug of rings['1']?.products ?? []) expect(heads.has(slug)).toBe(true);
  expect(slices.map(row => row.slug)).toEqual(rings['1']?.slices);
  for (const row of slices) expect(heads.get(row.slug)).toBe(row.from);
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
