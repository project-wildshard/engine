import type { ResidencyAllocator, ResidencyLease } from '../../../shared/game/grid/allocator';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { ApproachInputsDeferredError } from './productInputs';
import { productResidentBytesSteps } from '../shardfile/productCost';
import { workSlice } from '@wildshard/engine/core/workSlice';

/** A required product read the shared budget refused for now (not a broken product). */
export const PRODUCT_DEFERRED = 'Product residency admission deferred';

/** A caller holds the product while any admitted source or immutable transport bytes are still in use. */
export interface ProductLease<T> { readonly value: T; release: () => void }
interface Entry<T> { promise: Promise<T>; claim: ResidencyLease | undefined; bytes: number; users: number; settled: boolean; failed: boolean; optional: boolean }

/** Page-owned product cache. In-flight/active users are pinned; unused products participate in ordinary allocator eviction. */
export class ProductLeases<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private closed = false;
  constructor(private readonly allocator: ResidencyAllocator, private readonly owner: string) {}
  private disposed(): boolean { return this.closed; }
  /** An approach can join an existing admission, never start another product load. */
  has(key: string): boolean { return !this.closed && this.entries.has(key); }
  /** Reserve the source/wire claim before the loader reads immutable assets; concurrent copies share one admission. */
  async acquire(key: string, load: (reserve: (source: Shardfile) => Promise<void>, releaseBytes: (bytes: number) => void) => Promise<T>, optional = false): Promise<ProductLease<T>> {
    if (this.disposed()) throw new Error('Product cache disposed');
    let entry = this.entries.get(key);
    if (entry === undefined) {
      const fresh: Entry<T> = { promise: Promise.resolve().then(async () => {
        try {
          const value = await load(async source => {
            if (this.closed || fresh.claim !== undefined) throw new Error('Product admission disposed or reserved twice');
            // T10: the source's residency walk (preflight and heap count) runs in steps under the frame's work slice, the
            // same checks and bytes: in a drive it was one 23-34 ms unit of a drawn frame per product at phone 4x
            // Small iterator units matter too: a 4096-value step can exceed
            // a live frame before the outer slice clock gets another check.
            const steps = productResidentBytesSteps(source, 64), slice = workSlice(4);
            let step = steps.next();
            while (step.done !== true) { if (slice.due()) await slice.yield(); step = steps.next(); }
            if (this.closed || fresh.claim !== undefined) throw new Error('Product admission disposed or reserved twice');
            fresh.bytes = step.value;
            const request = { id: `product:${this.owner}:${key}`, category: 'product' as const, owner: this.owner,
              bytes: fresh.bytes, distance: 0, needed: true, evictSync: () => { this.entries.delete(key); fresh.claim = undefined; } };
            const claim = fresh.optional ? this.allocator.reserveIfFits(request) : this.allocator.reserve(request);
            if (claim === null) { if (fresh.optional) throw new ApproachInputsDeferredError(); throw new Error(PRODUCT_DEFERRED); } fresh.claim = claim;
          }, bytes => {
            if (this.closed) return; // A decoder completing after page disposal has no live claim to reduce.
            if (fresh.claim === undefined) throw new Error('Transport release needs a product claim');
            fresh.claim.shrink(fresh.bytes - bytes); fresh.bytes -= bytes;
          });
          if (fresh.claim === undefined) throw new Error('Product loader omitted pre-asset residency admission');
          fresh.settled = true; return value;
        } catch (error) { fresh.failed = true; this.drop(key, fresh); throw error; }
      }), claim: undefined, bytes: 0, users: 0, settled: false, failed: false, optional };
      entry = fresh; this.entries.set(key, fresh);
    }
    const held = entry; if (!optional) held.optional = false; held.users++; held.claim?.update({ needed: true });
    let released = false;
    const release = (): void => {
      if (released) return; released = true; held.users--;
      if (held.users === 0) {
        if (this.closed || held.failed) this.drop(key, held);
        else if (held.settled) held.claim?.update({ needed: false });
      }
    };
    try {
      const value = await held.promise;
      if (this.disposed()) throw new Error('Product cache disposed during admission');
      return { value, release };
    } catch (error) { release(); throw error; }
  }
  private drop(key: string, entry: Entry<T>): void {
    if (this.entries.get(key) === entry) this.entries.delete(key);
    entry.claim?.release(); entry.claim = undefined;
  }
  /** Forget every unused promise now; active readers retain their claim until their own idempotent release. */
  dispose(): void {
    this.closed = true;
    for (const [key, entry] of this.entries) if (entry.users === 0) this.drop(key, entry);
  }
}
