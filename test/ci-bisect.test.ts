// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the candidate replay planner against owned tiny Git history.
import { execFileSync } from 'node:child_process';
import { expect, test } from 'vitest';
import source from '../scripts/ci-bisect.py?raw';

test('after-red replay plans retain every exact commit and refuse incomplete attribution', () => {
  expect(execFileSync('python3', ['test/test_ci_bisect.py', '--candidate-stdin'], {
    input: source, encoding: 'utf8', timeout: 10_000, stdio: ['pipe', 'pipe', 'pipe'],
  })).toBe('');
});
