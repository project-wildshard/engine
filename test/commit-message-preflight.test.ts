// oxlint-disable-next-line import/no-nodejs-modules -- Real commits prove fast refusal and fatal executed hooks.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Locate the owned Git fixture and defining validator.
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

test('invalid messages refuse before hooks while valid reds and foreign stages remain protected', () => {
  const output = execFileSync('python3', ['test/fixtures/commit-message-preflight.py', resolve('.')], {
    encoding: 'utf8', timeout: 10_000,
  });
  expect(output).toContain('"indexPreserved": true');
  expect(output).toContain('"validHookRedRefuses": true');
  expect(output).toContain('"humanUnchanged": true');
});
