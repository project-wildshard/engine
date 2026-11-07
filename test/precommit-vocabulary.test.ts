// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the real isolated Git candidate builder.
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the exact checker under test.
import {resolve} from 'node:path';
import {expect, test} from 'vitest';

test('staged ownership vocabulary supersedes an older verified test cache', () => {
  expect(execFileSync('python3', ['test/fixtures/precommit-vocabulary.py', resolve('scripts/precommit-source.py')],
    {encoding: 'utf8', timeout: 15_000})).toContain('stale cache / staged ownership / HEAD ownership / loose refusal passed');
});
