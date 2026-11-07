// Opt-in quiet output for Node entry points; imports keep their ordinary behaviour.
import { spawnSync } from 'node:child_process';

/** Re-execute this CLI once, logging its complete output, when --quiet or WS_QUIET=1 is set.
 * @param {string} label */
export function quietCli(label) {
  if (process.env.WS_QUIET_ACTIVE === '1' || (process.env.WS_QUIET !== '1' && !process.argv.includes('--quiet'))) return;
  const result = spawnSync('python3', [`${import.meta.dirname}/quiet_logs.py`, '--label', label, '--',
    process.execPath, ...process.execArgv, ...process.argv.slice(1).filter(arg => arg !== '--quiet')], { stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  // oxlint-disable-next-line unicorn/no-process-exit -- This CLI delegates execution and must preserve its child's status without continuing generation.
  process.exit(result.status ?? (result.signal === 'SIGINT' ? 130 : result.signal === 'SIGTERM' ? 143 : 1));
}
