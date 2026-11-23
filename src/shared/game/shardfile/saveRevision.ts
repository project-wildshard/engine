/** FORMAT-PRUNE FP26 (J493): a shard's save lineage. Format 0.1.0.4 spells it `identity.saveRevision`, older formats
 *  `identity.revision`; it keys the quest ledger, region durability, the player store and client checkpoints, and only ever
 *  rises. It is not the API's shard revision. Reading either spelling lets the engine run on a format pin before and after
 *  0.1.0.4, so the rename needs no save change: the number is the same. */
export function saveRevision(identity: Readonly<{ saveRevision: number } | { revision: number }>): number {
  return 'saveRevision' in identity ? identity.saveRevision : identity.revision;
}
