// @vitest-environment node
// oxlint-disable-next-line import/no-nodejs-modules -- Real output folders reproduce the split-release failure.
import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The fixture stays under the repo tmp folder.
import {dirname, join, resolve} from 'node:path';
import {expect, test} from 'vitest';
import {r2Packs, serverPackOutputRoot} from '../src/scripts/page-release/packs.mjs';

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
