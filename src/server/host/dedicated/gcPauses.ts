// MMO-OBSERVABILITY OB4 (meta docs/plans/MMO-OBSERVABILITY-PLAN.md; Jake, 2026-11-24: "The nodejs MMO does GC and trashes the UX
// experience"): one thread's garbage-collection pauses, read and reset once per reading, like `loopLag`. A worker sends its own in
// its 10 s reading; the door's `/metrics` reads the main thread's. The metrics client's own `nodejs_gc_duration_seconds` sees the main
// thread only, and the workers hold the ticks. Kept apart from the metrics module so a worker bundle carries no metrics client.
// oxlint-disable-next-line import/no-nodejs-modules -- Node's own GC entries.
import { constants, PerformanceObserver, type PerformanceEntry } from 'node:perf_hooks';

/** The pauses of one kind in one reading: how many, their total and the longest, in ms. */
export interface GcKind { readonly n: number; readonly ms: number; readonly max: number }
/** One reading of a thread's pauses, by kind; a kind with none is absent. */
export type GcReading = Readonly<Partial<Record<GcKindName, GcKind>>>;
export type GcKindName = 'minor' | 'major' | 'incremental' | 'weakcb';

/** Node's `detail.kind` flag to its name, as the metrics client names them. */
const KINDS: ReadonlyMap<number, GcKindName> = new Map([
  [constants.NODE_PERFORMANCE_GC_MINOR, 'minor'], [constants.NODE_PERFORMANCE_GC_MAJOR, 'major'],
  [constants.NODE_PERFORMANCE_GC_INCREMENTAL, 'incremental'], [constants.NODE_PERFORMANCE_GC_WEAKCB, 'weakcb'],
]);

/** Fold one GC entry into `into`; exported for the test, which has no say over when V8 collects. */
export function foldGc(into: Map<GcKindName, { n: number; ms: number; max: number }>, entry: Pick<PerformanceEntry, 'duration'> & { readonly detail?: unknown }): void {
  const flag = typeof entry.detail === 'object' && entry.detail !== null && 'kind' in entry.detail ? entry.detail.kind : undefined;
  const kind = typeof flag === 'number' ? KINDS.get(flag) : undefined;
  if (kind === undefined || !Number.isFinite(entry.duration) || entry.duration < 0) return;
  const row = into.get(kind) ?? { n: 0, ms: 0, max: 0 };
  row.n++; row.ms += entry.duration; row.max = Math.max(row.max, entry.duration);
  into.set(kind, row);
}

/** Start watching this thread's GC; each call answers the pauses since the last one and starts the next window. */
export function gcPauses(): () => GcReading {
  let window = new Map<GcKindName, { n: number; ms: number; max: number }>();
  const observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) foldGc(window, entry); });
  observer.observe({ entryTypes: ['gc'] });
  return () => {
    const read: Partial<Record<GcKindName, GcKind>> = {};
    for (const [kind, row] of window) read[kind] = { n: row.n, ms: row.ms, max: row.max };
    window = new Map();
    return read;
  };
}
