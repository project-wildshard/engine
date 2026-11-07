import { formatMB } from './plan';

/** Disk-prefetch facts supplied by the application; they never credit transport bytes. */
export interface LoadingPrefetchSnapshot {
  readonly phase: 'running' | 'done' | 'quota' | 'stopped' | 'error';
  readonly reason: string | null;
  readonly products: number; readonly productsRead: number;
  readonly knownFiles: number; readonly knownBytes: number;
  readonly presentFiles: number; readonly presentBytes: number;
  readonly storedFiles: number; readonly storedBytes: number;
}

/** The manifest operation is the sole source of download progress. */
export interface LoadingDownloadSnapshot {
  /** Native cache presence has not resolved yet; keep its percentage unknown. */
  readonly progressKnown?: boolean;
  /** Build-owned encoded representation sizes, separate from decoded admission/progress. */
  readonly wire?: {readonly totalBytes: number; readonly completedBytes: number; readonly cachedBytes: number; readonly arrivingBytes?: number};
  readonly totalBytes: number; readonly completedBytes: number; readonly cachedBytes: number;
  readonly filesTotal: number; readonly filesDone: number; readonly complete: boolean; readonly error: string | null;
  /** Bytes streamed so far, verified or not (a part's chunks before its members verify): progress for the stuck-boot
   *  watch (src/client/engine/boot/stuckStep.ts), never shown as downloaded. */
  readonly streamedBytes?: number;
}
export function loadingDownloadFraction(row: LoadingDownloadSnapshot): number {
  return row.complete ? 1 : row.totalBytes === 0 ? 0 : Math.min(0.999, row.completedBytes / row.totalBytes);
}
export function loadingDownloadText(row: LoadingDownloadSnapshot): string {
  const text = row.wire ?? row;
  // DL21: wire bytes still arriving count as they stream (decoded reads already credit per chunk)
  return `Spawn view · ${formatMB(text.completedBytes + (row.wire?.arrivingBytes ?? 0))}${row.complete ? '' : ` of ${formatMB(text.totalBytes)}`} · ${formatMB(text.cachedBytes)} from cache`;
}

/** The grid prefetch's own row: disk bytes against the set discovered so far (a finished run with every product read is 1). */
export function loadingPrefetchFraction(prefetch: LoadingPrefetchSnapshot): number {
  const complete = prefetch.phase === 'done' && prefetch.productsRead === prefetch.products
    && prefetch.presentFiles + prefetch.storedFiles === prefetch.knownFiles;
  return complete ? 1 : Math.min(0.999, (prefetch.presentBytes + prefetch.storedBytes) / Math.max(1, prefetch.knownBytes));
}

export function loadingPrefetchText(prefetch: LoadingPrefetchSnapshot): string {
  const bytes = prefetch.presentBytes + prefetch.storedBytes, files = prefetch.presentFiles + prefetch.storedFiles;
  const state = prefetch.phase === 'running' ? 'prefetching' : prefetch.phase === 'done' ? 'prefetch finished' : 'prefetch stopped';
  // Even a finished run can skip a failed product: its discovered set is not an invented whole-set total.
  return `Streams in play · On disk: ${formatMB(bytes)} of ${formatMB(prefetch.knownBytes)} known so far · ${files} / ${prefetch.knownFiles} files · ${prefetch.productsRead} / ${prefetch.products} products checked · ${state}${prefetch.reason === null ? '' : ` (${prefetch.reason})`}`;
}
