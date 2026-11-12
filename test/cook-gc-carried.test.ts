// oxlint-disable-next-line import/no-nodejs-modules -- The collector runs against a folder store of its own.
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The store lives under ./tmp.
import {join, resolve as resolvePath} from 'node:path';
import {expect, test} from 'vitest';
import {collectGarbage, indexKey, type CookIndex} from '../src/cook/game/cookWorker';
import {folderStore} from '../src/cook/game/packStore';
import {serverPackBookPath, type ServerPackBook} from '../src/shared/game/shardfile/serverPack';

/** PAGE-SIZE PZ5: a carried build reads its book, parts and content from R2, so gc keeps every build a channel carries. */
const part = (hex: string): {url: string; bytes: number; hash: string; wireBytes: number; files: [string, number, number][]} =>
  ({url: `/assets/spawn/server/${hex.repeat(16)}.pack.br`, bytes: 1, hash: hex.repeat(64), wireBytes: 1, files: [['shard.json', 0, 1]]});
const book = (build: string, main: string, more: string, grid: string): ServerPackBook =>
  ({book: 'server', build, shards: {'pine-hollow': {...part(main), more: [part(more)]}}, grid: part(grid)});
const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

test('gc keeps a carried build\'s server book and every part it names, and never a content set', async () => {
  mkdirSync('tmp', {recursive: true}); const root = mkdtempSync(resolvePath('tmp/cook-gc-carried-'));
  try {
    const store = folderStore(join(root, 'store')), put = (key: string, body: Uint8Array = new Uint8Array(1)): Promise<void> => store.put(key, body, {type: 'application/octet-stream', cache: 'no-store'});
    // live: the build a channel serves now, with a cook index; carried: an older build the channel still carries, with only
    // its book and parts (page-release packs.mjs); gone: a build no channel names any more.
    const index: CookIndex = {version: 1, build: 'live', slug: 'pine-hollow', hash: 'a'.repeat(64), header: '', manifests: [], keys: ['assets/spawn/parts/1111111111111111.pack.br'], server: {bytes: 0, files: 0}, serverPack: undefined, proof: 'proved', seconds: 0} as unknown as CookIndex;
    await put(indexKey('live', index.hash), encode(index)); await put(index.keys[0] ?? '');
    await put(serverPackBookPath('live'), encode(book('live', 'a', 'b', 'c')));
    await put(serverPackBookPath('carried'), encode(book('carried', 'd', 'e', 'c')));
    await put(serverPackBookPath('gone'), encode(book('gone', 'f', 'e', 'c')));
    for (const hex of ['a', 'b', 'c', 'd', 'e', 'f']) await put(part(hex).url.slice(1));
    await put('content/609da07f7448e19d/content.json'); await put('content/609da07f7448e19d/assets/spawn/parts/2222222222222222.pack.br');
    await put('assets/spawn/parts/3333333333333333.pack.br');

    const report = await collectGarbage(store, ['live', 'carried'], 1e12, Date.now() + 7_200_000);
    const left = (await store.list('')).map(row => row.key);
    // The carried build's book and each of its parts, its own and the one it shares with the live build, survive.
    for (const key of [serverPackBookPath('carried'), part('d').url.slice(1), part('e').url.slice(1), part('c').url.slice(1)]) expect(left, key).toContain(key);
    for (const key of [serverPackBookPath('live'), part('a').url.slice(1), part('b').url.slice(1), indexKey('live', index.hash), index.keys[0] ?? '']) expect(left, key).toContain(key);
    expect(left).toContain('content/609da07f7448e19d/content.json');
    expect(left).toContain('content/609da07f7448e19d/assets/spawn/parts/2222222222222222.pack.br');
    // What only the dropped build or nobody names goes.
    for (const key of [serverPackBookPath('gone'), part('f').url.slice(1), 'assets/spawn/parts/3333333333333333.pack.br']) expect(left, key).not.toContain(key);
    expect(report.deleted).toBe(3);
  } finally {rmSync(root, {recursive: true, force: true});}
});
