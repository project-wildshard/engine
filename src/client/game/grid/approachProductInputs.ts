import { gridShardfileProduct, type GridProduct, type GridProductOwner } from './products';
import { ApproachInputsDeferredError } from './productInputs';
import type { Scope } from '@wildshard/engine/app/scope';
import { timeClientPreparation } from '../shardfile/preparationTiming';
import { prefetchEntryReads } from './entryReadPrefetch';
import { boundedResponse } from '../shardfile/product';
import { TIER } from '@wildshard/engine/core/tier';

let readGeneration = 0;
type InputBorrow = Pick<GridProduct, 'releaseInputs' | 'release'>;

/** Keep one verified input borrow through an approach. Cancellation drains the
 * started acquisition before releasing its charged bytes; a constructor's
 * overlapping borrow keeps the same inputs alive until its own final release. */
export async function holdApproachInputs(acquire: (signal: AbortSignal) => Promise<InputBorrow | undefined>, signal: AbortSignal, owner: Scope): Promise<void> {
  if (signal.aborted || owner.disposed || owner.disposing) return;
  const lifetime = owner.child('grid.approach-inputs'), controller = new AbortController();
  let stop = (): void => undefined;
  const ended = new Promise<void>(resolve => { stop = resolve; });
  lifetime.onDispose(() => { controller.abort(); stop(); }); lifetime.listen(signal, 'abort', () => { lifetime.dispose(); }, { once: true });
  try {
    const input = await acquire(controller.signal);
    if (input === undefined) return;
    try { if (!lifetime.disposed) await ended; }
    finally { try { await input.releaseInputs(); } finally { input.release(); } }
  } finally { lifetime.dispose(); }
}

/** Approach IO uses ordinary product admission, verification and input claims.
 * No strips, regional foundation, runtime hooks or readiness are constructed. */
export function prepareApproachProductInputs(slug: string, owner: GridProductOwner & { readonly scope: Scope }, signal: AbortSignal, at?: { readonly x: number; readonly z: number }): Promise<void> {
  return holdApproachInputs(approachSignal => timeClientPreparation(slug, 'grid.approach.inputs', async () => {
    // No ordinary input acquisition may run before the speculative headroom check.
    // A missing metadata admission defers this optimization to actual entry.
    const pending = gridShardfileProduct(slug, owner, { signal: approachSignal });
    if (pending === null) return undefined;
    let product: GridProduct;
    try { product = await pending; }
    catch (error) { if (error instanceof ApproachInputsDeferredError) return undefined; throw error; }
    // T7.14: what this region's entry will read, nearest-first, into the content / HTTP cache while the approach lasts
    try {
      const generation = ++readGeneration;
      let readId = 0;
      const count = await prefetchEntryReads(slug, TIER, { source: product.admitted.source, readBlob: hash => product.reader.read(hash, 'low'),
        reserve: read => owner.allocator.reserveIfFits({ id: `entry-read:${slug}:${generation}:${++readId}`, owner: 'grid', category: 'product',
          bytes: 2 * read.bytes, distance: 0, needed: true }),
        fetchAsset: async (read, abort) => {
          const response = await fetch(read.url, { signal: abort, priority: 'low' });
          if (!response.ok) throw new Error(`Entry asset refused: ${String(response.status)}`);
          const bytes = await boundedResponse(response, read.bytes);
          if (bytes.length !== read.bytes || await product.options.hash(bytes) !== read.hash) throw new Error('Entry asset hash or size differs');
        },
        fetchJson: async (url, abort) => {
          const lease = owner.allocator.reserveIfFits({ id: `entry-read:${slug}:${generation}:record`, owner: 'grid', category: 'product',
            bytes: 4 * 1024 * 1024, distance: 0, needed: true });
          if (lease === null) throw new ApproachInputsDeferredError();
          try {
            const response = await fetch(url, { signal: abort, cache: 'no-cache' });
            if (!response.ok) throw new Error(`${String(response.status)} ${url}`);
            const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await boundedResponse(response, 2 * 1024 * 1024)));
            return value;
          } finally { lease.release(); }
        } }, approachSignal, at);
      if (count > 0) performance.mark('wildshard.approach.entry-reads', { detail: { slug, count } });
      return product;
    } catch (error) {
      try { await product.releaseInputs(); } finally { product.release(); }
      throw error;
    }
  }), signal, owner.scope);
}
