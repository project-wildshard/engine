// DEV-SPEED DS13: `worktree.mjs reap` against real git. A bare repo stands in for GitHub. Only a landed, clean, idle
// plan worktree goes, with its local branch and its origin branch; every other kind stays, named with its reason.
import {spawn, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {afterEach, describe, expect, test} from 'vitest';
import {parseReapArgs,stopWorktreeProcesses} from '../../scripts/worktree-reap.mjs';

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
  put(canonical, '.gitignore', '/.worktrees/\n/out/\n/tmp/\n');
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
    expect(parseReapArgs([])).toEqual({dryRun: false, graceHours: 24, staleHours: 72, remote: true});
    expect(parseReapArgs(['--dry-run', '--grace=0.5', '--stale=1', '--no-remote'])).toEqual({dryRun: true, graceHours: 0.5, staleHours: 1, remote: false});
    for (const bad of [['--force'], ['--grace'], ['--grace=-1'], ['--stale=x'], ['x']]) expect(() => parseReapArgs(bad)).toThrow();
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
    // Ignored build output and scratch never count as dirt, and go with the worktree (REPO-DISK DK11).
    put(f.tree('landed'), 'out/big.bin', 'x');
    put(f.tree('landed'), 'tmp/lane/scratch.bin', 'x');

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
    expect(existsSync(join(f.tree('landed'), 'tmp'))).toBe(false);
    for (const name of ['unlanded', 'dirty', 'busy', 'landing']) expect(existsSync(f.tree(name)), name).toBe(true);
    expect(f.branches().sort()).toEqual(['plan/busy', 'plan/dirty', 'plan/landing', 'plan/unlanded']);
    expect(f.remoteBranches().sort()).toEqual(['plan/busy', 'plan/dirty', 'plan/landing', 'plan/unlanded']);
    expect(readFileSync(f.receipts, 'utf8')).toMatch(/^\d\d:\d\d UTC fixture-lane worktree reap engine: reaped landed; kept busy \(.*\), dirty \(.*\), landing \(.*\), unlanded \(.*\); origin landed deleted; df [+-][\d,]+ MiB$/mu);
  }, 60_000);

  test('DK11: an unlanded or dirty worktree past --stale goes on the receipt with its size; a dry run records no df', () => {
    const f = repos(['old', 'messy', 'done']);
    f.work('old', false);
    f.work('done', true);
    put(f.tree('messy'), 'notes.txt', 'mine\n');
    const quiet = f.reap(['--grace=0', '--stale=24']);
    expect(quiet.stdout).not.toMatch(/stale/u);
    const dry = f.reap(['--grace=0', '--stale=0', '--dry-run']);
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toMatch(/stale {4}old \([\d.]+ GiB, idle 0\.0 d, 1 commit\(s\) not on main\)/u);
    expect(dry.stdout).toMatch(/stale {4}messy \([\d.]+ GiB, idle 0\.0 d, 1 uncommitted path\(s\)\)/u);
    const lines = readFileSync(f.receipts, 'utf8').trim().split('\n');
    expect(lines[0]).toMatch(/; df [+-][\d,]+ MiB$/u);
    expect(lines[1]).toMatch(/\(dry run\).*; stale 0 h\+: messy \(.*\), old \(.*\)$/u);
    expect(lines[1]).not.toMatch(/; df /u);
  }, 60_000);

  test('FL30: an orphaned process in a landed worktree is stopped and the worktree reaped; a dry run only names it', async () => {
    const f = repos(['orphaned']);
    f.work('orphaned', true);
    const started = spawnSync('sh', ['-c', 'sleep 30 >/dev/null 2>&1 & echo $!'], {cwd: f.tree('orphaned'), encoding: 'utf8'});
    const orphan = Number(started.stdout.trim());
    const alive = () => { try { process.kill(orphan, 0); return true; } catch { return false; } };
    try {
      await new Promise(done => setTimeout(done, 200));
      const dry = f.reap(['--grace=0', '--dry-run']);
      expect(dry.stdout).toMatch(new RegExp(`would stop orphaned: orphaned pid ${String(orphan)}`, 'u'));
      expect(alive()).toBe(true);
      const result = f.reap();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(new RegExp(`stopped  orphaned: orphaned pid ${String(orphan)}`, 'u'));
      expect(result.stdout).toMatch(/reaped {3}orphaned: worktree removed/u);
      expect(alive()).toBe(false);
    } finally { if (alive()) process.kill(orphan, 'SIGKILL'); }
  }, 60_000);

  test('FL30: stopWorktreeProcesses stops what runs in a worktree, with its children, and spares this process', async () => {
    const base = mkdtempSync(join(tmpdir(), 'worktree-stop-'));
    roots.push(base);
    const tree = realpathSync(base);
    const runner = spawn('sh', ['-c', 'sleep 30 & sleep 30; wait'], {cwd: tree, stdio: 'ignore'});
    children.push(runner);
    await new Promise(done => setTimeout(done, 200));
    expect(stopWorktreeProcesses(tree, {orphansOnly: true})).toEqual([]);
    const stopped = stopWorktreeProcesses(tree);
    expect(stopped).toContain(runner.pid);
    expect(stopped).not.toContain(process.pid);
    expect(stopped.length).toBeGreaterThanOrEqual(3);
    // The runner is this test's own child: it stays a zombie until reaped here, so wait for its exit.
    const exited = runner.exitCode !== null || runner.signalCode !== null ? undefined : new Promise(done => { runner.once('exit', done); });
    await exited;
    expect(runner.signalCode ?? runner.exitCode).not.toBeNull();
    for (const pid of stopped.filter(pid => pid !== runner.pid)) expect(() => process.kill(pid, 0)).toThrow();
  }, 30_000);

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

  test('J206 review: a merge whose parents are on main is not landed, and a linked .worktrees/ is never followed', () => {
    const f = repos(['merged']);
    // Main gains B; the plan merges B into its older base and adds its own change in the merge commit.
    put(f.canonical, 'src/b.ts', 'export const b = 1;\n');
    git(f.canonical, ['add', 'src/b.ts']);
    git(f.canonical, ['commit', '-q', '-m', 'feat: b']);
    git(f.canonical, ['push', '-q', 'origin', 'main']);
    git(f.tree('merged'), ['fetch', '-q', 'origin']);
    git(f.tree('merged'), ['merge', '-q', '--no-ff', '--no-commit', 'origin/main']);
    put(f.tree('merged'), 'src/resolution.ts', 'export const resolved = 1;\n');
    git(f.tree('merged'), ['add', 'src/resolution.ts']);
    git(f.tree('merged'), ['commit', '-q', '-m', 'merge main with a resolution']);
    // git cherry lists nothing for it: the change only lives in the merge.
    expect(git(f.canonical, ['cherry', 'origin/main', 'plan/merged'])).toBe('');
    const result = f.reap();
    expect(result.stdout).toMatch(/kept {5}merged: 1 commit\(s\) not on main/u);
    expect(existsSync(f.tree('merged'))).toBe(true);

    // A second checkout whose .worktrees/ is a link into the first: its reaper must not touch the first's worktrees.
    const g = repos(['x']);
    g.work('x', true);
    // Git still records <canonical>/.worktrees/x, which now reaches the folder through a link.
    const elsewhere = join(dirname(g.canonical), 'elsewhere');
    spawnSync('mv', [join(g.canonical, '.worktrees'), elsewhere]);
    spawnSync('ln', ['-s', elsewhere, join(g.canonical, '.worktrees')]);
    const linked = g.reap();
    expect(linked.status, linked.stderr).toBe(0);
    expect(linked.stdout).toMatch(/skipped .*x: resolves to .*elsewhere\/x, outside /u);
    expect(linked.stdout).not.toMatch(/reaped/u);
    expect(existsSync(join(elsewhere, 'x', 'src', 'x.ts'))).toBe(true);
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
