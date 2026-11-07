// oxlint-disable-next-line import/no-nodejs-modules -- Run the actual CLI against isolated owned tool processes.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the production entry used by every fixture branch.
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

test('release packs overlap setup, preserve PRs and drain failures', () => {
  expect(() => execFileSync('python3', ['test/fixtures/prepare-release-packs.py', resolve('scripts/prepare-release-packs.mjs')],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 })).not.toThrow();
});
