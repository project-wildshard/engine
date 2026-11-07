import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise read-only Python log parsers with private fixtures.
import { spawnSync } from 'node:child_process';

test('the shared-waits reading parses current sources without inventing missing observations', () => {
  const result = spawnSync('python3', ['scripts/test_agent_time.py'], { encoding: 'utf8', timeout: 10000 });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toMatch(/Ran [1-9]\d* tests/u);
});
