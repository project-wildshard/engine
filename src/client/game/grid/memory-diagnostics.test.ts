// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { provideBootLedger, recordBootCheckpoint, startBoot } from '@wildshard/engine/boot/bootTrace';
import { withOwner } from '@wildshard/engine/app/ownership';
import { setDev } from '@wildshard/engine/core/devMode';
import { contentCost, type ContentCostInput } from '@wildshard/format/contentCost';
import { MemoryAdmission } from '@wildshard/format/memoryAdmission';
import { memoryAttribution, type MemorySnapshot } from '@wildshard/engine/core/memoryAttribution';
import { phoneFromLedger } from '@wildshard/engine/core/phoneMemoryModel';
import phoneModel from '../../../../scripts/memory/phone-model.json';
import { CRASH_LINE, installBudgetOverlay, memoryHeadline, phoneCrashLine } from './budgetOverlay';
import { installMemoryWarning } from './memoryWarning';
import { perfDockSections } from '@wildshard/engine/ui/perfDock';

const scopes: Scope[] = [];
const owner = (): Scope => { const scope = new Scope('memory-diagnostics'); scopes.push(scope); return scope; };
afterEach(() => { for (const scope of scopes.splice(0)) scope.dispose(); setDev(false); document.body.replaceChildren(); });

const sim = (who: string, bytes: number) => ({ id: `sim:${who}`, category: 'sim' as const, bytes, owner: who, distance: 0, needed: true, refs: 1, holds: 0, accountedBytes: bytes });
const observed = (gpu: number, ram: number): MemorySnapshot => ({ version: 1, allocations: [], totals: { gpu, ram }, unattributed: { gpu: 0, ram: 0 }, measured: null, accountedBytes: null });

test('G628 M1/M3: one line, the page headline in its danger band; the shard limit only when expanded', () => {
  setDev(true);
  const scope = owner(), hud = document.body, bytes = 321_621_621;
  const input: ContentCostInput = { l0: 0, l1: 0, far: 0, libraries: 0, sims: bytes, commons: 0, overlap: 80_000_000 };
  withOwner(scope, () => installBudgetOverlay({ scope, name: () => 'Driftwood Isle', memory: () => observed(0, 0),
    allocator: { entries: () => [sim('dw', bytes)], cost: () => ({ ...contentCost(input), input }) } }));
  const line = hud.querySelector<HTMLElement>('.ws-grid-budget-x');
  expect(line?.textContent).toBe(`CLAIMS ≈${(contentCost(input).playing / 1e9).toFixed(2)} GB PLAYING · 1 WORLD`);
  expect(line?.dataset['tone']).toBe('green');
  // The dock button has one visible number. The headline above waits in its panel.
  const card = document.querySelector<HTMLElement>('.ws-perf-dock .ws-grid-budget');
  const chip = card?.querySelector<HTMLButtonElement>('button.ws-grid-budget-chip');
  expect(chip?.querySelector('.ws-grid-budget-icon')?.getAttribute('aria-hidden')).toBe('true');
  expect(chip?.textContent).toBe((contentCost(input).playing / 1e9).toFixed(1)); // QA-FEEDBACK 11-24 row 36: one decimal on the chip
  expect(chip?.getAttribute('aria-label')).toBe(`Memory ${chip?.textContent} GB`);
  expect(card?.querySelector<HTMLElement>('.ws-grid-budget-gb')?.dataset['tone']).toBe('green');
  expect(chip?.dataset['overLimit']).toBeUndefined();
  expect(card?.querySelector<HTMLElement>('.ws-grid-budget-detail')?.hidden).toBe(true);
  for (const gone of ['SHARDS OK', 'SHARED', 'OF BUDGET', 'NO OWNER']) expect(hud.textContent).not.toContain(gone);
  expect(hud.querySelector('[data-owner="dw"]')).toBeNull();
  chip?.click();
  expect(chip?.getAttribute('aria-expanded')).toBe('true');
  // d2ef0c0848 calibrates the base to 250 MiB: 262144000 + ceil(bytes * 1.11) + 80000000 = 699144000.
  expect(hud.querySelector('[data-owner="dw"]')?.textContent).toBe('DRIFTWOOD ISLE58% · 699 / 1200 MB');
  expect(hud.querySelector('.ws-grid-budget-gauge')).toBeNull();
});

test('G628 M1/M5: the headline is the larger of model and measured; amber at 1.5 GB, red at 1.75 GB', () => {
  expect(memoryHeadline(1_000_000_000, null, 300_000_000)).toMatchObject({ bytes: 1_000_000_000, measured: null, source: 'model', tone: 'green' });
  expect(memoryHeadline(1_000_000_000, observed(1_000_000_000, 300_000_000), 300_000_000)).toMatchObject({ bytes: 1_600_000_000, source: 'observed', tone: 'amber' });
  expect(memoryHeadline(1_800_000_000, observed(100, 0), 300_000_000)).toMatchObject({ bytes: 1_800_000_000, source: 'model', tone: 'red' });
  const native = { ...observed(0, 0), measured: { webContentBytes: 1_200_000_000, labelledGpuBytes: 400_000_000, sampledAt: 0, source: 'test' } };
  expect(memoryHeadline(1_000_000_000, native, 300_000_000)).toMatchObject({ bytes: 1_600_000_000, source: 'native' });
});

test('hidden Developer strip skips snapshots while entry trends keep their original cost', () => {
  vi.useFakeTimers();
  try {
    setDev(true);
    const scope = owner();
    const input: ContentCostInput = { l0: 0, l1: 0, far: 0, libraries: 0, sims: 100, commons: 0, overlap: 80_000_000 };
    const cost = vi.fn(() => ({ ...contentCost(input), input })), entries = vi.fn(() => [sim('nine', input.sims)]);
    const memory = vi.fn(() => observed(0, 0));
    const overlay = withOwner(scope, () => installBudgetOverlay({ scope, name: () => 'Nine', memory, allocator: { cost, entries } }));
    expect(memory).toHaveBeenCalledTimes(1);
    setDev(false);
    cost.mockClear(); entries.mockClear(); memory.mockClear();
    overlay.refresh(); overlay.crossed(); vi.advanceTimersByTime(3000);
    expect(cost).toHaveBeenCalledTimes(1);
    expect(entries).not.toHaveBeenCalled(); expect(memory).not.toHaveBeenCalled();
    expect(overlay.trend()).toEqual([contentCost(input).playing]);
    setDev(true);
    expect(memory).toHaveBeenCalledTimes(1); expect(entries).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(memory).toHaveBeenCalledTimes(2); expect(entries).toHaveBeenCalledTimes(2);
    scope.dispose();
  } finally { vi.useRealTimers(); }
});

test('collapsed strip reads current totals and expands with full allocation details', async () => {
  vi.useFakeTimers();
  try {
    setDev(true);
    const scope = owner(), hud = document.body;
    const input: ContentCostInput = { l0: 0, l1: 0, far: 0, libraries: 0, sims: 100, commons: 0, overlap: 80_000_000 };
    const summary = vi.spyOn(memoryAttribution, 'summary'), snapshot = vi.spyOn(memoryAttribution, 'snapshot');
    const overlay = withOwner(scope, () => installBudgetOverlay({ scope, name: () => 'Nine',
      allocator: { entries: () => [sim('nine', input.sims)], cost: () => ({ ...contentCost(input), input }) } }));
    expect(summary).toHaveBeenCalledTimes(1); expect(snapshot).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(summary).toHaveBeenCalledTimes(2); expect(snapshot).not.toHaveBeenCalled();
    await vi.dynamicImportSettled();
    summary.mockClear();
    overlay.toggle();
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(hud.querySelector('[data-memory="observed"]')).not.toBeNull();
    const head = overlay.headline();
    overlay.crossed(); vi.advanceTimersByTime(0);
    expect(summary).toHaveBeenCalledTimes(1); expect(snapshot).toHaveBeenCalledTimes(2);
    expect(overlay.headline()).toEqual(head);
    overlay.toggle(); vi.advanceTimersByTime(1000);
    expect(summary).toHaveBeenCalledTimes(3); expect(snapshot).toHaveBeenCalledTimes(2);
    scope.dispose();
  } finally { vi.useRealTimers(); }
});

test('the chip shows EM11 central, while the panel shows the peak, upper and subsystem budgets', async () => {
  const playing = { gpu: { buffer: 300e6, texture: 10e6 }, workers: { 'decoder/wasm': 2e6 } };
  const loading = { ...playing, ram: { decode: 150e6 } };
  let ledger = loading;
  vi.stubGlobal('__wildshardMemory', { counters: () => playing });
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone)' });
  vi.stubGlobal('screen', { width: 390, height: 844 });
  vi.stubGlobal('devicePixelRatio', 3);
  provideBootLedger(() => ledger);
  try {
    setDev(true);
    startBoot({ id: 'nine', name: 'Nine' }, false);
    recordBootCheckpoint('decode:peak');
    ledger = { ...playing, ram: { decode: 0 } };
    document.dispatchEvent(new Event('ws:control-ready'));
    const scope = owner(), input: ContentCostInput = { l0: 0, l1: 0, far: 0, libraries: 0, sims: 0, commons: 0, overlap: 0 };
    const overlay = withOwner(scope, () => installBudgetOverlay({ scope, name: id => id,
      memory: () => observed(100e6, 0),
      allocator: { entries: () => [], cost: () => ({ ...contentCost(input), input }) } }));
    await vi.dynamicImportSettled();
    const range = phoneFromLedger(playing, phoneModel), peak = phoneFromLedger(loading, phoneModel).central;
    const chip = document.querySelector<HTMLElement>('.ws-grid-budget');
    expect(chip?.dataset).toMatchObject({ source: 'predicted', playingBytes: String(range.central), loadingPeakBytes: String(peak), peakBytes: String(peak) });
    expect(chip?.querySelector('button')?.textContent).toBe((range.central / 1e9).toFixed(1)); // row 36: one decimal; the panel keeps two
    expect(overlay.headline()).toMatchObject({ source: 'predicted', bytes: range.central, loadingPeak: peak, peak });
    overlay.toggle();
    expect(document.querySelector('.ws-grid-budget-x')?.textContent).toContain('EM11');
    expect(chip?.textContent).toContain(`EM11 PLAYING UPPER${(range.high / 1e9).toFixed(2)} GB`);
    expect(chip?.textContent).toContain(`PEAK SINCE LOAD${(peak / 1e9).toFixed(2)} GB`);
    expect(chip?.textContent).toContain('CRASH LINE · IPHONE 13-CLASSUNMEASURED');
    const geometry = document.querySelector<HTMLElement>('[data-subsystem="geometry"]');
    expect(geometry?.dataset).toMatchObject({ liveBytes: '300000000', budgetBytes: '150000000', tone: 'red' });
    expect(geometry?.querySelector('meter')?.getAttribute('max')).toBe('150000000');
    expect(document.querySelector<HTMLElement>('[data-subsystem="workers"]')?.dataset['liveBytes']).toBe('2000000');
  } finally {
    setDev(false);
    startBoot({ id: 'nine', name: 'Nine' }, false);
    vi.unstubAllGlobals();
  }
});

test('the peak includes a higher playing reading and holds it after memory falls', async () => {
  const low = { gpu: { buffer: 300e6 } }, high = { gpu: { buffer: 550e6 } };
  let playing = low;
  vi.stubGlobal('__wildshardMemory', { counters: () => playing });
  provideBootLedger(() => low);
  try {
    setDev(true);
    startBoot({ id: 'nine', name: 'Nine' }, false);
    recordBootCheckpoint('decode:peak');
    document.dispatchEvent(new Event('ws:control-ready'));
    const scope = owner(), input: ContentCostInput = { l0: 0, l1: 0, far: 0, libraries: 0, sims: 0, commons: 0, overlap: 0 };
    const overlay = withOwner(scope, () => installBudgetOverlay({ scope, name: id => id, memory: () => observed(0, 0),
      allocator: { entries: () => [], cost: () => ({ ...contentCost(input), input }) } }));
    await vi.dynamicImportSettled();
    const lowBytes = phoneFromLedger(low, phoneModel).central, highBytes = phoneFromLedger(high, phoneModel).central;
    expect(highBytes).toBeGreaterThan(lowBytes);
    expect(overlay.headline()).toMatchObject({ bytes: lowBytes, loadingPeak: lowBytes, peak: lowBytes });
    playing = high;
    overlay.refresh();
    expect(overlay.headline()).toMatchObject({ bytes: highBytes, loadingPeak: lowBytes, peak: highBytes });
    playing = low;
    overlay.refresh();
    document.querySelector<HTMLButtonElement>('.ws-grid-budget-chip')?.click();
    expect(overlay.headline()).toMatchObject({ bytes: lowBytes, loadingPeak: lowBytes, peak: highBytes });
    expect(document.querySelector('.ws-grid-budget-detail')?.textContent).toContain(`PEAK SINCE LOAD${(highBytes / 1e9).toFixed(2)} GB`);
  } finally {
    startBoot({ id: 'nine', name: 'Nine' }, false);
    vi.unstubAllGlobals();
  }
});

test('crash lines distinguish the iPhone references and an unknown device', () => {
  expect(phoneCrashLine('iPhone', 874, 402, 3)).toEqual({ label: 'IPHONE 17 PRO REFERENCE', bytes: CRASH_LINE });
  expect(phoneCrashLine('iPhone', 390, 844, 3)).toEqual({ label: 'IPHONE 13-CLASS', bytes: null });
  expect(phoneCrashLine('iPhone', 430, 932, 3)).toEqual({ label: 'DEVICE', bytes: null });
  expect(phoneCrashLine('Macintosh', 402, 874, 3)).toEqual({ label: 'DEVICE', bytes: null });
});

test('G628 M4/M7: a red line per shard over its limit; the trend keeps the first entry and the last six', async () => {
  setDev(true);
  const scope = owner(), hud = document.body;
  let sims = 100_000_000;
  const cost = () => { const input: ContentCostInput = { l0: 0, l1: 0, far: 0, libraries: 0, sims, commons: 0, overlap: 80_000_000 }; return { ...contentCost(input), input }; };
  const overlay = withOwner(scope, () => installBudgetOverlay({ scope, name: () => 'Nine', memory: () => observed(0, 0),
    overLimit: () => [{ owner: 'nine', overBytes: 50_000_000 }], allocator: { entries: () => [sim('nine', sims)], cost } }));
  expect(hud.querySelector('.ws-grid-budget-over')?.textContent).toBe('NINE OVER ITS LIMIT · +50.0 MB');
  expect(hud.querySelector<HTMLElement>('.ws-grid-budget-chip')?.dataset['overLimit']).toBeDefined();
  const start = cost().playing;
  for (let i = 0; i < 9; i++) { overlay.crossed(); sims += 10_000_000; }
  await new Promise(resolve => { setTimeout(resolve, 0); }); // each entry's line follows it by a task
  const trend = overlay.trend();
  expect(trend).toHaveLength(7);
  expect(trend[0]).toBe(start);
  expect(hud.querySelector('.ws-grid-budget-x')?.textContent).toMatch(/· \+\d+ MB SINCE START$/u);
});

test('cold neighbour estimates stay in history while HUD warnings follow the entered owner', () => {
  setDev(true);
  const scope = owner(), memory = new MemoryAdmission(() => true), hud = perfDockSections();
  scope.onDispose(() => { memory.dispose(); });
  memory.accept({ stage: 'actual', owner: 'nine', id: 'nine:estimate', claimedBytes: 1, accountedBytes: 1,
    playingBytes: 1_590_900_000, loadingBytes: 1_500_000_000, playingCap: 1_200_000_000, loadingCap: 1_800_000_000 });
  const enter = withOwner(scope, () => installMemoryWarning(memory, scope, 'dw'));
  expect(hud.querySelector('.ws-memory-warning')).toBeNull();
  enter('nine');
  // A14: a section of the frame meter's panel, and the dock's red mark while it shows
  expect(document.querySelector('.ws-perf-dock')?.classList.contains('alert')).toBe(true);
  expect(hud.querySelector('.ws-memory-warning-chip')?.textContent).toBe('MEMORY LIMIT · nine ESTIMATE · +390.9 MB');
  enter('dw'); expect(hud.querySelector<HTMLElement>('.ws-memory-warning')?.hidden).toBe(true);
  expect(memory.reports()).toHaveLength(1);
  memory.accept({ stage: 'resident', owner: 'pine', id: 'pine:resident', claimedBytes: 1, accountedBytes: 1,
    playingBytes: 1_250_000_000, loadingBytes: 1_500_000_000, playingCap: 1_200_000_000, loadingCap: 1_800_000_000 });
  expect(hud.querySelector('.ws-memory-warning-chip')?.textContent).toBe('MEMORY LIMIT · pine RESIDENT · +50.0 MB');
  expect(hud.querySelectorAll('.ws-memory-warning-report')).toHaveLength(1);
  enter(null); expect(hud.querySelector<HTMLElement>('.ws-memory-warning')?.hidden).toBe(false);
  setDev(false); expect(hud.querySelector<HTMLElement>('.ws-memory-warning')?.hidden).toBe(true);
  expect(document.querySelector('.ws-perf-dock')?.classList.contains('alert')).toBe(false);
  scope.dispose(); enter('nine'); expect(hud.querySelector('.ws-memory-warning')).toBeNull();
});
