import { parseEntryReadSet, nearestEntryReads, type EntryRead, type EntryReadSet, type RegionEntryReads } from '@wildshard/format/entryReads';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { outputDescriptor } from '../../../shared/game/shardfile/outputDescriptor';
import { contentURL } from '@wildshard/engine/boot/contentBase';

/** A region's recorded entry reads: `public/assets/<slug>/entry-reads.json` (the T7.14 runtime slice: one real entry's
 *  first-demand reads, committed as data; the bake-time crawl replaces the file). */
export const entryReadsUrl = (slug: string): string => `/assets/${slug}/entry-reads.json`;
/** reads started at once: enough to keep a phone link busy, few enough to leave the drive's own tile reads their turn */
const PARALLEL_READS = 3;
const ENTRY_CENTRE = { x: 0, z: 0 };

export interface EntryReadPorts {
  /** this approach's product: a recorded blob still in it is read through its reader, which keeps it in the content cache */
  readonly source: Pick<Shardfile, 'files'>;
  readonly readBlob: (hash: string) => Promise<unknown>;
  /** an immutable public asset: fetched once into the HTTP cache (`/assets/*` is `immutable`, so the entry's read hits it) */
  readonly fetchAsset: (read: EntryRead, signal: AbortSignal) => Promise<unknown>;
  /** Optional work uses headroom only; a refusal skips the read, never evicts. */
  readonly reserve: (read: EntryRead) => { readonly release: () => void } | null;
  readonly fetchJson: (url: string, signal: AbortSignal) => Promise<unknown>;
}

/** The reads worth starting: the tier's recorded row in its first-demand order, blobs only while this product still holds
 *  them (a rebuilt product's changed files are skipped), assets as recorded. */
export function entryReadPlan(rows: EntryReadSet, tier: RegionEntryReads['tier'], slug: string, source: Pick<Shardfile, 'files'>, at: { readonly x: number; readonly z: number } = ENTRY_CENTRE): readonly EntryRead[] {
  // the record lives at the region's own path (`entryReadsUrl`): its rows are that region's
  const row = nearestEntryReads(rows, tier, at);
  if (row === undefined) return [];
  // A record may predate an added device tag while the immutable body/hash is
  // unchanged. Do not let that stale hint reintroduce the other device's bytes.
  // Actual admission/readers retain their authoritative critical/dependency rules.
  const otherTier = new Set(outputDescriptor(source)?.index.files.filter(file => file.tier !== undefined && file.tier !== tier).map(file => file.hash));
  const held = new Map(source.files.filter(file => !otherTier.has(file.hash)).map(file => [file.hash, file.compressed])), blobs = `/shardfiles/${slug}/blobs/`;
  return row.reads.filter(read => read.url.startsWith(blobs) ? held.get(read.hash) === read.bytes : read.url.startsWith('/assets/'));
}

/**
 * T7.14: while the verified approach drives toward `slug`, read what its entry will read, nearest-first, so the hold finds
 * it in the content / HTTP cache instead of downloading ~35 MB (Pine cold on a phone link). Read-only: nothing is
 * constructed, decoded or kept in memory past each read. A turn-away aborts `signal`: no new read starts. A missing or
 * stale record prefetches nothing; a failed read is skipped (the entry reads it as before).
 */
export async function prefetchEntryReads(slug: string, tier: RegionEntryReads['tier'], ports: EntryReadPorts, signal: AbortSignal, at?: { readonly x: number; readonly z: number }): Promise<number> {
  if (signal.aborted) return 0;
  let rows: EntryReadSet;
  try { rows = parseEntryReadSet(await ports.fetchJson(contentURL(entryReadsUrl(slug)), signal)); } catch { return 0; }
  const plan = entryReadPlan(rows, tier, slug, ports.source, at), blobs = `/shardfiles/${slug}/blobs/`;
  let next = 0, done = 0;
  const lane = async (): Promise<void> => {
    while (!signal.aborted && next < plan.length) {
      const read = plan[next++]; if (read === undefined) return;
      const lease = ports.reserve(read); if (lease === null) continue;
      try {
        if (signal.aborted) return;
        await (read.url.startsWith(blobs) ? ports.readBlob(read.hash) : ports.fetchAsset(read, signal)); done++;
      } catch { /* the entry reads it itself */ }
      finally { lease.release(); }
    }
  };
  const settled = await Promise.allSettled(Array.from({ length: Math.min(PARALLEL_READS, plan.length) }, lane));
  for (const row of settled) if (row.status === 'rejected') throw row.reason;
  return done;
}
