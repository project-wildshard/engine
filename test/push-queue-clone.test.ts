// oxlint-disable-next-line import/no-nodejs-modules -- Build a real remote and snapshot with the git CLI.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Test repositories stay in the repository scratch root.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve fixture paths and the file:// remote.
import { join, resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- A file:// URL avoids git's local-path shortcut, like the real ssh remote.
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { cloneQueueOrigin } from '../scripts/push-queue-clone.mjs';

// Ambient signing, hooks or maintenance settings must not decide the fixture.
const isolated: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (cwd: string, args: readonly string[]): string => execFileSync('git', ['-c', 'user.name=Queue clone', '-c', 'user.email=queue@example.test', ...args], { cwd, env: isolated, encoding: 'utf8' }).trim();

test('a batch clones origin even when its reference snapshot holds a commit-graph with origin tip', () => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp', 'push-queue-clone-'));
  try {
    const remote = join(root, 'remote.git'), seed = join(root, 'seed'), snapshot = join(root, 'snapshot'), target = join(root, 'origin');
    git(root, ['init', '--quiet', '--bare', '--initial-branch=main', remote]);
    git(root, ['init', '--quiet', '--initial-branch=main', seed]);
    for (const value of ['1', '2', '3']) {
      writeFileSync(join(seed, 'file.txt'), value);
      git(seed, ['add', 'file.txt']);
      git(seed, ['commit', '--quiet', '-m', `commit ${value}`]);
    }
    git(seed, ['push', '--quiet', remote, 'main']);
    const tip = git(seed, ['rev-parse', 'HEAD']);
    // The queue snapshot: a clone of origin main plus its stamp commit, whose maintenance writes a split graph.
    git(root, ['clone', '--quiet', '--no-hardlinks', remote, snapshot]);
    writeFileSync(join(snapshot, 'stamp.txt'), 'stamp');
    git(snapshot, ['add', 'stamp.txt']);
    git(snapshot, ['commit', '--quiet', '-m', 'stamp']);
    git(snapshot, ['commit-graph', 'write', '--reachable', '--split']);
    expect(readdirSync(join(snapshot, '.git/objects/info/commit-graphs')).some(name => name.endsWith('.graph'))).toBe(true);

    cloneQueueOrigin(snapshot, pathToFileURL(remote).href, target, isolated);

    expect(git(target, ['rev-parse', 'HEAD'])).toBe(tip);
    expect(git(target, ['status', '--porcelain'])).toBe('');
    expect(readFileSync(join(target, 'file.txt'), 'utf8')).toBe('3');
    expect(existsSync(join(target, '.git/objects/info/alternates'))).toBe(false);
    rmSync(snapshot, { recursive: true, force: true });
    expect(git(target, ['cat-file', '-t', tip])).toBe('commit');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
