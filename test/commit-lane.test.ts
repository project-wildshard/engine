// oxlint-disable-next-line import/no-nodejs-modules -- Run the candidate lane recorder in its native Python interpreter.
import { execFileSync } from 'node:child_process';
import { expect, test } from 'vitest';
import source from '../scripts/commit_lane.py?raw';

test('committed lane attribution survives missing runtime metadata', () => {
  expect(execFileSync('python3', ['test/test_commit_lane.py', '--candidate-stdin'], {
    input: source, encoding: 'utf8', timeout: 10_000, stdio: ['pipe', 'pipe', 'pipe'],
  })).toBe('');
});
