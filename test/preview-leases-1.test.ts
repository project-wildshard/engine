import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise original real lease controls in isolated fixture roots.
import { spawnSync } from 'node:child_process';

test('preview leases, sharing and release retain all behavior (partition 1/3)', () => {
  const result = spawnSync('python3', ['scripts/test_serve_ports.py', '--partition', '1/3'], { encoding: 'utf8', timeout: 45000 });
  expect(result.status, result.stderr).toBe(0);
}, 50000);
