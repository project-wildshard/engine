// oxlint-disable-next-line import/no-nodejs-modules -- The budget leaves no index behind.
import {existsSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- This test runs the worker in folders of its own.
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {createCookWorker} from '../src/cook/game/cookWorker';
import {folderStore} from '../src/cook/game/packStore';
import {hashOf, legacyMigrationFixture, root, useCookHarness} from './fixtures/cookWorkerHarness';

/** C4 (J28, J29, J30): a real product and hostile ones through real child processes under their real limits. QA 11-25 row 33
 * split the publish proofs into three files, each under the 60 s file budget with its own cold cook: the HTTP notice and two
 * publishes (cook-worker-publish.test.ts), the budget refusal and the mapless report (cook-worker-publish-budget.test.ts), and
 * the full store's alarm (cook-worker-publish-full.test.ts). */
describe('the cook worker', () => {
  const {folder: fixture, slug} = legacyMigrationFixture;
  const h = useCookHarness(fixture, slug);

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
});
