// oxlint-disable-next-line import/no-nodejs-modules -- Run the repository's own model-source check as a process.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- The check runs under this test's Node.
import { execPath } from 'node:process';
import { expect, test } from 'vitest';

test('every Blender-built model keeps its source, and no script is an orphan', () => {
  const run = spawnSync(execPath, ['scripts/check-model-sources.mjs'], { encoding: 'utf8' });
  expect(run.stderr).toBe('');
  expect(run.status).toBe(0);
});
