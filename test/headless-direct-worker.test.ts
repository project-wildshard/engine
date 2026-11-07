// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the real isolated Node worker and its complete native continuation.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Each child owns only one bounded checkout scratch directory.
import { mkdtempSync, rmSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the fixed proof scripts and source loader in this checkout.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The child uses this exact Node runtime and environment.
import process from 'node:process';
// oxlint-disable-next-line import/no-nodejs-modules -- Node's source loader is a fixed local import hook.
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';

test.each([
  ['trusted-run', '"nativeActors":1'],
  ['deferred-run', '"checkpoints":2'],
  ['resident-run', '"gridRegion":true'],
])('direct native %s retains its complete gameplay assertions', (name, marker) => {
  const root = mkdtempSync(resolve('tmp', 'direct-native-worker-'));
  try {
    const child = spawnSync(process.execPath, ['--experimental-transform-types', '--import',
      pathToFileURL(resolve('scripts/sim-node-loader.mjs')).href, resolve('test/fixtures/headless', `${name}.mjs`)],
    { encoding: 'utf8', timeout: 20_000, env: { ...process.env, TMPDIR: root, NODE_COMPILE_CACHE: resolve(root, 'compile') } });
    expect(child.status, child.stdout + child.stderr).toBe(0);
    expect(child.stdout).toContain(marker);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
