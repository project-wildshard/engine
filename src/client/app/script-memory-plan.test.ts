// STAGING-BUGBASH SB47 (opus-sb49): a grid page reserved its whole in-play script memory bank (35 fixed, 9 virgin) under the
// loader: 1.1-2.0 s of Application modules on headless WebKit iPhone at 4x CPU. Under the loader it reserves the standalone
// bank; the rest tops up after control, a reserve an idle turn.
import { expect, test } from 'vitest';
import { GRID_SCRIPT_MEMORY, PAGE_SCRIPT_MEMORY, SCRIPT_MEMORY_TOP_UP_DEFAULT, reserveScriptMemory, scriptMemoryTopUp } from './scriptMemoryPlan';
import { prepareScriptMemoryBank, scriptMemoryCensus } from '@wildshard/engine/script/moduleV2';

const total = (bank: typeof PAGE_SCRIPT_MEMORY): number => bank.counts.reduce((n, c) => n + c, 0) + bank.virgin.reduce((n, row) => n + row.count, 0);

test('a grid page reserves only the standalone bank under the loader, and the grid bank after control at idle pace', async () => {
  const before = scriptMemoryCensus().retained;
  let control: (() => void) | null = null, idles = 0;
  await reserveScriptMemory(true, { prepare: prepareScriptMemoryBank, yieldTask: () => Promise.resolve(),
    afterControl: (run) => { control = run; }, idle: () => { idles++; return Promise.resolve(true); } });
  expect(scriptMemoryCensus().retained - before).toBe(total(PAGE_SCRIPT_MEMORY));
  expect(idles).toBe(0);
  // the top-up runs only once control is reached, and spends an idle turn before its first reserve and after each
  const topUp = control as (() => void) | null;
  expect(topUp).not.toBeNull();
  topUp?.();
  await new Promise((resolve) => { setTimeout(resolve, 50); });
  expect(scriptMemoryCensus().retained - before).toBe(total(GRID_SCRIPT_MEMORY));
  expect(idles).toBe(1 + total(GRID_SCRIPT_MEMORY) - total(PAGE_SCRIPT_MEMORY));
});

test('a standalone page reserves its bank and tops up nothing', async () => {
  let asked = false;
  const banks: number[] = [];
  await reserveScriptMemory(false, { prepare: (counts, _y, virgin) => { banks.push(counts.reduce((n, c) => n + c, 0) + (virgin ?? []).reduce((n, row) => n + row.count, 0)); return Promise.resolve(); },
    yieldTask: () => Promise.resolve(), afterControl: () => { asked = true; }, idle: () => Promise.resolve(true) });
  expect(banks).toEqual([total(PAGE_SCRIPT_MEMORY)]);
  expect(asked).toBe(false);
});

test('a top-up whose owner ends stops between reserves', async () => {
  let control: (() => void) | null = null, turns = 0;
  const banks: number[] = [];
  await reserveScriptMemory(true, { prepare: async (counts, yieldTask) => { banks.push(counts[0] ?? 0); try { await yieldTask(); await yieldTask(); } catch { /* ended */ } },
    yieldTask: () => Promise.resolve(), afterControl: (run) => { control = run; }, idle: () => Promise.resolve(++turns < 3) });
  (control as (() => void) | null)?.();
  await new Promise((resolve) => { setTimeout(resolve, 20); });
  expect(banks).toEqual([PAGE_SCRIPT_MEMORY.counts[0], GRID_SCRIPT_MEMORY.counts[0]]);
  expect(turns).toBe(3);
});

test('debug.scriptMemoryTopUp false: a grid page reserves the standalone bank and tops up nothing (DW3)', async () => {
  let asked = false;
  const banks: number[] = [];
  await reserveScriptMemory(true, { prepare: (counts, _y, virgin) => { banks.push(counts.reduce((n, c) => n + c, 0) + (virgin ?? []).reduce((n, row) => n + row.count, 0)); return Promise.resolve(); },
    yieldTask: () => Promise.resolve(), afterControl: () => { asked = true; }, idle: () => Promise.resolve(true), topUp: false });
  expect(banks).toEqual([total(PAGE_SCRIPT_MEMORY)]);
  expect(asked).toBe(false);
  expect(scriptMemoryTopUp(false)).toBe(false);
  expect(scriptMemoryTopUp(true)).toBe(true);
  expect(scriptMemoryTopUp('off')).toBe(SCRIPT_MEMORY_TOP_UP_DEFAULT);
});

test('unset, phone Low skips the top-up and every other page keeps it; a saved pick wins (DW3)', () => {
  expect(scriptMemoryTopUp(null, true)).toBe(false);
  expect(scriptMemoryTopUp(undefined, false)).toBe(true);
  expect(scriptMemoryTopUp(null)).toBe(SCRIPT_MEMORY_TOP_UP_DEFAULT);
  expect(scriptMemoryTopUp(true, true)).toBe(true);
  expect(scriptMemoryTopUp(false, false)).toBe(false);
});
