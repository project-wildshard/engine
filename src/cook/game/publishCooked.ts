// oxlint-disable-next-line import/no-nodejs-modules -- The cook publishes verified files to its object store.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Each cooked object is read from the bounded child's output.
import {readFileSync, statSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The client's output tree supplies the staged objects.
import {join} from 'node:path';
import {cookedIndexKey, cookedShardPrefix, cookedVersionPrefix, readCookedIndexAddress, type CookedIndexAddress, type CookedShardRef} from '../../shared/game/shardfile/cookedPackPaths';
import type {CookIndex} from './cookWorker';
import type {ImmutablePackStore, ObjectHeaders} from './packStore';

export type VersionedCookIndex = CookIndex & CookedIndexAddress & {readonly outputDigest: string};
export interface CookObject {
  readonly path: string;
  readonly file: string;
  readonly common?: boolean;
  readonly mount?: boolean;
}

const JSON_HEADERS: ObjectHeaders = {type: 'application/json', cache: 'public, max-age=300'};
const decode = new TextDecoder(), encode = new TextEncoder();
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const suffix = (name: string): string => /(?:\.pack\.br|\.[a-z0-9]+)$/u.exec(name)?.[0] ?? '';

type ReadyCookIndex = VersionedCookIndex & {readonly check: NonNullable<CookIndex['check']>};

export async function readVersionedCook(store: Pick<ImmutablePackStore, 'get'>, ref: CookedShardRef, hash: string): Promise<ReadyCookIndex | undefined> {
  const key = cookedIndexKey(ref), bytes = await store.get(key);
  if (bytes === undefined) return undefined;
  const index = JSON.parse(decode.decode(bytes)) as VersionedCookIndex, address = readCookedIndexAddress(index);
  if (cookedIndexKey(address) !== key || address.hash !== hash) throw new Error(`Cooked identity conflicts at ${key}`);
  if (!/^[a-f0-9]{64}$/u.test(index.outputDigest) || index.check?.pass !== true
    || !Array.isArray(index.keys) || [...new Set(Object.values(address.objects))].some(value => !index.keys.includes(value))) {
    throw new Error(`Incomplete cooked index at ${key}`);
  }
  return {...index, ...address, check: index.check};
}

export interface PublishCookedOptions {
  readonly store: ImmutablePackStore;
  /** CK1: called with the object key (`common/<sha256>.jpg`), never the page path, so a content-named key reads as one. */
  readonly headers: (key: string) => ObjectHeaders;
  readonly reserve?: (objects: readonly {readonly key: string; readonly bytes: number}[]) => Promise<void>;
  readonly parallel: <T>(items: readonly T[], job: (item: T) => Promise<void>) => Promise<void>;
}

export async function publishCooked(options: PublishCookedOptions, ref: CookedShardRef, base: CookIndex, digestOfOutput: string,
  out: string, files: readonly CookObject[], members?: CookedIndexAddress['members']): Promise<VersionedCookIndex> {
  const cook = cookedVersionPrefix(ref), common = `${cookedShardPrefix(ref)}common/`;
  const objects = new Map<string, string>(), mounts = new Map<string, string>();
  const plan = files.map(file => {
    const at = join(out, file.file);
    const key = file.common === true ? `${common}${digest(readFileSync(at))}${suffix(file.path)}` : `${cook}${file.path}`;
    objects.set(file.path, key);
    if (file.mount === true) mounts.set(`/${file.path}`, key);
    return {at, key, path: file.path, bytes: statSync(at).size};
  });
  const ordered = (rows: ReadonlyMap<string, string>): Record<string, string> => Object.fromEntries([...rows].sort(([a], [b]) => a.localeCompare(b, 'en')));
  const index: VersionedCookIndex = {...base, ...ref, keys: [...new Set(objects.values())].sort(), objects: ordered(objects),
    outputDigest: digestOfOutput, ...(members === undefined ? {} : {members}), ...(mounts.size === 0 ? {} : {mounts: ordered(mounts)})};
  readCookedIndexAddress(index);
  await options.reserve?.(plan);
  await options.parallel(plan, async ({key, at}) => {
    await options.store.putImmutable(key, readFileSync(at), options.headers(key));
  });
  await writeVersionedCook(options.store, ref, index);
  return index;
}

/** The index is the publication boundary. An existing address must refer to the same upload and cooked bytes. */
export async function writeVersionedCook(store: ImmutablePackStore, ref: CookedShardRef, index: VersionedCookIndex): Promise<void> {
  const existing = await readVersionedCook(store, ref, index.hash);
  if (existing !== undefined) {
    if (existing.outputDigest !== index.outputDigest) throw new Error(`Cook output differs at ${cookedIndexKey(ref)}`);
    return;
  }
  try {
    await store.putImmutable(cookedIndexKey(ref), encode.encode(JSON.stringify(index)), JSON_HEADERS);
  } catch (error) {
    const won = await readVersionedCook(store, ref, index.hash);
    if (won?.outputDigest !== index.outputDigest) throw error;
  }
}

/** Two real shardfiles witness that the cook's current output can reuse prior bytes under the same cook version. */
export async function verifyCookReuse(samples: readonly {readonly slug: string; readonly outputDigest: string}[],
  cook: (slug: string) => Promise<string>): Promise<void> {
  if (samples.length !== 2 || new Set(samples.map(sample => sample.slug)).size !== 2) throw new Error('Cook reuse requires two different zones');
  for (const row of samples) {
    if (await cook(row.slug) !== row.outputDigest) throw new Error(`Cook output changed for ${row.slug}; bump cookVersion`);
  }
}
