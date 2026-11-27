/** SHARD-COMPAT FE9a: what the cook records of the copy it vouches for, as the API records a migrated copy (CP2b, CP7a): the
 * format the original was uploaded at, the migration chain engine's format runs on it, and the digest of what that chain makes
 * (the original's own SHA-256 when no step applies). A host that knows the API's digest under the same chain refuses a copy
 * whose digest differs, by slug: the two hosts ran the same code on the same bytes and must agree. */
import {migrateShardfile} from '@wildshard/format/migrate';
import type {FormatMigration} from '@wildshard/format/formatMigrations';
import {readTar, writeTar} from '@wildshard/format/tar';

export interface CookProvenance {readonly formatIn: string; readonly chainId: string; readonly digest: string; readonly applied: readonly string[]}
/** The API's record of the copy it serves for this original (`migrated_shardfiles`): its chain and digest. */
export interface ExpectedCopy {readonly chainId: string; readonly digest: string}

/** The chain's provenance for `tarball`, or undefined when the chain can't read it (the validator's refusal then stands). */
export function cookProvenance(tarball: Uint8Array, hash: (bytes: Uint8Array) => string, migrations?: readonly FormatMigration[]): CookProvenance | undefined {
  try {
    const chained = migrateShardfile(readTar(tarball), {hash, ...(migrations === undefined ? {} : {migrations})});
    const digest = chained.applied.length === 0 ? hash(tarball) : hash(writeTar(chained.files));
    return {formatIn: chained.from, chainId: chained.chainId, digest, applied: chained.applied};
  } catch { return undefined; }
}

/** Why the copy disagrees with the API's, or undefined if there is no conflict. */
export function provenanceRefusal(slug: string, provenance: CookProvenance | undefined, expected: ExpectedCopy | undefined, shardVersion?: string): string | undefined {
  if (expected === undefined) return undefined;
  // The API names the unchanged original "identity". The cook still
  // records its canonical chain ID even when that chain ran no steps.
  const matches = expected.chainId === 'identity'
    ? provenance?.applied.length === 0
    : provenance?.chainId === expected.chainId;
  if (provenance === undefined || !matches) {
    return `${slug} shardVersion ${shardVersion ?? '(unavailable)'}: migration chain mismatch (cook ${provenance?.chainId ?? '(unreadable)'}, API ${expected.chainId})`;
  }
  if (expected.digest === provenance.digest) return undefined;
  return `${slug}: the migrated copy's digest ${provenance.digest} differs from the API's ${expected.digest} under chain ${provenance.chainId}`;
}

/** One migrated copy the API lists in a channel block (`channels.<name>.migrations`). */
export interface ListedCopy {readonly raw: string; readonly format: string; readonly hash?: string | undefined; readonly chainId: string; readonly status: string}

/** SHARD-COMPAT CP2b2b: the API's copy of `raw` at `format` (the engine's), as the cook must match it; undefined with none. */
export function expectedCopyOf(raw: string, listed: readonly ListedCopy[], format: string): ExpectedCopy | undefined {
  const row = listed.find(copy => copy.raw === raw && copy.format === format && copy.status === 'ok' && copy.hash !== undefined);
  return row?.hash === undefined ? undefined : {chainId: row.chainId, digest: row.hash};
}
