import { engineString } from '../strings';
import { diagnosticNow } from '../core/clock';
/** A path supplies its vocabulary; the engine only accounts for exclusive wall time. */
export interface LoadingStep { key: string; label: string; weight: number; aliases?: readonly string[] }
export interface LoadingPath { id: string; steps: readonly LoadingStep[]; ignored?: readonly string[] }
export interface LoadingRow {
  key: string; label: string; number: number; state: 'todo' | 'on' | 'ok'; ms: number; detail: string; fraction?: number;
  /** First accounted start on the monotonic timeline clock, not a paint timestamp. */
  startedAt?: number;
  /** Last completed wall boundary; ms remains exclusive of nested work. */
  endedAt?: number;
  /** DOM setup percentage already displayed at first entry, when supplied. */
  setupAtStart?: number;
}
export interface LoadingGap { label: string; state: 'on' | 'ok'; ms: number; after: string | null }
/** Optional presentation boundary; no observer or timer is installed by the timeline. */
export interface LoadingPresentation {
  readonly readSetup: () => number | undefined;
  readonly beforeStart?: () => void;
  readonly initialSetup?: {readonly at: number; readonly setup: number} | undefined;
}
interface Stage { key: string; base: string; detail: string; fraction?: number }
/** Declare a later pass up front. Undeclared passes fold into the last declared row. */
export function repeatedStep(step: Pick<LoadingStep, 'key' | 'label'>, pass: number): LoadingStep {
  return { key: `${step.key}#${pass}`, label: engineString('s_loading_step_repeat', [step.label, pass]), weight: 1 };
}
/** Nested/parallel waits never double-count elapsed seconds: the most recently entered stage owns each interval. */
/** An alias as the card shows it: 'fieldModels' -> 'field models', 'level.kit' -> 'level kit'. */
export function aliasLabel(name: string): string { return name.replaceAll(/([a-z])([A-Z])/gu, '$1 $2').replaceAll('.', ' ').toLowerCase(); }
export class LoadingTimeline {
  /** Attempt identity for wait attribution; it carries no work or serialized state. */
  readonly waitOwner: symbol = Symbol('loading-waits');
  private path: LoadingPath;
  private readonly rows = new Map<string, { ms: number; started: boolean; detail: string; fraction?: number; startedAt?: number; endedAt?: number; setupAtStart?: number }>();
  private readonly active = new Map<number, Stage>();
  private readonly aliases = new Map<string, string>();
  private readonly ignored = new Set<string>();
  private readonly gaps: LoadingGap[] = [];
  private readonly occurrences = new Map<string, number>();
  private sequence = 0;
  private at: number;
  private last: string | null = null;
  private readonly now: () => number;
  private readonly presentation: LoadingPresentation | undefined;
  constructor(path: LoadingPath, startedAt: number, now: () => number = diagnosticNow,
    presentation?: LoadingPresentation) {
    this.path = path; this.now = now; this.at = startedAt; this.presentation = presentation;
    this.configure(path);
    const initial = this.gaps.pop(), first = path.steps[0];
    if (first !== undefined) {
      const row = this.rows.get(first.key);
      const initialSetup = presentation?.initialSetup;
      if (row !== undefined) {
        row.started = true; row.startedAt = startedAt; row.ms = initial?.ms ?? 0;
        if (initialSetup?.at === startedAt && Number.isInteger(initialSetup.setup)
          && initialSetup.setup >= 0 && initialSetup.setup <= 100) row.setupAtStart = initialSetup.setup;
      }
    }
  }
  configure(path: LoadingPath): void {
    this.accrue(); this.path = path; this.aliases.clear(); this.ignored.clear();
    for (const step of path.steps) {
      this.aliases.set(step.key, step.key);
      for (const alias of step.aliases ?? []) this.aliases.set(alias, step.key);
      if (!this.rows.has(step.key)) this.rows.set(step.key, { ms: 0, started: false, detail: '' });
    }
    for (const key of path.ignored ?? []) this.ignored.add(key);
  }
  private current(): Stage | undefined { return [...this.active.values()].at(-1); }
  private accrue(): void {
    const now = this.now(), elapsed = Math.max(0, now - this.at), current = this.current();
    this.at = now;
    if (current !== undefined) {
      const row = this.rows.get(current.key);
      if (row !== undefined) { row.ms += elapsed; row.detail = current.detail || row.detail; }
      if (row !== undefined && current.fraction !== undefined) row.fraction = current.fraction;
      return;
    }
    if (elapsed === 0) return;
    const previous = this.gaps.at(-1);
    if (previous?.state === 'on') previous.ms += elapsed;
    else this.gaps.push({ label: this.last === null ? engineString('s_loading_gap_setup') : engineString('s_loading_gap_after', [this.label(this.last)]),
      state: 'on', ms: elapsed, after: this.last });
  }
  private label(key: string): string { return this.path.steps.find(step => step.key === key)?.label ?? key; }
  report(name: string, text: string, done?: number, total?: number): void {
    const key = this.aliases.get(name) ?? name;
    for (const stage of this.active.values()) if (stage.key === key || stage.base === key) {
      stage.detail = text;
      // One unit remains for stage completion, just as in StepProgress.set.
      if (done !== undefined && total !== undefined && Number.isFinite(done) && Number.isFinite(total) && total > 0) {
        stage.fraction = Math.max(stage.fraction ?? 0, Math.min(total, Math.max(0, done)) / (total + 1));
      }
      // Parallel work keeps its real detail live even while a newer stage
      // owns the exclusive wall-time interval.
      const row = this.rows.get(stage.key);
      if (row !== undefined) {
        row.detail = stage.detail;
        if (stage.fraction !== undefined) row.fraction = stage.fraction;
      }
    }
  }
  /** Keep the declared denominator fixed. Unknown work remains visible in its
   * active parent's detail; repeats reuse their last declared pass. */
  begin(name: string, detail = ''): { end: () => void; detail: (text: string) => void } {
    if (this.ignored.has(name)) return { end: () => undefined, detail: () => undefined };
    this.accrue();
    const known = this.aliases.get(name);
    const base = known ?? this.current()?.base ?? this.last ?? this.path.steps[0]?.key;
    if (base === undefined) throw new Error('Loading work requires a declared step');
    // DL21: a sub-stage begun under its step's alias names itself when it brings no detail ('Equipment and HUD · field
    // models'): the step read only its own title for ~2 s in the DL23 recordings while its parts ran
    const initialDetail = known === undefined ? `${name}${detail ? ` · ${detail}` : ''}` : detail || (name === known ? '' : aliasLabel(name));
    const count = this.occurrences.get(base) ?? 0;
    const already = [...this.active.values()].find(stage => stage.base === base);
    const repeated = known !== undefined && count > 0 && already === undefined;
    const again = repeated ? this.path.steps.find(step => step.key === `${base}#${count + 1}`)
      ?? this.path.steps.reduce<LoadingStep | undefined>((last, step) => step.key === base || step.key.startsWith(`${base}#`) ? step : last, undefined) : undefined;
    const key = already?.key ?? again?.key ?? base;
    if (repeated || count === 0) this.occurrences.set(base, count + 1);
    const row = this.rows.get(key);
    if (row !== undefined) {
      if (row.startedAt === undefined) {
        // Publish earned credit while this row is still todo: marking it
        // started before the callback would incorrectly credit it as done.
        this.presentation?.beforeStart?.();
        row.startedAt = this.at;
        const shown = this.presentation?.readSetup();
        if (shown !== undefined && Number.isInteger(shown) && shown >= 0 && shown <= 100) row.setupAtStart = shown;
      }
      row.started = true;
      delete row.endedAt;
    }
    const previous = this.gaps.at(-1); if (previous?.state === 'on') previous.state = 'ok';
    const id = ++this.sequence, stage = { key, base, detail: initialDetail };
    this.active.set(id, stage);
    return { end: () => {
      if (!this.active.has(id)) return;
      this.accrue(); this.active.delete(id); this.last = key;
      if (row !== undefined && ![...this.active.values()].some(value => value.key === key)) row.endedAt = this.at;
    }, detail: text => { stage.detail = text; } };
  }
  snapshot(): { path: string; rows: LoadingRow[]; gaps: LoadingGap[]; current: string | null; display: string | null } {
    this.accrue();
    const running = new Set([...this.active.values()].map(stage => stage.key));
    const rows = this.path.steps.map((step, index): LoadingRow => {
      const key = step.key;
      const row = this.rows.get(key);
      const result: LoadingRow = { key, label: step?.label ?? key, number: index + 1,
        state: running.has(key) ? 'on' : row?.started ? 'ok' : 'todo', ms: row?.ms ?? 0, detail: row?.detail ?? '' };
      if (row?.fraction !== undefined) result.fraction = row.fraction;
      if (row?.startedAt !== undefined) result.startedAt = row.startedAt;
      if (row?.endedAt !== undefined) result.endedAt = row.endedAt;
      if (row?.setupAtStart !== undefined) result.setupAtStart = row.setupAtStart;
      return result;
    });
    return { path: this.path.id, rows, gaps: this.gaps.map(gap => ({ label: gap.label, state: gap.state,
      ms: gap.ms, after: gap.after })), current: this.current()?.key ?? null,
      // Presentation stays on the outer/earliest running step. Exclusive
      // accounting and unit reports still belong to the newest nested work.
      display: this.active.values().next().value?.key ?? null };
  }
}

let timeline: LoadingTimeline | undefined;
/** Installed explicitly by the visible loader; imports do not install observers or services. */
export function installLoadingTimeline(value: LoadingTimeline): () => void {
  timeline = value; return () => { if (timeline === value) timeline = undefined; };
}
export function currentLoadingTimeline(): LoadingTimeline | undefined { return timeline; }
