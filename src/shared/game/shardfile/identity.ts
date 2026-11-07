import { catalogueDocument } from '../grid/catalogueDocument';
import { bareSlug } from '../grid/catalogueSlot';

const PRIVATE_NAMESPACES = ['global', 'profile', 'device', 'session'];
/** Outside products cannot impersonate a platform shard or a private save namespace. */
export function assertExternalShardSlug(slug: string): void {
  const reserved = new Set([...catalogueDocument().placements.map((row) => bareSlug(row.slug)), ...PRIVATE_NAMESPACES]);
  if (reserved.has(bareSlug(slug))) throw new Error('Outside shardfile uses a reserved first-party slug');
}
/** Stable, bounded save key for the exact (origin, slug) pair; paths and revisions do not change progress identity. */
export async function externalShardInstance(base: string, slug: string, hash: (bytes: Uint8Array) => Promise<string>): Promise<string> {
  const url = new URL(base);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Outside shardfiles require an HTTP origin');
  assertExternalShardSlug(slug);
  const identity = await hash(new TextEncoder().encode(JSON.stringify([url.origin, slug])));
  if (!/^[a-f0-9]{64}$/u.test(identity)) throw new Error('Outside shard identity requires a SHA-256 address');
  return `external-${identity}`;
}
