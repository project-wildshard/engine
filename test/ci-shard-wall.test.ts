// EV3c (HOW-WE-BUILD, 2026-11-12): a shard's five-minute wall (J193) is charged only the set-up every job shares, and
// an overrun under 2x is AMBER (J295), as a test file's is. Runs 43315974456 and 43318910290 went red on tests (1):
// shards of 132-142 s were charged about 168 s of job 1's set-up, 100 s of it the history scan only job 1 runs.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { checkWalls, sharedSetupMs, wallVerdicts } from '../scripts/ci-pack.mjs';
import { AMBER, amberLine, judgeWall, parseAmber } from '../scripts/test-amber.mjs';

const LIMIT = 300_000;
const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

/** One job's report: a shard that ran `testMs` after `setupMs` of charged set-up, the job ending when it did. */
const report = (testMs: number, setupMs: number) => {
  const started = 1_000_000;
  return { ended: started + testMs, units: [{ name: 'shard:9', started, charged: started - setupMs, ended: started + testMs }] };
};

test('job 1 charges its shards only the set-up every job shares', () => {
  // Run 43318910290, tests (1): 140 s from the job clock to ci-pack, 99 s of it job 1's own checks, then 28 s of pins.
  const setup = sharedSetupMs({ jobStart: 1, packStart: 140_001, ownMs: 99_000, pinsMs: 28_000 });
  expect(setup).toBe(69_000);
  // Every other job has no own checks: all of its set-up is charged, as when each shard was a job of its own.
  expect(sharedSetupMs({ jobStart: 1, packStart: 41_001, ownMs: 0, pinsMs: 28_000 })).toBe(69_000);
  // A clock that can't be read charges nothing before ci-pack, and own time never makes the charge negative.
  expect(sharedSetupMs({ jobStart: Number.NaN, packStart: 140_000, ownMs: 0, pinsMs: 28_000 })).toBe(28_000);
  expect(sharedSetupMs({ jobStart: 0, packStart: 140_000, ownMs: 0, pinsMs: 28_000 })).toBe(28_000);
  expect(sharedSetupMs({ jobStart: 1, packStart: 40_001, ownMs: 99_000, pinsMs: 0 })).toBe(0);
  // The shard: 140 s of tests plus 168 s of job set-up is 308 s on the old clock; charged the shared 69 s it is 209 s.
  const [verdict] = wallVerdicts(report(140_000, setup), report(140_000, setup).ended);
  expect(verdict).toMatchObject({ file: 'shard-9-wall', level: 'ok', ms: 209_000 });
});

test('a shard wall over budget is AMBER under 2x and red at 2x (J295)', () => {
  expect(judgeWall('9', LIMIT, LIMIT).level).toBe('ok');
  expect(judgeWall('9', 1.2 * LIMIT, LIMIT)).toMatchObject({ file: 'shard-9-wall', level: 'amber', ms: 360_000, budget: LIMIT });
  expect(judgeWall('9', AMBER.redFactor * LIMIT - 1, LIMIT).level).toBe('amber');
  expect(judgeWall('9', AMBER.redFactor * LIMIT, LIMIT).level).toBe('red');
  // main-watch reads the AMBER line off the annotations, as it does a test file's.
  expect(parseAmber(amberLine(judgeWall('9', 1.2 * LIMIT, LIMIT), '1'))).toEqual([{ file: 'shard-9-wall', ms: 360_000, budget: LIMIT }]);
});

test('the wall check after the upload warns AMBER and stays green under 2x, and fails at 2x', () => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp', 'ci-shard-wall-')); roots.push(root);
  const cwd = process.cwd();
  const errors: string[] = [];
  vi.spyOn(console, 'error').mockImplementation((line: string) => { errors.push(line); });
  try {
    process.chdir(root); mkdirSync('tmp/ci-pack', { recursive: true });
    const write = (testMs: number) => { const row = report(testMs, 0); writeFileSync('tmp/ci-pack/job-1.json', JSON.stringify(row)); return row.ended; };
    expect(checkWalls(1, write(1.2 * LIMIT))).toBe(true);
    expect(errors.join('\n')).toMatch(/^::warning .*AMBER file=shard-9-wall ms=360000 budget=300000/mu);
    expect(errors.join('\n')).not.toMatch(/::error/u);
    errors.length = 0;
    expect(checkWalls(1, write(2 * LIMIT))).toBe(false);
    expect(errors.join('\n')).toMatch(/^::error .*CI_SHARD_BUDGET_EXCEEDED.*RED file=shard-9-wall ms=600000/mu);
  } finally { process.chdir(cwd); }
});
