import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Require an actual queued machine-lane ancestor, rather than trusting a copied environment flag.
 * @param {'full-test'|'build'} resource
 * @param {NodeJS.ProcessEnv} [env]
 */
export function assertHeavyLease(resource, env = process.env) {
  const root = env.WS_HEAVY_ROOT ?? join(homedir(), '.wildshard-heavy-lanes');
  /** @type {unknown} */
  let lease;
  // A build can own any of the three physical build slots.
  for (const slot of resource === 'build' ? ['build', 'build-2', 'build-3'] : [resource]) {
    try { lease = JSON.parse(readFileSync(join(root, `${slot}.active.json`), 'utf8')); } catch { continue; }
    if (lease !== null && typeof lease === 'object' && 'token' in lease && lease.token === env.WS_HEAVY_TOKEN) break;
  }
  const message = `Run this through python3 scripts/heavy-lane.py ${resource} -- <command>; focused Vitest file runs remain unrestricted.`;
  if (lease === null || typeof lease !== 'object' || !('token' in lease) || !env.WS_HEAVY_TOKEN || lease.token !== env.WS_HEAVY_TOKEN ||
    !('runnerPid' in lease) || !('childPid' in lease)) throw new Error(message);
  /** @type {Map<number,number>} */
  const parents = new Map(execFileSync('ps', ['-Ao', 'pid=,ppid='], { encoding: 'utf8' }).trim().split('\n').map(line => {
    const [pid, parent] = line.trim().split(/\s+/u).map(Number);
    return [pid, parent];
  }));
  const visited = new Set();
  for (let pid = process.pid; pid > 1 && !visited.has(pid);) {
    if (pid === lease.runnerPid || pid === lease.childPid) return;
    visited.add(pid); pid = parents.get(pid) ?? 0;
  }
  throw new Error(message);
}
