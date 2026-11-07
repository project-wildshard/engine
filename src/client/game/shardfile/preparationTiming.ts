import { diagnosticNow } from '@wildshard/engine/core/clock';
import { isDev } from '@wildshard/engine/core/devMode';
import { currentLoadingTimeline } from '@wildshard/engine/boot/timeline';

/** A span's name as the card shows it: 'world.world.dressing' -> 'world dressing', 'assembly:painted' -> 'assembly painted'. */
export function preparationCardLabel(step: string): string {
  return step.split(/[.:]/u).filter((part, index, parts) => part !== '' && part !== parts[index - 1]).join(' ').replaceAll('-', ' ');
}
/** DL21 (E529: no step sits unchanged without naming its work): while a preparation span runs under the loading card, its
 *  step's detail names it ('Region world · world dressing'), and gets back the step's own detail when it ends (unless a
 *  later report replaced it). Nalati's Region world step read 'Home scenes 0 / 0' for 2.9 s in the DL23 recording while
 *  world dressing (3.1 s) and world assembly (1.3 s) ran. Outside a loading step it does nothing. */
// The spans running on each step, newest last, the step's own detail before the first, and what they last wrote: spans
// overlap (regionalWorld's presentation inputs run beside its inputs), so an ending span shows the newest one still running,
// or the step's own detail after the last (sp-x1's review: a label compare restored a finished span's name)
interface StepSpans { base: string; readonly running: { readonly label: string }[]; wrote: string }
const spansByTimeline = new WeakMap<object, Map<string, StepSpans>>();
function nameOnCard(step: string): () => void {
  const timeline = currentLoadingTimeline(), key = timeline?.snapshot().current ?? null;
  if (timeline === undefined || key === null) return () => undefined;
  const detail = (): string | undefined => timeline.snapshot().rows.find(row => row.key === key)?.detail;
  const steps = spansByTimeline.get(timeline) ?? new Map<string, StepSpans>(); spansByTimeline.set(timeline, steps);
  const spans: StepSpans = steps.get(key) ?? { base: detail() ?? '', running: [], wrote: '' }; steps.set(key, spans);
  // the step reported its own detail since the spans last wrote ('Home models 3 / 9'): that is what to come back to
  const now = detail(); if (spans.running.length > 0 && now !== undefined && now !== spans.wrote) spans.base = now;
  const span = { label: preparationCardLabel(step) };
  spans.running.push(span); spans.wrote = span.label; timeline.report(key, span.label);
  return () => {
    spans.running.splice(spans.running.indexOf(span), 1);
    // a report the spans did not write (a step's own count) stands
    if (detail() === spans.wrote) { spans.wrote = spans.running.at(-1)?.label ?? spans.base; timeline.report(key, spans.wrote); }
    if (spans.running.length === 0) steps.delete(key);
  };
}

/** Developer-only spans retain one result per product/step, including failed preparation; every page names the running
 *  span on its loading step (above). */
export async function timeClientPreparation<T>(slug: string, step: string, work: () => T | Promise<T>): Promise<T> {
  const named = nameOnCard(step);
  try {
    if (!isDev()) return await work();
    const name = `wildshard.prepare:${slug}:${step}`, start = diagnosticNow();
    try { return await work(); }
    finally {
      performance.clearMeasures(name);
      performance.measure(name, { start, end: diagnosticNow() });
    }
  } finally { named(); }
}

interface PreparationPhase { start: number | undefined; end: number; calls: number; failures: number; elapsedMs: number; longestMs: number }
interface PreparationBatch<Phase extends string> {
  readonly run: <T>(phase: Phase, work: () => Promise<T>) => Promise<T>;
  readonly sync: <T>(phase: Phase, work: () => T) => T;
  /** Count a completion check without creating an async hop when it needs no pause. */
  readonly checkpoint: (phase: Phase, work: () => Promise<void> | undefined) => Promise<void> | undefined;
  /** End one ordered wall interval, starting at creation or the preceding mark. */
  readonly mark: (phase: Phase) => void;
  readonly finish: () => void;
}
/** Developer-only, bounded phase totals for a multi-file preparation. Await all work before finish().
 * Each measure spans its first call through its last; detail.elapsedMs sums the individual elapsed calls,
 * including async waits, and is not CPU time. Public mode allocates no batch and reads no clocks. */
export function clientPreparationBatch<Phase extends string>(slug: string, step: string, phases: readonly Phase[]): PreparationBatch<Phase> | undefined {
  if (!isDev()) return undefined;
  const rows = new Map<Phase, PreparationPhase>(phases.map(phase => [phase, { start: undefined, end: 0, calls: 0, failures: 0, elapsedMs: 0, longestMs: 0 }]));
  let cursor = diagnosticNow();
  let finished = false;
  const begin = (phase: Phase) => {
    if (finished) throw new Error('Client preparation batch is finished');
    const row = rows.get(phase);
    if (row === undefined) throw new Error('Unknown client preparation phase');
    return row;
  };
  const record = (row: PreparationPhase, start: number, failed: boolean): void => {
    const end = diagnosticNow(), elapsed = end - start;
    row.start = row.start === undefined ? start : Math.min(row.start, start); row.end = Math.max(row.end, end);
    row.calls++; row.failures += failed ? 1 : 0; row.elapsedMs += elapsed; row.longestMs = Math.max(row.longestMs, elapsed);
  };
  return {
    mark: phase => { const row = begin(phase); record(row, cursor, false); cursor = row.end; },
    run: async (phase, work) => {
      const row = begin(phase), start = diagnosticNow(); let failed = true;
      try { const result = await work(); failed = false; return result; }
      finally { record(row, start, failed); }
    },
    sync: (phase, work) => {
      const row = begin(phase), start = diagnosticNow(); let failed = true;
      try { const result = work(); failed = false; return result; }
      finally { record(row, start, failed); }
    },
    checkpoint: (phase, work) => {
      const row = begin(phase), start = diagnosticNow();
      let pending: Promise<void> | undefined;
      try { pending = work(); }
      catch (error) { record(row, start, true); throw error; }
      if (pending === undefined) { record(row, start, false); return undefined; }
      const complete = async (): Promise<void> => {
        let failed = true;
        try { await pending; failed = false; }
        finally { record(row, start, failed); }
      };
      return complete();
    },
    finish: () => {
      if (finished) return; finished = true;
      for (const [phase, row] of rows) {
        const name = `wildshard.prepare:${slug}:${step}.${phase}`;
        performance.clearMeasures(name);
        if (row.start !== undefined) performance.measure(name, { start: row.start, end: row.end,
          detail: { calls: row.calls, failures: row.failures, elapsedMs: row.elapsedMs, longestMs: row.longestMs } });
      }
    },
  };
}
