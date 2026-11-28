// Meta QA70: the per-file progress a gate Vitest step writes, and the line that names its slow files.
// oxlint-disable-next-line import/no-nodejs-modules -- A real progress file.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import VitestProgress, { expectedSuiteSeconds, progressReport, progressSummary, SLOW_FILE_SECONDS } from '../src/scripts/vitest-progress.mjs';

const row = (file: string, at: number, event: string): string => `${JSON.stringify({ file, at, event })}\n`;

test('the summary pairs starts with ends, sorts the slowest first and keeps unfinished files running', () => {
  const text = row('a.test.ts', 0, 'start') + row('b.test.ts', 1000, 'start') + row('a.test.ts', 4000, 'end') + 'not json\n'
    + row('c.test.ts', 2000, 'start') + row('b.test.ts', 3000, 'end');
  expect(progressSummary(text, 10_000)).toEqual({
    running: [{ file: 'c.test.ts', seconds: 8 }],
    slowest: [{ file: 'a.test.ts', seconds: 4 }, { file: 'b.test.ts', seconds: 2 }],
    finished: 2,
  });
});

test('the report names files over the slow line, and is empty with no progress file', () => {
  mkdirSync('tmp', { recursive: true });
  const work = mkdtempSync(resolve('tmp/vitest-progress-'));
  try {
    const path = join(work, 'progress.jsonl');
    expect(progressReport(path)).toBe('');
    expect(progressReport(undefined)).toBe('');
    writeFileSync(path, row('slow.test.ts', 0, 'start') + row('slow.test.ts', (SLOW_FILE_SECONDS + 5) * 1000, 'end'));
    expect(progressReport(path, 200_000)).toBe(`1 file(s) finished; slowest: slow.test.ts ${SLOW_FILE_SECONDS + 5} s; over ${SLOW_FILE_SECONDS} s: slow.test.ts`);
  } finally { rmSync(work, { recursive: true, force: true }); }
});

test('the reporter appends one line per file start and end, relative to the root', () => {
  mkdirSync('tmp', { recursive: true });
  const work = mkdtempSync(resolve('tmp/vitest-progress-'));
  const path = join(work, 'progress.jsonl');
  const previous = process.env['WS_VITEST_PROGRESS'];
  try {
    process.env['WS_VITEST_PROGRESS'] = path;
    const reporter = new VitestProgress();
    reporter.onInit({ config: { root: work } });
    reporter.onTestModuleStart({ moduleId: join(work, 'test/x.test.ts') });
    reporter.onTestModuleEnd({ moduleId: join(work, 'test/x.test.ts'), state: () => 'passed' });
    const { finished, running } = progressSummary(readFileSync(path, 'utf8'));
    expect({ finished, running }).toEqual({ finished: 1, running: [] });
  } finally {
    if (previous === undefined) delete process.env['WS_VITEST_PROGRESS']; else process.env['WS_VITEST_PROGRESS'] = previous;
    rmSync(work, { recursive: true, force: true });
  }
});

test('the expected wall is the table\'s seconds over the workers', () => {
  expect(expectedSuiteSeconds({ a: 30, b: 60 }, 3)).toBe(30);
  expect(expectedSuiteSeconds({}, 3)).toBeNull();
  expect(expectedSuiteSeconds(undefined, 3)).toBeNull();
  expect(expectedSuiteSeconds({ a: 1 }, 0)).toBeNull();
});
