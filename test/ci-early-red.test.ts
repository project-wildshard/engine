// Early red (meta FLOW-SIMPLE FS24): a push behind a running main run that is already red cancels that run, so the
// pending run for the newer push starts at once. Only push runs on main; a run with no finished failure is kept.
import { expect, test } from 'vitest';
import { earlyRed, failedBlocking } from '../src/scripts/ci-early-red.mjs';

const run = (id: number, status: string, minute: number, event = 'push', head_branch = 'main') =>
  ({ id, event, status, head_branch, head_sha: String(id).padEnd(40, '0'), created_at: `2026-11-19T03:${String(minute).padStart(2, '0')}:00Z` });
const job = (name: string, status: string, conclusion: string | null) => ({ name, status, conclusion });
// Run 44447800293 at 03:20 UTC: boundaries failed at 03:19, the run went on to 03:39 while 0b6df89b05's push waited.
const redJobs = [job('boundaries', 'completed', 'failure'), job('tests (3)', 'in_progress', null), job('memory-client-build', 'in_progress', null)];
const jobs = (table: Record<number, ReturnType<typeof job>[]>) => (id: number) => table[id] ?? [];

test('a newer push behind a running run with a failed blocking job cancels the running run', () => {
  const runs = [run(44447800293, 'in_progress', 55), run(44447220435, 'pending', 59)].map((row, index) => index === 1 ? { ...row, id: 44448000000 } : row);
  expect(earlyRed(runs, jobs({ 44447800293: redJobs }))).toEqual({ cancel: 44447800293, newer: 44448000000, failed: ['boundaries'] });
});

test('no newer pending push, no cancel: the red run finishes and reports everything', () => {
  expect(earlyRed([run(10, 'in_progress', 1)], jobs({ 10: redJobs }))).toBeNull();
  expect(earlyRed([run(10, 'in_progress', 1), run(11, 'completed', 2)], jobs({ 10: redJobs }))).toBeNull();
});

test('a running run with no finished blocking failure is kept', () => {
  const runs = [run(10, 'in_progress', 1), run(11, 'pending', 2)];
  expect(earlyRed(runs, jobs({ 10: [job('tests (1)', 'in_progress', null), job('tests (2)', 'completed', 'success')] }))).toBeNull();
  // Still running with a failed step: cancelling now would turn its failure into `cancelled`.
  expect(earlyRed(runs, jobs({ 10: [job('tests (1)', 'in_progress', null)] }))).toBeNull();
  // Advisory jobs never make a run red (main-watch's list).
  expect(earlyRed(runs, jobs({ 10: [job('timings', 'completed', 'failure'), job('nine-ledger-diagnostic', 'completed', 'failure')] }))).toBeNull();
});

test('qualification dispatches and release refs are never cancelled or counted as newer', () => {
  const failing = jobs({ 10: redJobs, 12: redJobs });
  expect(earlyRed([run(10, 'in_progress', 1, 'workflow_dispatch'), run(11, 'pending', 2)], failing)).toBeNull();
  expect(earlyRed([run(10, 'in_progress', 1), run(11, 'pending', 2, 'workflow_dispatch')], failing)).toBeNull();
  expect(earlyRed([run(12, 'in_progress', 1, 'push', 'release/v0.1.47'), run(13, 'pending', 2, 'push', 'release/v0.1.47')], failing)).toBeNull();
});

test('timed out and startup failures count; cancelled jobs do not', () => {
  expect(failedBlocking(job('nine-ring1-build', 'completed', 'timed_out'))).toBe(true);
  expect(failedBlocking(job('tests (4)', 'completed', 'startup_failure'))).toBe(true);
  expect(failedBlocking(job('tests (4)', 'completed', 'cancelled'))).toBe(false);
  expect(failedBlocking(job('tests (4)', 'completed', 'success'))).toBe(false);
});
