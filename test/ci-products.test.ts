// oxlint-disable-next-line import/no-nodejs-modules -- Exercise isolated transfer fixtures without products or network.
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';

test('CI product transfers retain complete bytes, receipts and strict refusal', () => {
  const result = spawnSync('python3', ['test/test_ci_products.py'], { encoding: 'utf8', timeout: 25000 });
  expect(result.status, result.stderr).toBe(0);
});
