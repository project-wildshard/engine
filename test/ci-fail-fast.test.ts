import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise owned CI process groups without GitHub or builds.
import { spawnSync } from 'node:child_process';

// oxlint-disable-next-line import/no-nodejs-modules -- The owned fixture proves sibling cancellation without app work.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Paths refer only to the owned temporary test directory.
import { resolve } from 'node:path';
import { runChecks } from '../scripts/ci-checks.mjs';


test('CI commands retain independent verdicts and clean up owned interruptions', () => {
  const result = spawnSync('python3', ['test/test_ci_fail_fast.py'], { encoding: 'utf8', timeout: 10000 });
  expect(result.status, result.stderr).toBe(0);
});

test('a first parallel check failure cancels its owned sibling before a later side effect', async () => {
  const directory = mkdtempSync('tmp/ci-peer-');
  const marker = resolve(directory, 'late');
  try {
    const results = await runChecks(['exit 7', `sleep 4; touch '${marker}'`]);
    expect(results[0]?.code).toBe(7);
    expect(results[1]?.code).not.toBe(0);
    expect(existsSync(marker)).toBe(false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
