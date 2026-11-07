// oxlint-disable-next-line import/no-nodejs-modules -- Native runtime proof never executes inside Vitest's fake DOM.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Use the same Node as the SDK worker.
import { execPath } from 'node:process';

const WORKER_WARNING = /^\(node:\d+\) ExperimentalWarning: Transform Types is an experimental feature and might change at any time\n\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)\n/gmu;
/** Preserve every error; suppress only Node's known transform-types warning (native Cocos/SDK classes use parameter properties). */
export function nalatiWitness(mode: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(execPath, ['--experimental-transform-types', '--import', './scripts/sim-node-loader.mjs', 'test/proof/nalati-grasslands/run.mjs', mode], { encoding: 'utf8', timeout: 60_000, maxBuffer: 2_000_000 });
  if (result.error !== undefined) throw result.error;
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.replace(WORKER_WARNING, '') };
}
