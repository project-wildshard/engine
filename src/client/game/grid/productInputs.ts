import type { ResidencyLease } from '../../../shared/game/grid/allocator';
import { ClientAssets } from '../shardfile/clientAssets';
import type { AdmittedProduct, ProductOptions } from '../shardfile/product';

/** Synchronous preparation inputs are borrowed only until `release`; later borrowers rehydrate verified bytes. */
export interface ProductInputLease { readonly assets: ReadonlyMap<string, Uint8Array>; release: () => Promise<void> }
type Claim = Pick<ResidencyLease, 'shrink' | 'release'>;
/** An optional read-ahead cannot borrow headroom without evicting a resident. */
export class ApproachInputsDeferredError extends Error {
  constructor() { super('Product input residency admission deferred'); this.name = 'ApproachInputsDeferredError'; }
}

/** GC6: reads in flight for a world's input read-back, and for a cancellable approach's. */
export const INPUT_READS = 16, APPROACH_INPUT_READS = 12;
/** Run `read` over `refs` with at most `width` in flight; the first failure stops new reads, waits for those in flight and
 *  throws. `active` is checked before each new read (it throws on cancellation). */
export async function readWindow(refs: readonly string[], width: number, active: () => void, read: (ref: string) => Promise<void>): Promise<void> {
  let next = 0, failure: { readonly error: unknown } | undefined;
  const lane = async (): Promise<void> => {
    while (failure === undefined && next < refs.length) {
      const ref = refs[next++]; if (ref === undefined) return;
      try { active(); await read(ref); } catch (error) { failure ??= { error }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, refs.length) }, lane));
  if (failure !== undefined) throw failure.error;
}

/** One admitted grid product's transient inputs, shared by overlapping preparations, never by finished promises. */
export class ProductInputs {
  readonly reader: ClientAssets;
  private readonly assets: Map<string, Uint8Array>;
  private readonly refs: readonly string[];
  private readonly transportRefs: readonly string[];
  private readonly claims: { refs: Set<string>; bytes: number; lease: Claim }[] = [];
  private users = 0;
  private pending = Promise.resolve();
  constructor(private readonly admitted: AdmittedProduct, options: ProductOptions, private readonly reserve: (bytes: number, speculative: boolean) => Claim, private readonly keep: ReadonlySet<string> = new Set(), transportRefs?: readonly string[]) {
    this.assets = new Map(admitted.assets); this.refs = [...this.assets.keys()];
    this.transportRefs = transportRefs === undefined ? this.refs : [...new Set(transportRefs)];
    this.reader = new ClientAssets(admitted.source, admitted.assets, options);
  }
  private run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.pending.then(work);
    // The settled queue carries no asset result or rejection into the page lifetime.
    this.pending = result.then(() => undefined, () => undefined); return result;
  }
  /** A decoder's release cannot uncharge a wire still borrowed by another preparation. */
  retains(ref: string): boolean { return this.assets.has(ref) || this.reader.retained.has(ref); }
  /** Metadata needs no input borrow; retire unused cold bytes through the same release authority. */
  releaseUnused(): Promise<void> {
    return this.run(async () => {
      if (this.users !== 0) return;
      const refs = [...this.assets.keys()].filter(ref => !this.keep.has(ref));
      if (refs.length === 0) return;
      const released = await this.admitted.releasePreparedTransport?.(refs, 'cache-or-fetch') ?? [];
      for (const ref of released) this.assets.delete(ref);
      this.reader.releaseTransport(released);
      for (const claim of this.claims) {
        for (const ref of released) claim.refs.delete(ref);
        const remaining = [...claim.refs].reduce((sum, ref) => sum + (this.assets.get(ref)?.byteLength ?? 0), 0);
        if (remaining === 0) claim.lease.release();
        else if (remaining < claim.bytes) claim.lease.shrink(remaining);
        claim.bytes = remaining;
      }
      for (let i = this.claims.length - 1; i >= 0; i--) if (this.claims[i]?.bytes === 0) this.claims.splice(i, 1);
    });
  }
  acquire(): Promise<ProductInputLease> { return this.acquireRefs(this.refs); }
  /** Explicit source-exit preparation restores only the originally admitted
   * tier's transport. Its charged borrow is shared with subsequent consumers. */
  acquireTransport(signal: AbortSignal, refs: readonly string[] = this.transportRefs): Promise<ProductInputLease> { return this.acquireSelected(refs, signal); }
  /** A demanded UI file borrows only its selected transport, never every world input. */
  acquireFiles(refs: readonly string[]): Promise<ProductInputLease> { return this.acquireSelected(refs); }
  private acquireSelected(refs: readonly string[], signal?: AbortSignal): Promise<ProductInputLease> {
    if (refs.some(ref => !this.transportRefs.includes(ref))) return Promise.reject(new Error('Unselected product input'));
    return this.acquireRefs([...new Set(refs)], signal);
  }
  private async acquireRefs(refs: readonly string[], signal?: AbortSignal): Promise<ProductInputLease> {
    this.users++;
    try {
      await this.run(async () => {
        const active = (): void => { if (signal?.aborted === true) throw new Error('Approach input acquisition cancelled'); };
        active();
        const missing = refs.filter(ref => !this.assets.has(ref));
        if (missing.length === 0) return;
        const source = this.admitted.source;
        const bytes = missing.reduce((sum, ref) => sum + (source.files.find(file => file.hash === ref)?.compressed ?? source.requires.commonsWire[ref.replace(/^commons:/u, '')] ?? 0), 0);
        const lease = this.reserve(bytes, signal !== undefined), loaded = new Map<string, Uint8Array>();
        try {
          // GC9: a cell's world reads its inputs back from the cache before it builds (Pine: about 1,500 files); one at a time
          // that read was most of the build behind a moving player's loading wall.
          // GC6 (QA 11-14 row 6): each read is a cache round trip that waits on drawn frames, so it is latency-bound, not
          // byte-bound: Nalati's ~860 inputs in lockstep batches of four took 20 s of its world's 30 s at Jake's 2992x1434@2.
          // A sliding window keeps INPUT_READS (a cancellable approach APPROACH_INPUT_READS) in flight; the bytes held are
          // the same (all of them are kept, and the lease above already charges them).
          await readWindow(missing, signal === undefined ? INPUT_READS : APPROACH_INPUT_READS, active, async ref => { loaded.set(ref, await this.reader.read(ref)); });
          active();
          for (const [ref, value] of loaded) this.assets.set(ref, value);
          this.claims.push({ refs: new Set(missing), bytes, lease });
        } catch (error) { lease.release(); throw error; }
      });
    } catch (error) { this.users--; throw error; }
    let live = true, closing: Promise<void> | undefined;
    return { assets: this.assets, release: () => {
      if (!live) return closing ?? Promise.resolve(); live = false; this.users--;
      closing = this.users === 0 ? this.releaseUnused() : Promise.resolve();
      return closing;
    } };
  }
}
