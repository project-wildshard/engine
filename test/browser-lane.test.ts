import { expect,test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise actual Bash admission against isolated process/device fixtures.
import { spawnSync } from 'node:child_process';

// Discover the existing native cases instead of putting their cumulative
// runtime behind one 15 s deadline. Each case keeps its own admission and
// subprocess bounds; no browser admission limit changes.
const discovery = spawnSync('python3', ['-c',
  'import json,runpy,unittest;case=runpy.run_path("scripts/test_browser_lane.py")["BrowserAdmissionTests"];print(json.dumps(unittest.defaultTestLoader.getTestCaseNames(case)))',
], { encoding: 'utf8', timeout: 5000 });
if (discovery.status !== 0) throw new Error(discovery.stderr);
const cases: string[] = JSON.parse(discovery.stdout);
if (cases.length === 0) throw new Error('Browser admission cases are missing');
// TEST-SPEED TS11: the broken-lock case's own subprocess may take 12 s on a loaded machine (its wait is the 300 s
// maximum, so waiting still fails it); every other case keeps the 8 s bound.
const budgets: Readonly<Record<string, number>> = { test_broken_portable_lock_fails_without_waiting_or_starting_a_child: 16_000 };
for (const name of cases) test(`browser admission: ${name}`, () => {
  const result = spawnSync('python3', ['scripts/test_browser_lane.py', `BrowserAdmissionTests.${name}`], { encoding: 'utf8', timeout: budgets[name] ?? 8000 });
  expect(result.status, result.stderr).toBe(0);
}, (budgets[name] ?? 8000) + 2000);
