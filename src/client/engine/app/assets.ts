import type { Disposable3, Scope } from '../../../shared/engine/app/scope';
import { enteredOwner } from '../../../shared/engine/app/ownership';

export interface AssetRecord { key: string; refs: number; retained: boolean }
export type AssetCensus = readonly AssetRecord[];
/** Injected accounting follows a retained cache without coupling resource ownership to a cost model. */
export interface AssetResidencyHandle { observe: (owner: Scope | null) => void; release: () => void; unused?: () => void; active?: (value: boolean) => void }
/** The composition root supplies the budget. Register may refuse before this service adopts the resource. */
export interface AssetResidencyPort<T> { register: (key: string, resource: T, owner: Scope | null, evict?: () => boolean, reusable?: boolean, revisit?: boolean) => AssetResidencyHandle }
interface Entry<T> { key: string; resource: T; refs: number; retained: boolean; cached: boolean; reusable: boolean; revisit: boolean; residency: AssetResidencyHandle | undefined;
  /** a renderer's own cache, disposed natively (`forgetDisposed`) */ native: boolean; /** natively disposed while leased: it leaves at its last release */ forgotten: boolean }

/** Shared resources are released by consumers; only this service disposes them. */
export class AssetService<T extends Disposable3 = Disposable3> {
  private entries = new Map<string, Entry<T>>();
  private managed = new WeakSet();
  private readonly byResource = new WeakMap<object, Entry<T>>();
  private residency: AssetResidencyPort<T> | undefined;

  /** Reusable fixed builds survive resident retirement while idle, charged and pressure-evictable.
   * Consumers must acquire them; cache memos must invalidate on resource disposal.
   * revisit opts fixed builds into idle retention across region retirement, under the same budget/eviction policy. */
  register(key: string, resource: T, opts?: { retain?: boolean; cache?: boolean; reusable?: boolean; revisit?: boolean; native?: boolean }): T {
    if (this.entries.has(key)) throw new Error(`Asset already registered: ${key}`);
    const cached = opts?.cache === true;
    const reusable = opts?.reusable === true, revisit = opts?.revisit === true;
    if (revisit && !reusable) throw new Error('Revisit assets require reusable cache ownership');
    if (reusable && (!cached || opts.retain !== true)) throw new Error('Reusable assets require retained cache ownership');
    // SF57: a module cache's resource is attributed to an enclosing `withOwner` section's scope; outside one (after an
    // `await`) the residency port falls back to its own reader, as it did for the ambient owner, without an owner read
    const residency = cached ? this.residency?.register(key, resource, enteredOwner(), () => this.evictCached(key), reusable, revisit) : undefined;
    const entry = { key, resource, refs: 0, retained: opts?.retain ?? false, cached, reusable, revisit, residency, native: opts?.native === true, forgotten: false };
    this.entries.set(key, entry); this.byResource.set(resource, entry);
    this.managed.add(resource);
    return resource;
  }
  acquire(key: string): T {
    const entry = this.entries.get(key);
    if (!entry) throw new Error(`Unknown asset: ${key}`);
    if (entry.refs === 0) entry.residency?.active?.(true);
    entry.refs++;
    return entry.resource;
  }
  /** Retain an already managed object through its authoritative entry, without creating a second disposal owner. */
  acquireResource(resource: object): (() => void) | null {
    const entry = this.byResource.get(resource);
    if (entry === undefined) return null;
    // a native cache its renderer already disposed takes no new lease (a dispose handler's lookup is not a use)
    if (entry.forgotten) return () => undefined;
    this.acquire(entry.key);
    let live = true;
    return () => { if (live) { live = false; this.release(entry.key); } };
  }
  release(key: string): void {
    const entry = this.entries.get(key);
    if (!entry || entry.refs === 0) throw new Error(`Asset has no reference to release: ${key}`);
    entry.refs--;
    if (entry.refs === 0 && entry.forgotten) { this.drop(entry); return; }
    if (entry.refs === 0) entry.residency?.active?.(false);
    if (entry.refs === 0) entry.residency?.unused?.();
    if (!this.entries.has(key)) return; // Retirement may evict the now-unused cache.
    if (entry.refs === 0 && !entry.retained) {
      this.entries.delete(key);
      this.managed.delete(entry.resource); this.byResource.delete(entry.resource); entry.residency?.release();
      entry.resource.dispose();
    }
  }
  retained(): AssetCensus {
    return [...this.entries].map(([key, entry]) => ({ key, refs: entry.refs, retained: entry.retained }));
  }
  retainedResources(): readonly T[] { return [...this.entries.values()].filter((entry) => entry.retained).map((entry) => entry.resource); }
  /** Objects still held by explicit consumers, including renderer-lifetime acquisitions without cache retention. */
  acquiredResources(): readonly T[] { return [...this.entries.values()].filter(entry => entry.refs > 0).map(entry => entry.resource); }
  /** Budget owners may retire a module cache only after all explicit consumers release it. Disposal events invalidate
   * module memos before another admission can reuse their GPU resources; ordinary retained engine assets are excluded. */
  evictCached(key: string): boolean {
    const entry = this.entries.get(key);
    if (entry === undefined) return true;
    if (!entry.cached || entry.refs !== 0) return false;
    // Keep the ledger authoritative if native disposal throws; never uncharge a failed retirement.
    entry.resource.dispose();
    this.entries.delete(key); this.managed.delete(entry.resource); this.byResource.delete(entry.resource); entry.residency?.release();
    return true;
  }
  /** A renderer cache evicted an already-disposed resource; this does not dispose it a second time. A `native` cache
   *  (three's shadow depth variants, which it disposes with their source material) may be disposed while a resident still
   *  leases it from a draw: it then leaves at its last release. Any other leased asset refuses. */
  forgetDisposed(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    if (entry.refs !== 0) {
      if (!entry.native) throw new Error(`Disposed asset still acquired: ${key}`);
      entry.forgotten = true; return;
    }
    this.drop(entry);
  }
  private drop(entry: Entry<T>): void {
    this.entries.delete(entry.key); this.managed.delete(entry.resource); this.byResource.delete(entry.resource); entry.residency?.release();
  }
  /** Install one page's accounting port. Existing module caches are admitted before replacing any old binding. */
  bindResidency(port: AssetResidencyPort<T>): () => void {
    if (this.residency !== undefined) throw new Error('Asset residency already bound');
    const prepared = new Map<Entry<T>, AssetResidencyHandle>();
    try { for (const [key, entry] of this.entries) if (entry.cached) {
      const handle = port.register(key, entry.resource, null, () => this.evictCached(key), entry.reusable, entry.revisit);
      prepared.set(entry, handle); handle.active?.(entry.refs > 0);
    } }
    catch (error) { for (const handle of prepared.values()) handle.release(); throw error; }
    for (const [entry, handle] of prepared) entry.residency = handle;
    this.residency = port;
    let live = true;
    return () => {
      if (!live) return; live = false;
      for (const entry of this.entries.values()) { entry.residency?.release(); entry.residency = undefined; }
      this.residency = undefined;
    };
  }
  /** Draw-time ownership survives async loaders; a cache remains visible after its last content consumer retires. */
  observeResidency(resource: object, owner: Scope | null): void { this.byResource.get(resource)?.residency?.observe(owner); }
  has(key: string): boolean { return this.entries.has(key); }
  isAcquired(resource: object): boolean { return this.managed.has(resource); }
}
