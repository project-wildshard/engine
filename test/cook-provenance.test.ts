// oxlint-disable-next-line import/no-nodejs-modules -- The cook writes into a folder of its own.
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {migrateShardfile} from '@wildshard/format/migrate';
import {readTar, writeTar} from '@wildshard/format/tar';
import {cookProvenance, provenanceRefusal} from '../src/cook/game/cookProvenance';
import {runCookJob, ShardfileRefusedError} from '../src/cook/game/cookJob';
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

  it('refuses only a different digest under the same chain', () => {
    const provenance = cookProvenance(h.real, hashOf);
    if (provenance === undefined) throw new Error('the chain read nothing');
    expect(provenanceRefusal(slug, provenance, {chainId: provenance.chainId, digest: provenance.digest})).toBeUndefined();
    expect(provenanceRefusal(slug, provenance, {chainId: 'identity', digest: '0'.repeat(64)})).toBeUndefined();
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

  it('gives nothing for bytes the chain cannot read, so the validator refusal stands', () => {
    expect(cookProvenance(new Uint8Array(512), hashOf)).toBeUndefined();
  });
});
