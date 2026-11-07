import { BufferAttribute, Object3D, type BufferGeometry } from 'three';
import { app } from './runtime';
import { containerResources, sceneResources } from './sceneOwnership';
import { dispatchRebind } from '../../../shared/engine/app/scope';
import { cacheUntilDisposed as trackCacheUntilDisposed } from './disposalCache';

/** A module cache keeps source meshes alive across loads; consumers acquire their shared GPU resources. */
export function retainCachedResources<T>(value: T): T {
  const resources = value instanceof Object3D ? sceneResources(value) : containerResources(value);
  for (const resource of resources) {
    const key = `scene:${String(Reflect.get(resource, 'uuid'))}`;
    if (!app.assets.has(key)) app.assets.register(key, resource, { retain: true, cache: true });
  }
  return value;
}

/**
 * Refresh a live geometry's binding states after a node build adds attributes (three does this through `dispose()`).
 * CPU-backed buffers may upload again; buffers whose CPU arrays were released stay live. Memos that hold the geometry
 * (`cacheUntilDisposed`) keep their value, so a shard's loaded views and built fields survive their first graph draw.
 */
export function rebindGeometry(geometry: BufferGeometry): void {
  // Static attributes can relinquish their CPU arrays after upload. A
  // binding refresh must retain those GPU buffers until real retirement.
  const retained = Object.entries(geometry.attributes).filter(([, attribute]) =>
    attribute instanceof BufferAttribute && attribute.count > 0 && attribute.array.byteLength === 0);
  for (const [name] of retained) geometry.deleteAttribute(name);
  try { dispatchRebind(geometry); }
  finally { for (const [name, attribute] of retained) geometry.setAttribute(name, attribute); }
}

/** Existing application/legacy entry; the defining tracker has no application value dependency. */
function cacheUntilDisposed<T>(value: T, invalidate: () => void): T {
  return trackCacheUntilDisposed(value, invalidate);
}

/**
 * `cacheUntilDisposed` for one memo entry: forget `entry` under `key` once `value` retires. The listener is made here, so
 * it holds only the memo, the key and the entry. One made inside a loader keeps the loader's whole context (an async
 * reader's product, owner and scope across its awaits): a page-cached geometry then kept the first grid region that
 * loaded it alive for the page's life (live P0: Driftwood -> Sky Reach -> Driftwood on the phone).
 */
export function forgetWhenDisposed<K, E>(value: object, memo: Map<K, E>, key: K, entry: E): void {
  cacheUntilDisposed(value, () => { if (memo.get(key) === entry) memo.delete(key); });
}

/** A keyed memo `memoUntilDisposed` keeps values in (a Map or a WeakMap). */
export interface DisposalMemo<K, V> { readonly get: (key: K) => V | undefined; readonly set: (key: K, value: V) => unknown; readonly delete: (key: K) => unknown }

/**
 * `memo`'s value for `key`, made by `make()` on a miss and kept until any resource it owns retires (`cacheUntilDisposed`;
 * a promise is tracked once it settles, and a rejected one is forgotten so the next call retries). A newer value under
 * the same key is never evicted by an older one's retirement.
 */
export function memoUntilDisposed<K, V>(memo: DisposalMemo<K, V>, key: K, make: () => V): V {
  const kept = memo.get(key);
  if (kept !== undefined) return kept;
  const made = make();
  memo.set(key, made);
  return cacheUntilDisposed(made, () => { if (memo.get(key) === made) memo.delete(key); });
}

/** Keyed borrowed resources: share acquisition, forget retired values, and retry failures without caching them. */
export class ResourceMemo<K extends string, V extends object> {
  private readonly ready = new Map<K, V>();
  private readonly pending = new Map<K, { promise: Promise<V>; token: symbol }>();
  private readonly invalidated: (key: K) => void;
  constructor(invalidated: (key: K) => void = () => undefined) { this.invalidated = invalidated; }
  peek(key: K): V | undefined { return this.ready.get(key); }
  entries(): IterableIterator<[K, V]> { return this.ready.entries(); }
  /** Forget without disposing borrowed resources; the owning scope still releases them. */
  invalidate(key: K): void {
    const known = this.ready.has(key) || this.pending.has(key);
    this.ready.delete(key); this.pending.delete(key);
    if (known) this.invalidated(key);
  }
  private publish(key: K, value: V): V {
    cacheUntilDisposed(value, () => { if (this.ready.get(key) === value) this.invalidate(key); });
    this.ready.set(key, value);
    return value;
  }
  /** Synchronous factories run only on a miss; thrown errors never publish a value. */
  acquire(key: K, create: () => V): V {
    const known = this.ready.get(key);
    if (known !== undefined) return known;
    const value = create();
    const made = this.publish(key, value);
    this.pending.delete(key);
    return made;
  }
  /** Begin immediately, sharing one promise per key through completion. Late invalidated loads cannot replace a newer value. */
  load(key: K, create: () => Promise<V>): Promise<V> {
    const known = this.pending.get(key);
    if (known !== undefined) return known.promise;
    const ready = this.ready.get(key);
    if (ready !== undefined) {
      const pending = Promise.resolve(ready); this.pending.set(key, { promise: pending, token: Symbol('resource') }); return pending;
    }
    const token = Symbol('resource');
    // Invoke now, converting even a synchronous factory throw into a rejected load.
    const loading = new Promise<V>(resolve => { resolve(create()); });
    const settle = async (): Promise<V> => {
      try {
        const value = await loading;
        if (this.pending.get(key)?.token === token) this.publish(key, value);
        return value;
      } catch (error: unknown) {
        if (this.pending.get(key)?.token === token) this.pending.delete(key);
        throw error;
      }
    };
    const pending = settle();
    this.pending.set(key, { promise: pending, token });
    return pending;
  }
}
