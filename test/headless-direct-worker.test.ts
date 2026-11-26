// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the real isolated Node worker and its complete native continuation.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Each child owns only one bounded checkout scratch directory.
import { mkdtempSync, rmSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The child's deadline follows the machine's load.
import { availableParallelism, loadavg } from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the fixed proof scripts and source loader in this checkout.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The child uses this exact Node runtime and environment.
import process from 'node:process';
// oxlint-disable-next-line import/no-nodejs-modules -- Node's source loader is a fixed local import hook.
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';

// QA-FEEDBACK 2026-11-22 row 12: a case takes 3 to 10 s of CPU, and at load 25 to 48 the fixed 20 s kill failed land
// gates (opus-pine2 03:38, opus-compat-w4 03:56 UTC) that pass alone. The deadline is 20 s on an idle machine, stretched
// by how oversubscribed the cores are at the start (capped at 3 minutes), and the test's own timeout sits above it.
const DEADLINE_MS = Math.min(180_000, Math.round(20_000 * Math.max(1, (loadavg()[0] ?? 0) / availableParallelism())));

test.each([
  ['trusted-run', '"nativeActors":1'],
  ['deferred-run', '"checkpoints":2'],
  ['resident-run', '"gridRegion":true'],
])('direct native %s retains its complete gameplay assertions', (name, marker) => {
  const root = mkdtempSync(resolve('tmp', 'direct-native-worker-'));
  try {
    const child = spawnSync(process.execPath, ['--import',
      pathToFileURL(resolve('src/scripts/sim-node-loader.mjs')).href, resolve('test/fixtures/headless', `${name}.mjs`)],
    { encoding: 'utf8', timeout: DEADLINE_MS, env: { ...process.env, TMPDIR: root, NODE_COMPILE_CACHE: resolve(root, 'compile') } });
    expect(child.status, child.stdout + child.stderr).toBe(0);
    expect(child.stdout).toContain(marker);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, DEADLINE_MS + 15_000);
