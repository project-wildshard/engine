import { currentLoadingTimeline } from './timeline';
import { diagnosticNow } from '../core/clock';
import { beginLoadingWait, finishLoadingWait, loadingWaitState, reportLoadingWait, type LoadingWaitState, type LoadingWaitEntry, type LoadingWaitKind } from './loadingWaits';
import { pageScope } from '../app/resources';
import { engineString } from '../strings';
import { bootTask } from './timing';
/** Pending asynchronous work is observed without changing its owner, queue or concurrency. */
export type WaitKind = LoadingWaitKind;
export interface BootWait extends LoadingWaitEntry { ageMs: number }
export class WaitRegistry {
  private readonly state: () => LoadingWaitState;
  private readonly now: () => number;
  constructor(now: () => number = diagnosticNow, state?: () => LoadingWaitState) {
    this.now = now; const own: LoadingWaitState = { version: 1, sequence: 0, pending: new Map() };
    this.state = state ?? (() => own);
  }
  /** Register an already-started operation and remove it on either resolution or rejection. */
  async waitFor<T>(label: string, promise: Promise<T>, kind: WaitKind = 'work', step: string | null = null, owner: symbol | null = null, resource?: string): Promise<T> {
    const state = this.state(), id = ++state.sequence, now = this.now();
    state.pending.set(id, { id, label, kind, step, owner, startedAt: now, progressAt: now, loadedBytes: 0, totalBytes: null,
      retry: null, progress: '', inline: false,
      ...(resource === undefined ? {} : {resource}) });
    try { return await bootTask(`wait:${label}`, () => promise); }
    finally {
      state.pending.delete(id);
      // DL11: a wait of a second or more is named on the page's timeline, so a stalled step shows what held it (Pine's
      // sky step sat 82 s on a wait the card named only by count); only the injected-clock registry skips it.
      const ended = this.now();
      if (ended - now >= 1000 && this.now === diagnosticNow && typeof performance !== 'undefined') {
        performance.measure(`wildshard.prepare:wait:${label}`, { start: now, end: ended, detail: { step, kind } });
      }
    }
  }
  snapshot(): BootWait[] {
    const now = this.now();
    const rows: BootWait[] = [];
    for (const wait of this.state().pending.values()) rows.push({ ...wait, ageMs: Math.max(0, now - wait.startedAt) });
    return rows;
  }
}

const waits = new WaitRegistry(diagnosticNow, loadingWaitState);
/** Observe an existing promise; callers retain their admission, lifetime and concurrency policy. */
export function waitFor<T>(label: string, promise: Promise<T>, kind: WaitKind = 'work', resource?: string): Promise<T> {
  const timeline = currentLoadingTimeline();
  return waits.waitFor(label, promise, kind, timeline?.snapshot().current ?? null, timeline?.waitOwner ?? null, resource);
}
/** Prefer waits of the displayed step, then its newest nested work. Unrelated page work never supplies the footer. */
export function loadingStepWaits(pending: readonly BootWait[], display: string | null, current: string | null, owner: symbol | null = null): readonly BootWait[] {
  const displayed = display === null ? [] : pending.filter(wait => wait.owner === owner && wait.step === display);
  return displayed.length > 0 ? displayed : current === null ? [] : pending.filter(wait => wait.owner === owner && wait.step === current);
}
/** Live page waits in registration order, including an age from the same monotonic clock. */
export function bootWaits(): readonly BootWait[] { return waits.snapshot(); }
/** Account for all awaits at a semantic boundary, including work between the older bootstrap steps. DL21 (E526): a step
 *  that reads files names them on the card while it runs ('Reading 12 files · 4.1 MB'), so a step that fetches what the
 *  spawn download did not carry never sits unchanged. */
export async function loadingStage<T>(key: string, work: () => T | Promise<T>): Promise<T> {
  const timeline = currentLoadingTimeline(), stage = timeline?.begin(key);
  const reads = timeline === undefined ? null : stageReads(key, timeline.waitOwner);
  try { return await bootTask(`stage:${key}`, () => Promise.resolve(work())); }
  finally { reads?.(); stage?.end(); }
}
/** This page's same-origin fetches from now on, counted by a resource-timing observer (it sees every entry; the
 *  timeline buffer, 250 by default, fills early and would freeze a getEntriesByType count, sp-x2's review). `match`
 *  narrows the names counted. */
export function observeReads(match: (name: string) => boolean = () => true): { readonly files: () => number; readonly bytes: () => number; readonly stop: () => void } {
  let files = 0, bytes = 0;
  if (typeof PerformanceObserver === 'undefined' || typeof location === 'undefined') return { files: () => 0, bytes: () => 0, stop: () => undefined };
  const observer = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      if (!(entry instanceof PerformanceResourceTiming) || entry.initiatorType !== 'fetch' || !entry.name.startsWith(location.origin) || !match(entry.name)) continue;
      files++; bytes += entry.transferSize || entry.encodedBodySize;
    }
  });
  observer.observe({ type: 'resource' });
  return { files: () => files, bytes: () => bytes, stop: () => { observer.disconnect(); } };
}
/** The `resource` of a stage's reads tally ('Reading 12 files · 4.1 MB'): the card adds it to a file wait's line. */
export const STAGE_READS = 'stage-reads';
/** A wait of the stage's own step that counts its reads once it has one; the returned stop removes it. */
function stageReads(step: string, owner: symbol): () => void {
  const reads = observeReads(), scope = pageScope.child('loading.reads');
  let id: number | null = null;
  const tick = (): void => {
    const files = reads.files(), bytes = reads.bytes(); if (files === 0) return;
    const label = `Reading ${files} files · ${(bytes / 1e6).toFixed(1)} MB`;
    if (id === null) id = beginLoadingWait(label, { kind: 'work', step, owner, loadedBytes: bytes, resource: STAGE_READS });
    else reportLoadingWait(id, { label, loadedBytes: bytes });
  };
  scope.interval(250, tick);
  return () => { reads.stop(); scope.dispose(); if (id !== null) finishLoadingWait(id); };
}
/** DL21: a wait on the step it starts in, counting what it has done where no total is known ('Server world · 12 files').
 *  `add` moves the card; `end` takes the wait away and names it on the timeline, as `waitFor` does. */
export function countedWait(label: string, unit: string, kind: WaitKind = 'worker'): { readonly add: () => void; readonly end: () => void } {
  const timeline = currentLoadingTimeline(), started = diagnosticNow();
  const id = beginLoadingWait(label, { kind, step: timeline?.snapshot().current ?? null, owner: timeline?.waitOwner ?? null, startedAt: started });
  let count = 0;
  return { add: () => { count++; reportLoadingWait(id, { label: engineString('s_loading_counted', [label, count, unit]) }); },
    end: () => {
      finishLoadingWait(id);
      const ended = diagnosticNow();
      if (ended - started >= 1000 && typeof performance !== 'undefined') performance.measure(`wildshard.prepare:wait:${label}`, { start: started, end: ended, detail: { kind } });
    } };
}
/** Count actual completed units on the stage that starts this operation, without advancing work on a timer. */
export function loadingUnits(label: string, total: number): (done: number, detail?: string) => void {
  const timeline = currentLoadingTimeline(), key = timeline?.snapshot().current;
  return (done, detail) => {
    if (key === null || key === undefined) return;
    timeline?.report(key, `${label} ${done} / ${total}${detail ? ` · ${detail}` : ''}`, done, total);
  };
}
