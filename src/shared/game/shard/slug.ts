/** C3: the catalogue says which shards exist, so a slug is a name, not a member of a table the build compiled. */
export type ShardSlug = string;
/** An external identity whose format was validated at the catalogue or shardfile boundary. */
export type ValidatedShardSlug = string & { readonly __shardSlug: true };
/** Brand only validated identities; callers cannot supply arbitrary strings as shard keys. */
export function parseShardSlug(value: unknown): ValidatedShardSlug {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9.-]*$/u.test(value)) throw new Error('Invalid shard slug');
  return value as ValidatedShardSlug;
}
