// oxlint-disable-next-line import/no-nodejs-modules -- The package's own engines field.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// Meta QA 11-25 row 41 (J505): CI's setup-node reads `engines.node` (`node-version-file: package.json`) and takes the newest
// cached Node that satisfies it. With `>=24.18.0` alone, hosted runners picked 26.13.1, which refuses
// `--experimental-transform-types`, and main went red (run 45628242073). The range stays capped below 25 until the move to 26.
test('engines.node is capped below Node 25', () => {
  const range = (JSON.parse(readFileSync('package.json', 'utf8')) as { engines: { node: string } }).engines.node;
  expect(range).toMatch(/^>=24\.\d+\.\d+ <25$/u);
});
