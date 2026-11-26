// oxlint-disable-next-line import/no-nodejs-modules -- The cook lists a folder store of its own and reads its own source.
import {mkdirSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The store lives under ./tmp.
import {join, resolve as resolvePath} from 'node:path';
import {expect, test} from 'vitest';
import {COOK_PREFIXES, collectGarbage, indexKey, reclaimPacks, storeUsage, type CookIndex} from '../src/cook/game/cookWorker';
import {folderStore, type PackStore} from '../src/cook/game/packStore';

// Meta Cloudflare audit CF4 (QA 11-26 row 12): the cook listed the whole packs bucket, 2.4 M objects (~2,400 R2 Class A
// calls and 10+ minutes a listing), most of them page content sets under `content/`, to measure and sweep its own ~10 k.
// Every listing now names one of the cook's prefixes.
const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

function counted(store: PackStore): {store: PackStore, prefixes: string[]} {
  const prefixes: string[] = [];
  return {prefixes, store: {...store, list: prefix => { prefixes.push(prefix); return store.list(prefix); }}};
}

test('usage, collection and the protected collection list only the cook prefixes, never the root or content/', async () => {
  mkdirSync('tmp', {recursive: true}); const root = mkdtempSync(resolvePath('tmp/cook-list-prefixes-'));
  try {
    const base = folderStore(join(root, 'store'));
    const put = (key: string, bytes = 1): Promise<void> => base.put(key, new Uint8Array(bytes), {type: 'application/octet-stream', cache: 'no-store'});
    const hash = 'a'.repeat(64), part = `assets/spawn/parts/${'1'.repeat(16)}.pack.br`;
    const index = {version: 1, build: 'live', slug: 'pine-hollow', hash, header: '', manifests: [], keys: [part], server: {bytes: 0, files: 0}, serverParts: []} as unknown as CookIndex;
    await base.put(indexKey('live', hash), encode(index), {type: 'application/json', cache: 'no-store'});
    await put(part, 5);
    await put(`loose/${hash}/shardfiles/pine-hollow/shard.json`, 7);
    await put('content/0123456789abcdef/assets/big.bin', 1000);
    await put('releases/staging.json');

    const usage = counted(base);
    const measured = await storeUsage(usage.store, 1e12);
    expect(measured.objects).toBe(3);
    expect(measured.bytes).toBe(5 + 7 + encode(index).length);

    const gc = counted(base);
    await collectGarbage(gc.store, ['live'], 1e12, Date.now() + 7_200_000);
    const reclaim = counted(base);
    await reclaimPacks(reclaim.store, {builds: ['live'], heads: new Set([hash])}, 1e12, Date.now() + 7_200_000);

    for (const prefix of [...usage.prefixes, ...gc.prefixes, ...reclaim.prefixes]) {
      expect(prefix === '' || prefix.startsWith('content/'), `listed "${prefix}"`).toBe(false);
      expect(COOK_PREFIXES.some(own => prefix.startsWith(own)), `listed "${prefix}"`).toBe(true);
    }
    expect((await base.list('content/')).map(row => row.key)).toEqual(['content/0123456789abcdef/assets/big.bin']);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('the cook worker source never lists the bucket root', () => {
  const source = readFileSync(resolvePath(import.meta.dirname, '../src/cook/game/cookWorker.ts'), 'utf8');
  expect(source).not.toMatch(/\.list\(\s*(['"`])\1\s*\)/u);
});
