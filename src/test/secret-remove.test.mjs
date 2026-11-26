import { describe, expect, test } from 'vitest';
import { compareVersions, parseRemoteRefs, removeSecret, runnableRefs } from '../scripts/server-release/secret-remove.mjs';

// Meta QA 11-25 row 135: ADMIN_TOKEN left the `production` environment while release/v0.1.97, cut before main's
// workflow moved to PRODUCTION_FLIP_TOKEN, still read it in production-pointers. The refs below are that moment's
// shape on made-up commits (J507): production plays v0.1.96, v0.1.97 is mid-train, main has the new workflow.
const C = (/** @type {string} */ seed) => seed.repeat(40).slice(0, 40);
const LS_REMOTE = [
  `${C('a')}\trefs/heads/main`,
  `${C('b')}\trefs/heads/release/v0.1.96`,
  `${C('c')}\trefs/heads/release/v0.1.97`,
  `${C('d')}\trefs/tags/v0.1.96`,
  `${C('b')}\trefs/tags/v0.1.96^{}`,
  `${C('e')}\trefs/tags/v0.1.9`,
  `${C('f')}\trefs/tags/v0.1.9^{}`,
].join('\n');
const OLD = 'jobs:\n  production-pointers:\n    env:\n      ADMIN_TOKEN: ${{ secrets.ADMIN_TOKEN }}\n';
const NEW = 'jobs:\n  production-pointers:\n    env:\n      PRODUCTION_FLIP_TOKEN: ${{ secrets.PRODUCTION_FLIP_TOKEN }}\n';

/** A fake origin: each commit's server-release.yml, with a ci.yml naming the secret only in text. */
function origin(/** @type {Record<string, string>} */ workflow) {
  /** @type {string[][]} */
  const calls = [];
  const git = (/** @type {string[]} */ args) => {
    calls.push(args);
    const [command, target = ''] = args;
    if (command === 'ls-remote') return LS_REMOTE;
    if (command === 'fetch') return '';
    if (command === 'ls-tree') return 'ci.yml\nserver-release.yml\nREADME.md\n';
    const [commit = '', path = ''] = (args[1] ?? target).split(':');
    if (path.endsWith('ci.yml')) return '# ADMIN_TOKEN is read by no ci job\n';
    return workflow[commit] ?? NEW;
  };
  return { git, calls };
}

describe('secret-remove (meta QA 11-25 row 135)', () => {
  test("v0.1.97's shape: a train cut before the workflow change keeps the secret", async () => {
    const { git } = origin({ [C('b')]: OLD, [C('c')]: OLD });
    /** @type {string[][]} */
    const deleted = [];
    await expect(removeSecret('ADMIN_TOKEN', { env: 'production' }, { git, productionBuild: async () => C('b'), gh: args => { deleted.push(args); }, log: () => {} }))
      .rejects.toThrow(/ADMIN_TOKEN stays in environment production: release\/v0\.1\.97 server-release\.yml still read it/u);
    expect(deleted).toEqual([]);
  });

  test('once that train promotes, the secret goes, from the named environment only', async () => {
    const { git } = origin({ [C('b')]: OLD, [C('c')]: NEW });
    /** @type {string[][]} */
    const deleted = [];
    const ls = `${LS_REMOTE}\n${C('9')}\trefs/tags/v0.1.97\n${C('c')}\trefs/tags/v0.1.97^{}`;
    const promoted = (/** @type {string[]} */ args) => (args[0] === 'ls-remote' ? ls : git(args));
    expect(await removeSecret('ADMIN_TOKEN', { env: 'production' }, { git: promoted, productionBuild: async () => C('c'), gh: args => { deleted.push(args); }, log: () => {} })).toEqual([]);
    expect(deleted).toEqual([['secret', 'delete', 'ADMIN_TOKEN', '-R', 'project-wildshard/engine', '--env', 'production']]);
  });

  test("main's workflow reading the secret refuses too: the next train would cut with it", async () => {
    const { git } = origin({ [C('a')]: OLD, [C('c')]: NEW });
    await expect(removeSecret('ADMIN_TOKEN', { check: true }, { git, productionBuild: async () => C('b'), gh: () => { throw new Error('no delete'); }, log: () => {} }))
      .rejects.toThrow(/ADMIN_TOKEN stays in the repository: main server-release\.yml still read it/u);
  });

  test('--check names the runnable refs and deletes nothing', async () => {
    const { git } = origin({});
    /** @type {string[]} */
    const lines = [];
    await removeSecret('ADMIN_TOKEN', { env: 'production', check: true }, { git, productionBuild: async () => C('b'), gh: () => { throw new Error('no delete'); }, log: line => { lines.push(line); } });
    expect(lines).toEqual(['ADMIN_TOKEN: no runnable ref reads it (main, release/v0.1.97); free to remove from environment production']);
  });

  test('a production build no release ref names fails closed', async () => {
    const { git } = origin({});
    await expect(removeSecret('ADMIN_TOKEN', { check: true }, { git, productionBuild: async () => C('7'), log: () => {} }))
      .rejects.toThrow(/cannot tell which trains are in flight/u);
  });

  test('refs: tags peel to their commit, older and promoted versions drop out, other refs are ignored', async () => {
    const refs = parseRemoteRefs(`${LS_REMOTE}\n${C('1')}\trefs/heads/plan/x\n${C('2')}\trefs/tags/server-staging-${C('2')}`);
    expect(refs.find(one => one.ref === 'refs/tags/v0.1.96')).toEqual({ ref: 'refs/tags/v0.1.96', version: 'v0.1.96', commit: C('b') });
    expect(runnableRefs(refs, C('b')).map(one => one.ref)).toEqual(['refs/heads/main', 'refs/heads/release/v0.1.97']);
    expect(compareVersions('v0.1.10', 'v0.1.9')).toBe(1);
    await expect(removeSecret('admin token', {}, {})).rejects.toThrow(/not a secret name/u);
  });
});
