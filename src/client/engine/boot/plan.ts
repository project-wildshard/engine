import { engineString } from '../../../shared/engine/strings';
/**
 * The boot plan — ported from game-demos/trials-gauntlet-demo `src/client/engine/boot/plan.ts`
 * (their docs/tasks/loading-progress-invariant.md §4):
 *
 *   > Progress is the boot sequence's own declaration of work done over work declared, and the
 *   > loader can only display it.
 *
 * Two fractions, each monotone by construction and each exactly 1 on `done()` by arithmetic:
 *
 *   setup    = Σ weight(step) × fraction(step) / Σ weight(step)  over BOOT_STEPS (steps.ts)
 *   download = Σ min(read(src), total(src)) / Σ total(src)           over BYTE_SOURCES (steps.ts)
 *
 * The loading card uses its own completed-work timeline. A step's fraction is 1 when its work resolves;
 * reported progress stays below 1 until then. Progress events publish changes, while `view` samples current
 * step and gap durations on demand. The loading card owns its clock; the plan schedules no polling frames.
 * A byte source grows only by what its reader reports and closes with the step that awaited it.
 *
 * `Plan<Remaining>` loses each key as `step()` runs it, and `done` is typed `never` until nothing
 * remains — a step dropped from `main.ts` is a compile error.
 */
import { BOOT_STEPS, BYTE_SOURCES, STEP_INFO, byteLabel, closedBy, type BootStep, type ByteKey } from '../../../shared/engine/boot/steps';
import { frameBudgetSpent, paceYield, presenting } from '../../../shared/engine/core/framePacing';
import { WORK_SLICE_MS } from '../../../shared/engine/core/workSlice';
import { loadingStage } from '../../../shared/engine/boot/waits';
import { currentLoadingTimeline } from '../../../shared/engine/boot/timeline';

export interface StepProgress {
  /** Progress in the step's own unit; the step's contribution becomes max(previous, done / (total + 1)). */
  set: (done: number, total: number, detail?: string) => void;
  /** The live detail line for this step (a count, a program total). */
  detail: (text: string) => void;
}
export interface ByteProgress { add: (n: number) => void }

export interface LogRow {
  key: BootStep; label: string; state: 'todo' | 'on' | 'ok';
  /** Wall ms of the step (running: so far at publish time; `t0` lets a painter keep it live). */
  ms: number; t0: number; detail: string; fraction: number; sub: number;
}

/** Wall time outside a reported step; kept separate from completed work and timing weights. */
export interface GapRow {
  after: BootStep | null; label: string; state: 'on' | 'ok';
  ms: number; t0: number; detail: string;
}

export interface ProgressView {
  download: number; setup: number; done: boolean; error: string | null;
  step: BootStep; label: string; detail: string;
  /** DOWNLOAD's live line: the source most recently read, its bytes so far and its declared total. */
  bytes: { key: ByteKey; label: string; done: number; total: number } | null;
  bytesRead: number; bytesTotal: number; filesDone: number; filesTotal: number;
  /** World source bytes only; menu art and audio do not delay the building label. */
  worldBytesReady: boolean;
  doneCount: number; rows: LogRow[]; gaps: GapRow[];
}
export type Sink = (view: ProgressView) => void;

/** a boot plan: run its steps in order, with byte and file counters feeding the loading screen */
export interface Plan<R extends BootStep> {
  step: <K extends R, T>(key: K, work: (p: StepProgress) => T | Promise<T>) => Promise<Plan<Exclude<R, K>> & { readonly value: T }>;
  /** The byte counter for a source; hand it to the code that reads the bytes. */
  reader: (key: ByteKey) => ByteProgress;
  /** A file of a source finished (for the "n / m files" line). */
  fileDone: (key: ByteKey) => void;
  fail: (message: string) => void;
  /** Everything ran: both fractions are 1. Callable only on the exhausted plan type. */
  readonly done: [R] extends [never] ? () => void : never;
  readonly view: ProgressView;
  readonly remaining?: R;
}

export interface PlanOptions {
  /** Declared byte totals and file counts per source (known before the first byte). */
  totals: Readonly<Record<ByteKey, { bytes: number; files: number }>>;
  now?: () => number;
  /**
   * Awaited after every step (default in a browser: one macrotask). A step's work and the next step's
   * start otherwise chain through microtasks inside ONE task — the 0.75–1.3 s long tasks of
   * project/archive/2026-09-22-load-perf.md were forest + edge + grass and animals + weapon glued together.
   */
  yieldTask?: (() => Promise<void>) | null;
}

/** One MessageChannel hop: a fresh task with no 4 ms timer clamp. */
const messageHop = (): Promise<void> => new Promise((resolve) => {
  const c = new MessageChannel();
  c.port1.onmessage = () => { c.port1.close(); c.port2.close(); resolve(); };
  c.port2.postMessage(0);
});

/**
 * End the current task: the next step starts in a fresh one (a MessageChannel hop — no 4 ms timer clamp). In play (the
 * engine loop drawing, `presenting()`, op-hitch26) with a frame due, it waits until the loop has drawn that frame instead:
 * Blink can run queued port messages back to back with no frame between them.
 */
export const macrotask = (): Promise<void> => paceYield(messageHop, undefined, WORK_SLICE_MS);

/**
 * A yield point that ends the task only once it has run `budgetMs` (wall): sprinkle `await slice()` between
 * builders of uneven size — the ones a shard skips cost nothing, the heavy runs still break under ~100 ms.
 */
export function slicer(budgetMs = 30, progress?: StepProgress): Slice {
  let t0 = performance.now();
  // in play (a grid cell built on the road while the engine loop draws, op-hitch26) a stretch is a work slice, not a loading
  // task: the loading screen's ~100 ms rule becomes the frame floor's. Every builder also shares
  // the work spent since the last draw, so a fresh builder cannot refill an already spent frame.
  // Awaited reads and painted frames do not spend a fresh live CPU slice.
  // Loading still bounds the task by its original local elapsed clock.
  const due = (): boolean => { const now = performance.now(); return presenting(now)
    ? frameBudgetSpent(Math.min(budgetMs, WORK_SLICE_MS), now) : now - t0 >= budgetMs; };
  const next = async (): Promise<void> => { await macrotask(); t0 = performance.now(); };
  const slice = async (done?: number, total?: number, detail?: string): Promise<void> => {
    if (done !== undefined && total !== undefined) progress?.set(done, total, detail);
    if (!due()) return;
    await next();
  };
  return Object.assign(slice, { due: (): Promise<void> | null => (due() ? next() : null) });
}

/** A `slicer()` yield point, plus `due()` on the same clock for code that pauses inside a step (`placeSliced`'s `due`):
 *  null while the task is under budget, else the next task's start. */
export interface Slice {
  (done?: number, total?: number, detail?: string): Promise<void>;
  due: () => Promise<void> | null;
}

interface StepState { state: 'todo' | 'on' | 'ok'; fraction: number; sub: number; detail: string; t0: number; ms: number }
interface SourceState { total: number; files: number; read: number; filesDone: number; closed: boolean }
const clamp01 = (x: number): number => (x > 1 ? 1 : Math.max(x, 0));

export function createBootPlan(sink: Sink, options: PlanOptions): Plan<BootStep> {
  const now = options.now ?? (() => performance.now());
  const steps = {} as Record<BootStep, StepState>; // every key filled just below
  for (const k of BOOT_STEPS) steps[k] = { state: 'todo', fraction: 0, sub: 0, detail: '', t0: 0, ms: 0 };
  const sources = {} as Record<ByteKey, SourceState>;
  for (const k of BYTE_SOURCES) sources[k] = { total: Math.max(0, options.totals[k].bytes || 0), files: options.totals[k].files || 0, read: 0, filesDone: 0, closed: false };
  let lastRead: ByteKey | null = null;
  const firstStep = BOOT_STEPS[0];
  if (firstStep === undefined) throw new Error('boot plan: no steps');
  let current: BootStep = firstStep;
  const gaps: GapRow[] = [];
  let gap: GapRow | null = { after: null, label: engineString('s_loading_gap_before', [STEP_INFO[firstStep].label]), state: 'on', t0: now(), ms: 0, detail: '' };
  function closeGap(at: number): void {
    if (gap === null) return;
    gaps.push({ ...gap, state: 'ok', ms: at - gap.t0 });
    gap = null;
  }
  let error: string | null = null;
  let finished = false;
  let shownDownload = 0;
  let shownSetup = 0;
  let view!: ProgressView;
  const yieldTask = options.yieldTask === undefined ? (typeof window !== 'undefined' && typeof MessageChannel === 'function' ? macrotask : null) : options.yieldTask;
  const credited = (s: { total: number; read: number; closed: boolean }): number => (s.closed ? s.total : Math.min(s.read, s.total));

  function snapshot(): ProgressView {
    const t = now();
    let acc = 0, weightTotal = 0, doneCount = 0;
    const rows: LogRow[] = BOOT_STEPS.map((k) => {
      const s = steps[k];
      const ok = s.state === 'ok';
      if (ok) doneCount++;
      const weight = STEP_INFO[k].weight;
      const fraction = ok ? 1 : s.fraction;
      acc += weight * fraction; weightTotal += weight; // the same additions as `acc` at done() (fraction 1 everywhere): equal by arithmetic
      return { key: k, label: STEP_INFO[k].label, state: s.state, ms: s.state === 'on' ? t - s.t0 : s.ms, t0: s.t0, detail: s.detail, fraction, sub: ok ? 1 : s.sub };
    });
    let read = 0, total = 0, filesDone = 0, filesTotal = 0;
    for (const s of Object.values(sources)) {
      if (s.total <= 0) continue;
      total += s.total; read += credited(s);
      filesTotal += s.files; filesDone += s.closed ? s.files : Math.min(s.filesDone, s.files);
    }
    // The max() is the assertion that no future edit can make the screen run backwards.
    shownSetup = Math.max(shownSetup, weightTotal > 0 ? acc / weightTotal : 1);
    shownDownload = Math.max(shownDownload, total > 0 ? read / total : 1);
    const last = lastRead ? sources[lastRead] : null;
    return {
      download: shownDownload, setup: shownSetup, done: finished, error,
      step: current, label: STEP_INFO[current].label, detail: steps[current].detail,
      bytes: lastRead && last ? { key: lastRead, label: byteLabel(lastRead), done: credited(last), total: last.total } : null,
      bytesRead: read, bytesTotal: total, filesDone, filesTotal, doneCount, rows,
      gaps: gap === null ? [...gaps] : [...gaps, { ...gap, ms: t - gap.t0 }],
      worldBytesReady: BYTE_SOURCES.every(key => key === 'art' || key === 'music' || key === 'sfx' || credited(sources[key]) >= sources[key].total),
    };
  }

  function publish(): void { view = snapshot(); sink(view); }

  function progressFor(key: BootStep): StepProgress {
    const s = steps[key];
    return {
      set(done, total, detail) {
        if (s.state !== 'on') return;
        if (total > 0 && Number.isFinite(total) && Number.isFinite(done)) {
          const d = Math.min(Math.max(0, done), total);
          s.sub = Math.max(s.sub, d / total);
          s.fraction = Math.max(s.fraction, clamp01(d / (total + 1)));
        }
        if (detail !== undefined) s.detail = detail;
        currentLoadingTimeline()?.report(key, s.detail, done, total);
        publish();
      },
      detail(text) { if (s.state !== 'on') return; s.detail = text; currentLoadingTimeline()?.report(key, text); publish(); },
    };
  }

  async function run<T>(key: BootStep, work: (p: StepProgress) => T | Promise<T>): Promise<T> {
    const s = Object.hasOwn(steps, key) ? steps[key] : undefined; // a key outside BOOT_STEPS (a JS caller) is unknown
    if (s?.state !== 'todo' || finished) throw new Error(`boot plan: ${key} ${s === undefined ? 'unknown' : finished ? 'after done()' : `already ${s.state}`}`);
    const startedAt = now(); closeGap(startedAt);
    s.state = 'on'; s.t0 = startedAt; current = key;
    publish();
    const value = await loadingStage(key, () => work(progressFor(key)));
    const endedAt = now();
    s.state = 'ok'; s.fraction = 1; s.sub = 1; s.ms = endedAt - s.t0;
    const running = BOOT_STEPS.find(step => steps[step].state === 'on');
    if (running !== undefined) current = running;
    else gap = { after: key, label: engineString('s_loading_gap_after', [STEP_INFO[key].label]), state: 'on', t0: endedAt, ms: 0, detail: '' };
    for (const bk of BYTE_SOURCES) if (closedBy(bk) === key) sources[bk].closed = true;
    publish();
    return value;
  }

  const api = {
    async step(key: BootStep, work: (p: StepProgress) => unknown) { const value = await run(key, work); if (yieldTask) await yieldTask(); return next(value); },
    reader(key: ByteKey): ByteProgress {
      const s = sources[key];
      return { add(n) { if (!(n > 0) || s.closed) return; s.read += n; lastRead = key; publish(); } };
    },
    fileDone(key: ByteKey) { const s = sources[key]; if (!s.closed) { s.filesDone++; publish(); } },
    fail(message: string) { error = message; publish(); },
    done() {
      if (finished) return;
      const missed = BOOT_STEPS.filter((k) => steps[k].state !== 'ok');
      if (missed.length > 0) throw new Error(`boot plan: ${missed.join(',')} not complete`);
      closeGap(now());
      finished = true;
      publish();
      // Arithmetic, not policy: Σw·1/Σw and ΣT/ΣT. The throw is the assertion that this file's math was not edited into a lie.
      if (view.download !== 1 || view.setup !== 1) throw new Error('boot plan: done() not at 1/1');
    },
    get view(): ProgressView { return snapshot(); },
  } as unknown as Plan<BootStep>;
  function next(value: unknown): Plan<BootStep> & { value: unknown } { return Object.assign(Object.create(api) as Plan<BootStep> & { value: unknown }, { value }); }
  publish();
  return api;
}

/** Decimal MB matches the network ruler; memory ceilings retain their own byte units. */
export const formatMB = (b: number): string => `${(b / 1_000_000).toFixed(b < 10_000_000 ? 2 : 1)} MB`;

/** Runs one step: what code outside main.ts (bootstrap) receives, so it need not know the plan type. */
export type StepRunner = <T>(key: BootStep, work: (p: StepProgress) => T | Promise<T>) => Promise<T>;
