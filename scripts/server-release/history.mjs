// J234: a staging release abandoned before merge-back still has a place in the source history.
// Only version/changelog-only prepared commits may use their main cut for forward ordering.
import { spawnSync } from 'node:child_process';

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const COMMIT = /^[a-f0-9]{40}$/u;

/** A newer published prepared release from the same or a later main cut, with no release-only code to lose.
 * @param {string} older @param {string} newer @param {string} [cwd] @returns {boolean} */
export function preparedReleaseFollows(older, newer, cwd = process.cwd()) {
  if (!COMMIT.test(older) || !COMMIT.test(newer)) return false;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  /** @param {string[]} args @returns {string | null} */
  const git = args => {
    const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : null;
  };
  /** @param {string} build @returns {{version: number[], cut: string} | null} */
  const prepared = build => {
    try {
      const pkg = JSON.parse(git(['show', `${build}:package.json`]) ?? 'null');
      if (typeof pkg?.version !== 'string' || !VERSION.test(pkg.version)) return null;
      const version = pkg.version;
      if (git(['rev-parse', '--verify', `refs/remotes/origin/release/v${version}^{commit}`]) !== build
        || git(['show', '-s', '--format=%s', build]) !== `chore(release): v${version}`) return null;
      const parents = (git(['show', '-s', '--format=%P', build]) ?? '').split(' ');
      const cut = parents[0];
      if (parents.length !== 1 || cut === undefined || !COMMIT.test(cut)
        || git(['merge-base', '--is-ancestor', cut, 'refs/remotes/origin/main']) === null) return null;
      const paths = (git(['diff', '--name-only', cut, build]) ?? '').split('\n');
      if (!paths.includes('package.json') || paths.some(path => !['package.json', 'CHANGELOG.md'].includes(path))) return null;
      // The manifest may change only its version. A code/dependency/config change on the release branch must be retained by real ancestry.
      const parent = JSON.parse(git(['show', `${cut}:package.json`]) ?? 'null');
      if (parent === null || JSON.stringify({ ...pkg, version: parent.version }) !== JSON.stringify(parent)) return null;
      const parts = version.split('.').map(Number);
      if (!parts.every(Number.isSafeInteger)) return null;
      return { version: parts, cut };
    } catch { return null; }
  };
  const prior = prepared(older), candidate = prepared(newer);
  if (prior === null || candidate === null) return false;
  const different = candidate.version.findIndex((part, index) => part !== prior.version[index]);
  return different !== -1 && candidate.version[different] > prior.version[different]
    && git(['merge-base', '--is-ancestor', prior.cut, candidate.cut]) !== null;
}
