import type { OutputIndex } from '@wildshard/format/outputIndex';

type Pack = NonNullable<OutputIndex['packs']>[number];
const wholePacks = new WeakMap<object, Map<string, Promise<Uint8Array>>>();
interface SharedPack { readonly pending?: Promise<Uint8Array>; readonly bytes?: WeakRef<Uint8Array> }
const sharedPacks = new WeakMap<object, Map<string, SharedPack>>();
/** MF7: the packs a finished boot let go (`hash:bytes`), and every owner table that may hold each one */
const releasedPacks = new Set<string>();
const holders = new Map<string, WeakRef<Map<string, Promise<Uint8Array>>>[]>();

/** One verified whole GET per immutable index inventory, shared across admission
 * and later demand waves. Failed attempts leave no retained rejection. The weak
 * owner lets the bytes go with their product, rather than a global URL cache. */
export function readPackWhole(owner: object, pack: Pack,
  read: (path: string, maximum: number, members: Pack['entries']) => Promise<Uint8Array>, hash: (bytes: Uint8Array) => Promise<string>, identity: object = hash): Promise<Uint8Array> {
  if (pack.bytes < 1 || pack.bytes > 4_194_304) return Promise.reject(new Error('Shardfile pack size exceeds 4 MiB'));
  let whole = wholePacks.get(owner);
  if (whole === undefined) { whole = new Map(); wholePacks.set(owner, whole); }
  const key = `${pack.hash}:${pack.bytes}`, previous = whole.get(key);
  if (previous !== undefined) return previous;
  let shared = sharedPacks.get(identity);
  if (shared === undefined) { shared = new Map(); sharedPacks.set(identity, shared); }
  const held = whole, common = shared, known = common.get(key), present = known?.bytes?.deref();
  // Separate parses of the same immutable index can overlap (notably WebKit's
  // descriptor and admission). Coalesce their verified bytes without making
  // the page table a new strong backing owner after those products retire.
  // a released pack (MF7) is shared while a read of it is in flight, never kept once it settles
  const keep = !releasedPacks.has(key), forget = (pending: Promise<Uint8Array>): void => {
    if (keep) { const tables = holders.get(key) ?? []; tables.push(new WeakRef(held)); holders.set(key, tables); }
    else void pending.then(() => { if (held.get(key) === pending) held.delete(key); return undefined; }, () => undefined);
  };
  if (known?.pending !== undefined) { held.set(key, known.pending); forget(known.pending); return known.pending; }
  if (present !== undefined) { const borrowed = Promise.resolve(present); if (keep) { held.set(key, borrowed); forget(borrowed); } return borrowed; }
  const bytes = (async () => {
    const wire = await read(pack.path, pack.bytes, pack.entries);
    if (wire.length !== pack.bytes || await hash(wire) !== pack.hash) throw new Error('Shardfile pack hash or size mismatch');
    return wire;
  })();
  held.set(key, bytes); common.set(key, { pending: bytes }); forget(bytes);
  if (common.size > 512) { const oldest = common.keys().next().value; if (oldest !== undefined) common.delete(oldest); }
  void bytes.then(wire => { common.set(key, { bytes: new WeakRef(wire) }); return undefined; }, () => {
    if (held.get(key) === bytes) held.delete(key);
    if (common.get(key)?.pending === bytes) common.delete(key);
    return undefined;
  });
  return bytes;
}

/** MF7: let a product's verified whole packs go once its boot has built what they fed, from every table that holds them
 *  (admission's phase reader keys its own copy of the index: on the Simulator all 11 of Pine Hollow's, 41.8 MB, stayed
 *  there), and keep none read later: each later wave reads and verifies its pack again (from the content cache when it
 *  is there), as every released member does. */
export function releasePackWholes(packs: readonly Pack[]): void {
  for (const pack of packs) {
    const key = `${pack.hash}:${pack.bytes}`;
    releasedPacks.add(key);
    for (const table of holders.get(key) ?? []) table.deref()?.delete(key);
    holders.delete(key);
  }
}

/** iPhone downloads I5: a phase's packed members (I5.1's `index.packs`) served from one verified read of each pack. */
export interface PackReads {
  /** whether `hash` is a member of one of this phase's packs */
  readonly has: (hash: string) => boolean;
  /** the member's exact bytes (an owned copy); the pack is read and hash-checked once, then held only by this reader */
  readonly read: (hash: string) => Promise<Uint8Array>;
}

/** One phase's pack reads (a descriptor's sections, or an admission's files): `members` limits which packs it may read,
 *  so a phase never fetches the other phase's pack. Whole verified bytes are shared only within this index's lifetime. */
export function packReads(packs: OutputIndex['packs'], members: ReadonlySet<string>,
  read: (path: string, maximum: number, members: Pack['entries']) => Promise<Uint8Array>, hash: (bytes: Uint8Array) => Promise<string>): PackReads {
  const where = new Map<string, { readonly pack: NonNullable<OutputIndex['packs']>[number]; readonly offset: number; readonly bytes: number }>();
  for (const pack of packs ?? []) {
    // Admission may request only the control subset of a compiler pack. Do not
    // download its deferred bodies here, discard them, then fetch them again
    // when their real owner asks. Complete phases still share one verified read.
    if (!pack.entries.every(entry => members.has(entry.hash))) continue;
    for (const entry of pack.entries) {
      if (!where.has(entry.hash)) where.set(entry.hash, { pack, offset: entry.offset, bytes: entry.bytes });
    }
  }
  return {
    has: member => where.has(member),
    read: async member => {
      const at = where.get(member);
      if (at === undefined) throw new Error('Not a packed member');
      const bytes = readPackWhole(packs ?? where, at.pack, read, hash);
      return (await bytes).slice(at.offset, at.offset + at.bytes);
    },
  };
}
