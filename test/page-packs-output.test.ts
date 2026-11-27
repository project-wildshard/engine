// @vitest-environment node
// oxlint-disable-next-line import/no-nodejs-modules -- Match the real R2 publisher's command seam.
import type {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Real book descriptors hash decoded pack bytes.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Real output folders reproduce the split-release failure.
import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The fixture stays under the repo tmp folder.
import {dirname, join, resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Parts use the same wire encoding as the page release.
import {brotliCompressSync,brotliDecompressSync} from 'node:zlib';
import {expect, test} from 'vitest';
import {r2Packs, serverPackOutputRoot} from '../src/scripts/page-release/packs.mjs';
import {COOKED_BUCKET,COOKED_ORIGIN} from '../src/shared/game/shardfile/cookedPackPaths';
import {serverPackBookPath} from '../src/shared/game/shardfile/serverPack';

test('server publication reads the split content folder and keeps joined releases working', () => {
  const parent = resolve('tmp/page-packs-output-test'); mkdirSync(parent, {recursive: true});
  const root = mkdtempSync(join(parent, 'release-')), book = 'assets/spawn/server-build.json';
  const write = (folder: string): void => { const file = join(root, folder, book); mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, '{}'); };
  try {
    expect(() => serverPackOutputRoot(root, book)).toThrow('missing');
    write('dist-content');
    expect(serverPackOutputRoot(root, book)).toBe(join(root, 'dist-content'));
    write('dist');
    expect(serverPackOutputRoot(root, book)).toBe(join(root, 'dist'));
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('server publication retries a disconnected CDN read and a 503 before admitting the exact book', async (): Promise<void> => {
  const parent = resolve('tmp/page-packs-output-test');
  mkdirSync(parent, {recursive:true});
  const root = mkdtempSync(join(parent, 'retry-'));
  const build = 'a'.repeat(40), cors = 'https://stage.example.test';
  const book = JSON.stringify({book:'server', build, shards:{}});
  const file = join(root, 'dist-content', 'assets', 'spawn', `server-${build}.json`);
  mkdirSync(dirname(file), {recursive:true});
  writeFileSync(file, book);
  symlinkSync(resolve('src'), join(root, 'src'), 'dir');
  let reads = 0;
  const store = r2Packs({log:(): void => undefined, sleep:(): Promise<void> => Promise.resolve(),
    fetch:(): Promise<Response> => {
      reads++;
      if (reads === 1) return Promise.reject(new TypeError('fetch failed'));
      if (reads === 2) return Promise.resolve(new Response(null, {status:503}));
      return Promise.resolve(new Response(book, {headers:{'access-control-allow-origin':cors}}));
    }});
  try {
    await expect(store.verify({root, build, cors})).resolves.toMatchObject({parts:0});
    expect(reads).toBe(3);
  } finally { rmSync(root, {recursive:true, force:true}); }
});

test('road publication verifies its cooked parts before writing a grid-only book', async (): Promise<void> => {
  const parent = resolve('tmp/page-packs-output-test');
  mkdirSync(parent,{recursive:true});
  const root = mkdtempSync(join(parent,'grid-'));
  const build = 'c'.repeat(40), cors = 'https://staging.wildshard.io';
  const gridBody = Buffer.from('road strips'), gridWire = brotliCompressSync(gridBody);
  const grid = {url:'/assets/spawn/server/cccccccccccccccc.pack.br', bytes:gridBody.length, wireBytes:gridWire.length,
    hash:createHash('sha256').update(gridBody).digest('hex'), files:[['grid',0,gridBody.length]]};
  const book = {book:'server',build,shards:{'one-shard':grid},grid};
  const bookPath = serverPackBookPath(build), stored = new Map<string,Buffer>(), writes: string[] = [];
  const bookAt = (bucket: string): string => `${bucket}/${bookPath}`;
  const gridAt = (bucket: string): string => `${bucket}${grid.url}`;
  const cooked = new URL(COOKED_ORIGIN).origin;
  try {
    for (const [path,body] of [[bookPath,JSON.stringify(book)], [grid.url.slice(1),gridWire]] as const) {
      const file = join(root,'dist',path);
      mkdirSync(dirname(file),{recursive:true});
      writeFileSync(file,body);
    }
    symlinkSync(resolve('src'),join(root,'src'),'dir');
    const put = (_tool: string,args: readonly string[]): Buffer => {
      const key = args[3] ?? '', path = args[args.indexOf('--file')+1] ?? '';
      const bytes = readFileSync(path);
      writes.push(key);
      stored.set(key,args.includes('--content-encoding') ? brotliDecompressSync(bytes) : bytes);
      return Buffer.alloc(0);
    };
    const store = r2Packs({log:(): void => undefined, exec:put as typeof execFileSync,
      fetch:(input): Promise<Response> => {
        const url = new URL(String(input));
        const bucket = url.origin === cooked ? COOKED_BUCKET : 'wildshard-packs';
        const body = stored.get(`${bucket}${url.pathname}`);
        return Promise.resolve(new Response(body === undefined ? null : new Uint8Array(body),
          {status:body === undefined ? 404 : 200, headers:{'access-control-allow-origin':cors}}));
      }});
    await store.publish({root,build,cors,dryRun:false});
    expect(writes).toEqual([gridAt('wildshard-packs'),gridAt(COOKED_BUCKET),bookAt(COOKED_BUCKET),bookAt('wildshard-packs')]);
    expect(JSON.parse(stored.get(bookAt(COOKED_BUCKET))?.toString() ?? '')).toEqual({...book,shards:{}});
    await store.verify({root,build,cors});
    await store.publish({root,build,cors,dryRun:false});
    expect(writes).toHaveLength(4);
    stored.delete(gridAt(COOKED_BUCKET));
    await expect(store.verify({root,build,cors})).rejects.toThrow(grid.url);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
