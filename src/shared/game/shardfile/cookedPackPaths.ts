import type {CookedPartMember} from '@wildshard/engine/boot/tables';
import {contentHash} from './contentHash';

export const COOKED_BUCKET = 'wildshard-cooked';
export const COOKED_ORIGIN = 'https://cooked.wildshard.io/';

export interface CookedShardRef {
  readonly slug: string;
  readonly shardVersion: string;
  readonly cookVersion: string;
  readonly cookHash: string;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const INTEGER = String.raw`(?:0|[1-9][0-9]*)`;
const CORE = String.raw`${INTEGER}\.${INTEGER}\.${INTEGER}`;
const PRERELEASE = String.raw`(?:${INTEGER}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
const COOK_VERSION = new RegExp(`^${CORE}$`, 'u');
const SHARD_VERSION = new RegExp(String.raw`^${CORE}(?:-${PRERELEASE}(?:\.${PRERELEASE})*)?$`, 'u');
const HASH = /^[a-f0-9]{64}$/u;
const PATH_SEGMENT = /^[\w-][\w.-]*$/u;

export function cookedShardPrefix({slug, shardVersion}: Pick<CookedShardRef, 'slug' | 'shardVersion'>): string {
  if (!SLUG.test(slug) || !SHARD_VERSION.test(shardVersion)) throw new Error('Invalid cooked shard identity');
  return `shards/${slug}/${shardVersion}/`;
}

export function cookedVersionPrefix(ref: Pick<CookedShardRef, 'slug' | 'shardVersion' | 'cookVersion'>): string {
  if (!COOK_VERSION.test(ref.cookVersion)) throw new Error('Invalid cook version');
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

/** Address fields common to the client, the room and the cook's collection. */
export interface CookedIndexAddress extends CookedShardRef {
  readonly hash: string;
  readonly objects: Readonly<Record<string, string>>;
  readonly mounts?: Readonly<Record<string, string>>;
  readonly members?: Readonly<Record<string, CookedPartMember>>;
}

export function cookedMemberAddresses(address: CookedIndexAddress, at: (key: string) => string): readonly (readonly [string, CookedPartMember])[] {
  return Object.entries(address.members ?? {}).map(([path, member]) => {
    const key = cookedObjectKey(address, address.objects, member.part);
    if (key === undefined) throw new Error(`Cannot address cooked part for ${path}`);
    return [`/${path}`, {...member, part: at(key)}] as const;
  });
}

export async function checkedCookedMember(part: Uint8Array, member: CookedPartMember): Promise<Uint8Array<ArrayBuffer>> {
  const end = member.offset + member.bytes;
  if (end > part.byteLength) throw new Error('Truncated cooked member');
  const bytes = Uint8Array.from(part.subarray(member.offset, end));
  if (await contentHash(bytes) !== member.hash) throw new Error('Cooked member digest differs');
  return bytes;
}

const record = (input: unknown): input is Record<string, unknown> =>
  typeof input === 'object' && input !== null && !Array.isArray(input);

function readObjects(input: unknown, ref: CookedShardRef): Readonly<Record<string, string>> {
  if (!record(input)) throw new Error('Cook index has no object table');
  const objects = Object.fromEntries(Object.entries(input).map(([path, key]) => {
    if (!path.split('/').every(part => PATH_SEGMENT.test(part)) || typeof key !== 'string') throw new Error('Invalid cook object');
    return [path, key];
  }));
  for (const path of Object.keys(objects)) cookedObjectKey(ref, objects, path);
  return objects;
}

function readMembers(input: unknown, objects: Readonly<Record<string, string>>): Readonly<Record<string, CookedPartMember>> {
  if (!record(input)) throw new Error('Invalid cooked part members');
  return Object.fromEntries(Object.entries(input).map(([path, value]) => {
    if (!path.split('/').every(part => PATH_SEGMENT.test(part)) || Object.hasOwn(objects, path) || !record(value)) {
      throw new Error('Invalid cooked member path');
    }
    const {part, offset, bytes, hash} = value;
    if (typeof part !== 'string' || !/^assets\/spawn\/(?:parts|server)\//u.test(part) || !Object.hasOwn(objects, part)
      || typeof offset !== 'number' || typeof bytes !== 'number' || offset < 0 || bytes < 0
      || !Number.isSafeInteger(offset) || !Number.isSafeInteger(bytes) || !Number.isSafeInteger(offset + bytes)
      || typeof hash !== 'string' || !HASH.test(hash)) throw new Error('Invalid cooked member address');
    return [path, {part, offset, bytes, hash}];
  }));
}

export function readCookedIndexAddress(input: unknown): CookedIndexAddress {
  if (!record(input)) throw new Error('Invalid cook index');
  const {slug, shardVersion, cookVersion, cookHash, hash} = input;
  if (typeof slug !== 'string' || typeof shardVersion !== 'string' || typeof cookVersion !== 'string'
    || typeof cookHash !== 'string' || typeof hash !== 'string' || !HASH.test(hash)) throw new Error('Invalid cook index identity');
  const ref = {slug, shardVersion, cookVersion, cookHash};
  cookedIndexKey(ref);
  const objects = readObjects(input['objects'], ref);
  const members = input['members'] === undefined ? undefined : readMembers(input['members'], objects);
  const base = {...ref, hash, objects, ...(members === undefined ? {} : {members})};
  if (input['mounts'] === undefined) return base;
  if (!record(input['mounts'])) throw new Error('Invalid cook mounts');
  const mounts = Object.fromEntries(Object.entries(input['mounts']).map(([url, key]) => {
    if (!url.startsWith('/') || typeof key !== 'string' || cookedObjectKey(ref, objects, url) !== key) throw new Error('Invalid cook mount');
    return [url, key];
  }));
  return {...base, mounts};
}
