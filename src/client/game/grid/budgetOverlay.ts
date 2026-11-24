/**
 * The Developer memory button shows the EM11 playing estimate (GB) in its danger band. The panel
 * adds the source, the peak across boot checkpoints and displayed readings, the playing upper
 * bound, device crash line, world limits, entry trend, and observed allocations. Claims and
 * observations supply the fallback while the ledger is unavailable. The panel reads once a second.
 *
 * Costs nothing when off: no element and no timer exist until the Developer switch is on; switching it off stops the
 * timer and hides the strip (the trend still records each entry: one allocator read). Text is authored with
 * `textContent` only. Players never see it (no URL switch, E162).
 */
import type { Scope } from '@wildshard/engine/app/scope';
import { CONTENT_CAPS } from '@wildshard/engine/core/config';
import { isDev, onDev } from '@wildshard/engine/core/devMode';
import { perfDockChip } from '@wildshard/engine/ui/perfDock';
import { memoryAttribution, type MemorySnapshot } from '@wildshard/engine/core/memoryAttribution';
import type { ResidencyAllocator } from '../../../shared/game/grid/allocator';
import { budgetBreakdown, megabytes, PLATFORM_OWNER, readBudgetPoints, type BudgetPoints, type PointsTone } from './budgetPoints';
import type { MemoryGrouping, MemorySort } from './memoryRows';
import type { PhoneBudgetReading, readLoadingPeak, readPhoneBudget, renderMemoryPanel } from './budgetMemoryPanel';
import './budgetOverlay.css';
import { PHONE_MEMORY_LOADING_CAP_BYTES } from '@wildshard/engine/core/phoneMemoryCap';

/** D1: the headline turns amber at this many bytes (decimal, MB = 10^6); the phone line, BC12 */
export const MEMORY_AMBER: number = PHONE_MEMORY_LOADING_CAP_BYTES;
/** D1: and red at this many */
export const MEMORY_RED = 1.75e9;
/** iPhone 17 Pro WebContent jetsam log, ActiveHard 2048 MiB. https://developer.apple.com/forums/thread/823061 */
export const CRASH_LINE: number = 2048 * 1024 ** 2;
/** IP7 will replace this with the measured iPhone 13 WebContent line. */
export const IPHONE_13_CRASH_LINE_UNMEASURED: number | null = null;

/** Safari exposes screen geometry. Several iPhone models can share it. */
export function phoneCrashLine(ua: string, width: number, height: number, dpr: number): { label: string; bytes: number | null } {
  if (/\biPhone\b/u.test(ua) && dpr === 3) {
    const short = Math.min(width, height), long = Math.max(width, height);
    if (short === 390 && long === 844) return { label: 'IPHONE 13-CLASS', bytes: IPHONE_13_CRASH_LINE_UNMEASURED };
    if (short === 402 && long === 874) return { label: 'IPHONE 17 PRO REFERENCE', bytes: CRASH_LINE };
  }
  return { label: 'DEVICE', bytes: null };
}
/** M7: how many entries after the first the trend keeps */
export const TREND_KEPT = 6;
/** How often the strip re-reads the allocator while it shows. */
export const BUDGET_REFRESH_MS = 1000;

export interface BudgetOverlayHost {
  readonly scope: Scope;
  readonly allocator: Pick<ResidencyAllocator, 'entries' | 'cost'>;
  /** an owner (a cell instance) to its shard's display name; the platform is the road */
  readonly name: (owner: string) => string;
  /** whether an owner is a shard with a limit (a cell instance); others are page-wide (the road, the platform's sims) */
  readonly shard?: (owner: string) => boolean;
  /** Existing allocation identities, not another admission ledger. Null native readings remain unavailable. */
  readonly memory?: () => MemorySnapshot;
  /** G628 M4: the loaded shards over their own limit now (resident only), one strip line each (`memoryWarning.ts`) */
  readonly overLimit?: () => readonly { readonly owner: string; readonly overBytes: number }[];
}
export interface BudgetOverlay {
  /** the last scored table (null until Developer mode first shows the strip) */
  readonly state: () => BudgetPoints | null;
  /** the last headline (null until Developer mode first shows the strip) */
  readonly headline: () => MemoryHeadline | null;
  /** the trend: the headline at the first entry, then at the last {@link TREND_KEPT} (bytes) */
  readonly trend: () => readonly number[];
  /** re-read the allocator now (the timer does this every {@link BUDGET_REFRESH_MS}) */
  readonly refresh: () => void;
  /** expand or collapse the breakdown (the tap) */
  readonly toggle: () => void;
  /** M7: a cell was entered; the trend records the headline now */
  readonly crossed: () => void;
}

/** Playing estimate with its source and the high-water readings for this overlay. */
export interface MemoryHeadline {
  readonly bytes: number; readonly tone: PointsTone;
  /** the cost model's playing bytes */
  readonly model: number;
  /** the native reading, else the engine base + observed GPU storage and RAM; null when nothing was observed */
  readonly measured: number | null;
  /** which of the two the headline is */
  readonly source: 'model' | 'native' | 'observed' | 'predicted';
  readonly loadingPeak: number | null;
  readonly peak: number;
}
export function memoryTone(bytes: number): PointsTone { return bytes >= MEMORY_RED ? 'red' : bytes >= MEMORY_AMBER ? 'amber' : 'green'; }
export function memoryHeadline(model: number, snapshot: MemorySnapshot | null, engineBase: number): MemoryHeadline {
  const native = snapshot?.measured ?? null, observed = snapshot === null ? 0 : snapshot.totals.gpu + snapshot.totals.ram;
  const measured = native !== null ? native.webContentBytes + native.labelledGpuBytes : observed > 0 ? engineBase + observed : null;
  const bytes = Math.max(model, measured ?? 0);
  return { bytes, tone: memoryTone(bytes), model, measured, loadingPeak: null, peak: bytes,
    source: measured === null || measured <= model ? 'model' : native !== null ? 'native' : 'observed' };
}

const SOURCE: Readonly<Record<MemoryHeadline['source'], string>> = { model: 'CLAIMS', native: 'NATIVE', observed: 'OBSERVED', predicted: 'EM11' };
const MB = (bytes: number): string => `${megabytes(bytes)} MB`;
const GB = (bytes: number): string => (bytes / 1e9).toFixed(2);
function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag); node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
/** A `data-*` attribute: the tone for the stylesheet, raw bytes for tests and captures. */
function data(node: HTMLElement, name: string, value: string | number): void { node.setAttribute(`data-${name}`, String(value)); }
function row(label: string, value: string, tone: PointsTone | null = null): HTMLElement {
  const line = el('div', 'ws-grid-budget-row'); data(line, 'tone', tone ?? 'none');
  line.append(el('span', 'ws-grid-budget-k', label), el('span', 'ws-grid-budget-v', value));
  return line;
}
function section(title: string, ...rows: HTMLElement[]): HTMLElement {
  const sec = el('section', 'ws-grid-budget-sec'); sec.append(el('h4', 'ws-grid-budget-h', title), ...rows); return sec;
}

/** Install the strip on a grid page; everything leaves with the scope. */
export function installBudgetOverlay(host: BudgetOverlayHost): BudgetOverlay {
  const { scope } = host;
  let root: HTMLElement | null = null, chip: HTMLButtonElement | null = null, gb: HTMLElement | null = null;
  let bar: HTMLElement | null = null, detail: HTMLElement | null = null, more: HTMLElement | null = null;
  let crash: ReturnType<typeof phoneCrashLine> | null = null;
  let timer: ReturnType<typeof setInterval> | 0 = 0, expanded = false, last: BudgetPoints | null = null, head: MemoryHeadline | null = null, signature = '';
  let group: MemoryGrouping = 'owner', sort: MemorySort = 'total';
  let allocationScope: Scope | null = null;
  const trend: number[] = [];
  const label = (owner: string): string => (owner === PLATFORM_OWNER ? 'ROAD' : host.name(owner));
  const snapshot = (accounted: number, details = expanded): MemorySnapshot => host.memory?.()
    ?? (details ? memoryAttribution.snapshot(accounted) : { ...memoryAttribution.summary(accounted), allocations: [] });
  const read = (cost: ReturnType<BudgetOverlayHost['allocator']['cost']>, memory: MemorySnapshot | null): MemoryHeadline =>
    memoryHeadline(cost.playing, memory, cost.input.engineBase ?? CONTENT_CAPS.engineBase);

  let memoryPanel: { readPhoneBudget: typeof readPhoneBudget; readLoadingPeak: typeof readLoadingPeak; renderMemoryPanel: typeof renderMemoryPanel } | undefined;
  let loadingPanel = false;
  async function loadPanel(): Promise<void> {
    if (loadingPanel || memoryPanel !== undefined) return;
    loadingPanel = true;
    try {
      memoryPanel = await import('./budgetMemoryPanel');
      refresh();
    } catch (error) {
      console.error('Memory panel failed to load:', error);
    } finally {
      loadingPanel = false;
    }
  }
  const paint = (points: BudgetPoints, headline: MemoryHeadline, parts: ReturnType<typeof budgetBreakdown>, memory: MemorySnapshot | null,
    over: readonly { readonly owner: string; readonly overBytes: number }[], prediction: PhoneBudgetReading | null): void => {
    if (root === null || chip === null || gb === null || bar === null || more === null || crash === null) return;
    const worlds = parts.worlds.length, start = prediction === null ? trend[0] : undefined;
    const since = start === undefined ? '' : ` · ${headline.bytes >= start ? '+' : '−'}${Math.round(Math.abs(headline.bytes - start) / 1e6)} MB SINCE START`;
    const source = SOURCE[headline.source], peak = GB(headline.peak);
    const crashLine = crash.bytes === null ? 'UNMEASURED' : `${GB(crash.bytes)} GB`;
    const line = el('span', 'ws-grid-budget-x', `${source} ≈${GB(headline.bytes)} GB PLAYING · ${worlds} ${worlds === 1 ? 'WORLD' : 'WORLDS'}${since}`);
    data(line, 'tone', headline.tone); data(line, 'bytes', headline.bytes); data(line, 'source', headline.source);
    const lines = over.map(({ owner, overBytes }) => {
      const node = el('span', 'ws-grid-budget-over', `${label(owner).toUpperCase()} OVER ITS LIMIT · +${MB(overBytes)}`);
      data(node, 'tone', 'red'); data(node, 'owner', owner); data(node, 'over-bytes', overBytes); return node;
    });
    bar.replaceChildren(line, ...lines);
    // QA-FEEDBACK 11-24 row 36 (Jake: "Memory can be two figures like `1.1` instead of `1.18`"): the chip shows one decimal; the panel keeps two
    gb.textContent = (headline.bytes / 1e9).toFixed(1); data(gb, 'tone', headline.tone);
    data(chip, 'tone', headline.tone);
    chip.toggleAttribute('data-over-limit', over.length > 0);
    data(root, 'source', headline.source); data(root, 'playing-bytes', headline.bytes); data(root, 'peak-bytes', headline.peak);
    if (headline.loadingPeak === null) delete root.dataset['loadingPeakBytes'];
    else data(root, 'loading-peak-bytes', headline.loadingPeak);
    chip.setAttribute('aria-label', `Memory ${gb.textContent} GB`);
    if (!expanded) { allocationScope?.dispose(); allocationScope = null; more.replaceChildren(); return; }
    if (prediction !== null) line.title = `Predicted phone range ${GB(prediction.range.low)}–${GB(prediction.range.high)} GB`;
    const total = section('MEMORY ESTIMATES',
      ...(prediction === null ? [] : [row('EM11 PLAYING UPPER', `${GB(prediction.range.high)} GB`)]),
      row('PEAK SINCE LOAD', `${peak} GB`),
      row(`CRASH LINE · ${crash.label}`, crashLine),
      row('MODEL (CLAIMS)', MB(headline.model), headline.source === 'model' ? headline.tone : null),
      ...(prediction === null ? [] : [row('PHONE PREDICTION RANGE', `${GB(prediction.range.low)}–${GB(prediction.range.high)} GB`)]),
      row('OBSERVED', headline.measured === null ? 'NOTHING OBSERVED' : MB(headline.measured),
        headline.source === 'observed' || headline.source === 'native' ? headline.tone : null));
    const owned = section('WORLDS · OWN BYTES (THESE ADD UP)', ...parts.worlds.map(world => { const r = row(label(world.owner), MB(world.bytes)); data(r, 'world', world.owner); return r; }));
    const shared = section('SHARED', ...parts.shared.map(part => row(part.label.toUpperCase(), MB(part.bytes))),
      row(`OTHER CELLS · ${parts.cells.count}`, MB(parts.cells.bytes)));
    const kept = section('TREND · AT EACH ENTRY', row(trend.length === 0 ? 'NO ENTRY YET' : `${trend.map(GB).join(' → ')} GB`, ''));
    const resident = new Set(parts.worlds.map(world => world.owner).concat(over.map(o => o.owner)));
    const limits = section(`SHARD LIMITS · EACH ALONE, ${GB(CONTENT_CAPS.playing)} GB`, ...points.shards.flatMap(shard => {
      const { limit } = shard; if (limit === null || !resident.has(shard.owner)) return [];
      const r = row(label(shard.owner).toUpperCase(), `${limit.playingPoints}% · ${Math.round(limit.playing / 1e6)} / ${Math.round(limit.playingCap / 1e6)} MB`, limit.tone);
      data(r, 'owner', shard.owner); data(r, 'limit-playing', limit.playing); return [r];
    }));
    allocationScope?.dispose(); allocationScope = null;
    const sections = memory !== null && memoryPanel !== undefined ? memoryPanel.renderMemoryPanel({ el, row, section, data, MB },
      allocationScope = scope.child('ui.budget-memory'), memory, prediction, group, sort, value => { group = value; signature = ''; refresh(); },
      value => { sort = value; signature = ''; refresh(); }) : [];
    more.replaceChildren(total, ...sections, owned, shared, kept, limits);
  };

  function refresh(): void {
    if (root === null || root.hidden !== false || scope.disposed) return;
    const cost = host.allocator.cost(), entries = host.allocator.entries(), memory = snapshot(cost.accounted), over = host.overLimit?.() ?? [];
    // repaint only when the table, the observed totals, the over-limit lines or the view changed: the timer is otherwise a cheap read
    const prediction = memoryPanel?.readPhoneBudget() ?? null;
    const loadingPeak = memoryPanel?.readLoadingPeak() ?? null;
    const shown = expanded ? JSON.stringify(memory) : `${memory.totals.gpu}|${memory.totals.ram}|${memory.measured?.sampledAt ?? ''}`;
    const next = `${cost.accounted}|${entries.length}|${String(expanded)}|${group}|${sort}|${trend.length}|${JSON.stringify(over)}|${shown}|${JSON.stringify(prediction?.ledger)}|${loadingPeak}`;
    if (next === signature && last !== null) return;
    signature = next;
    last = readBudgetPoints({ entries: () => entries, cost: () => cost }, { name: label, ...(host.shard === undefined ? {} : { shard: host.shard }) });
    const fallback = read(cost, memory);
    const playing: MemoryHeadline = prediction === null ? fallback
      : { ...fallback, bytes: prediction.range.central, tone: memoryTone(prediction.range.central), source: 'predicted' };
    head = { ...playing, loadingPeak, peak: Math.max(head?.peak ?? 0, playing.bytes, loadingPeak ?? 0) };
    paint(last, head, budgetBreakdown(entries, cost), expanded ? memory : null, over, prediction);
  }
  const toggle = (): void => {
    if (chip === null || detail === null) return;
    expanded = !expanded; chip.setAttribute('aria-expanded', String(expanded)); detail.hidden = !expanded;
    refresh();
  };
  const crossed = (): void => {
    if (scope.disposed) return;
    // G639: the entry's cost is taken now; its memory snapshot, the trend line and the repaint (allocator table, a second
    // snapshot, the DOM) wait for the task after it, out of its activation frame (~20 ms of a 250 ms Pine activation frame
    // at phone 4x). Entries queue in order, so the trend is the same.
    const cost = host.allocator.cost();
    scope.timeout(0, () => {
      const dev = isDev();
      trend.push((dev ? memoryPanel?.readPhoneBudget()?.range.central : undefined) ?? read(cost, dev ? snapshot(cost.accounted, false) : null).bytes);
      if (trend.length > TREND_KEPT + 1) trend.splice(1, 1);
      refresh();
    });
  };
  const build = (): void => {
    crash = phoneCrashLine(navigator.userAgent, screen.width, screen.height, devicePixelRatio);
    root = el('div', 'ws-grid-budget');
    chip = document.createElement('button'); chip.type = 'button'; chip.className = 'ws-grid-budget-chip'; chip.setAttribute('aria-expanded', 'false');
    const icon = el('span', 'ws-grid-budget-icon'); icon.setAttribute('aria-hidden', 'true');
    gb = el('b', 'ws-grid-budget-gb', '—');
    chip.append(icon, gb);
    // the panel: the headline and the over-limit lines, then (expanded) the breakdown
    bar = el('div', 'ws-grid-budget-bar'); more = el('div', 'ws-grid-budget-more'); detail = el('div', 'ws-grid-budget-detail'); detail.hidden = true;
    detail.append(bar, more);
    root.append(chip, detail);
    // the card takes its own taps; the touch controls under it never see them
    scope.listen(root, 'pointerdown', (event: Event) => { event.stopPropagation(); });
    scope.listen(chip, 'click', (event: Event) => { event.stopPropagation(); toggle(); });
    perfDockChip(root, scope, 10);
  };
  const sync = (on: boolean): void => {
    if (scope.disposed) return;
    if (!on) { scope.cancelTimer(timer); timer = 0; allocationScope?.dispose(); allocationScope = null; if (root !== null) root.hidden = true; return; }
    if (root === null) build();
    if (root === null) return;
    root.hidden = false; void loadPanel(); signature = ''; refresh();
    if (timer === 0) timer = scope.interval(BUDGET_REFRESH_MS, refresh);
  };
  sync(isDev());
  scope.onDispose(onDev(sync));
  return { state: () => last, headline: () => head, trend: () => trend, refresh, toggle, crossed };
}
