// RELEASE-BRANCHES RB3: only a tagged release merge with no code change reuses release CI.
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';

/** @param {string} refs @param {string} cwd @returns {string | null} the release tag, or null for the normal gate. */
export function releaseMerge(refs, cwd) {
  const rows = refs.split('\n').map(line => line.trim().split(/\s+/u)).filter(row => row[0] !== '');
  if (rows.length !== 1) return null;
  const [, sha = '', remote = '', previous = ''] = rows[0] ?? [];
  if (remote !== 'refs/heads/main' || !/^[a-f0-9]{40}$/u.test(sha) || /^0+$/u.test(sha)) return null;
  const git = (/** @type {string[]} */ args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    const parents = git(['show', '--no-patch', '--format=%P', sha]).split(' ');
    if (parents.length !== 2 || parents[0] !== previous) return null;
    const [first, release] = parents;
    const paths = git(['diff', '--name-only', first, sha]).split('\n');
    if (!paths.includes('package.json') || paths.some(path => path !== 'package.json' && path !== 'CHANGELOG.md')) return null;
    const before = JSON.parse(git(['show', `${first}:package.json`]));
    const after = JSON.parse(git(['show', `${sha}:package.json`]));
    if (before.version === after.version || !isDeepStrictEqual({ ...before, version: after.version }, after)) return null;
    const tag = `v${after.version}`;
    if (!/^v\d+\.\d+\.\d+$/u.test(tag) || !git(['tag', '--points-at', release]).split('\n').includes(tag)) return null;
    if (JSON.parse(git(['show', `${release}:package.json`])).version !== after.version) return null;
    return tag;
  } catch { return null; }
}
