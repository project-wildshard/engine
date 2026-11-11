// DEV-SPEED DS13: `worktree.mjs reap` against real git. A bare repo stands in for GitHub. Only a landed, clean, idle
// plan worktree goes, with its local branch and its origin branch; every other kind stays, named with its reason.
import {spawn, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {afterEach, describe, expect, test} from 'vitest';
import {parseReapArgs} from '../../scripts/worktree-reap.mjs';

const SCRIPT = resolve(import.meta.dirname, '../../scripts/worktree.mjs');
/** @type {string[]} */
const roots = [];
/** @type {import('node:child_process').ChildProcess[]} */
const children = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill();
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

const ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && !key.startsWith('HERDR') && !key.startsWith('VITEST'))),
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com',
};
/** @param {string} cwd @param {string[]} args */
const git = (cwd, args) => {
  const result = spawnSync('git', args, {cwd, env: ENV, encoding: 'utf8'});
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
};
/** @param {string} root @param {string} path @param {string} body */
const put = (root, path, body) => { mkdirSync(dirname(join(root, path)), {recursive: true}); writeFileSync(join(root, path), body); };

/** origin and a canonical clone, with one plan worktree per name, each on plan/<name> from main. @param {string[]} names */
function repos(names) {
  const base = mkdtempSync(join(tmpdir(), 'worktree-reap-'));
  roots.push(base);
  const origin = join(base, 'origin.git'), canonical = join(base, 'engine');
  git(base, ['init', '-q', '--bare', '-b', 'main', origin]);
  git(base, ['clone', '-q', origin, canonical]);
  put(canonical, '.gitignore', '/.worktrees/\n/out/\n');
  put(canonical, 'src/a.ts', 'export const a = 1;\n');
  git(canonical, ['add', '.']);
  git(canonical, ['commit', '-q', '-m', 'seed']);
  git(canonical, ['push', '-q', 'origin', 'main']);
  for (const name of names) git(canonical, ['worktree', 'add', '-q', '-b', `plan/${name}`, `.worktrees/${name}`, 'main']);
  const tree = (/** @type {string} */ name) => join(canonical, '.worktrees', name);
  /** A commit on the plan, pushed to its origin branch; `land` also fast-forwards origin main to it. */
  const work = (/** @type {string} */ name, /** @type {boolean} */ land) => {
    put(tree(name), `src/${name}.ts`, `export const ${name} = 1;\n`);
    git(tree(name), ['add', '.']);
    git(tree(name), ['commit', '-q', '-m', `feat: ${name}`]);
    git(tree(name), ['push', '-q', 'origin', `plan/${name}`]);
    if (land) { git(tree(name), ['pull', '-q', '--rebase', 'origin', 'main']); git(tree(name), ['push', '-q', 'origin', `HEAD:main`]); git(tree(name), ['push', '-q', '-f', 'origin', `plan/${name}`]); }
  };
  const receipts = join(base, 'receipts.log');
  const reap = (/** @type {string[]} */ args = ['--grace=0']) => spawnSync(process.execPath, [SCRIPT, 'reap', ...args], {cwd: canonical, env: {...ENV, WS_LANE_NAME: 'fixture-lane', WS_LANE_RECEIPTS: receipts}, encoding: 'utf8'});
  const branches = () => git(canonical, ['branch', '--list', 'plan/*', '--format=%(refname:short)']).split('\n').filter(Boolean);
  const remoteBranches = () => git(origin, ['branch', '--list', 'plan/*', '--format=%(refname:short)']).split('\n').filter(Boolean);
  return {origin, canonical, tree, work, reap, branches, remoteBranches, receipts};
}

describe('worktree reap', () => {
  test('parses its options and refuses anything else', () => {
    expect(parseReapArgs([])).toEqual({dryRun: false, graceHours: 24, remote: true});
    expect(parseReapArgs(['--dry-run', '--grace=0.5', '--no-remote'])).toEqual({dryRun: true, graceHours: 0.5, remote: false});
    for (const bad of [['--force'], ['--grace'], ['--grace=-1'], ['x']]) expect(() => parseReapArgs(bad)).toThrow();
  });

  test('reaps a landed, clean, idle worktree with its branch and origin branch; keeps unlanded, dirty, busy and landing ones', async () => {
    const f = repos(['landed', 'unlanded', 'dirty', 'busy', 'landing']);
    f.work('landed', true);
    f.work('unlanded', false);
    f.work('dirty', true);
    put(f.tree('dirty'), 'notes.txt', 'mine\n');
    f.work('busy', true);
    f.work('landing', true);
    writeFileSync(join(git(f.tree('landing'), ['rev-parse', '--absolute-git-dir']), 'wildshard-land.lock'), `${String(process.pid)}\n`);
    const busy = spawn('sleep', ['30'], {cwd: f.tree('busy'), stdio: 'ignore'});
    children.push(busy);
    await new Promise(done => setTimeout(done, 200));
    // Ignored build output never counts as dirt.
    put(f.tree('landed'), 'out/big.bin', 'x');

    const dry = f.reap(['--grace=0', '--dry-run']);
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toMatch(/would reap landed/u);
    expect(existsSync(f.tree('landed'))).toBe(true);

    const result = f.reap();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/reaped {3}landed: worktree removed, branch deleted/u);
    expect(result.stdout).toMatch(/landed: origin plan\/landed deleted/u);
    expect(result.stdout).toMatch(/kept {5}unlanded: 1 commit\(s\) not on main/u);
    expect(result.stdout).toMatch(/kept {5}dirty: 1 uncommitted path\(s\), first notes\.txt/u);
    expect(result.stdout).toMatch(new RegExp(`kept {5}busy: in use by pid [\\d, ]*${String(busy.pid)}`, 'u'));
    expect(result.stdout).toMatch(/kept {5}landing: land is running there/u);
    expect(existsSync(f.tree('landed'))).toBe(false);
    for (const name of ['unlanded', 'dirty', 'busy', 'landing']) expect(existsSync(f.tree(name)), name).toBe(true);
    expect(f.branches().sort()).toEqual(['plan/busy', 'plan/dirty', 'plan/landing', 'plan/unlanded']);
    expect(f.remoteBranches().sort()).toEqual(['plan/busy', 'plan/dirty', 'plan/landing', 'plan/unlanded']);
    expect(readFileSync(f.receipts, 'utf8')).toMatch(/^\d\d:\d\d UTC fixture-lane worktree reap engine: reaped landed; kept busy \(.*\), dirty \(.*\), landing \(.*\), unlanded \(.*\); origin landed deleted$/mu);
  }, 60_000);

  test('the grace keeps a worktree that landed moments ago', () => {
    const f = repos(['fresh']);
    f.work('fresh', true);
    const result = f.reap([]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/kept {5}fresh: active 0\.0 h ago, under the 24 h grace/u);
    expect(existsSync(f.tree('fresh'))).toBe(true);
  });

  test('an origin branch that gained unlanded commits elsewhere is left, though the local worktree goes', () => {
    const f = repos(['shared']);
    f.work('shared', true);
    // Another machine pushes more work to origin plan/shared.
    const other = join(dirname(f.canonical), 'other');
    git(dirname(f.canonical), ['clone', '-q', '-b', 'plan/shared', f.origin, other]);
    put(other, 'src/more.ts', 'export const more = 1;\n');
    git(other, ['add', '.']);
    git(other, ['commit', '-q', '-m', 'feat: more']);
    git(other, ['push', '-q', 'origin', 'plan/shared']);
    git(f.canonical, ['fetch', '-q', 'origin', 'plan/shared']);
    const result = f.reap();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/reaped {3}shared/u);
    expect(result.stdout).toMatch(/origin plan\/shared holds commits not on main; left/u);
    expect(f.remoteBranches()).toEqual(['plan/shared']);
  });

  test('a branch that moved after the check is never deleted, and a running setup stops the run', () => {
    const f = repos(['a']);
    writeFileSync(join(f.canonical, '.git', 'wildshard-worktree-setup.lock'), '1 0 x');
    const stopped = f.reap();
    expect(stopped.status).toBe(1);
    expect(stopped.stdout).toMatch(/a worktree setup is running/u);
    rmSync(join(f.canonical, '.git', 'wildshard-worktree-setup.lock'));
    // A worktree on a branch that is not its plan branch is left alone.
    git(f.tree('a'), ['checkout', '-q', '-b', 'other']);
    const result = f.reap();
    expect(result.stdout).toMatch(/kept {5}a: on refs\/heads\/other, not plan\/a/u);
    expect(f.branches()).toEqual(['plan/a']);
  });
});
