/**
 * The memory card (SHARD-PLATFORM SF38 / G30, rebuilt by G628's memory-strip rows M1 / M3 / M5 / M7): Developer mode only,
 * grid pages only. A14 (Jake, 2026-11-10: "MEM becomes a really small card at the top, labelled mem, right next to the FPS
 * chip"): a chip on the Developer dock (`perfDock.ts`) reading "mem 1.46" (GB), toned by its band, with a red "!" while a
 * shard is over its limit. A tap drops the panel: the headline against the phone's crash line, in plain words
 * ("MEM ≈1.46 GB / 2.05 · 3 WORLDS · +440 MB SINCE START"), its colour the danger band (amber from 1.5 GB, red from
 * 1.75 GB: D1, against the 17 Pro's ~2.05 GB WebContent jetsam line), and one red line per loaded shard over its own limit
 * (M4, `memoryWarning.ts`). The headline is the larger of the cost model (`allocator.cost().playing`) and what this page
 * measured (M5, D2): the native WebContent + GL reading when a harness lent one, else the engine base plus the observed GPU
 * storage and RAM. A tap expands the parts that add up to the model (M2's `budgetBreakdown`), the trend (M7: the headline
 * at each cell entry, the first and the last six), each world's shard limit alone and the observed allocations. Read
 * once a second, never per frame.
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
import { memoryRows, type MemoryGrouping, type MemorySort } from './memoryRows';
import './budgetOverlay.css';

/** D1: the headline turns amber at this many bytes (decimal, MB = 10^6) */
export const MEMORY_AMBER = 1.5e9;
/** D1: and red at this many */
export const MEMORY_RED = 1.75e9;
/** the iPhone 17 Pro's WebContent jetsam line (~2.05 GB): what the headline is read against */
export const CRASH_LINE = 2.05e9;
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

/** M1 / M5: the page's memory headline, the larger of the cost model and the page's own measurement. */
export interface MemoryHeadline {
  readonly bytes: number; readonly tone: PointsTone;
  /** the cost model's playing bytes */
  readonly model: number;
  /** the native reading, else the engine base + observed GPU storage and RAM; null when nothing was observed */
  readonly measured: number | null;
  /** which of the two the headline is */
  readonly source: 'model' | 'native' | 'observed';
}
export function memoryTone(bytes: number): PointsTone { return bytes >= MEMORY_RED ? 'red' : bytes >= MEMORY_AMBER ? 'amber' : 'green'; }
export function memoryHeadline(model: number, snapshot: MemorySnapshot | null, engineBase: number): MemoryHeadline {
  const native = snapshot?.measured ?? null, observed = snapshot === null ? 0 : snapshot.totals.gpu + snapshot.totals.ram;
  const measured = native !== null ? native.webContentBytes + native.labelledGpuBytes : observed > 0 ? engineBase + observed : null;
  const bytes = Math.max(model, measured ?? 0);
  return { bytes, tone: memoryTone(bytes), model, measured, source: measured === null || measured <= model ? 'model' : native !== null ? 'native' : 'observed' };
}

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
  let root: HTMLElement | null = null, gb: HTMLElement | null = null, alert: HTMLElement | null = null, bar: HTMLElement | null = null, detail: HTMLElement | null = null, more: HTMLElement | null = null;
  let timer: ReturnType<typeof setInterval> | 0 = 0, expanded = false, last: BudgetPoints | null = null, head: MemoryHeadline | null = null, signature = '';
  let group: MemoryGrouping = 'owner', sort: MemorySort = 'total';
  let allocationScope: Scope | null = null;
  const trend: number[] = [];
  const label = (owner: string): string => (owner === PLATFORM_OWNER ? 'ROAD' : host.name(owner));
  const snapshot = (accounted: number, details = expanded): MemorySnapshot => host.memory?.()
    ?? (details ? memoryAttribution.snapshot(accounted) : { ...memoryAttribution.summary(accounted), allocations: [] });
  const read = (cost: ReturnType<BudgetOverlayHost['allocator']['cost']>, memory: MemorySnapshot | null): MemoryHeadline =>
    memoryHeadline(cost.playing, memory, cost.input.engineBase ?? CONTENT_CAPS.engineBase);

  const memorySection = (memory: MemorySnapshot): HTMLElement => {
    allocationScope?.dispose();
    const entered = scope.child('ui.budget-memory'); allocationScope = entered;
    const sec = section('SEEN ON THIS PAGE · OBSERVED STORAGE', row('GPU', MB(memory.totals.gpu)), row('RAM STORAGE / CAPACITY', MB(memory.totals.ram)),
      row('UNATTRIBUTED GPU', MB(memory.unattributed.gpu)), row('UNATTRIBUTED RAM STORAGE', MB(memory.unattributed.ram)));
    data(sec, 'memory', 'observed');
    const measured = memory.measured;
    sec.append(row('NATIVE WC + LABELLED GL', measured === null ? 'NOT SAMPLED' : MB(measured.webContentBytes + measured.labelledGpuBytes)));
    if (measured !== null) sec.append(el('p', 'ws-grid-budget-memory-note', `${new Date(measured.sampledAt).toISOString()} · ${measured.source}`));
    sec.append(el('p', 'ws-grid-budget-memory-note', 'GPU is allocated storage. RAM is live storage / capacity, not physical footprint. Native unobserved RAM remains unknown.'));
    const controls = el('div', 'ws-grid-budget-tools');
    const pick = (name: string, choices: readonly (readonly [string, string])[], value: string, changed: (value: string) => void): void => {
      const select = document.createElement('select'); select.className = 'ws-grid-budget-choice'; select.setAttribute('aria-label', name);
      for (const [key, title] of choices) { const option = document.createElement('option'); option.value = key; option.textContent = title; select.append(option); }
      select.value = value; entered.listen(select, 'change', () => { changed(select.value); signature = ''; refresh(); }); controls.append(select);
    };
    pick('Group allocations', [['owner', 'BY OWNER'], ['asset', 'BY OWNER + ASSET']], group, value => { group = value === 'asset' ? 'asset' : 'owner'; });
    pick('Sort allocations', [['total', 'TOTAL'], ['gpu', 'GPU'], ['ram', 'RAM'], ['name', 'NAME']], sort, value => {
      sort = value === 'gpu' || value === 'ram' || value === 'name' ? value : 'total';
    });
    sec.append(controls);
    const projection = memoryRows(memory, group, sort);
    for (const allocation of projection.rows) {
      const line = row(allocation.asset.length === 0 ? allocation.owner : `${allocation.owner}\n${allocation.asset}`, `GPU ${MB(allocation.gpu)} · RAM ${MB(allocation.ram)}`);
      line.classList.add('ws-grid-budget-allocation');
      data(line, 'memory-owner', allocation.owner); data(line, 'gpu-bytes', allocation.gpu); data(line, 'ram-bytes', allocation.ram);
      if (group === 'owner') {
        const drill = document.createElement('button'); drill.type = 'button'; drill.className = 'ws-grid-budget-choice'; drill.textContent = allocation.owner;
        const key = line.firstElementChild;
        if (key !== null) { key.replaceChildren(drill); entered.listen(drill, 'click', () => { group = 'asset'; signature = ''; refresh(); }); }
      }
      sec.append(line, el('small', 'ws-grid-budget-memory-note', `${allocation.allocations} allocations · ${MB(allocation.estimated)} estimated`));
    }
    sec.append(row('ROWS BELOW 1 MB', `GPU ${MB(projection.omitted.gpu)} · RAM ${MB(projection.omitted.ram)}`));
    // Controls and asset taps never collapse the existing chip or reach the touch controls behind it.
    entered.listen(sec, 'click', event => { event.stopPropagation(); });
    return sec;
  };
  const paint = (points: BudgetPoints, headline: MemoryHeadline, parts: ReturnType<typeof budgetBreakdown>, memory: MemorySnapshot | null,
    over: readonly { readonly owner: string; readonly overBytes: number }[]): void => {
    if (root === null || gb === null || alert === null || bar === null || more === null) return;
    const worlds = parts.worlds.length, start = trend[0];
    const since = start === undefined ? '' : ` · ${headline.bytes >= start ? '+' : '−'}${Math.round(Math.abs(headline.bytes - start) / 1e6)} MB SINCE START`;
    const line = el('span', 'ws-grid-budget-x', `MEM ≈${GB(headline.bytes)} GB / ${GB(CRASH_LINE)} · ${worlds} ${worlds === 1 ? 'WORLD' : 'WORLDS'}${since}`);
    data(line, 'tone', headline.tone); data(line, 'bytes', headline.bytes); data(line, 'source', headline.source);
    const lines = over.map(({ owner, overBytes }) => {
      const node = el('span', 'ws-grid-budget-over', `${label(owner).toUpperCase()} OVER ITS LIMIT · +${MB(overBytes)}`);
      data(node, 'tone', 'red'); data(node, 'owner', owner); data(node, 'over-bytes', overBytes); return node;
    });
    bar.replaceChildren(line, ...lines);
    gb.textContent = GB(headline.bytes); data(gb, 'tone', headline.tone);
    alert.hidden = over.length === 0; alert.textContent = over.length > 1 ? `!${String(over.length)}` : '!';
    root.setAttribute('aria-label', line.textContent ?? '');
    if (!expanded) { allocationScope?.dispose(); allocationScope = null; more.replaceChildren(); return; }
    const total = section(`MEMORY ≈${GB(headline.bytes)} GB OF ~${GB(CRASH_LINE)} GB CRASH LINE`,
      row('MODEL (CLAIMS)', MB(headline.model), headline.source === 'model' ? headline.tone : null),
      row('MEASURED', headline.measured === null ? 'NOTHING OBSERVED' : MB(headline.measured), headline.source === 'model' ? null : headline.tone));
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
    more.replaceChildren(total, owned, shared, kept, limits, ...(memory === null ? [] : [memorySection(memory)]));
  };

  function refresh(): void {
    if (root === null || root.hidden !== false || scope.disposed) return;
    const cost = host.allocator.cost(), entries = host.allocator.entries(), memory = snapshot(cost.accounted), over = host.overLimit?.() ?? [];
    // repaint only when the table, the observed totals, the over-limit lines or the view changed: the timer is otherwise a cheap read
    const shown = expanded ? JSON.stringify(memory) : `${memory.totals.gpu}|${memory.totals.ram}|${memory.measured?.sampledAt ?? ''}`;
    const next = `${cost.accounted}|${entries.length}|${String(expanded)}|${group}|${sort}|${trend.length}|${JSON.stringify(over)}|${shown}`;
    if (next === signature && last !== null) return;
    signature = next;
    last = readBudgetPoints({ entries: () => entries, cost: () => cost }, { name: label, ...(host.shard === undefined ? {} : { shard: host.shard }) });
    head = read(cost, memory);
    paint(last, head, budgetBreakdown(entries, cost), expanded ? memory : null, over);
  }
  const toggle = (): void => {
    if (root === null || detail === null) return;
    expanded = !expanded; root.setAttribute('aria-expanded', String(expanded)); detail.hidden = !expanded;
    refresh();
  };
  const crossed = (): void => {
    if (scope.disposed) return;
    // G639: the entry's cost is taken now; its memory snapshot, the trend line and the repaint (allocator table, a second
    // snapshot, the DOM) wait for the task after it, out of its activation frame (~20 ms of a 250 ms Pine activation frame
    // at phone 4x). Entries queue in order, so the trend is the same.
    const cost = host.allocator.cost();
    scope.timeout(0, () => {
      trend.push(read(cost, isDev() ? snapshot(cost.accounted, false) : null).bytes);
      if (trend.length > TREND_KEPT + 1) trend.splice(1, 1);
      refresh();
    });
  };
  const build = (): void => {
    root = el('div', 'ws-grid-budget'); root.setAttribute('role', 'button'); root.setAttribute('aria-expanded', 'false'); root.tabIndex = -1;
    gb = el('b', 'ws-grid-budget-gb', '—'); alert = el('i', 'ws-grid-budget-alert', '!'); alert.hidden = true;
    // the panel: the headline and the over-limit lines, then (expanded) the breakdown
    bar = el('div', 'ws-grid-budget-bar'); more = el('div', 'ws-grid-budget-more'); detail = el('div', 'ws-grid-budget-detail'); detail.hidden = true;
    detail.append(bar, more);
    root.append(el('i', 'ws-grid-budget-label', 'mem'), gb, alert, detail);
    // the card takes its own taps; the touch controls under it never see them
    scope.listen(root, 'pointerdown', (event: Event) => { event.stopPropagation(); });
    scope.listen(root, 'click', (event: Event) => { event.stopPropagation(); toggle(); });
    perfDockChip(root, scope, 10);
  };
  const sync = (on: boolean): void => {
    if (scope.disposed) return;
    if (!on) { scope.cancelTimer(timer); timer = 0; allocationScope?.dispose(); allocationScope = null; if (root !== null) root.hidden = true; return; }
    if (root === null) build();
    if (root === null) return;
    root.hidden = false; signature = ''; refresh();
    if (timer === 0) timer = scope.interval(BUDGET_REFRESH_MS, refresh);
  };
  sync(isDev());
  scope.onDispose(onDev(sync));
  return { state: () => last, headline: () => head, trend: () => trend, refresh, toggle, crossed };
}
