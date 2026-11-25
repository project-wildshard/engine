// oxlint-disable-next-line import/no-nodejs-modules -- The budget leaves no index behind.
import {existsSync, mkdirSync, openSync, closeSync, ftruncateSync, rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- A stub of api-server's notify call.
import {type Server} from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- This test runs the worker in folders of its own.
import {dirname, join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {createCookWorker, notifyServer, PACK_BUDGET_BYTES, STORE_FULL_ALARM_MS} from '../src/cook/game/cookWorker';
import {folderStore} from '../src/cook/game/packStore';
import {hashOf, root, slug, useCookHarness} from './fixtures/cookWorkerHarness';

/** C4 (J28, J29, J30): a real product and hostile ones through real child processes under their real limits. */
// These stand in for the page's content and the cook's packed parts without allocating their disk space.
function sparse(root: string, key: string, bytes: number): void {
  const file = join(root, key);
  mkdirSync(dirname(file), {recursive: true});
  const fd = openSync(file, 'w');
  try { ftruncateSync(fd, bytes); } finally { closeSync(fd); }
}

describe('the cook worker', () => {
  const h = useCookHarness();

  it('authenticates HTTP notices and publishes twice from one bucket listing', async () => {
    const folder = join(h.scratch, 'listed'), inner = folderStore(folder), hash = hashOf(h.real);
    // The page's content sets exceed the whole default cook budget by themselves.
    sparse(folder, 'content/set-a/blob.bin', 8_000_000_000);
    let whole = 0;
    const cook = createCookWorker({build: 'b4', store: {...inner, list: prefix => { if (prefix === '') whole++; return inner.list(prefix); }},
      source: h.source(new Map([[hash, h.real]])), launcher: h.launcher(), serverPacks: join(h.scratch, 'server'), scratch: join(h.scratch, 'work')});
    const server: Server = notifyServer(cook, 'a-long-enough-test-token');
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(), port = typeof address === 'object' && address !== null ? address.port : 0, url = `http://127.0.0.1:${port}`;
    const notice = {event: 'shardfile.new', stage: 'preview', shard: slug, revision: 1, hash};
    const post = (token: string, value: unknown): Promise<Response> => fetch(`${url}/notify`, {method: 'POST', headers: {authorization: `Bearer ${token}`}, body: JSON.stringify(value)});
    try {
      expect((await post('wrong', notice)).status).toBe(401);
      expect((await post('a-long-enough-test-token', {...notice, hash: '../..'})).status).toBe(422);
      expect((await post('a-long-enough-test-token', {...notice, extra: 1})).status).toBe(422);
      expect((await fetch(`${url}/notify`, {method: 'POST', headers: {authorization: 'Bearer a-long-enough-test-token'}, body: 'x'.repeat(9000)}).catch(() => ({status: 400}))).status).toBe(400);
      expect((await post('a-long-enough-test-token', notice)).status).toBe(202);
      await cook.idle();
      expect(cook.rows().map(row => row.state)).toEqual(['cooked']);
      expect(await (await fetch(`${url}/health`)).json()).toMatchObject({ok: true, failed: 0});
    } finally { await new Promise(resolve => { server.close(resolve); }); }
    expect(existsSync(join(folder, 'index')), 'the authenticated notice wrote its index despite the page content').toBe(true);
    expect(whole).toBe(1);
    // Force a second actual publication through the same worker and bucket.
    rmSync(join(folder, 'index'), {recursive: true, force: true});
    expect(await cook.cook({slug, hash}), 'the second publish writes the index again').toMatchObject({state: 'cooked'});
    expect(existsSync(join(folder, 'index')), 'the second publish wrote its index').toBe(true);
    expect(whole).toBe(1);
  }, 60_000);

  it('holds the budget: nothing is published past it, and an upload bigger than the whole store is refused', async () => {
    const hash = hashOf(h.real), upstream = h.source(new Map([[hash, h.real]]));
    let downloads = 0;
    const cook = createCookWorker({build: 'b5', store: folderStore(join(h.scratch, 'small')),
      source: {...upstream, download: identity => { downloads++; return upstream.download(identity); }}, launcher: h.launcher(),
      serverPacks: join(h.scratch, 'server'), scratch: join(h.scratch, 'work'), budgetBytes: 1024});
    const row = await cook.cook({slug, hash});
    // QA 11-24 row 62: it can never fit, so its verdict is a refusal the API hears, not a failure retried for hours.
    expect(row).toMatchObject({state: 'refused'});
    expect(row.detail).toMatch(/Over the pack budget: .* needs \d+ B, more than the whole 1024 B store/u);
    expect(await cook.cook({slug, hash}), 'a refusal is settled').toMatchObject({state: 'refused'});
    expect(existsSync(join(h.scratch, 'small', 'index'))).toBe(false);
    expect(downloads, 'a permanent publication refusal cannot download and cook the same shard again').toBe(1);
  }, 120_000);

  it('refuses a cook report without its map, and publishes no index (MAP-NEXT MN5, J450)', async () => {
    const hash = hashOf(h.real), folder = join(h.scratch, 'mapless');
    const cook = createCookWorker({build: 'b7', store: folderStore(folder), source: h.source(new Map([[hash, h.real]])),
      launcher: h.launcher(join(root, 'test/fixtures/cook-job-no-map.mjs')), serverPacks: join(h.scratch, 'server'), scratch: join(h.scratch, 'work')});
    const row = await cook.cook({slug, hash});
    expect(row).toMatchObject({state: 'failed'});
    expect(row.detail).toContain('no map');
    expect(existsSync(join(folder, 'index'))).toBe(false);
  }, 60_000);

  it('still refuses when its own keys are over the default budget, and a full store alarms once a day', async () => {
    const store = join(h.scratch, 'full');
    sparse(store, 'assets/spawn/parts/old-part.bin', 5_000_000_000);
    const hash = hashOf(h.real), alarms: string[] = [];
    let clock = 0;
    const cook = createCookWorker({build: 'b6', store: folderStore(store), source: h.source(new Map([[hash, h.real]])), launcher: h.launcher(),
      serverPacks: join(h.scratch, 'server'), scratch: join(h.scratch, 'work'), now: () => clock, alarm: line => { alarms.push(line); }});
    const row = await cook.cook({slug, hash});
    expect(row).toMatchObject({state: 'failed'});
    expect(row.detail).toContain('Over the pack budget: 5000000000 + ');
    // QA 11-24 row 62: the alarm names used and budget bytes; a store GC can free stays a retried failure, not a refusal.
    expect(alarms).toHaveLength(1);
    expect(alarms[0]).toMatch(new RegExp(`^ALARM pack store full: 5000000000 of ${String(PACK_BUDGET_BYTES)} B used; ${slug} ${hash.slice(0, 12)} needs \\d+ B more$`, 'u'));
    clock = STORE_FULL_ALARM_MS - 1;
    expect(await cook.cook({slug, hash})).toMatchObject({state: 'failed'});
    expect(alarms).toHaveLength(1);
    clock = STORE_FULL_ALARM_MS;
    await cook.cook({slug, hash});
    expect(alarms).toHaveLength(2);
  }, 180_000);

});
