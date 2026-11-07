// oxlint-disable-next-line import/no-nodejs-modules -- Keep compatibility probes outside Vitest's browser-like test setup.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Use the same Node executable as the template's native witness.
import { execPath } from 'node:process';

/** A blocked or partial witness must remain nonzero; no empty proxy can satisfy the compatibility gate. */
export function nativeCompatibility(slug: string, mode = 'all', timeoutMs = 110_000): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(execPath, ['--experimental-transform-types', '--import', './scripts/sim-node-loader.mjs', `test/proof/${slug}/run.mjs`, mode], { encoding: 'utf8', timeout: timeoutMs });
  if (result.error !== undefined) throw result.error;
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr };
}
