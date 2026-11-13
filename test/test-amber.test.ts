// J295 (Jake, 2026-11-12): a CI test file over its budget is AMBER, not red: the job stays green and says so, a hang
// at 2x is still red, and an amber left on main for 24 h or 12 runs in a row turns red.
// oxlint-disable-next-line import/no-nodejs-modules -- Real report and table files in an owned scratch directory.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Scratch paths.
import { join, resolve } from 'node:path';
import { afterAll, afterEach, expect, test, vi } from 'vitest';
import type { TestModule } from 'vitest/node';
import EngineBudget from '../scripts/engine-ci-budget.ts';
import { AMBER, amberLine, judgeFile, nextLedger, parseAmber } from '../scripts/test-amber.mjs';
import { collectTimings, readTimings, writeTimings } from '../scripts/test-timings.mjs';

mkdirSync(resolve('tmp'), { recursive: true });
const scratch = mkdtempSync(resolve('tmp/test-amber-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
afterEach(() => { Reflect.deleteProperty(process.env, 'WS_TIMINGS_DIR'); Reflect.deleteProperty(process.env, 'WS_CI_TIMINGS'); vi.restoreAllMocks(); });

const HOUR = 3_600_000, NOW = Date.parse('2026-11-12T20:00:00Z');

test('the thresholds live in one spot: 60 s budget, red at 2x, after 24 h or 12 main runs, cleared by 3 clean runs', () => {
  expect(AMBER).toEqual({ budgetMs: 60_000, redFactor: 2, redAfterHours: 24, redAfterRuns: 12, clearAfterRuns: 3 });
});

test('over budget is amber; at 2x it is red at once; within budget is ok', () => {
  expect(judgeFile('a', 60_000, 60_000, undefined, NOW).level).toBe('ok');
  // Run 43288951110's tests (3): 61443 ms, the failure J295 turns amber.
  expect(judgeFile('a', 61_443, 60_000, undefined, NOW)).toMatchObject({ level: 'amber', ms: 61_443, budget: 60_000, why: 'first amber' });
  expect(judgeFile('a', 119_999, 60_000, undefined, NOW).level).toBe('amber');
  expect(judgeFile('a', 120_000, 60_000, undefined, NOW)).toMatchObject({ level: 'red', why: 'at 2x its budget or more' });
});

test('an amber that stays on main turns red: after 12 runs in a row, or 24 h since its first', () => {
  const entry = (runs: number, hoursAgo: number) => ({ since: NOW - hoursAgo * HOUR, runs, ms: 61_000, run: '1' });
  expect(judgeFile('a', 61_000, 60_000, entry(11, 23), NOW).level).toBe('amber');
  expect(judgeFile('a', 61_000, 60_000, entry(12, 1), NOW)).toMatchObject({ level: 'red', why: 'amber on 12 main runs in a row' });
  expect(judgeFile('a', 61_000, 60_000, entry(2, 24), NOW).why).toMatch(/over 24 h$/u);
  // A file back within budget is ok whatever its streak; the next main run clears it from the ledger.
  expect(judgeFile('a', 59_000, 60_000, entry(40, 100), NOW).level).toBe('ok');
});

test('the ledger extends a streak, keeps an unmeasured file, drops one within budget 3 runs in a row or gone from the suite', () => {
  const inventory = new Set(['a', 'b', 'c', 'd']);
  const first = nextLedger(undefined, [{ file: 'a', durationMs: 61_000 }, { file: 'b', durationMs: 70_000 }, { file: 'b', durationMs: 71_000 }, { file: 'c', durationMs: 5 }], { run: '1', at: 100, inventory });
  expect(first).toEqual({ a: { since: 100, runs: 1, ms: 61_000, run: '1', clean: 0 }, b: { since: 100, runs: 1, ms: 71_000, run: '1', clean: 0 } });
  const second = nextLedger({ ...first, gone: { since: 1, runs: 3, ms: 1, run: '0' } }, [{ file: 'a', durationMs: 62_000 }, { file: 'd', durationMs: 1 }], { run: '2', at: 200, inventory });
  expect(second).toEqual({ a: { since: 100, runs: 2, ms: 62_000, run: '2', clean: 0 }, b: first['b'] });
  // A file hovering at 60 s keeps its streak and its clock: one clean run doesn't clear it, the next amber resumes it.
  const under = (ledger: typeof second, run: string) => nextLedger(ledger, [{ file: 'a', durationMs: 59_000 }], { run, at: 300, inventory });
  const once = under(second, '3');
  expect(once['a']).toEqual({ since: 100, runs: 2, ms: 62_000, run: '2', clean: 1 });
  expect(nextLedger(once, [{ file: 'a', durationMs: 61_000 }], { run: '4', at: 400, inventory })['a']).toEqual({ since: 100, runs: 3, ms: 61_000, run: '4', clean: 0 });
  expect(under(under(once, '4'), '5')).toEqual({ b: first['b'] });
  // Ring 1 runs part of the suite: it never drops a file it didn't plan.
  expect(nextLedger({ gone: { since: 1, runs: 1, ms: 1, run: '0' } }, [], { run: '4', at: 400, inventory: null })).toHaveProperty('gone');
});

test('the AMBER line is machine-readable and parses back, one per file', () => {
  const line = amberLine(judgeFile('test/x.test.ts', 61_443.4, 60_000, undefined, NOW), '43288951110');
  expect(line).toBe('AMBER file=test/x.test.ts ms=61443 budget=60000 run=43288951110 streak=0 why=first_amber');
  expect(parseAmber(`noise\n${line}\n${line}\nRED file=test/y.test.ts ms=1 budget=1`)).toEqual([{ file: 'test/x.test.ts', ms: 61_443, budget: 60_000 }]);
});

test('main\'s timings job carries the ledger forward in the table and names the run\'s AMBER lines', () => {
  const run = join(scratch, 'run');
  const write = (path: string, value: unknown): void => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, JSON.stringify(value)); };
  write(join(run, 'engine-ci-1/engine-ci/plan.json'), { ring: 'full', sha: 'b'.repeat(40), files: ['test/a.test.ts', 'test/b.test.ts'] });
  const line = 'AMBER file=test/a.test.ts ms=61000 budget=60000 run=9 streak=1 why=x';
  write(join(run, 'engine-ci-1/engine-ci/shard-1-ordinary.json'), { schema: 'engine-ci-budget/2', run: '9', endedAt: 5_000, budget: { limitMs: 60_000, amber: [line], red: [] },
    files: [{ file: 'test/a.test.ts', state: 'passed', durationMs: 61_000 }, { file: 'test/b.test.ts', state: 'passed', durationMs: 10 }] });
  const previous = { version: 1 as const, run: '8', sha: 'a'.repeat(40), measuredAt: 0, full: {}, ring1: {}, amber: { 'test/a.test.ts': { since: 1_000, runs: 1, ms: 61_500, run: '8' } } };
  const result = collectTimings(previous, run);
  expect(result?.amber).toEqual([line]);
  expect(result?.timings.amber).toEqual({ 'test/a.test.ts': { since: 1_000, runs: 2, ms: 61_000, run: '9', clean: 0 } });
  // A table from before J295 has no ledger and reads as nothing amber yet.
  process.env['WS_TIMINGS_DIR'] = join(scratch, 'old');
  writeTimings({ version: 1, run: '7', sha: 'c'.repeat(40), measuredAt: 1, full: {}, ring1: {} });
  expect(readTimings()?.amber).toEqual({});
  // A broken entry is dropped, never the whole ledger.
  write(join(scratch, 'old/timings.json'), { version: 1, run: '7', sha: 'c', measuredAt: 1, full: {}, ring1: {},
    amber: { 'test/a.test.ts': { since: 1, runs: 2, ms: 61_000, run: '6' }, 'test/b.test.ts': { since: 'x' } } });
  expect(readTimings()?.amber).toEqual({ 'test/a.test.ts': { since: 1, runs: 2, ms: 61_000, run: '6' } });
});

const fakeModule = (file: string, ms: number, notes: string[] = []): TestModule => ({
  moduleId: resolve(file), state: () => 'passed', errors: () => [],
  diagnostic: () => ({ duration: ms, collectDuration: 0, setupDuration: 0, prepareDuration: 0, environmentSetupDuration: 0 }),
  children: { allTests: function* () { yield { fullName: 't', result: () => ({ state: 'passed' }), options: { mode: 'run' }, annotations: () => notes.map(message => ({ message, type: 'warning' })) }; } },
}) as unknown as TestModule;

test('the real reporter: amber warns and exits green, 2x and an escalated amber exit red', () => {
  process.env['WS_TIMINGS_DIR'] = join(scratch, 'reporter');
  writeTimings({ version: 1, run: '7', sha: 'c'.repeat(40), measuredAt: 1, full: {}, ring1: {},
    amber: { 'test/old.test.ts': { since: Date.now() - 25 * HOUR, runs: 3, ms: 61_000, run: '6' } } });
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const report = (name: string, modules: TestModule[]) => {
    process.env['WS_CI_TIMINGS'] = join(scratch, `${name}.json`);
    const before = process.exitCode;
    new EngineBudget().onTestRunEnd(modules, [], 'passed');
    const exit = process.exitCode;process.exitCode = before;
    return { exit, json: JSON.parse(readFileSync(join(scratch, `${name}.json`), 'utf8')) as { budget: { amber: string[]; red: string[] } } };
  };
  const amber = report('amber', [fakeModule('test/new.test.ts', 61_443), fakeModule('test/fast.test.ts', 10)]);
  expect(amber.exit).not.toBe(1);
  expect(amber.json.budget.red).toEqual([]);
  expect(parseAmber(amber.json.budget.amber.join('\n'))).toEqual([{ file: 'test/new.test.ts', ms: 61_443, budget: 60_000 }]);
  expect(errors.mock.calls.flat().join('\n')).toMatch(/^::warning file=test\/new\.test\.ts,title=AMBER .*::AMBER file=test\/new\.test\.ts ms=61443 budget=60000/mu);
  expect(report('hang', [fakeModule('test/new.test.ts', 120_000)]).exit).toBe(1);
  const escalated = report('escalated', [fakeModule('test/old.test.ts', 61_000)]);
  expect(escalated.exit).toBe(1);
  expect(escalated.json.budget.red[0]).toMatch(/^RED file=test\/old\.test\.ts .*streak=3 why=amber_on_main_since/u);
  // AU6 (J303): the cook report's AMBER audio annotation becomes a ::warning main-watch reads, and the run stays green.
  errors.mockClear();
  const line = 'AMBER audio shard=pine-like tier=phone bytes=7250000 budget=6000000 red=10000000 level=amber';
  const other = line.replace('pine-like', 'nalati-like'), audio = report('audio', [fakeModule('test/audio-report.test.ts', 10, [line, 'an ordinary note', other])]);
  expect(audio.exit).not.toBe(1);
  // One warning for them all (GitHub keeps 10 a step), and the report keeps them for the timings job to repeat on a reused run.
  expect(errors.mock.calls.flat()).toEqual([`::warning title=AMBER shard audio over 6 MB (J303)::${line}%0A${other}`]);
  expect(audio.json.budget.amber).toEqual([line, other]);
});
