import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Own a minimal duration registry for the actual planner.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve isolated synthetic report paths.
import { resolve } from 'node:path';
import { createShardPlan, readShardPlan, CI_SHARD_COUNT } from '../scripts/test-shard-plan';
import { measuredWeights, selectTimingHistory } from '../scripts/vitest-plan';

const source = { sha: 'a'.repeat(40), run: '123' };
function fixture() {
  const paths = Array.from({ length: 37 }, (_, index) => `test/fixture-${index}.test.ts`);
  const weights = new Map(paths.map((path, index) => [path, index % 7]));
  const options = { ...source, count: 4, workers: 2, fallbackSeconds: 3, measuredFiles: 37 };
  return { paths, weights, options, plan: createShardPlan(paths, weights, options) };
}

test('plans assign every current and newly discovered file once with deterministic balanced worker bins', () => {
  const f = fixture(), plan = createShardPlan([...f.paths, 'test/added.test.ts'], f.weights, f.options);
  expect(plan.shards.flatMap(shard => shard.files).sort()).toEqual([...f.paths, 'test/added.test.ts'].sort());
  expect(new Set(plan.shards.flatMap(shard => shard.files)).size).toBe(f.paths.length + 1);
  expect(createShardPlan([...f.paths].reverse(), f.weights, f.options)).toEqual(f.plan);
  const walls = f.plan.shards.map(shard => shard.expectedSeconds);
  expect(Math.max(...walls) - Math.min(...walls)).toBeLessThanOrEqual(6);
  const long = createShardPlan(['long', 'short-a', 'short-b'], new Map([['long', 20], ['short-a', 1], ['short-b', 1]]), { ...f.options, count: 1 });
  expect(long.expectedSeconds).toBe(20);
});

test('stale, duplicate, missing and foreign-source plans refuse before selecting a shard', () => {
  const f = fixture();
  expect(() => readShardPlan(f.plan, f.paths, 3, source)).toThrow('count');
  expect(() => readShardPlan(f.plan, f.paths.slice(1), 4, source)).toThrow('inventory');
  const duplicate = structuredClone(f.plan), file = duplicate.shards[0]?.files[0];
  if (file === undefined) throw new Error('Missing planned fixture');
  duplicate.shards[1]?.files.push(file);
  expect(() => readShardPlan(duplicate, f.paths, 4, source)).toThrow('inventory');
  expect(() => readShardPlan(f.plan, f.paths, 4, { ...source, run: 'other' })).toThrow('source/run');
  expect(() => readShardPlan(f.plan, f.paths, 4, { ...source, sha: 'b'.repeat(40) })).toThrow('source/run');
  expect(() => createShardPlan([], f.weights, f.options)).toThrow('Empty');
  expect(() => createShardPlan(f.paths, f.weights, { ...f.options, workers: 0 })).toThrow('count');
});

test('recent successful complete-module observations include import/setup and override older body-only results', () => {
  const root = mkdtempSync(resolve('tmp/vitest-plan-'));
  try {
    mkdirSync(resolve(root, 'test'));
    writeFileSync(resolve(root, 'test/durations.json'), JSON.stringify({ 'test/a.test.ts': 3, 'test/b.test.ts': 4 }));
    const results = [{ testResults: [
      { name: resolve(root, 'test/a.test.ts'), status: 'passed', startTime: 1000, endTime: 2000 },
      { name: resolve(root, 'test/b.test.ts'), status: 'failed', startTime: 1000, endTime: 1001 },
    ] }];
    const timings = [{ files: [{ file: 'test/a.test.ts', state: 'passed', measuredAt: 3000,
      durationMs: 2000, collectMs: 1000, setupMs: 500, prepareMs: 0, environmentMs: 0 }] }];
    const result = measuredWeights(root, ['test/a.test.ts', 'test/b.test.ts', 'test/new.test.ts'], results, timings);
    expect(result.weights.get('test/a.test.ts')).toBe(3.5);
    expect(result.weights.get('test/b.test.ts')).toBe(5.5);
    expect(result.weights.get('test/new.test.ts')).toBe(5.5);
    expect(result.measuredFiles).toBe(1);
    expect(() => measuredWeights(root, [], [], [{ files: [{ ...timings[0]?.files[0], collectMs: -1 }] }])).toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('full-snapshot weights survive missing or older history and accept newer successful measurements', () => {
  const root = mkdtempSync(resolve('tmp/vitest-plan-'));
  try {
    mkdirSync(resolve(root, 'test'));
    const file = resolve(root, 'test/ci-module-durations.json');
    const saved = { version: 1, ...source, measuredAt: 3000, files: { 'test/a.test.ts': 12, 'test/b.test.ts': 8 } };
    writeFileSync(file, JSON.stringify(saved));
    const paths = ['test/a.test.ts', 'test/b.test.ts', 'test/new.test.ts'];
    const old = { file: paths[0], state: 'passed', measuredAt: 2000,
      durationMs: 1000, collectMs: 100, setupMs: 200, prepareMs: 0, environmentMs: 0 };
    const result = measuredWeights(root, paths, [], [{ files: [old] }]);
    expect([...result.weights]).toEqual([[paths[0], 12], [paths[1], 8], [paths[2], 12]]);
    expect(result.measuredFiles).toBe(2);
    expect(measuredWeights(root, paths, [], []).weights).toEqual(result.weights);
    const latest = measuredWeights(root, paths, [], [{ files: [{ ...old, measuredAt: 4000 }] }]);
    expect(latest.weights.get('test/a.test.ts')).toBe(1.3);
    expect(measuredWeights(root, paths, [], [{ files: [{ ...old, state: 'failed', measuredAt: 5000 }] }]).weights).toEqual(result.weights);
    writeFileSync(file, JSON.stringify({ ...saved, files: { 'test/a.test.ts': -1 } }));
    expect(() => measuredWeights(root, paths, [], [])).toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const historyRun = (id: number) => ({ databaseId: id, headSha: id.toString(16).padStart(40, '0'), event: 'push', headBranch: 'main', status: 'completed' });
const historyArtifact = (run: ReturnType<typeof historyRun>) => ({ name: 'vitest-times-1', expired: false,
  workflow_run: { id: run.databaseId, head_sha: run.headSha, head_branch: run.headBranch } });

test('a newer completed push without timings preserves an older measured wave', () => {
  const cancelled = historyRun(4), prepareFailed = historyRun(3), measured = historyRun(2), older = historyRun(1);
  expect(selectTimingHistory([cancelled, prepareFailed, measured, older], [historyArtifact(older), historyArtifact(measured)])).toBe('2');
  expect(selectTimingHistory([measured, older], [historyArtifact(older), historyArtifact(measured)])).toBe('2');
});

test('history ignores expired, foreign and unfinished reports without changing no-history fallback', () => {
  const foreign = { ...historyRun(5), event: 'pull_request' }, unfinished = { ...historyRun(4), status: 'in_progress' };
  const expired = historyRun(3), mismatch = historyRun(2), main = historyRun(1);
  const artifacts = [historyArtifact(foreign), historyArtifact(unfinished), { ...historyArtifact(expired), expired: true },
    { ...historyArtifact(mismatch), workflow_run: { ...historyArtifact(mismatch).workflow_run, head_sha: 'f'.repeat(40) } },
    { ...historyArtifact(main), name: 'unrelated-output' }];
  expect(selectTimingHistory([foreign, unfinished, expired, mismatch, main], artifacts)).toBeUndefined();
  expect(selectTimingHistory([main], [])).toBeUndefined();
  expect(selectTimingHistory([], [historyArtifact(main)])).toBeUndefined();
  expect(selectTimingHistory([{ ...main, headBranch: 'other' }], [historyArtifact(main)])).toBeUndefined();
  expect(selectTimingHistory([main], [{ ...historyArtifact(main), workflow_run: { ...historyArtifact(main).workflow_run, head_branch: 'other' } }])).toBeUndefined();
});

test('malformed, duplicate or unbounded history listings refuse', () => {
  const run = historyRun(1);
  expect(() => selectTimingHistory([run, run], [])).toThrow('Duplicate');
  expect(() => selectTimingHistory([null], [])).toThrow();
  expect(() => selectTimingHistory([run], [{ ...historyArtifact(run), workflow_run: null }])).toThrow();
  expect(() => selectTimingHistory(Array.from({ length: 21 }, (_, index) => historyRun(index + 1)), [])).toThrow();
  expect(() => selectTimingHistory([run], Array.from({ length: 101 }, () => historyArtifact(run)))).toThrow();
});


test('twelve larger jobs preserve the complete old24 inventory and refuse an old plan', () => {
  // G989 trades per-job modeled time for fewer runner admissions. This is
  // synthetic work, not a passing CI wall-clock or balance measurement.
  const paths = Array.from({ length: 2284 }, (_, index) => `test/work-${index}.test.ts`);
  const weights = new Map(paths.map((path, index) => [path, index < 12 ? 100 : 4]));
  const options = { ...source, workers: 2, fallbackSeconds: 4, measuredFiles: paths.length };
  const previous = createShardPlan(paths, weights, { ...options, count: 24 });
  const current = createShardPlan(paths, weights, { ...options, count: CI_SHARD_COUNT });
  expect(current.expectedSeconds).toBeGreaterThan(previous.expectedSeconds);
  expect(() => readShardPlan(previous, paths, CI_SHARD_COUNT, source)).toThrow('count');
  expect(current.shards.flatMap(shard => shard.files).sort()).toEqual([...paths].sort());
  expect(new Set(current.shards.flatMap(shard => shard.files)).size).toBe(paths.length);
});
