/**
 * ONE-FORMAT OF9b (J365 (7)): `shardfile` is the one key that names a shard's descriptor. Products built before it name a
 * client-plan runtime page's descriptor under an older key; this is the one place that key is read. Discovery data and title
 * rows pass through here as they enter the page, so nothing past it knows the old key. Naming two different files is refused.
 */
const OLD_KEY = 'gridShardfile';

export function liftLegacyPointer<R>(row: R): R {
  if (typeof row !== 'object' || row === null || Array.isArray(row) || !Object.hasOwn(row, OLD_KEY)) return row;
  const { [OLD_KEY]: old, ...rest } = row as Readonly<Record<string, unknown>>;
  if (old === undefined) return rest as R;
  const shardfile = rest['shardfile'];
  if (shardfile !== undefined && shardfile !== old) throw new Error('A manifest names its shardfile once');
  return { ...rest, shardfile: old } as R;
}
