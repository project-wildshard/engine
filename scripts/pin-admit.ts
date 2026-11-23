// SHARD-COMPAT FE9b (J486): `pins.ts install` admits a pin as the cook does (cookJob.ts `admit`, CP1). A pin this tree's
// validator admits installs as it is. One it refuses goes through the format's migration chain: when a step runs and the
// copy validates, the copy installs (its build receipt is dropped by the chain, as the API's migrated copy drops it);
// a refusal the chain can't repair is the pin's own refusal.
import { migrateShardfile, validateMigrated } from '@wildshard/format/migrate';

type Files = ReadonlyMap<string, Uint8Array>;
export interface AdmittedPin { readonly files: Files; readonly applied: readonly string[]; readonly warnings: readonly string[] }

/** `files` as installed: the original when `validate` admits it, else the chain's validated copy. */
export function admitPin(files: Files, hash: (bytes: Uint8Array) => string, validate: (files: Files) => { readonly warnings: readonly string[] }): AdmittedPin {
  try {
    return { files, applied: [], warnings: validate(files).warnings };
  } catch (refusal) {
    let chained: ReturnType<typeof migrateShardfile>;
    try { chained = migrateShardfile(files, { hash }); } catch { throw refusal; }
    if (chained.applied.length === 0) throw refusal;
    const preparation = chained.preparation === 'author' ? { preparation: 'author' as const } : {};
    const product = validateMigrated(chained.files, { hash, judged: 'stored', ...preparation });
    return { files: chained.files, applied: chained.applied, warnings: product.warnings };
  }
}
