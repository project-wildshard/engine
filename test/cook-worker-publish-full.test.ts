// oxlint-disable-next-line import/no-nodejs-modules -- This test runs the worker in folders of its own.
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {createCookWorker, PACK_BUDGET_BYTES, STORE_FULL_ALARM_MS} from '../src/cook/game/cookWorker';
import {folderStore} from '../src/cook/game/packStore';
import {hashOf, legacyMigrationFixture, sparse, useCookHarness} from './fixtures/cookWorkerHarness';

/** C4 (J28, J29, J30): a real product and hostile ones through real child processes under their real limits. QA 11-25 row 33
 * split the publish proofs into three files, each under the 60 s file budget with its own cold cook: the HTTP notice and two
 * publishes (cook-worker-publish.test.ts), the budget refusal and the mapless report (cook-worker-publish-budget.test.ts), and
 * the full store's alarm (cook-worker-publish-full.test.ts). */
describe('the cook worker', () => {
  const {folder, slug} = legacyMigrationFixture;
  const h = useCookHarness(folder, slug);

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
