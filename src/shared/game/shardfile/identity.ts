import { catalogueDocument } from '../grid/catalogueDocument';
import { bareSlug } from '../grid/catalogueSlot';

const PRIVATE_NAMESPACES = new Set(['global', 'profile', 'device', 'session']);
/** No shard, whoever made it, may name a private save namespace. */
export function assertShardSlug(slug: string): void {
  if (PRIVATE_NAMESPACES.has(bareSlug(slug))) throw new Error('Shardfile slug names a private save namespace');
}
/**
 * ONE-FORMAT OF10a5: identity and the save instance come from admission, for every shard. A slug the catalogue places
 * (the api-server owns each slug per account: another account's upload of it is a 403) saves under its placement's
 * instance, so this answers undefined; any other product's saves are keyed by its exact (origin, slug) pair, which
 * paths and revisions do not change.
 */
export async function admittedShardInstance(base: string, slug: string, hash: (bytes: Uint8Array) => Promise<string>): Promise<string | undefined> {
  assertShardSlug(slug);
  if (catalogueDocument().placements.some(row => bareSlug(row.slug) === bareSlug(slug))) return undefined;
  const url = new URL(base);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Outside shardfiles require an HTTP origin');
  const identity = await hash(new TextEncoder().encode(JSON.stringify([url.origin, slug])));
  if (!/^[a-f0-9]{64}$/u.test(identity)) throw new Error('Outside shard identity requires a SHA-256 address');
  return `external-${identity}`;
}
