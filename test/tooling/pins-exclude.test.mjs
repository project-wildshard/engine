// J240 / DEV-SPEED DS6: `pins.ts install` in a plan worktree must not rewrite the canonical checkout's exclude block
// (codex-port, 2026-11-10: a `--from-format` install in a worktree broke the parent's pins). Real Git, one linked
// worktree; each checkout owns its own block in the shared exclude file.
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {afterEach, describe, expect, test} from 'vitest';
import {excludePublished, excludeText} from '../../scripts/pins-exclude.mjs';

/** @type {string[]} */
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}); });
const ENV = {...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null'};
/** @param {string} cwd @param {string[]} args */
const git = (cwd, args) => {
  const result = spawnSync('git', args, {cwd, env: ENV, encoding: 'utf8'});
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
};
/** @param {string} root @param {string} path */
const publish = (root, path) => { mkdirSync(dirname(join(root, path)), {recursive: true}); writeFileSync(join(root, path), 'mount\n'); };

describe('the shared exclude file holds one block per checkout', () => {
  test('pins in a worktree leave the parent block, and the parent its pins, intact; a removed worktree is pruned', () => {
    const root = mkdtempSync(join(tmpdir(), 'pins-exclude-'));
    roots.push(root);
    git(root, ['init', '-q', '-b', 'main']);
    writeFileSync(join(root, 'tracked.txt'), 'x\n');
    git(root, ['add', 'tracked.txt']);
    git(root, ['-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'seed']);
    git(root, ['worktree', 'add', '-q', '-b', 'plan/p', '.worktrees/p', 'main']);
    const tree = join(root, '.worktrees/p'), exclude = join(root, '.git/info/exclude');
    writeFileSync(exclude, '# a hand-written line\n*.local\n/.worktrees/\n');

    const parent = ['public/assets/a.bin', 'public/assets/b.bin'];
    for (const path of parent) publish(root, path);
    excludePublished(parent, root);
    expect(git(root, ['status', '--porcelain'])).toBe('');

    // The worktree's install publishes a smaller set (a --from-format install of one slug).
    publish(tree, 'public/assets/b.bin');
    excludePublished(['public/assets/b.bin'], tree);
    expect(git(tree, ['status', '--porcelain'])).toBe('');
    expect(git(root, ['status', '--porcelain'])).toBe('');
    const shared = readFileSync(exclude, 'utf8');
    expect(shared).toContain('# a hand-written line\n*.local\n');
    expect(shared).toContain('# pins: mounts published under public/, begin\n/public/assets/a.bin\n/public/assets/b.bin\n# pins: mounts published under public/, end\n');
    expect(shared).toContain('# pins: mounts published under public/, begin (worktree .worktrees/p)\n/public/assets/b.bin\n# pins: mounts published under public/, end (worktree .worktrees/p)\n');

    // The parent reinstalls: its own block changes, the worktree's stays.
    excludePublished(['public/assets/a.bin'], root);
    rmSync(join(root, 'public/assets/b.bin'));
    expect(git(root, ['status', '--porcelain'])).toBe('');
    expect(readFileSync(exclude, 'utf8')).toContain('(worktree .worktrees/p)\n/public/assets/b.bin\n');

    // Once the worktree is gone, the next write drops its block.
    git(root, ['worktree', 'remove', '--force', '.worktrees/p']);
    excludePublished(['public/assets/a.bin'], root);
    expect(readFileSync(exclude, 'utf8')).not.toContain('(worktree');
    expect(readFileSync(exclude, 'utf8')).toContain('*.local\n');
  });

  test('replaces only its own block, closes another checkout\'s unterminated block and keeps unrelated lines', () => {
    const legacy = 'keep\n# pins: mounts published under public/, begin\n/public/old\n# pins: mounts published under public/, end\ntail\n';
    expect(excludeText(legacy, '', ['public/new'])).toBe('keep\ntail\n# pins: mounts published under public/, begin\n/public/new\n# pins: mounts published under public/, end\n');
    const both = excludeText(excludeText(legacy, '.worktrees/w', ['public/w']), '', ['public/n']);
    expect(both).toBe('keep\ntail\n# pins: mounts published under public/, begin (worktree .worktrees/w)\n/public/w\n# pins: mounts published under public/, end (worktree .worktrees/w)\n# pins: mounts published under public/, begin\n/public/n\n# pins: mounts published under public/, end\n');
    const open = 'a\n# pins: mounts published under public/, begin (worktree .worktrees/x)\n/public/x\n';
    expect(excludeText(open, '', ['public/n'])).toBe('a\n# pins: mounts published under public/, begin (worktree .worktrees/x)\n/public/x\n# pins: mounts published under public/, end (worktree .worktrees/x)\n# pins: mounts published under public/, begin\n/public/n\n# pins: mounts published under public/, end\n');
    expect(excludeText(open, '', ['public/n'], () => false)).toBe('a\n# pins: mounts published under public/, begin\n/public/n\n# pins: mounts published under public/, end\n');
    expect(excludeText('', '', [])).toBe('# pins: mounts published under public/, begin\n# pins: mounts published under public/, end\n');
  });
});
