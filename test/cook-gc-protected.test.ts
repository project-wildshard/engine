// oxlint-disable-next-line import/no-nodejs-modules -- The collector runs against a folder store of its own.
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The store lives under ./tmp.
import {join, resolve as resolvePath} from 'node:path';
import {expect, test} from 'vitest';
import {indexKey, needsReclaim, reclaimPacks, type CookIndex} from '../src/cook/game/cookWorker';
import {folderStore} from '../src/cook/game/packStore';

// J505 (QA-FEEDBACK-2026-11-23-b; Jake, 2026-11-23 ~20:40 Cancún: "make it a permanent fix"): the 4 GB pack store (J89)
// refused a publish and codex-ms ran a protected GC by hand. reclaimPacks is that collection: the kept builds whole, and
// from any build the index of every protected head with what it names; a publish runs it under 15% headroom.
const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
const index = (build: string, hex: string, part: string): CookIndex => ({version: 1, build, slug: 'pine-hollow', hash: hex.repeat(64), header: '', manifests: [],
  keys: [`assets/spawn/parts/${part.repeat(16)}.pack.br`], server: {bytes: 0, files: 0}, serverParts: []} as unknown as CookIndex);

test('a protected collection keeps a live head\'s index from an old build, and takes an unprotected one', async () => {
  mkdirSync('tmp', {recursive: true}); const root = mkdtempSync(resolvePath('tmp/cook-gc-protected-'));
  try {
    const store = folderStore(join(root, 'store')), put = (key: string, body: Uint8Array = new Uint8Array(1)): Promise<void> => store.put(key, body, {type: 'application/octet-stream', cache: 'no-store'});
    // current: the cook's build; old: a build no channel names, which cooked a head that is still live (a) and one nobody
    // names any more (b)
    const current = index('current', 'c', '3'), live = index('old', 'a', '1'), gone = index('old', 'b', '2');
    for (const row of [current, live, gone]) { await put(indexKey(row.build, row.hash), encode(row)); await put(row.keys[0] ?? ''); }
    const foreign = ['content/609da07f7448e19d/content.json', 'releases/staging-placements.json',
      'releases/production-placements.json', 'releases/staging.json', 'index/catalogue.json',
      'another-service/index/old/row.json', 'assets/telemetry/report.json'];
    for (const key of foreign) await put(key);

    const fresh = indexKey('retired', 'd'.repeat(64));
    await put(fresh, encode(index('retired', 'd', '4')));
    const runAt = Date.now() + 7_200_000;
    const withFreshIndex = {
      ...store,
      list: async (prefix: string) => (await store.list(prefix)).map(row =>
        row.key === fresh ? {...row, modified: runAt - 60_000} : row),
    };

    const report = await reclaimPacks(withFreshIndex, {builds: ['current'], heads: new Set([live.hash])}, 1e12, runAt);
    const left = (await store.list('')).map(row => row.key);
    for (const key of [indexKey('current', current.hash), current.keys[0] ?? '', indexKey('old', live.hash), live.keys[0] ?? '', ...foreign]) expect(left, key).toContain(key);
    for (const key of [indexKey('old', gone.hash), gone.keys[0] ?? '']) expect(left, key).not.toContain(key);
    expect(left).toContain(fresh);
    expect(report.deleted).toBe(2);
    expect(report.freedBytes).toBeGreaterThan(0);
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('a protected collection refuses an empty keep list', async () => {
  await expect(reclaimPacks(folderStore('tmp/never-written'), {builds: [], heads: new Set()}, 1, 0)).rejects.toThrow(/empty list/u);
});

test('a publish reclaims once the store would hold over 85% of its budget', () => {
  expect(needsReclaim(3_400_000_000, 4_000_000_000)).toBe(false);
  expect(needsReclaim(3_400_000_001, 4_000_000_000)).toBe(true);
  expect(needsReclaim(4_100_000_000, 4_000_000_000)).toBe(true);
});
