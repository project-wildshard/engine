/** LS1's in-memory contract. No renderer, storage, telemetry or installation on import. */
export interface BootTimingEntry {
  id: number; build: string | null; attempt: string; realm: string;
  operation: string; start: number; end: number | null;
  result: string; detail: Readonly<Record<string, unknown>>;
}
/** Default-channel receipts are bounded summaries, never duration spans. */
export interface BootTimingRealm {
  purpose:string;url:string;timeOrigin:number|null;
  precision:'browser';instrumentation:'parent-only'|'worker';
  messages?:{count:number;first:number;last:number;kinds:Record<string,number>};
}
export interface BootTiming {
  version: 1; build: string | null; attempt: string; attemptCount: number;
  timeOrigin: number; entries: BootTimingEntry[];
  resources: Readonly<Record<string, unknown>>[];
  counters: Record<string, { loaded: number; total: number | null; unit: string; at: number; events: number }>;
  navigation?: Readonly<Record<string, unknown>>;
  realms?: Readonly<Record<string, BootTimingRealm>>;
  lifecycle?: readonly Readonly<Record<string, unknown>>[];
  paints?: readonly Readonly<Record<string, unknown>>[];
  overflow?: Readonly<Record<string, unknown>>;
  largestGap?: Readonly<Record<string, unknown>> | null;
  handoff?: Readonly<Record<string, unknown>> | null;
  serviceWorker?: Readonly<Record<string, unknown>>;
  active: { id: number; operation: string; ageMs: number; realm: string }[];
  begin: (operation: string, detail?: Readonly<Record<string, unknown>>) => number;
  end: (id: number, result?: string) => void;
  mark: (operation: string, detail?: Readonly<Record<string, unknown>>) => void;
  progress: (operation: string, delta: number, total: number | null, unit: string) => void;
  read: () => BootTiming;
  finish: () => void;
}

/** The same plain object from the first HTML statement, or absent in a non-page host. */
export function bootTiming(): BootTiming | undefined {
  const value: unknown = Reflect.get(globalThis, '__bootTiming');
  return typeof value === 'object' && value !== null && 'version' in value && value.version === 1 &&
    'begin' in value && typeof value.begin === 'function' ? value as BootTiming : undefined;
}
export function bootMark(operation: string, detail: Readonly<Record<string, unknown>> = {}): void { bootTiming()?.mark(operation, detail); }
export function bootProgress(operation: string, delta: number, total: number | null, unit: string): void { bootTiming()?.progress(operation, delta, total, unit); }
/** Name synchronous atomic work without adding a promise or a scheduling turn. */
export function bootWork<T>(operation: string, work: () => T): T {
  const timing = bootTiming(), id = timing?.begin(operation);
  try { const value = work(); if (id !== undefined) timing?.end(id, 'complete'); return value; }
  catch (error) { if (id !== undefined) timing?.end(id, 'failed'); throw error; }
}
/** Observe the existing await; do not change its start, refusal, concurrency or ownership. */
export async function bootTask<T>(operation: string, work: () => Promise<T>): Promise<T> {
  const timing = bootTiming(), id = timing?.begin(operation);
  try { const value = await work(); if (id !== undefined) timing?.end(id, 'complete'); return value; }
  catch (error) { if (id !== undefined) timing?.end(id, 'failed'); bootMark(`${operation}:failure`, { message: String(error) }); throw error; }
}
/** Observe an already scheduled literal import without hiding it from the build's import bank. */
export function bootAwait<T>(operation: string, pending: Promise<T>): Promise<T> {
  return bootTask(operation, () => pending);
}
/** Adopt a named inline boundary without recreating the collector or losing its early history. */
export function endBootOperation(operation: string): void {
  const timing = bootTiming();
  if (timing === undefined) return;
  for (let index = timing.entries.length - 1; index >= 0; index--) {
    const entry = timing.entries[index];
    if (entry?.operation === operation && entry.end === null) { timing.end(entry.id, 'complete'); return; }
  }
}
