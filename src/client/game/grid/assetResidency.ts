import type { App } from '@wildshard/engine/app/app';
import type { Disposable3, Scope } from '@wildshard/engine/app/scope';
import type { ResidencyAllocator, ResidencyLease, ResidencyEviction } from '../../../shared/game/grid/allocator';

type AssetPort = Parameters<App['assets']['bindResidency']>[0];
/** Renderer composition supplies concrete allocation identities; Node residency imports no rendering module. */
export type AssetAllocationReader = (resource: Disposable3) => readonly { identity: object; bytes: number; kind: 'cpu' | 'gpu' }[];
interface CacheConsumer { readonly users: Map<Scope, (() => void) | undefined>; readonly evict: (() => boolean) | undefined; readonly reusable: boolean; readonly revisit: boolean; active: boolean; lastUse: number; retired: boolean }
interface Allocation { readonly identity: object; lease: ResidencyLease; readonly bytes: number; readonly kind: 'cpu' | 'gpu'; readonly consumers: Set<CacheConsumer>; refs: number; covering: string | undefined; independent: boolean }
const bridges = new WeakMap<ResidencyAllocator, AssetResidencyBridge>();

/** One page's retained allocation bridge: CPU backing stores, GPU attributes and texture source/sampler pairs are
 * deduplicated by identity. A whole-runtime claim covers only resources actually registered/drawn in its owner scope. */
export class AssetResidencyBridge implements AssetPort {
  private readonly allocations = new Map<object, Allocation>();
  private readonly consumers = new Set<CacheConsumer>();
  private readonly owners = new Map<Scope, string>();
  private sequence = 0;
  private uses = 0;
  private readonly allocator: ResidencyAllocator;
  private readonly readAllocations: AssetAllocationReader;
  private readonly readOwner: () => Scope | null;
  constructor(allocator: ResidencyAllocator, readAllocations: AssetAllocationReader, readOwner: () => Scope | null = () => null) {
    this.allocator = allocator; this.readAllocations = readAllocations; this.readOwner = readOwner;
    if (bridges.has(allocator)) throw new Error('Allocator already has an asset bridge');
    bridges.set(allocator, this);
  }
  /** Bind the reviewed whole-runtime claim to a resident scope, never merely to whichever shard is current. */
  cover(scope: Scope, claim: ResidencyLease): void {
    if (scope.disposed || !this.allocator.entries().some(entry => entry.id === claim.id && entry.category === 'sim')) throw new Error('Cache coverage requires a live runtime');
    const old = this.owners.get(scope);
    if (old !== undefined && old !== claim.id) throw new Error('Runtime cache coverage changed identity');
    if (old !== undefined) return;
    this.owners.set(scope, claim.id);
    scope.onDisposeSteps(() => this.retireCoverage(scope));
  }
  /** A covered runtime's retirement: each consumer it leaves unused is evicted, one per part (O20: Nine's evictions in one
   *  cleanup held a sliced retirement's frame 7.7 s on the Simulator). */
  private *retireCoverage(scope: Scope): Generator<undefined, void> {
    this.owners.delete(scope);
    const errors: unknown[] = [];
    for (const consumer of this.consumers) if (this.forgetUser(consumer, scope) || consumer.users.size === 0) {
      // Async source templates may never be drawn; with no consumer/acquisition they are safe to evict too.
      consumer.retired = true;
      try { this.evictUnused(consumer); } catch (error) { errors.push(error); }
      yield;
    }
    if (errors.length > 0) throw new AggregateError(errors, 'Runtime cache retirement failed');
  }
  private runtimeOwner(scope: Scope | null): Scope | undefined {
    if (scope === null || scope.disposed) return undefined;
    let closest: Scope | undefined;
    for (const [owner, claim] of this.owners) if (scope.belongsTo(owner) && this.allocator.has(claim) &&
      (closest === undefined || owner.belongsTo(closest))) closest = owner;
    return closest;
  }
  private covering(scope: Scope | null): string | undefined {
    const owner = this.runtimeOwner(scope); return owner === undefined ? undefined : this.owners.get(owner);
  }
  // The dated native measurement is a coverage ceiling, not a bound on concrete storage. Larger caches
  // remain visible, independently charged allocations and must pass the normal shared admission policy.
  private coverage(bytes: number, preferred: string | undefined, id?: string): string | undefined {
    if (preferred === undefined) return undefined;
    const remaining = this.allocator.coverageRemaining(preferred, id);
    return remaining !== null && bytes <= remaining ? preferred : undefined;
  }
  private reserve(bytes: number, kind: 'cpu' | 'gpu', covering: string | undefined, identity: object): ResidencyLease {
    const lease = this.allocator.reserve({ id: `commons:retained:${String(++this.sequence)}:${kind}`, category: 'commons', owner: 'platform',
      bytes, distance: 0, needed: true, prepareEvict: () => this.prepareEviction(identity), ...(covering === undefined ? {} : { coveredBy: covering }) });
    if (lease === null) throw new Error('Retained cache admission deferred by the shared budget');
    return lease;
  }
  private evictUnused(consumer: CacheConsumer): void {
    for (const user of consumer.users.keys()) if (user.disposed) this.forgetUser(consumer, user);
    // Ordinary reuse spans live residents. Explicit revisit builds keep their real
    // idle charges until budget pressure evicts them; active acquisitions stay protected.
    if (consumer.retired && consumer.users.size === 0 && !consumer.revisit && (!consumer.reusable || !consumer.active)) consumer.evict?.();
  }
  private forgetUser(consumer: CacheConsumer, scope: Scope): boolean {
    if (!consumer.users.has(scope)) return false;
    const forget = consumer.users.get(scope);
    consumer.users.delete(scope); forget?.(); return true;
  }
  /** Tiles and other non-runtime consumers can share a cache with a live page.
   * Their retirement must detach immediately, without waiting for that cache's
   * final acquisition or a covered runtime's cleanup to prune their scopes. */
  private observeUser(consumer: CacheConsumer, scope: Scope, independent: boolean): void {
    if (consumer.users.has(scope)) return;
    // Covered runtimes retain their existing stepped eviction/error boundary.
    const forget = independent ? scope.capture('disposers', () => {
      consumer.users.delete(scope); consumer.retired = true; this.evictUnused(consumer);
    }) : undefined;
    consumer.users.set(scope, forget);
  }
  private prepareEviction(identity: object): ResidencyEviction | null {
    // G639: asked once per eviction candidate (a burst of idle builds on an entry over target): check the set in place and
    // copy it only for an eviction that will happen
    const entry = this.allocations.get(identity);
    if (entry === undefined || entry.consumers.size === 0) return null;
    for (const consumer of entry.consumers) if (!consumer.reusable || consumer.active || consumer.evict === undefined) return null;
    const consumers = [...entry.consumers];
    return { commit: () => {
      for (const consumer of consumers) if (consumer.evict?.() !== true) throw new Error('Retained cache eviction refused');
    }, abort: () => undefined };
  }
  /** The allocator keeps the same real charges; only idle reusable allocations become eviction candidates. */
  private refresh(held: readonly Allocation[]): void {
    for (const entry of held) {
      const consumers = [...entry.consumers];
      const needed = consumers.some(consumer => !consumer.reusable || consumer.active);
      const newest = Math.max(0, ...consumers.map(consumer => consumer.lastUse));
      entry.lease.update({ needed, distance: 1 / (newest + 1) });
    }
  }
  /** AssetService calls this before adopting a cache; refusal releases every partially prepared allocation. */
  register(_key: string, resource: Disposable3, owner: Scope | null, evict?: () => boolean, reusable = false, revisit = false): ReturnType<AssetPort['register']> {
    if (revisit && !reusable) throw new Error('Revisit cache requires reusable ownership');
    const held: Allocation[] = [], covering = revisit ? undefined : this.covering(owner ?? this.readOwner());
    const unhold: (() => void)[] = [];
    try {
      for (const row of this.readAllocations(resource)) {
        let entry = this.allocations.get(row.identity);
        if (revisit && entry?.covering !== undefined) throw new Error('Revisit backing must be independently charged');
        if (entry === undefined) {
          const actualCoverage = this.coverage(row.bytes, covering), lease = this.reserve(row.bytes, row.kind, actualCoverage, row.identity);
          entry = { identity: row.identity, lease, bytes: row.bytes, kind: row.kind, consumers: new Set(), refs: 0, covering: actualCoverage, independent: revisit }; this.allocations.set(row.identity, entry);
        }
        if (revisit) entry.independent = true;
        entry.refs++; held.push(entry); unhold.push(entry.lease.hold());
      }
    } catch (error) { this.release(held); for (const release of unhold) release(); throw error; }
    let live = true;
    const consumer: CacheConsumer = { users: new Map(), evict, reusable, revisit, active: false, lastUse: ++this.uses, retired: false };
    for (const entry of held) entry.consumers.add(consumer);
    const initialOwner = this.runtimeOwner(owner ?? this.readOwner());
    this.consumers.add(consumer);
    const observe = (scope: Scope | null): void => {
      if (!live) return;
      const runtime = this.runtimeOwner(scope);
      const user = runtime ?? (scope !== null && !scope.disposed ? scope : undefined);
      if (user !== undefined && consumer.users.has(user)) return; // Draws repeat; admission/coverage runs once per consumer.
      const next = this.covering(scope);
      // Parent retirement itself exposes the bytes; a page draw cannot hide them.
      if (next !== undefined) for (const entry of held) {
        // Revisit storage outlives a runtime; a recycled sim id grants no coverage.
        if (entry.independent) continue;
        if (entry.covering === next) continue;
        const actualCoverage = this.coverage(entry.bytes, next, entry.lease.id);
        if (entry.covering === actualCoverage) continue;
        if (actualCoverage === undefined && entry.covering !== undefined && this.allocator.has(entry.covering)) {
          // Admit the new charge before releasing the old covered reference: a refusal leaves it intact.
          const replacement = this.reserve(entry.bytes, entry.kind, undefined, entry.identity);
          entry.lease.release(); entry.lease = replacement;
        } else entry.lease.update({ coveredBy: actualCoverage ?? null });
        entry.covering = actualCoverage;
      }
      if (user !== undefined) this.observeUser(consumer, user, runtime === undefined);
    };
    try { observe(initialOwner ?? null); this.refresh(held); }
    catch (error) { live = false; this.consumers.delete(consumer); this.release(held, consumer); throw error; }
    finally { for (const release of unhold) release(); }
    return { observe, active: value => {
      if (!live) return;
      consumer.active = value; consumer.lastUse = ++this.uses; this.refresh(held);
    }, unused: () => { if (live) this.evictUnused(consumer); }, release: () => { if (live) { live = false; this.consumers.delete(consumer); this.release(held, consumer); } } };
  }
  private release(held: readonly Allocation[], consumer?: CacheConsumer): void {
    if (consumer !== undefined) for (const scope of consumer.users.keys()) this.forgetUser(consumer, scope);
    // O20: each entry keeps its identity, so a region's retirement deletes in O(1) instead of scanning every allocation
    for (const entry of held) {
      if (consumer !== undefined) entry.consumers.delete(consumer);
      if (--entry.refs === 0) { entry.lease.release(); this.allocations.delete(entry.identity); }
      else this.refresh([entry]);
    }
  }
  /** Detach only with the actual renderer owner; unloading a level alone must not uncharge still-live cached GPU data. */
  dispose(): void {
    for (const consumer of this.consumers) for (const scope of consumer.users.keys()) this.forgetUser(consumer, scope);
    for (const entry of this.allocations.values()) entry.lease.release();
    this.allocations.clear(); this.owners.clear(); this.consumers.clear(); bridges.delete(this.allocator);
  }
}

/** Regional factories can bind coverage only after obtaining their reviewed whole-runtime lease. No bridge means no
 * renderer cache exists in that Node/headless composition; the actual browser owner installs it before content boots. */
export function coverRuntimeAssets(allocator: ResidencyAllocator, scope: Scope, claim: ResidencyLease): void {
  bridges.get(allocator)?.cover(scope, claim);
}
