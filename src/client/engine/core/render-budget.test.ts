import { expect, test } from 'vitest';
import { BUDGET_WINDOW, DESKTOP_PIXEL_BUDGET, MAX_HOLD_WINDOWS, RAISE_WINDOWS, RenderBudget, UNPAID_HOLD_WINDOWS, budgetCeiling, budgetFloor, budgetSteps } from './renderBudget';

/** feed one decision window of identical intervals; returns what the last frame decided */
const window = (budget: RenderBudget, ms: number): number | null => {
  let out: number | null = null;
  for (let i = 0; i < BUDGET_WINDOW; i++) out = budget.measured(ms) ?? out;
  return out;
};

test("Jake's window keeps the tier's 1.5; a big window is held to the pixel budget", () => {
  // QA-FEEDBACK-2026-11-14: 1496x717 CSS at devicePixelRatio 2, the desktop tier's 1.5 cap: 2.4 Mpx, under the budget
  expect(budgetCeiling(1496, 717, 2, 1.5)).toBe(1.5);
  // a 2560x1440 window at 1.5 would be 8.3 Mpx: the budget holds it under 4.2 Mpx, snapped down to an eighth (3.7 Mpx)
  const big = budgetCeiling(2560, 1440, 2, 1.5);
  expect(big).toBe(1);
  expect(2560 * 1440 * big * big).toBeLessThanOrEqual(DESKTOP_PIXEL_BUDGET);
  // never past the screen's own density
  expect(budgetCeiling(800, 600, 1, 1.5)).toBe(1);
  // a screen density off the eighths (browser zoom, 110 % scaling) snaps down to one, so the ceiling is a step itself
  for (const device of [0.9, 1.1, 1.2]) {
    const ceiling = budgetCeiling(1280, 720, device, 1.5);
    expect(ceiling).toBeLessThanOrEqual(device);
    expect(new RenderBudget(ceiling).ceiling).toBe(ceiling);
  }
});

test('the floor is one buffer pixel per CSS pixel, or 3/4 of a ceiling already under it', () => {
  expect(budgetFloor(1.5)).toBe(1);
  expect(budgetFloor(1)).toBe(0.75);
  expect(budgetSteps(1, 1.5)).toEqual([1, 1.125, 1.25, 1.375, 1.5]);
});

test('a slow frame steps down fast; a step that pays is kept; calm frames step back up slowly', () => {
  const budget = new RenderBudget(1.5);
  expect(budget.ratio).toBe(1.5);
  expect(window(budget, 20)).toBe(1.375); // misses 60: one step down at once
  expect(budget.takeRatio()).toBe(1.375);
  expect(budget.takeRatio()).toBeNull(); // taken once, by the frame that draws
  expect(window(budget, 17)).toBeNull(); // faster by 15 %: kept, and now under the bar
  expect(budget.ratio).toBe(1.375);
  for (let i = 0; i < RAISE_WINDOWS - 1; i++) expect(window(budget, 10)).toBeNull();
  expect(window(budget, 10)).toBe(1.5); // six calm windows: one step up
});

test('a step that buys nothing is taken back and held off, longer each time', () => {
  const budget = new RenderBudget(1.5);
  expect(window(budget, 25)).toBe(1.375);
  expect(window(budget, 25)).toBe(1.5); // as slow at fewer pixels: not bound by pixels, back to the ceiling
  for (let i = 0; i < UNPAID_HOLD_WINDOWS - 1; i++) expect(window(budget, 25)).toBeNull();
  expect(window(budget, 25)).toBe(1.375); // the hold ran out: one more try
  expect(window(budget, 25)).toBe(1.5);
  for (let i = 0; i < 2 * UNPAID_HOLD_WINDOWS - 1; i++) expect(window(budget, 25)).toBeNull(); // doubled
  expect(window(budget, 25)).toBe(1.375);
  expect(MAX_HOLD_WINDOWS).toBeGreaterThan(2 * UNPAID_HOLD_WINDOWS);
});

test('it keeps stepping down while each step pays, never under the floor', () => {
  const budget = new RenderBudget(1.5);
  let ms = 40;
  for (let i = 0; i < 10; i++) { window(budget, ms); ms *= 0.85; }
  expect(budget.ratio).toBeGreaterThanOrEqual(1);
});

test('a resize moves the ceiling; a capture restores it', () => {
  const budget = new RenderBudget(1.5);
  window(budget, 20); budget.takeRatio();
  expect(budget.resize(1.125)).toBe(1.125); // the new ceiling is under the current step
  expect(budget.ceiling).toBe(1.125);
  window(budget, 20);
  expect(budget.ratio).toBe(1);
  budget.restore();
  expect(budget.takeRatio()).toBe(1.125);
});

test('a hitch never moves it: decisions read a window median', () => {
  const budget = new RenderBudget(1.5);
  for (let i = 0; i < BUDGET_WINDOW; i++) expect(budget.measured(i % 10 === 0 ? 250 : 9)).toBeNull();
  expect(budget.ratio).toBe(1.5);
});
