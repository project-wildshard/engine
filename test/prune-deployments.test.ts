// @vitest-environment node
import { expect, test } from 'vitest';
import { KEEP_PROMOTED, STAGED_GRACE_MS, prunable, withRetries } from '../scripts/prune-deployments.mjs';
import deploy from '../.github/workflows/deploy.yml?raw';

const now = 1_000_000_000;
const row = (uid: string, ageMinutes: number, readySubstate: string, delta: object = {}) => ({
  uid, created: now - ageMinutes * 60_000, state: 'READY', target: 'production', readySubstate, ...delta });
const promoted = (count: number) => Array.from({ length: count }, (_, index) => row(`p${index}`, index + 1, 'PROMOTED'));
const uids = (rows: readonly { uid: string }[]) => rows.map(({ uid }) => uid);
const context = { liveId: 'p0', aliased: new Set<string>(), now };

test('keeps exactly the newest promoted builds', () => {
  expect(KEEP_PROMOTED).toBe(5);
  expect(uids(prunable(promoted(8), context))).toEqual(['p5', 'p6', 'p7']);
});

test('a promoted build older than the kept window stays while it is live or aliased', () => {
  const rows = [...promoted(6), row('old-live', 90, 'PROMOTED'), row('v0-3', 60_000, 'PROMOTED')];
  expect(uids(prunable(rows, { ...context, liveId: 'old-live', aliased: new Set(['v0-3']) }))).toEqual(['p5']);
});

test('a stage waits out its grace because a running release may still promote it', () => {
  const grace = STAGED_GRACE_MS / 60_000;
  expect(uids(prunable([row('young', grace - 1, 'STAGED'), row('old', grace + 1, 'STAGED')], context))).toEqual(['old']);
});

test('stages never take a kept promoted slot', () => {
  const stages = Array.from({ length: 10 }, (_, index) => row(`s${index}`, 1, 'STAGED'));
  expect(prunable([...stages, ...promoted(5)], context)).toEqual([]);
});

test('anything not understood stays', () => {
  const rows = [row('building', 9_000, 'PROMOTED', { state: 'BUILDING' }), row('preview', 9_000, 'PROMOTED', { target: null }),
    row('unknown', 9_000, 'ROLLED_BACK'), row('missing', 9_000, '', { readySubstate: undefined })];
  expect(prunable(rows, context)).toEqual([]);
});

const instant = () => Promise.resolve();

test('a timed-out request is retried, which the first CI prune needed', async () => {
  let calls = 0;
  const call = () => { calls += 1; return calls < 3 ? Promise.reject(new Error('aborted due to timeout')) : Promise.resolve('listed'); };
  await expect(withRetries('GET /list', call, instant)).resolves.toBe('listed');
  expect(calls).toBe(3);
});

test('a run that gives up names the request', async () => {
  await expect(withRetries('GET /list', () => Promise.reject(new Error('aborted due to timeout')), instant))
    .rejects.toThrow('GET /list: aborted due to timeout (attempt 4)');
});

test('every stage prunes, so a red streak still clears stages, and a prune failure only warns', () => {
  const job = deploy.slice(deploy.indexOf('  stage-prebuilt:\n'), deploy.indexOf('  build-and-deploy:\n'));
  const step = job.slice(job.indexOf('- name: Prune superseded deployments'));
  expect(job.indexOf('- name: Complete the exact protected stage receipt')).toBeLessThan(job.indexOf('- name: Prune superseded deployments'));
  expect(step).toContain('!cancelled()');
  expect(step).toContain('continue-on-error: true');
  expect(step).toContain('node scripts/prune-deployments.mjs');
  expect(job).toContain('/scripts/prune-deployments.mjs\n');
});
