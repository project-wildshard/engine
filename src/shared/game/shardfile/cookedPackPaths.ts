export const COOKED_BUCKET = 'wildshard-cooked';
export const COOKED_ORIGIN = 'https://cooked.wildshard.io/';

export interface CookedShardRef {
  readonly slug: string;
  readonly shardVersion: string;
  readonly cookVersion: string;
  readonly cookHash: string;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SEMVER = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const HASH = /^[a-f0-9]{64}$/u;
const PATH_SEGMENT = /^[\w-][\w.-]*$/u;

export function cookedShardPrefix({slug, shardVersion}: Pick<CookedShardRef, 'slug' | 'shardVersion'>): string {
  if (!SLUG.test(slug) || !SEMVER.test(shardVersion)) throw new Error('Invalid cooked shard identity');
  return `shards/${slug}/${shardVersion}/`;
}

export function cookedVersionPrefix(ref: Pick<CookedShardRef, 'slug' | 'shardVersion' | 'cookVersion'>): string {
  if (!SEMVER.test(ref.cookVersion)) throw new Error('Invalid cook version');
  return `${cookedShardPrefix(ref)}cooks/${ref.cookVersion}/`;
}

export function cookedIndexKey(ref: CookedShardRef): string {
  if (!HASH.test(ref.cookHash)) throw new Error('Invalid cook hash');
  return `${cookedVersionPrefix(ref)}${ref.cookHash}/index.json`;
}

/** Maps a page path to an object owned by this exact shard version. */
export function cookedObjectKey(ref: CookedShardRef, objects: Readonly<Record<string, string>>, path: string): string | undefined {
  const logical = path.split('?')[0]?.replace(/^\//u, '') ?? '';
  const key = Object.hasOwn(objects, logical) ? objects[logical] : undefined;
  if (key === undefined) return undefined;
  const common = `${cookedShardPrefix(ref)}common/`, cook = cookedVersionPrefix(ref);
  const prefix = key.startsWith(common) ? common : key.startsWith(cook) ? cook : undefined;
  if (prefix === undefined || !key.slice(prefix.length).split('/').every(part => PATH_SEGMENT.test(part))) {
    throw new Error(`Cook object outside its shard version: ${logical}`);
  }
  return key;
}
