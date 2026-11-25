// oxlint-disable-next-line import/no-nodejs-modules -- The package's own engines field.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// Meta QA 11-25 rows 41 and 42 (J505): CI's setup-node reads `engines.node` (`node-version-file: package.json`) and takes the
// newest cached Node that satisfies it. With `>=24.18.0` alone, hosted runners picked 26.13.1 before engine could run on it,
// and main went red (run 45628242073). The range names the newest major proven here (26, row 42) and never an untried one.
test('engines.node is capped at the newest proven Node major', () => {
  const range = (JSON.parse(readFileSync('package.json', 'utf8')) as { engines: { node: string } }).engines.node;
  expect(range).toBe('>=24.18.0 <27');
});
