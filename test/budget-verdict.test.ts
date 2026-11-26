import { expect, test } from 'vitest';
import { judgedValue, verdict } from '../src/scripts/budgets/verdict.mjs';

// BUDGET-CAPS BC1 (meta docs/plans/BUDGET-CAPS-PLAN.md; J444): one hard cap, one recorded baseline, a derived 10% line.
const base = { baseline: { value: 100_000_000, contentKey: 'driftwood-isle@5' }, hard: 150_000_000, contentKey: 'driftwood-isle@5', kind: 'exact' as const };

test('the same content 9% over its baseline is ok; 10% over is regressed', () => {
  expect(verdict({ ...base, measure: 109_000_000 }).status).toBe('ok');
  expect(verdict({ ...base, measure: 110_000_000 }).status).toBe('regressed');
});

test('a new content key is raised, even 40% over, while it stays under the hard cap', () => {
  const result = verdict({ ...base, measure: 140_000_000, contentKey: 'driftwood-isle@6' });
  expect(result.status).toBe('raised');
  expect(result.line).toBeNull();
});

test('a declared key is raised', () => {
  expect(verdict({ ...base, measure: 130_000_000, declared: true }).status).toBe('raised');
});

test('a budget with no baseline yet is raised: only the hard cap is checked', () => {
  expect(verdict({ ...base, baseline: null, measure: 149_000_000 }).status).toBe('raised');
});

test('anything over the hard cap is over-hard, whatever the content key says', () => {
  expect(verdict({ ...base, measure: 150_000_001 }).status).toBe('over-hard');
  expect(verdict({ ...base, measure: 150_000_001, contentKey: 'driftwood-isle@6' }).status).toBe('over-hard');
  expect(verdict({ ...base, measure: 150_000_001, declared: true }).status).toBe('over-hard');
  expect(verdict({ ...base, hard: null, measure: 9e12, contentKey: 'new' }).status).toBe('raised');
});

test('a noisy measure judges the median of three reads: one read over and a median under is ok', () => {
  const noisy = { ...base, kind: 'noisy' as const };
  expect(verdict({ ...noisy, measure: [100_000_000, 120_000_000, 101_000_000] }).status).toBe('ok');
  expect(verdict({ ...noisy, measure: [112_000_000, 112_000_000, 112_000_000] }).status).toBe('regressed');
  expect(judgedValue('noisy', [3, 1, 2])).toBe(2);
  expect(() => judgedValue('noisy', [1, 2])).toThrow(/three reads/);
});

test('a 4 MB rise on a 20 MB memory total is ok under the 5 MB floor; 5 MB is regressed', () => {
  const memory = { baseline: { value: 20_000_000, contentKey: 'nalati@2' }, hard: null, contentKey: 'nalati@2', kind: 'noisy' as const, floor: 5_000_000 };
  expect(verdict({ ...memory, measure: [24_000_000, 24_000_000, 24_000_000] }).status).toBe('ok');
  const over = verdict({ ...memory, measure: [25_000_000, 25_000_000, 25_000_000] });
  expect(over.status).toBe('regressed');
  expect(over.line).toBe(25_000_000);
});

test('the result carries the judged value, the line and the change against the baseline', () => {
  const result = verdict({ ...base, measure: 70_000_000 });
  expect(result).toMatchObject({ status: 'ok', value: 70_000_000, line: 110_000_000, delta: -30_000_000 });
  expect(result.ratio).toBeCloseTo(-0.3);
});

test('a bad measure is an error, never a pass', () => {
  expect(() => verdict({ ...base, measure: -1 })).toThrow(/measure/);
  expect(() => verdict({ ...base, measure: Number.NaN })).toThrow(/measure/);
});

test('a frame-rate floor accepts equality and improvement without a soft ceiling', () => {
  const floor = { ...base, kind: 'floor' as const, hard: 60, baseline: { ...base.baseline, value: 60 } };
  expect(verdict({ ...floor, measure: 59.99 }).status).toBe('over-hard');
  expect(verdict({ ...floor, measure: 60 })).toMatchObject({ status: 'ok', line: null });
  expect(verdict({ ...floor, measure: 120 })).toMatchObject({ status: 'ok', line: null });
});
