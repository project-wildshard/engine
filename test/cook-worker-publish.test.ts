// oxlint-disable-next-line import/no-nodejs-modules -- The budget leaves no index behind.
import {existsSync, rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- A stub of api-server's notify call.
import {type Server} from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- This test runs the worker in folders of its own.
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {COOK_PREFIXES, createCookWorker, notifyServer} from '../src/cook/game/cookWorker';
import {folderStore} from '../src/cook/game/packStore';
import {hashOf, legacyMigrationFixture, sparse, useCookHarness} from './fixtures/cookWorkerHarness';

/** C4 (J28, J29, J30), QA57: the HTTP and listing contract cooks one made-up tile through the real child twice.
 * Other cook worker tests cover the pinned product. */
describe('the cook worker', () => {
  const {folder: fixture, slug} = legacyMigrationFixture;
  const h = useCookHarness(fixture, slug);

  it('authenticates HTTP notices and publishes twice from one bucket listing', async () => {
    expect(h.real.byteLength).toBeLessThan(128 * 1024);
    const folder = join(h.scratch, 'listed'), inner = folderStore(folder), hash = hashOf(h.real);
    // The page's content sets exceed the whole default cook budget by themselves.
    sparse(folder, 'content/set-a/blob.bin', 8_000_000_000);
    let whole = 0;
    const cook = createCookWorker({build: 'b4', store: {...inner, list: prefix => { if (prefix === COOK_PREFIXES[0]) whole++; return inner.list(prefix); }},
      source: h.source(new Map([[hash, h.real]])), launcher: h.launcher(), serverPacks: join(h.scratch, 'server'), scratch: join(h.scratch, 'work')});
    const server: Server = notifyServer(cook, 'a-long-enough-test-token');
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(), port = typeof address === 'object' && address !== null ? address.port : 0, url = `http://127.0.0.1:${port}`;
    const notice = {event: 'shardfile.new', stage: 'preview', shard: slug, uploadNumber: 1, hash};
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
});
