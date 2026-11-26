// Child processes for the page hosts (meta OFF-VERCEL OV4): output is captured, then printed with every secret replaced.
import {spawnSync} from 'node:child_process';

/**
 * Run a child with its output captured, then print it with every secret replaced. Throws on a non-zero exit.
 * @param {string} file @param {string[]} args @param {{cwd: string, env: NodeJS.ProcessEnv, timeout?: number}} options @param {string[]} secrets
 * @returns {string} stdout, redacted
 */
export function runRedacted(file, args, options, secrets) {
  const hide = (/** @type {string} */ text) => secrets.reduce((out, secret) => secret === '' ? out : out.split(secret).join('<token>'), text);
  const result = spawnSync(file, args, {...options, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024});
  if (result.stderr !== '') process.stderr.write(hide(result.stderr));
  if (result.error !== undefined) throw new Error(`${file} ${args[0] ?? ''} could not start: ${hide(result.error.message)}`);
  if (result.status !== 0) {
    process.stdout.write(hide(result.stdout));
    throw new Error(`${file} ${args[0] ?? ''} exited ${String(result.status)}`);
  }
  return hide(result.stdout);
}
