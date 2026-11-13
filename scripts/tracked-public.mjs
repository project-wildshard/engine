// The engine's tracked public/ files, which a pinned product's KTX2 table may name (pins.ts, S11). In a checkout git reads them
// from the work tree's index. A build-mirror slot (build-mirror.mjs) has no .git and stops git discovery at the slot on purpose,
// so `git ls-files` there failed and the set came back empty: every tracked engine KTX2 a product names looked missing, and a
// `serve-build.sh --head` build refused Driftwood (`lm-ao.phone-9f6766dc.ktx2`). The mirror names its own index, which holds
// exactly the commit it synced, and that is read instead.
import { execFileSync } from 'node:child_process';

/** @param {NodeJS.ProcessEnv} [env] @param {string} [cwd] @returns {ReadonlySet<string>} */
export function trackedPublic(env = process.env, cwd = process.cwd()) {
  const { WS_MIRROR_REPO: repo, WS_MIRROR_INDEX: index } = env;
  const mirror = repo !== undefined && repo !== '' && index !== undefined && index !== '';
  try {
    return new Set(execFileSync('git', ['ls-files', '-z', 'public'], { cwd: mirror ? repo : cwd, env: mirror ? { ...env, GIT_INDEX_FILE: index } : env, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean));
  } catch {
    return new Set();
  }
}
