import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise CI metadata/cache with private fixtures and no network.
import { spawnSync } from 'node:child_process';

test('recent CI test paths retain exact source identity, expiry and observation budgets', () => {
  const result = spawnSync('python3', ['test/test_recent_ci_tests.py'], { encoding: 'utf8', timeout: 10000 });
  expect(result.status, result.stderr).toBe(0);
});
