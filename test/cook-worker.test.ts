// oxlint-disable-next-line import/no-nodejs-modules -- This test runs the worker in folders of its own.
import {readdirSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- This test runs the worker in folders of its own.
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {collectGarbage, indexKey, objectHeaders, readCapped, storeUsage, type CookIndex} from '../src/cook/game/cookWorker';
import {hashOf, slug, useCookHarness} from './fixtures/cookWorkerHarness';

/** C4 (J28, J29, J30): a real product and hostile ones through real child processes under their real limits. */
// The cold real cook and the store it leaves. Hostile archives, job limits and the R2 store are in
// cook-worker-limits.test.ts; the HTTP notice's own cold cook is in cook-worker-publish.test.ts and the pack budget in
// cook-worker-publish-budget.test.ts and cook-worker-publish-full.test.ts.
describe('the cook worker', () => {
  const h = useCookHarness();

  it('cooks a real shard: parts and index in the store, a server pack for the room, no second cook', async () => {
    const hash = hashOf(h.real), cook = h.worker(new Map([[hash, h.real]]));
    const sharedHeader = `shardfiles/${slug}/shard.json`;
    const newerHeader = new TextEncoder().encode('the newer staged revision');
    await h.store.put(sharedHeader, newerHeader, objectHeaders(sharedHeader));
    const row = await cook.cook({slug, hash});
    expect(row.state, row.detail).toBe('cooked');
    const index = JSON.parse(new TextDecoder().decode(await h.store.get(indexKey('b1', hash)))) as CookIndex;
    expect(index).toMatchObject({version: 1, build: 'b1', slug, hash, proof: 'unmeasured'});
    expect(index.check).toMatchObject({slug, pass: true, proof: 'unmeasured'});
    expect(index.check?.performance.scripts.scripts.samples).toBe(180);
    expect(index.manifests).toHaveLength(4);
    for (const key of index.keys) expect(await h.store.has(key), key).toBe(true);
    expect(index.keys.filter(key => key.endsWith('.pack.br')).length).toBeGreaterThan(0);
    // An older recook must leave the shared alias alone and publish its own descriptor.
    expect(await h.store.get(sharedHeader)).toEqual(newerHeader);
    expect(index.keys).not.toContain(sharedHeader);
    expect(index.loose).toBe(`loose/${hash}/`);
    expect(await h.store.get(`loose/${hash}/${index.header}`)).toBeDefined();
    expect(index.keys).toContain(`loose/${hash}/${index.header}`);
    expect(objectHeaders(`loose/${hash}/${index.header}`).cache).toMatch(/immutable/u);
    const room = join(h.scratch, 'server', slug, hash), held = readdirSync(room, {recursive: true}).map(String);
    expect(held).toContain('shard.json');
    expect(index.server.bytes).toBeLessThan(h.real.length / 4);
    expect(held.filter(path => /\.(?:ktx2|glb|webp|png|jpe?g|mp3|m4a)$/u.test(path))).toEqual([]);
    expect(await cook.cook({slug, hash})).toMatchObject({state: 'present', check: index.check});
    // A new engine build cooks its own index, and its parts are the ones already stored (J83).
    const before = (await h.store.list('assets/spawn/parts/')).length, next = h.worker(new Map([[hash, h.real]]), 'b2');
    expect((await next.recook(['live'])).map(item => item.state)).toEqual(['cooked']);
    expect((await h.store.list('assets/spawn/parts/')).length).toBe(before);
    expect(await h.store.has(indexKey('b2', hash))).toBe(true);
  }, 120_000);

  it('collects what no kept build names, and leaves young objects to a running cook', async () => {
    const put = (key: string): Promise<void> => h.store.put(key, new Uint8Array(10), objectHeaders(key));
    await put('assets/spawn/parts/0000000000000000000000000000000000000000000000000000000000000000.pack.br');
    await expect(collectGarbage(h.store, [], 1e9, Date.now())).rejects.toThrow('builds to keep');
    const young = await collectGarbage(h.store, ['b1'], 1e9, Date.now());
    expect(young.deleted).toBe(0);
    const report = await collectGarbage(h.store, ['b1'], 1e9, Date.now() + 7_200_000);
    expect(report.deleted).toBeGreaterThanOrEqual(2); // the stray part and b2's index
    expect(await h.store.has(indexKey('b1', hashOf(h.real)))).toBe(true);
    expect(await h.store.has(indexKey('b2', hashOf(h.real)))).toBe(false);
    const usage = await storeUsage(h.store, 1e9);
    expect(usage.byPrefix['assets/spawn/parts']?.count).toBeGreaterThan(0);
    expect(usage.share).toBeGreaterThan(0);
  }, 30_000);

  it('caps a download on its decoded bytes', async () => {
    await expect(readCapped(new Response(new Uint8Array(2048)), 1024)).rejects.toThrow('passes 1024');
    expect(await readCapped(new Response(new Uint8Array(1024)), 1024)).toHaveLength(1024);
  });
});
