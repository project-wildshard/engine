// oxlint-disable-next-line import/no-nodejs-modules -- Each milestone is a fresh plain Node process, outside the test DOM setup.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Select the same Node executable as the test runner.
import { execPath } from 'node:process';

export function nativeProof(name: 'boot' | 'headless' | 'replay' | 'ledger'): string {
  return execFileSync(execPath, ['--experimental-transform-types', '--import', './scripts/sim-node-loader.mjs', 'test/proof/ink-cel-valley/run.mjs', name], { encoding: 'utf8', timeout: 60_000 });
}
