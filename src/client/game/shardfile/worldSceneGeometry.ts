import { Matrix4, type BufferGeometry } from 'three';
import type { App } from '@wildshard/engine/app/app';
import type { Scope } from '@wildshard/engine/app/scope';
import { withOwner } from '@wildshard/engine/app/ownership';
import { forgetWhenDisposed } from '@wildshard/engine/app/cachedAssets';
import { createOwnedGeometry } from '@wildshard/engine/models/ownedGeometry';
import { TIER } from '@wildshard/engine/core/tier';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import { PreparationReads } from './preparationReads';
import { homeBuildGeometryKeys, readHomeBuildGeometry, saveHomeBuildGeometry } from './homeBuildCache';

type Assets = Pick<App['assets'], 'register' | 'acquireResource' | 'evictCached'>;
type GeometryProduct = Pick<ShardProduct, 'url' | 'file'> & Partial<Pick<ShardProduct, 'shardfile'>>;
interface GeometryReuse { readonly revisit?: boolean }
interface Source {
  readonly file: string;
  readonly segments?: readonly string[];
  readonly attributes?: Readonly<Record<string, string>>;
}
/** A construction lease lends only independent mutable copies; completion releases its source claim. */
export interface WorldSceneGeometry {
  readonly copy: () => BufferGeometry;
  readonly done: () => void;
}
const templates = new WeakMap<Assets, Map<string, BufferGeometry>>();
function requireLive(owner: Scope): void {
  if (owner.disposed || owner.disposing) throw new Error('World scene geometry owner is disposed or retiring');
}
function lease(owner: Scope, assets: Assets, source: BufferGeometry): WorldSceneGeometry {
  requireLive(owner);
  const release = assets.acquireResource(source);
  if (release === null) throw new Error('World scene geometry has retired');
  let geometry: BufferGeometry | undefined = source;
  let forget = (): void => undefined;
  const done = (): void => {
    if (geometry === undefined) return;
    geometry = undefined; forget(); release();
  };
  forget = owner.capture('disposers', done);
  return { done, copy: () => {
    requireLive(owner);
    if (geometry === undefined) throw new Error('World scene geometry construction has finished');
    return geometry.clone();
  } };
}

/** Cache only completed immutable GLB geometry under its admitted addresses and decoder profile.
 * Each consumer has its own cancellable construction lease. No pending load or entered owner is shared. */
/** A source's template key: its admitted addresses and decoder profile. */
function templateKey(product: Pick<ShardProduct, 'url'>, row: Source, revisit: boolean): string {
  const url = product.url(row.file), segments = row.segments?.map(file => product.url(file)) ?? [];
  const ordered = Object.entries(row.attributes ?? {}), channels = [...ordered].sort(([a], [b]) => a.localeCompare(b));
  // Independent renames commute; chained or overwritten destinations keep the decoder's authored order.
  const destinations = ordered.map(([, to]) => to);
  const orderedAliases = new Set(destinations).size !== destinations.length || destinations.some(to => Object.hasOwn(row.attributes ?? {}, to));
  return JSON.stringify([url, segments, TIER, channels, orderedAliases ? ordered : null, revisit]);
}
/** Whether `row` already has a completed template under `assets` (a read would reuse it and read no bytes). */
export function cachedWorldSceneGeometry(product: Pick<ShardProduct, 'url'>, row: Source, assets: Assets, reuse: GeometryReuse = {}): boolean { return templates.get(assets)?.has(templateKey(product, row, reuse.revisit === true)) === true; }

/** Resident construction may keep fixed templates idle under the existing charged,
 * pressure-evictable revisit budget. Default readers retain resident-only reuse. */
export async function readWorldSceneGeometry(owner: Scope, product: GeometryProduct, row: Source, assets: Assets, reuse: GeometryReuse = {}): Promise<WorldSceneGeometry> {
  requireLive(owner);
  // Capture policy before transport: mutable caller options cannot re-key a
  // pending decode or change whether its backing receives independent charges.
  const revisit = reuse.revisit === true, url = product.url(row.file), key = templateKey(product, row, revisit);
  let memo = templates.get(assets);
  if (memo === undefined) { memo = new Map(); templates.set(assets, memo); }
  const ready = memo.get(key);
  if (ready !== undefined) return lease(owner, assets, ready);
  const saved = product.shardfile === undefined ? null : await readHomeBuildGeometry(product.shardfile, `owned:${key}`);
  const restored = saved?.size === 1 ? saved.get('model')?.geometry : undefined;
  if (restored === undefined && saved !== null) for (const view of saved.values()) view.geometry.dispose();
  if (owner.disposed || owner.disposing) restored?.dispose();
  requireLive(owner);
  let geometry: BufferGeometry;
  if (restored !== undefined) {
    geometry = restored;
  }
  else {
    const intake = createOwnedGeometry(url, row.attributes);
    // All segments are independently verified product files. Start them with the
    // primary instead of waiting one extra transport turn for that first file.
    // Drain started reads before a refusal can release the caller's input lease.
    const loaded = await Promise.allSettled([row.file, ...row.segments ?? []].map(async file => {
      const bytes = await product.file(file); return bytes;
    }));
    const words: Uint8Array[] = [];
    for (const result of loaded) {
      if (result.status === 'rejected') throw result.reason;
      words.push(result.value);
    }
    requireLive(owner); // A redirected owner must not start a now-useless decode.
    const first = words[0]; if (first === undefined) throw new Error('Missing world scene geometry bytes');
    await intake.load(first, row.segments === undefined ? undefined : words.slice(1));
    geometry = intake.take();
  }
  let asset: string | undefined;
  let temporary = true;
  try {
    requireLive(owner);
    // Concurrent cold readers decode privately; only a completed live winner is shared.
    const winner = memo.get(key);
    if (winner !== undefined) { temporary = false; geometry.dispose(); return lease(owner, assets, winner); }
    const id = `scene:${geometry.uuid}`;
    withOwner(owner, () => assets.register(id, geometry, { retain: true, cache: true, reusable: true, revisit }));
    asset = id;
    const held = lease(owner, assets, geometry);
    memo.set(key, geometry);
    forgetWhenDisposed(geometry, memo, key, geometry); // its listener holds no product or owner of this reader
    if (restored === undefined && product.shardfile !== undefined) void saveHomeBuildGeometry(product.shardfile, `owned:${key}`, new Map([['model', { geometry, matrix: new Matrix4() }]]));
    return held;
  } catch (error) {
    if (asset !== undefined) assets.evictCached(asset); else if (temporary) geometry.dispose();
    throw error;
  }
}

/** One four-model preparation window across ordered library cursors. Refill
 * before yielding a completed lease so transport/decode can use a caller's
 * publication pause. Closing drains all started work and releases untaken
 * leases; yielded leases retain their original independent owner. */
export async function* readWorldSceneGeometries(owner: Scope, product: GeometryProduct,
  rows: readonly Source[], assets: Assets, reuse: GeometryReuse = {}): AsyncGenerator<WorldSceneGeometry, void> {
  const pending = new Map<number, Promise<WorldSceneGeometry>>();
  // Warm templates need no transport. One file window spans cold model rows,
  // including their segments, without increasing concurrent decoded leases.
  const keys = homeBuildGeometryKeys(product.shardfile), homeKeys = keys === undefined ? undefined : await keys;
  const files = [...new Set(rows.flatMap(row => cachedWorldSceneGeometry(product, row, assets, reuse)
    || homeKeys?.has(`owned:${templateKey(product, row, reuse.revisit === true)}`) === true ? [] : [row.file].concat(row.segments ?? [])))];
  const indices = new Map(files.map((file, index) => [file, index]));
  const reads = new PreparationReads(files, file => product.file(file), () => !owner.disposed && !owner.disposing);
  const taken = new Map<string, Promise<Uint8Array>>(), refills = new Set<PreparationReads<string>>();
  const source = { ...(product.shardfile === undefined ? {} : { shardfile: product.shardfile }), url: product.url, file: (file: string): Promise<Uint8Array> => {
    const prior = taken.get(file); if (prior !== undefined) return prior;
    const index = indices.get(file);
    // An idle template can be pressure-evicted before its later decode cursor
    // borrows it. Rehydrate through the same bounded verified transport queue.
    const read = index === undefined ? (async () => {
      const refill = new PreparationReads([file], name => product.file(name), () => !owner.disposed && !owner.disposing);
      refills.add(refill);
      try { return await refill.take(0); } finally { await refill.close(); refills.delete(refill); }
    })() : reads.take(index);
    taken.set(file, read); return read;
  } };
  let next = 0;
  const fill = (): void => {
    requireLive(owner);
    while (pending.size < 4 && next < rows.length) {
      const row = rows[next]; if (row === undefined) throw new Error('Missing world geometry preparation row');
      const ready = readWorldSceneGeometry(owner, source, row, assets, reuse);
      void ready.catch(() => undefined); pending.set(next++, ready);
    }
  };
  try {
    fill();
    for (let index = 0; index < rows.length; index++) {
      const ready = pending.get(index); if (ready === undefined) throw new Error('Missing world geometry preparation');
      const geometry = await ready; pending.delete(index);
      fill();
      yield geometry;
    }
  } finally {
    const closing = Promise.all([reads.close(), ...[...refills].map(refill => refill.close())]);
    const settled = await Promise.allSettled(pending.values());
    for (const result of settled) if (result.status === 'fulfilled') result.value.done();
    pending.clear();
    await closing; taken.clear();
  }
}
