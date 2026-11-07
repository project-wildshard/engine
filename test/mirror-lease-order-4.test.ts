import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise original real lease controls in isolated fixture roots.
import { spawnSync } from 'node:child_process';

test('mirror admission retains all real lease controls (partition 4/4)', () => {
  const result = spawnSync('python3', ['scripts/test_lease_order.py', '--partition', '4/4'], { encoding: 'utf8', timeout: 25000 });
  expect(result.status, result.stderr).toBe(0);
}, 30000);
