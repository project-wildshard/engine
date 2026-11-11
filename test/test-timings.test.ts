// LAND-SIMPLIFY LS2 (J250, J258): measured test seconds are build output. Main's ci merges its shard reports into
// a table kept in the Actions cache; the planner and the local readers read that table, or fall back to defaults.
// oxlint-disable-next-line import/no-nodejs-modules -- Real report and table files in an owned scratch directory.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Scratch paths.
import { join, resolve } from 'node:path';
import { afterAll, afterEach, expect, test } from 'vitest';
import { collectTimings, readTimings, readWeights, timingsDir, writeTimings } from '../scripts/test-timings.mjs';
import { createEnginePlan } from '../scripts/engine-ci-plan.ts';
import { readDurations } from '../scripts/test-shard-plan.ts';

mkdirSync(resolve('tmp'), { recursive: true });
const scratch = mkdtempSync(resolve('tmp/test-timings-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
afterEach(() => { Reflect.deleteProperty(process.env, 'WS_TIMINGS_DIR'); });

const write = (path: string, value: unknown): void => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, JSON.stringify(value)); };
const report = (run: string, files: { file: string; state: string; durationMs: number }[]) =>
  ({ schema: 'engine-ci-budget/2', sha: 'b'.repeat(40), run, endedAt: 1_000, files });

test('a run\'s reports replace measured files, keep unmeasured ones and drop files outside its inventory', () => {
  const run = join(scratch, 'run-a');
  write(join(run, 'engine-ci-1/engine-ci/plan.json'), { ring: 'full', sha: 'b'.repeat(40), files: ['test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts'] });
  write(join(run, 'engine-ci-1/engine-ci/shard-1-ordinary.json'), report('42', [{ file: 'test/a.test.ts', state: 'passed', durationMs: 2500 }]));
  write(join(run, 'engine-ci-2/engine-ci/shard-2-native.json'), report('42', [
    { file: 'test/b.test.ts', state: 'failed', durationMs: 9000 }, { file: 'test/gone.test.ts', state: 'passed', durationMs: 1 }]));
  write(join(run, 'engine-ci-2/engine-ci/shard-2-wall.json'), { shard: '2', elapsedMs: 5 });
  const previous = { version: 1 as const, run: '41', sha: 'a'.repeat(40), measuredAt: 0,
    full: { 'test/a.test.ts': 1, 'test/b.test.ts': 4, 'test/deleted.test.ts': 3 }, ring1: { 'test/r.test.ts': 2 } };
  const result = collectTimings(previous, run);
  expect(result?.measured).toBe(1);
  expect(result?.timings).toMatchObject({ run: '42', sha: 'b'.repeat(40), measuredAt: 1_000,
    full: { 'test/a.test.ts': 2.5, 'test/b.test.ts': 4 }, ring1: { 'test/r.test.ts': 2 } });
  expect(Object.keys(result?.timings.full ?? {})).toEqual(['test/a.test.ts', 'test/b.test.ts']);
  expect(collectTimings(previous, join(scratch, 'no-such-run'))).toBeNull();
});

test('readers share one table, and with none they get defaults instead of a committed file', () => {
  process.env['WS_TIMINGS_DIR'] = join(scratch, 'empty');
  expect(timingsDir()).toBe(join(scratch, 'empty'));
  expect(readTimings()).toBeNull();
  expect(readWeights('full')).toEqual({});
  expect(readDurations()).toBeNull();
  process.env['WS_TIMINGS_DIR'] = join(scratch, 'table');
  writeTimings({ version: 1, run: '7', sha: 'c'.repeat(40), measuredAt: 1, full: { 'test/a.test.ts': 3 }, ring1: { 'test/a.test.ts': 1 } });
  expect(readWeights('full')).toEqual({ 'test/a.test.ts': 3 });
  expect(readWeights('1')).toEqual({ 'test/a.test.ts': 1 });
  expect(readDurations()).toEqual(new Map([['test/a.test.ts', 3]]));
  write(join(scratch, 'bad/timings.json'), { version: 1, run: '7', sha: 'c', full: { 'test/a.test.ts': -1 }, ring1: {} });
  process.env['WS_TIMINGS_DIR'] = join(scratch, 'bad');
  expect(readTimings()).toBeNull();
});

test('the planner uses the table when it has one, and on a miss plans every shard it may and says so', () => {
  const files = Array.from({ length: 40 }, (_, index) => `test/f${String(index).padStart(2, '0')}.test.ts`);
  process.env['WS_TIMINGS_DIR'] = join(scratch, 'miss');
  const missed = createEnginePlan('full', files);
  expect(missed.timings).toBe('default');
  expect(missed.count).toBe(missed.curve.length);
  expect(missed.unknown).toEqual(files);
  process.env['WS_TIMINGS_DIR'] = join(scratch, 'hit');
  writeTimings({ version: 1, run: '8', sha: 'd'.repeat(40), measuredAt: 1, full: Object.fromEntries(files.map(file => [file, 1])), ring1: {} });
  const planned = createEnginePlan('full', files);
  expect(planned.timings).toBe('measured');
  expect(planned.unknown).toEqual([]);
  expect(planned.count).toBeLessThan(missed.count);
});
