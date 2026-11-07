// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { withOwner } from '@wildshard/engine/app/ownership';
import { setDev } from '@wildshard/engine/core/devMode';
import { contentCost, type ContentCostInput } from '@wildshard/format/contentCost';
import { MemoryAdmission } from '@wildshard/format/memoryAdmission';
import { memoryAttribution, type MemorySnapshot } from '@wildshard/engine/core/memoryAttribution';
import { installBudgetOverlay, memoryHeadline } from './budgetOverlay';
import { installMemoryWarning } from './memoryWarning';

const scopes: Scope[] = [];
const owner = (): Scope => { const scope = new Scope('memory-diagnostics'); scopes.push(scope); return scope; };
afterEach(() => { for (const scope of scopes.splice(0)) scope.dispose(); setDev(false); document.body.replaceChildren(); });

const sim = (who: string, bytes: number) => ({ id: `sim:${who}`, category: 'sim' as const, bytes, owner: who, distance: 0, needed: true, refs: 1, holds: 0, accountedBytes: bytes });
const observed = (gpu: number, ram: number): MemorySnapshot => ({ version: 1, allocations: [], totals: { gpu, ram }, unattributed: { gpu: 0, ram: 0 }, measured: null, accountedBytes: null });

test('G628 M1/M3: one line, the page headline in its danger band; the shard limit only when expanded', () => {
  setDev(true);
  const scope = owner(), hud = document.createElement('div'), bytes = 321_621_621;
  document.body.append(hud);
  const input: ContentCostInput = { l0: 0, l1: 0, far: 0, libraries: 0, sims: bytes, commons: 0, overlap: 80_000_000 };
  const overlay = withOwner(scope, () => installBudgetOverlay({ scope, hudRoot: hud, name: () => 'Driftwood Isle', memory: () => observed(0, 0),
    allocator: { entries: () => [sim('dw', bytes)], cost: () => ({ ...contentCost(input), input }) } }));
  const line = hud.querySelector<HTMLElement>('.ws-grid-budget-x');
  expect(line?.textContent).toBe(`MEM ≈${(contentCost(input).playing / 1e9).toFixed(2)} GB / 2.05 · 1 WORLD`);
  expect(line?.dataset['tone']).toBe('green');
  for (const gone of ['SHARDS OK', 'SHARED', 'OF BUDGET', 'NO OWNER']) expect(hud.textContent).not.toContain(gone);
  expect(hud.querySelector('[data-owner="dw"]')).toBeNull();
  overlay.toggle();
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
    const scope = owner(), hud = document.createElement('div');
    const input: ContentCostInput = { l0: 0, l1: 0, far: 0, libraries: 0, sims: 100, commons: 0, overlap: 80_000_000 };
    const cost = vi.fn(() => ({ ...contentCost(input), input })), entries = vi.fn(() => [sim('nine', input.sims)]);
    const memory = vi.fn(() => observed(0, 0));
    const overlay = withOwner(scope, () => installBudgetOverlay({ scope, hudRoot: hud, name: () => 'Nine', memory, allocator: { cost, entries } }));
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

test('collapsed strip reads current totals and expands with full allocation details', () => {
  vi.useFakeTimers();
  try {
    setDev(true);
    const scope = owner(), hud = document.createElement('div');
    const input: ContentCostInput = { l0: 0, l1: 0, far: 0, libraries: 0, sims: 100, commons: 0, overlap: 80_000_000 };
    const summary = vi.spyOn(memoryAttribution, 'summary'), snapshot = vi.spyOn(memoryAttribution, 'snapshot');
    const overlay = withOwner(scope, () => installBudgetOverlay({ scope, hudRoot: hud, name: () => 'Nine',
      allocator: { entries: () => [sim('nine', input.sims)], cost: () => ({ ...contentCost(input), input }) } }));
    expect(summary).toHaveBeenCalledTimes(1); expect(snapshot).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(summary).toHaveBeenCalledTimes(2); expect(snapshot).not.toHaveBeenCalled();
    overlay.toggle();
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(hud.querySelector('[data-memory="observed"]')).not.toBeNull();
    const head = overlay.headline();
    overlay.crossed(); vi.advanceTimersByTime(0);
    expect(summary).toHaveBeenCalledTimes(3); expect(snapshot).toHaveBeenCalledTimes(2);
    expect(overlay.headline()).toEqual(head);
    overlay.toggle(); vi.advanceTimersByTime(1000);
    expect(summary).toHaveBeenCalledTimes(5); expect(snapshot).toHaveBeenCalledTimes(2);
    scope.dispose();
  } finally { vi.useRealTimers(); }
});

test('G628 M4/M7: a red line per shard over its limit; the trend keeps the first entry and the last six', async () => {
  setDev(true);
  const scope = owner(), hud = document.createElement('div');
  document.body.append(hud);
  let sims = 100_000_000;
  const cost = () => { const input: ContentCostInput = { l0: 0, l1: 0, far: 0, libraries: 0, sims, commons: 0, overlap: 80_000_000 }; return { ...contentCost(input), input }; };
  const overlay = withOwner(scope, () => installBudgetOverlay({ scope, hudRoot: hud, name: () => 'Nine', memory: () => observed(0, 0),
    overLimit: () => [{ owner: 'nine', overBytes: 50_000_000 }], allocator: { entries: () => [sim('nine', sims)], cost } }));
  expect(hud.querySelector('.ws-grid-budget-over')?.textContent).toBe('NINE OVER ITS LIMIT · +50.0 MB');
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
  const scope = owner(), memory = new MemoryAdmission(() => true), hud = document.createElement('div');
  document.body.append(hud); scope.onDispose(() => { memory.dispose(); });
  memory.accept({ stage: 'actual', owner: 'nine', id: 'nine:estimate', claimedBytes: 1, accountedBytes: 1,
    playingBytes: 1_590_900_000, loadingBytes: 1_500_000_000, playingCap: 1_200_000_000, loadingCap: 1_800_000_000 });
  const enter = withOwner(scope, () => installMemoryWarning(memory, scope, hud, 'dw'));
  expect(hud.children).toHaveLength(0);
  enter('nine');
  expect(hud.querySelector('.ws-memory-warning-chip')?.textContent).toBe('MEMORY LIMIT · nine ESTIMATE · +390.9 MB');
  enter('dw'); expect(hud.querySelector<HTMLElement>('.ws-memory-warning')?.hidden).toBe(true);
  expect(memory.reports()).toHaveLength(1);
  memory.accept({ stage: 'resident', owner: 'pine', id: 'pine:resident', claimedBytes: 1, accountedBytes: 1,
    playingBytes: 1_250_000_000, loadingBytes: 1_500_000_000, playingCap: 1_200_000_000, loadingCap: 1_800_000_000 });
  expect(hud.querySelector('.ws-memory-warning-chip')?.textContent).toBe('MEMORY LIMIT · pine RESIDENT · +50.0 MB');
  expect(hud.querySelectorAll('.ws-memory-warning-report')).toHaveLength(1);
  enter(null); expect(hud.querySelector<HTMLElement>('.ws-memory-warning')?.hidden).toBe(false);
  setDev(false); expect(hud.querySelector<HTMLElement>('.ws-memory-warning')?.hidden).toBe(true);
  scope.dispose(); enter('nine'); expect(hud.children).toHaveLength(0);
});
