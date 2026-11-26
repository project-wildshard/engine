import { expect, test } from 'vitest';
import { activeT1Gate, qualifiedT1Run, t1Qualification } from '../scripts/t1-qualification.mjs';
import { T1_SHARDS } from '../scripts/t1-shards.mjs';

const DAY = 86_400_000, now = Date.parse('2026-11-19T12:00:00-05:00');
const sha = '12345678'.repeat(5), scope = 'a'.repeat(64);
function run(id, age) {
  const created = now - age;
  return { id, sha, created, event: 'push', branch: 'main', receipts: Object.keys(T1_SHARDS).map(suite => ({
    version: 1, suite, scope, complete: true, sha, run: String(id), started: created + 1000,
    event: 'push', ref: 'refs/heads/main', build: '12345678-example', platform: 'linux', status: 0,
    signal: null, error: null, verdict: 'pass', wallMs: 30_000, budgetMs: 120_000,
  })) };
}

test('requires three full pushes and three days after actual receipt completion', () => {
  const runs = [run(1, 4 * DAY), run(2, 2 * DAY), run(3, DAY)];
  expect(t1Qualification(runs, now, scope).block).toBe(true);
  expect(t1Qualification(runs.slice(0, 2), now, scope).block).toBe(false);
  expect(t1Qualification([run(1, DAY), run(2, DAY), run(3, DAY)], now, scope).block).toBe(false);
  expect(t1Qualification([run(1, 3 * DAY), run(2, DAY), run(3, DAY)], now, scope).block).toBe(false);
});

test('duplicate and incomplete runs cannot inflate the push count', () => {
  const first = run(1, 4 * DAY);
  expect(t1Qualification([first, first, first], now, scope).runs).toEqual([1]);
  const incomplete = run(2, DAY);
  incomplete.receipts.pop();
  expect(qualifiedT1Run(incomplete, now, scope)).toBe(false);
  incomplete.receipts.push(incomplete.receipts[0]);
  expect(qualifiedT1Run(incomplete, now, scope)).toBe(false);
});

test('report wrappers cannot hide a test failure, timeout or excess wall', () => {
  for (const delta of [{ status: 1 }, { signal: 'SIGTERM' }, { wallMs: 120_001 }, { verdict: 'fail' }, { error: 'spawn failed' }]) {
    const bad = run(1, 4 * DAY);
    Object.assign(bad.receipts[3], delta);
    expect(qualifiedT1Run(bad, now, scope), JSON.stringify(delta)).toBe(false);
  }
});

test('all suites must match the same hosted build, Actions SHA and main event', () => {
  for (const delta of [{ platform: 'darwin' }, { build: '12345678-another' }, { sha: 'b'.repeat(40) },
    { event: 'workflow_dispatch' }, { ref: 'refs/heads/plan/example' }, { run: '77' }, { started: now + 1000 }]) {
    const bad = run(1, 4 * DAY);
    Object.assign(bad.receipts[0], delta);
    expect(qualifiedT1Run(bad, now, scope), JSON.stringify(delta)).toBe(false);
  }
});

test('a changed suite or missing content cannot qualify the content suite', () => {
  const first = run(1, 4 * DAY);
  expect(qualifiedT1Run(first, now, 'b'.repeat(64))).toBe(false);
  first.receipts[0].complete = false;
  expect(qualifiedT1Run(first, now, scope)).toBe(false);
});

test('future, stale or foreign Actions metadata cannot establish the report start', () => {
  for (const bad of [run(1, -DAY), run(2, 8 * DAY), { ...run(3, 4 * DAY), branch: 'plan/example' },
    { ...run(4, 4 * DAY), event: 'workflow_dispatch' }]) {
    expect(qualifiedT1Run(bad, now, scope)).toBe(false);
  }
});

test('the shared policy blocks only with fresh matching three-day proof', () => {
  const policy = t1Qualification([run(1, 4 * DAY), run(2, 2 * DAY), run(3, DAY)], now, scope);
  expect(activeT1Gate(policy, scope, now)).toBe(true);
  expect(activeT1Gate({ ...policy, block: false }, scope, now)).toBe(false);
  expect(activeT1Gate(policy, 'b'.repeat(64), now)).toBe(false);
  expect(activeT1Gate(policy, scope, now + DAY + 1)).toBe(false);
  expect(activeT1Gate({ ...policy, at: now + 1 }, scope, now)).toBe(false);
  expect(activeT1Gate({ ...policy, runs: [1, 1, 1] }, scope, now)).toBe(false);
  expect(activeT1Gate(null, scope, now)).toBe(false);
});

test('a failed or incomplete main receipt resets the clean report window', () => {
  const red = run(4, 2 * DAY);
  Object.assign(red.receipts[3], { status: 1, verdict: 'fail' });
  const greens = [run(1, 4 * DAY), run(2, 3.5 * DAY), run(3, 3.25 * DAY)];
  const verdict = t1Qualification([...greens, red, run(5, DAY)], now, scope);
  expect(verdict.block).toBe(false);
  expect(verdict.redRuns).toEqual([4]);
  expect(verdict.runs).toEqual([5]);
  red.receipts.pop();
  expect(t1Qualification([...greens, red], now, scope).block).toBe(false);
});
