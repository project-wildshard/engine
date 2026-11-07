import { execFileSync, spawn } from 'node:child_process';

/** @typedef {{name: string, command: string[], cwd?: string}} CommitJob */
/** @typedef {{name: string, code: number, timedOut: boolean, output: string, cancelled?: boolean}} CommitResult */

/** Every child shares one wall deadline, including its complete process group.
 * @param {string} root @param {CommitJob[]} jobs @param {number} deadline
 * The observer runs once after a child closes (or fails to spawn), never on
 * partial output. Callers can drain advisory work after a completed fatal check.
 * @param {Record<string, string | undefined>} [env] @param {AbortSignal} [signal]
 * @param {(result: CommitResult) => void} [onResult] @returns {Promise<CommitResult[]>} */
export function runCommitJobs(root, jobs, deadline, env, signal, onResult) {
  const environment = env ?? process.env;
  return Promise.all(jobs.map(job => new Promise(resolve => {
    if (signal?.aborted) { resolve({ name: job.name, code: 130, timedOut: false, cancelled: true, output: '' }); return; }
    const executable = job.command.at(0);
    if (executable === undefined) { resolve({ name: job.name, code: 1, timedOut: false, output: 'Empty commit command' }); return; }
    const child = spawn(executable, job.command.slice(1), { cwd: job.cwd ?? root, env: environment, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', timedOut = false, cancelled = false;
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    /** @param {string} value */
    const append = value => { output += value; };
    child.stdout.on('data', append); child.stderr.on('data', append);
    const stop = (descendants = false) => {
      if (child.pid !== undefined) {
        // Nested hook fixtures can own detached grandchildren. Enumerate only
        // this live child's ancestry before killing anything, so those jobs
        // cannot survive cancellation by escaping its original process group.
        if (descendants) try {
          const rows = execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8', timeout: 1000 }).trim().split('\n')
            .map(row => row.trim().split(/\s+/u).map(Number));
          const owned = [child.pid], seen = new Set(owned);
          for (let index = 0; index < owned.length; index++) for (const [pid, parent] of rows) {
            if (pid === undefined || !Number.isSafeInteger(pid) || pid <= 1 || parent !== owned[index] || seen.has(pid)) continue;
            owned.push(pid); seen.add(pid);
          }
          for (const pid of owned.slice(1).reverse()) {
            try { process.kill(pid, 'SIGKILL'); }
            catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) output += String(error); }
          }
        } catch (error) { output += `Owned descendant cleanup: ${String(error)}\n`; }
        try { process.kill(-child.pid, 'SIGKILL'); }
        catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) output += String(error); }
      }
    };
    const cancel = () => { cancelled = true; stop(true); };
    signal?.addEventListener('abort', cancel, { once: true });
    // Product leases may create detached children just like nested hook fixtures.
    const timer = setTimeout(() => { timedOut = true; stop(true); }, Math.max(0, deadline - performance.now()));
    const clean = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
    let finished = false;
    const finish = (/** @type {CommitResult} */ result) => {
      if (finished) return;
      finished = true;
      clean(); resolve(result); onResult?.(result);
    };
    child.once('error', error => { finish({ name: job.name, code: 1, timedOut, output: output + error.message }); });
    child.once('close', code => {
      finish({ name: job.name, code: cancelled ? 130 : timedOut ? 124 : code ?? 1, timedOut, output, ...(cancelled ? { cancelled } : {}) });
    });
  })));
}

/** Cheap fixture inventories have explicit inputs.
 * @param {readonly string[]} changed @returns {string[]} */
export function commitGuards(changed) {
  const touches = (/** @type {RegExp} */ pattern) => changed.some(file => pattern.test(file));
  return [
    ...(touches(/^src\/(?:format|sdk|sharddev)\//u) ? ['test/schema-reference.test.ts'] : []),
    ...(touches(/^(?:lint\/(?:host-callbacks\.mjs|wildshard-plugin\.js)|scripts\/gen-host-catalogue\.mjs|test\/host-callbacks\.test\.ts)$/u) ? ['test/host-callbacks.test.ts'] : []),
    ...(touches(/^(?:lint\/(?:shardfile-boundaries\.mjs|wildshard-plugin\.js)|test\/shardfile-boundaries\.test\.ts)$/u) ? ['test/shardfile-boundaries.test.ts'] : []),
    ...(touches(/^(?:src\/(?:engine|game|format|sdk|sharddev)\/|scripts\/(?:platform-chargebacks|inline-platform|host-approvals|g571-hosts|shard-components|shard-platform)[^/]*\.|docs\/HOST-BAR\.md$|test\/platform-chargebacks\.test\.ts$)/u) ? ['test/platform-chargebacks.test.ts'] : []),
    ...(touches(/^(?:src\/shards\/(?:nalati-grasslands|nine-dragon-stack)\/|src\/(?:client|cook|server|shared)\/game\/shard\/manifest\.ts$|scripts\/(?:authored-manifest|manifest-declaration)\.|test\/(?:manifest-declarations\.test\.ts|fixtures\/manifest-declarations\.json)$)/u) ? ['test/manifest-declarations.test.ts'] : []),
  ];
}

/** Time alone defers; diagnostics already observed stay red at the deadline.
 * @param {CommitResult} result */
export function commitCheckFailed(result) {
  if (result.code === 0) return false;
  if (!result.timedOut && result.code !== 124) return true;
  // oxlint-disable-next-line no-control-regex -- Strip terminal escapes before preserving observed failures at the deadline.
  const output = result.output.replaceAll(/\u001B\[[0-9;]*m/gu, '');
  return /(?:FAIL\s+|Tests\s+\d+ failed|Test Files\s+\d+ failed|error\[|\berror [\w-]+[(/]|BINARY-JSON |GENERATED-SOURCE |MISSING STAGED MODULE |CLOSED |SHRINK-ONLY |staged allowance rose|was \d+, now \d+|deleted path)/u.test(output);
}
