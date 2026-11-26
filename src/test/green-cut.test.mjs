import { expect, test } from 'vitest';
import { greenCut } from '../scripts/green-cut.mjs';

// Meta QA 11-25 row 67: the v0.1.92 train waited on 9a5101633, whose ci run was cancelled before it started.
const order = ['c760', '9a51', 'f723', '9ed4', '2804'];
const isAncestor = (/** @type {string} */ a, /** @type {string} */ b) => order.indexOf(a) <= order.indexOf(b);
/** @param {string} headSha @param {string} status @param {string|null} conclusion @param {string} [event] */
const run = (headSha, status, conclusion, event = 'push') =>
  ({ databaseId: order.indexOf(headSha) + 1, headSha, status, conclusion, createdAt: '2026-11-25T20:00:00Z', event });

test('picks the newest green run that carries the commit, never the cancelled one', () => {
  const runs = [run('2804', 'completed', 'success'), run('9ed4', 'completed', 'success'), run('9a51', 'completed', 'cancelled'),
    run('c760', 'completed', 'success')];
  expect(greenCut(runs, ['9a51'], isAncestor).cut?.headSha).toBe('2804');
});

test('names the oldest run still going when nothing green carries the commit yet', () => {
  const runs = [run('2804', 'pending', null), run('9ed4', 'in_progress', null), run('9a51', 'completed', 'cancelled'),
    run('c760', 'completed', 'success')];
  const { cut, pending } = greenCut(runs, ['9a51'], isAncestor);
  expect(cut).toBeUndefined();
  expect(pending?.headSha).toBe('9ed4');
});

test('skips red and dispatched runs; with no commit named, the newest green push run', () => {
  const runs = [run('2804', 'completed', 'failure'), run('9ed4', 'completed', 'success', 'workflow_dispatch'),
    run('f723', 'completed', 'success')];
  expect(greenCut(runs, [], isAncestor).cut?.headSha).toBe('f723');
});
