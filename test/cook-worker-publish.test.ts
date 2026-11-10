// oxlint-disable-next-line import/no-nodejs-modules -- The budget leaves no index behind.
import {existsSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- A stub of api-server's notify call.
import {type Server} from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- This test runs the worker in folders of its own.
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {createCookWorker, notifyServer} from '../src/cook/game/cookWorker';
import {folderStore} from '../src/cook/game/packStore';
import {hashOf, slug, useCookHarness} from './fixtures/cookWorkerHarness';

/** C4 (J28, J29, J30): a real product and hostile ones through real child processes under their real limits. */
// The HTTP notice cooks the real product from a cold store and cache of its own; the pack budget then refuses
// to publish that same product past it, on the warm encoder cache, as it did after the notice in the original file.
describe('the cook worker', () => {
  const h = useCookHarness();

  it('takes a notice over HTTP, with its token, and cooks it', async () => {
    const hash = hashOf(h.real), cook = h.worker(new Map([[hash, h.real]]), 'b4'), server: Server = notifyServer(cook, 'a-long-enough-test-token');
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
  }, 60_000);

  it('holds the budget: nothing is published past it', async () => {
    const hash = hashOf(h.real), upstream = h.source(new Map([[hash, h.real]]));
    let downloads = 0;
    const cook = createCookWorker({build: 'b5', store: folderStore(join(h.scratch, 'small')),
      source: {...upstream, download: identity => { downloads++; return upstream.download(identity); }}, launcher: h.launcher(),
      serverPacks: join(h.scratch, 'server'), scratch: join(h.scratch, 'work'), budgetBytes: 1024});
    const row = await cook.cook({slug, hash});
    expect(row).toMatchObject({state: 'failed'});
    expect(row.detail).toContain('Over the pack budget');
    expect(existsSync(join(h.scratch, 'small', 'index'))).toBe(false);
    expect(downloads, 'a permanent publication refusal cannot download and cook the same shard again').toBe(1);
  }, 120_000);

});
