import type { Scope } from '@wildshard/engine/app/scope';
import { bootMemorySamples } from '@wildshard/engine/boot/bootTrace';
import type { MemorySnapshot } from '@wildshard/engine/core/memoryAttribution';
import model from '../../../scripts/memory/phone-model.json';
import { memorySubsystems, PHONE_MEMORY_BUDGETS, type BudgetLedger, type MemorySubsystem } from '@wildshard/engine/core/memoryBudget';
import { phoneFromLedger, phoneFromLedgerSample, phoneLedgerSample, type PhoneMemoryRange } from '@wildshard/engine/core/phoneMemoryModel';
import { memoryRows, type MemoryGrouping, type MemorySort } from './memoryRows';
import type { PointsTone } from './budgetPoints';

export interface PhoneBudgetReading {
  readonly ledger: BudgetLedger;
  readonly range: PhoneMemoryRange;
}
export function readPhoneBudget(): PhoneBudgetReading | null {
  const reader = Reflect.get(globalThis, '__wildshardMemory') as { counters?: () => BudgetLedger } | null | undefined;
  if (typeof reader?.counters !== 'function') return null;
  const ledger = reader.counters();
  return { ledger, range: phoneFromLedger(ledger, model) };
}

let sampledBoot: ReturnType<typeof bootMemorySamples> | undefined;
let sampledCount = 0;
let sampledPeak: number | null = null;
/** The largest EM11 estimate from this boot's live ledger samples. The
 * peak-over-settled multiplier is for predicting an unseen boot from play. */
export function readLoadingPeak(): number | null {
  const samples = bootMemorySamples();
  if (sampledBoot !== samples) {
    sampledBoot = samples;
    sampledCount = 0;
    sampledPeak = null;
  }
  if (sampledCount === samples.length) return sampledPeak;
  for (const sample of samples.slice(sampledCount)) {
    const reading = phoneFromLedgerSample(sample, model).central;
    sampledPeak = Math.max(sampledPeak ?? 0, reading);
  }
  sampledCount = samples.length;
  return sampledPeak;
}

const SUBSYSTEM_NAMES: Readonly<Record<MemorySubsystem, string>> = {
  browser: 'Browser and framebuffer',
  engine: 'Engine and render targets',
  workers: 'Workers and Wasm',
  geometry: 'GPU geometry',
  textures: 'GPU textures',
  scene: 'CPU geometry and colliders',
  audio: 'Audio',
  loading: 'Loading and decode',
  margin: 'Margin',
};

interface PanelElements {
  readonly el: (tag: string, className: string, text?: string) => HTMLElement;
  readonly row: (label: string, value: string, tone?: PointsTone | null) => HTMLElement;
  readonly section: (title: string, ...rows: HTMLElement[]) => HTMLElement;
  readonly data: (node: HTMLElement, name: string, value: string | number) => void;
  readonly MB: (bytes: number) => string;
}

export function budgetRows(ledger: BudgetLedger): readonly { id: MemorySubsystem; label: string; live: number; estimated: number; budget: number }[] {
  const totals = memorySubsystems(ledger);
  // EM4's blank WebContent floor. EM11 already subtracts the GPU blank floor.
  const floor = phoneFromLedger({}, model).central, browser = 16.5e6;
  const { jsheap, canvas } = phoneLedgerSample(ledger);
  const estimate = (id: MemorySubsystem): number => phoneFromLedgerSample({
    ...totals[id], jsheap: id === 'loading' ? jsheap : 0, canvas: id === 'loading' ? canvas : 0,
  }, model).central - floor;
  const ids = Object.keys(PHONE_MEMORY_BUDGETS) as MemorySubsystem[];
  return ids.map(id => ({ id, label: SUBSYSTEM_NAMES[id], live: totals[id].gpu + totals[id].ram,
    estimated: estimate(id) + (id === 'browser' ? browser : id === 'engine' ? floor - browser : 0),
    budget: PHONE_MEMORY_BUDGETS[id] }));
}

export function renderMemoryPanel(elements: PanelElements, entered: Scope, memory: MemorySnapshot,
  prediction: PhoneBudgetReading | null, group: MemoryGrouping, sort: MemorySort,
  changeGroup: (next: MemoryGrouping) => void, changeSort: (next: MemorySort) => void): HTMLElement[] {
  const { el, row, section, data, MB } = elements;
  const budgets = prediction === null ? [] : [section('PHONE SUBSYSTEMS · LEDGER / PREDICTED / BUDGET', ...budgetRows(prediction.ledger).map(item => {
    const tone = item.estimated > item.budget ? 'red' : 'none';
    const line = row(item.label, `${MB(item.live)} / ${MB(item.estimated)} / ${MB(item.budget)}`, tone === 'red' ? tone : null);
    data(line, 'subsystem', item.id); data(line, 'live-bytes', item.live); data(line, 'budget-bytes', item.budget);
    const meter = document.createElement('meter'); meter.className = 'ws-budget-subsystem-meter';
    meter.setAttribute('max', String(item.budget));
    meter.setAttribute('value', String(Math.min(item.estimated, item.budget)));
    meter.setAttribute('aria-label', item.label);
    line.append(meter);
    return line;
  }))];
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
    select.value = value; entered.listen(select, 'change', () => { changed(select.value); }); controls.append(select);
  };
  pick('Group allocations', [['owner', 'BY OWNER'], ['asset', 'BY OWNER + ASSET']], group, value => { changeGroup(value === 'asset' ? 'asset' : 'owner'); });
  pick('Sort allocations', [['total', 'TOTAL'], ['gpu', 'GPU'], ['ram', 'RAM'], ['name', 'NAME']], sort, value => {
    changeSort(value === 'gpu' || value === 'ram' || value === 'name' ? value : 'total');
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
      if (key !== null) { key.replaceChildren(drill); entered.listen(drill, 'click', () => { changeGroup('asset'); }); }
    }
    sec.append(line, el('small', 'ws-grid-budget-memory-note', `${allocation.allocations} allocations · ${MB(allocation.estimated)} estimated`));
  }
  sec.append(row('ROWS BELOW 1 MB', `GPU ${MB(projection.omitted.gpu)} · RAM ${MB(projection.omitted.ram)}`));
  // Controls and asset taps never collapse the existing chip or reach the touch controls behind it.
  entered.listen(sec, 'click', event => { event.stopPropagation(); });
  return [...budgets, sec];
}
