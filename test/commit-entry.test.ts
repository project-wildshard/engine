// oxlint-disable-next-line import/no-nodejs-modules -- Exercise Git and the public commit entry in a disposable repository.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own and remove only this fixture's temporary files.
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Use the test runner's managed temporary directory.
import { tmpdir } from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve fixture paths and the real entry script.
import { join } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the real entry independently of the fixture checkout.
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const entry = fileURLToPath(new URL('../scripts/commit.sh', import.meta.url));
const message = 'test(fixture): commit selected files\n\nAssisted-by: Codex:gpt-6.1-sol';

function fixture(run: (root: string, git: (...args: string[]) => string, commit: (...paths: string[]) => ReturnType<typeof invoke>) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'engine-commit-'));
  const git = (...args: string[]): string => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    return result.stdout.trim();
  };
  const commit = (...paths: string[]): ReturnType<typeof invoke> => invoke(root, paths);
  try {
    git('init', '-q', '--initial-branch=main');
    git('config', 'user.name', 'Fixture');
    git('config', 'user.email', 'fixture@example.com');
    git('config', 'core.hooksPath', join(root, '.git/hooks'));
    writeFileSync(join(root, 'selected'), 'old\n');
    writeFileSync(join(root, 'foreign'), 'old\n');
    git('add', '--', 'selected', 'foreign');
    git('commit', '-qm', 'fixture');
    writeFileSync(join(root, 'foreign'), 'foreign stage\n');
    git('add', '--', 'foreign');
    run(root, git, commit);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
function invoke(root: string, paths: string[]) {
  return spawnSync(entry, [message, '--', ...paths], { cwd: root, encoding: 'utf8', timeout: 5000 });
}

test('the named commit entry runs hooks on main and preserves foreign stages', () => {
  fixture((root, git, commit) => {
    const hook = join(root, '.git/hooks/pre-commit');
    writeFileSync(hook, '#!/bin/sh\ntest "$(git symbolic-ref --short HEAD)" = main || exit 1\ngit diff --cached --name-only > hook-paths\n');
    chmodSync(hook, 0o755);
    writeFileSync(join(root, 'selected'), 'new\n');
    writeFileSync(join(root, 'added'), 'new\n');
    const result = commit('selected', 'added');
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').split('\n')).toEqual(['added', 'selected']);
    expect(readFileSync(join(root, 'hook-paths'), 'utf8').trim().split('\n')).toEqual(['added', 'selected']);
    expect(git('diff', '--cached', '--name-only')).toBe('foreign');
  });
});

test('a refusing installed hook leaves HEAD and foreign stages intact', () => {
  fixture((root, git, commit) => {
    const hook = join(root, '.git/hooks/pre-commit'), before = git('rev-parse', 'HEAD');
    writeFileSync(hook, '#!/bin/sh\nexit 1\n');
    chmodSync(hook, 0o755);
    writeFileSync(join(root, 'selected'), 'refused\n');
    expect(commit('selected').status).not.toBe(0);
    expect(git('rev-parse', 'HEAD')).toBe(before);
    expect(git('diff', '--cached', '--name-only')).toBe('foreign');
    expect(readFileSync(join(root, 'selected'), 'utf8')).toBe('refused\n');
  });
});

test('a commit from a plan worktree uses its own index and leaves the canonical index untouched (J240, DS6)', () => {
  fixture((root, git) => {
    git('worktree', 'add', '-q', '-b', 'plan/p', '.worktrees/p', 'main');
    const tree = join(root, '.worktrees/p');
    const canonicalIndex = readFileSync(join(root, '.git/index')), canonicalHead = git('rev-parse', 'HEAD');
    writeFileSync(join(tree, 'selected'), 'from the worktree\n');
    const result = invoke(tree, ['selected']);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const inTree = (...args: string[]): string => {
      const run = spawnSync('git', args, { cwd: tree, encoding: 'utf8' });
      expect(run.status, run.stderr).toBe(0);
      return run.stdout.trim();
    };
    expect(inTree('show', 'plan/p:selected')).toBe('from the worktree');
    expect(inTree('status', '--porcelain', '--', 'selected')).toBe('');
    expect(readFileSync(join(root, '.git/index')).equals(canonicalIndex)).toBe(true);
    expect(git('rev-parse', 'HEAD')).toBe(canonicalHead);
    expect(git('diff', '--cached', '--name-only')).toBe('foreign');
  });
});
