// oxlint-disable-next-line import/no-nodejs-modules -- The cook writes into a folder of its own.
import {join} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- A chain mismatch must leave no output directory.
import {existsSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {migrateShardfile} from '@wildshard/format/migrate';
import {readTar, writeTar} from '@wildshard/format/tar';
import {cookProvenance, provenanceRefusal} from '../src/cook/game/cookProvenance';
import {checkShardfile} from '../src/server/host/checkShardfile';
import {runCookJob, ShardfileRefusedError} from '../src/cook/game/cookJob';
import {createCookWorker, indexKey, type CatalogueRow, type CookStage} from '../src/cook/game/cookWorker';
import {hashOf, legacyMigrationFixture, useCookHarness} from './fixtures/cookWorkerHarness';

/** SHARD-COMPAT FE9a: the cook records the original's format, the chain id and the copy's digest, as the API does (CP7a). */
describe('the cook provenance', () => {
  const h = useCookHarness(legacyMigrationFixture.folder), {slug} = legacyMigrationFixture;

  it('records the original format, the chain id the API stores and the migrated copy digest', () => {
    const chained = migrateShardfile(readTar(h.real), {hash: hashOf}), provenance = cookProvenance(h.real, hashOf);
    expect(chained.applied.length).toBeGreaterThan(0);
    expect(provenance).toEqual({formatIn: chained.from, chainId: chained.chainId, digest: hashOf(writeTar(chained.files)), applied: chained.applied});
    expect(provenance?.digest).not.toBe(hashOf(h.real));
    expect(provenance?.chainId).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('refuses unequal chains or unequal digests', () => {
    const provenance = cookProvenance(h.real, hashOf);
    if (provenance === undefined) throw new Error('the chain read nothing');
    expect(provenanceRefusal(slug, provenance, {chainId: provenance.chainId, digest: provenance.digest})).toBeUndefined();
    expect(provenanceRefusal(slug, provenance, {chainId: 'identity', digest: provenance.digest}, '1.2.3')).toBe(
      `${slug} shardVersion 1.2.3: migration chain mismatch (cook ${provenance.chainId}, API identity)`);
    expect(provenanceRefusal(slug, provenance, undefined)).toBeUndefined();
    expect(provenanceRefusal(slug, provenance, {chainId: provenance.chainId, digest: '0'.repeat(64)})).toMatch(new RegExp(`^${slug}: the migrated copy's digest`, 'u'));
  });

  it('refuses a doctored digest by slug before any pack is cooked', async () => {
    const provenance = cookProvenance(h.real, hashOf);
    if (provenance === undefined) throw new Error('the chain read nothing');
    const expected = {chainId: provenance.chainId, digest: '0'.repeat(64)};
    const run = runCookJob(h.real, join(h.scratch, 'doctored'), {expected, check: () => Promise.reject(new Error('the check ran')), wireBytes: () => 0, now: () => 0});
    await expect(run).rejects.toThrow(ShardfileRefusedError);
    await expect(run).rejects.toThrow(`${slug}: the migrated copy's digest`);
  }, 60_000);

  it('refuses a different chain before creating any output', async () => {
    const provenance = cookProvenance(h.real, hashOf);
    if (provenance === undefined) throw new Error('the chain read nothing');
    const expected = {chainId: 'a'.repeat(64), digest: provenance.digest};
    const out = join(h.scratch, 'wrong-chain');
    await expect(runCookJob(h.real, out, {
      expected, shardVersion: '1.2.3', check: () => Promise.reject(new Error('the check ran')), wireBytes: () => 0, now: () => 0,
    })).rejects.toThrow(`${slug} shardVersion 1.2.3: migration chain mismatch (cook ${provenance.chainId}, API ${expected.chainId})`);
    expect(existsSync(out)).toBe(false);
  }, 60_000);

  it('writes the cook when the API recorded the same chain and digest', async () => {
    const expected = cookProvenance(h.real, hashOf);
    if (expected === undefined) throw new Error('the chain read nothing');
    const out = join(h.scratch, 'matching-chain');
    const report = await runCookJob(h.real, out, {
      expected, check: (shard, assets, sections) => checkShardfile(shard, assets, {sections}), wireBytes: () => 0, now: () => 0,
    });
    expect(report.provenance).toEqual(expected);
    expect(existsSync(join(out, 'client', report.header))).toBe(true);
  }, 60_000);

  it('QA44 refreshes the exact notified copy and reopens its stale refusal', async () => {
    const provenance = cookProvenance(h.real, hashOf);
    if (provenance === undefined) throw new Error('the chain read nothing');
    const hash = hashOf(h.real), old = {slug, hash, uploadNumber:1, expected:{chainId:'identity',digest:hash}};
    const corrected = {...old, expected:{chainId:provenance.chainId,digest:provenance.digest}};
    let advertised: readonly CatalogueRow[] = [old];
    let finishOlderRead: (rows: readonly CatalogueRow[]) => void = () => undefined;
    const olderRead = new Promise<readonly CatalogueRow[]>(resolve => { finishOlderRead = resolve; });
    const stages: CookStage[] = [];
    const build = 'notify-provenance';
    const worker = createCookWorker({build,store:h.store,launcher:h.launcher(),
      serverPacks:join(h.scratch,'notify-server'),scratch:join(h.scratch,'notify-work'),
      source:{...h.source(new Map([[hash,h.real]])), heads:stage=>{
        stages.push(stage);
        return stage==='live' ? olderRead : Promise.resolve(advertised);
      }},
    });
    expect(await worker.recook(['preview'])).toMatchObject([{state:'refused',detail:expect.stringContaining('API identity')}]);
    expect(await h.store.get(indexKey(build,hash))).toBeUndefined();
    const polling = worker.sweep(['live']);
    advertised = [{...old,hash:'f'.repeat(64)},corrected];
    worker.enqueue({event:'shardfile.new',stage:'preview',shard:slug,uploadNumber:1,hash});
    await worker.idle();
    expect(stages).toEqual(['preview','live','preview']);
    expect(worker.rows()).toMatchObject([{slug,hash,state:'cooked'}]);
    const index = await h.store.get(indexKey(build,hash));
    expect(JSON.parse(new TextDecoder().decode(index))).toMatchObject({hash,provenance});

    finishOlderRead([old]);
    await polling;
    expect(await worker.cook({slug,hash})).toMatchObject({state:'present'});
  }, 60_000);

  it('gives nothing for bytes the chain cannot read, so the validator refusal stands', () => {
    expect(cookProvenance(new Uint8Array(512), hashOf)).toBeUndefined();
  });
});
