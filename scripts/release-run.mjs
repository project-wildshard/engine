import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

/** Scratch lives only for one run. The lease is visible to worktree reap even if the caller's working directory is elsewhere.
 * @param {string} root @param {string} label */
export function openReleaseRun(root, label) {
  const lane = process.env.WS_LANE_NAME ?? 'release';
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(lane)) throw new Error('Use a simple WS_LANE_NAME for release scratch');
  const parent = join(root, 'tmp', lane);
  mkdirSync(parent, { recursive: true });
  const work = mkdtempSync(join(parent, `${label}-`));
  const lease = openSync(join(work, '.running'), 'wx', 0o600);
  const proof = join(homedir(), '.cache', 'wildshard', 'plan-artifacts', 'release-qa', lane, basename(work));
  return { work, proof, close: () => {
    try { closeSync(lease); }
    finally { rmSync(work, { recursive: true, force: true }); }
  } };
}

/** Persist only the named verdicts the next release operation reads.
 * @param {string} work @param {string} proof @param {readonly string[]} files */
export function keepReleaseProof(work, proof, files) {
  for (const file of files) {
    const source = join(work, file);
    if (!existsSync(source)) continue;
    const destination = join(proof, file);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    copyFileSync(source, destination);
  }
}
