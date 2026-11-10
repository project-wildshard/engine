// DEV-SPEED DS12: scripts/worktree.mjs against real git. A bare repo stands in for GitHub; the canonical checkout is a
// clone of it with local edits and a local commit, so the tests can tell a cloned file from the origin/main blob.
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {afterEach, describe, expect, test} from 'vitest';
import {SLUG, parseArgs} from '../../scripts/worktree.mjs';

const SCRIPT = resolve(import.meta.dirname, '../../scripts/worktree.mjs');
/** @type {string[]} */
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}); });

/** No hook paths, no herdr, no inherited Git or Vitest state: a plain lane shell. */
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

/** origin with two commits; `canonical` cloned from it, then edited. */
function repos() {
  const base = mkdtempSync(join(tmpdir(), 'worktree-new-'));
  roots.push(base);
  const origin = join(base, 'origin.git'), seed = join(base, 'seed'), canonical = join(base, 'engine');
  git(base, ['init', '-q', '--bare', '-b', 'main', origin]);
  git(base, ['init', '-q', '-b', 'main', seed]);
  put(seed, 'package.json', '{"name":"fixture","private":true,"scripts":{}}\n');
  put(seed, '.gitignore', '/.worktrees/\n/tmp/\n');
  put(seed, 'src/same.ts', 'export const same = 1;\n');
  put(seed, 'src/dirty.ts', 'export const dirty = 1;\n');
  put(seed, 'src/ahead.ts', 'export const ahead = 1;\n');
  put(seed, 'bin/run.sh', '#!/bin/sh\necho run\n');
  spawnSync('chmod', ['+x', join(seed, 'bin/run.sh')]);
  spawnSync('ln', ['-s', 'same.ts', join(seed, 'src/link.ts')]);
  git(seed, ['add', '.']);
  git(seed, ['commit', '-q', '-m', 'seed']);
  git(seed, ['remote', 'add', 'origin', origin]);
  git(seed, ['push', '-q', 'origin', 'main']);
  git(base, ['clone', '-q', origin, canonical]);
  // The canonical checkout drifts from origin/main: a local commit and an uncommitted edit.
  put(canonical, 'src/ahead.ts', 'export const ahead = 2;\n');
  git(canonical, ['commit', '-q', '-am', 'local']);
  put(canonical, 'src/dirty.ts', 'export const dirty = "uncommitted";\n');
  put(canonical, 'tmp/secret.env', 'TOKEN=never-copied\n');
  return {origin, canonical, base};
}

/** @param {string} cwd @param {string[]} args @param {Record<string, string>} [env] */
const worktree = (cwd, args, env = {}) => spawnSync(process.execPath, [SCRIPT, ...args], {cwd, env: {...ENV, ...env}, encoding: 'utf8'});

describe('worktree new', () => {
  test('parses its slug and options and refuses anything else', () => {
    expect(parseArgs(['new', 'foo'])).toEqual({slug: 'foo', install: true, pins: true, herdr: true, clone: true});
    expect(parseArgs(['new', 'foo', '--no-install', '--no-pins'])).toMatchObject({install: false, pins: false});
    for (const bad of [[], ['old', 'foo'], ['new'], ['new', 'Foo'], ['new', '../x'], ['new', 'foo', '--force']]) expect(() => parseArgs(bad)).toThrow();
    expect(SLUG.test('dev-speed.2')).toBe(true);
  });

  test('makes .worktrees/<slug> on plan/<slug> at origin/main, clean, with origin/main bytes, a record and land steps', () => {
    const {canonical, base} = repos();
    const receipts = join(base, 'receipts.log');
    const made = worktree(canonical, ['new', 'foo', '--no-install'], {WS_LANE_NAME: 'lane-x', WS_LANE_RECEIPTS: receipts});
    expect(made.status, made.stderr).toBe(0);
    const tree = join(canonical, '.worktrees/foo');
    expect(git(tree, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('plan/foo');
    expect(git(tree, ['rev-parse', 'HEAD'])).toBe(git(canonical, ['rev-parse', 'origin/main']));
    expect(git(tree, ['status', '--porcelain'])).toBe('');
    // Never the canonical checkout's local commit, uncommitted edit or ignored files.
    expect(readFileSync(join(tree, 'src/ahead.ts'), 'utf8')).toBe('export const ahead = 1;\n');
    expect(readFileSync(join(tree, 'src/dirty.ts'), 'utf8')).toBe('export const dirty = 1;\n');
    expect(existsSync(join(tree, 'tmp/secret.env'))).toBe(false);
    expect(spawnSync('test', ['-x', join(tree, 'bin/run.sh')]).status).toBe(0);
    expect(spawnSync('readlink', [join(tree, 'src/link.ts')], {encoding: 'utf8'}).stdout.trim()).toBe('same.ts');
    const record = JSON.parse(readFileSync(join(tree, 'tmp/worktree-setup.json'), 'utf8'));
    expect(record.steps.map((/** @type {{step: string}} */ row) => row.step)).toEqual(['fetch', 'add', 'checkout']);
    if (process.platform === 'darwin') expect(record.steps[2].detail).toMatch(/^4 of 7 tracked files cloned/u);
    expect(made.stdout).toContain('WS_LANE_NAME=lane-x node scripts/land.mjs');
    expect(readFileSync(receipts, 'utf8')).toMatch(/^\d\d:\d\d UTC lane-x worktree new engine\/\.worktrees\/foo on plan\/foo from [0-9a-f]{10} in /mu);
  });

  test('from inside a linked worktree it still makes the new one under the canonical checkout', () => {
    const {canonical} = repos();
    expect(worktree(canonical, ['new', 'one', '--no-install']).status).toBe(0);
    const made = worktree(join(canonical, '.worktrees/one/src'), ['new', 'two', '--no-install']);
    expect(made.status, made.stderr).toBe(0);
    expect(existsSync(join(canonical, '.worktrees/two/package.json'))).toBe(true);
  });

  test('refuses an existing worktree, an existing branch and a live setup lock, and leaves nothing behind', () => {
    const {canonical} = repos();
    expect(worktree(canonical, ['new', 'foo', '--no-install']).status).toBe(0);
    expect(worktree(canonical, ['new', 'foo', '--no-install']).stderr).toMatch(/already exists/u);
    git(canonical, ['branch', 'plan/bar', 'main']);
    expect(worktree(canonical, ['new', 'bar', '--no-install']).stderr).toMatch(/branch plan\/bar already exists/u);
    mkdirSync(join(canonical, '.git/wildshard-worktree-setup.lock'));
    writeFileSync(join(canonical, '.git/wildshard-worktree-setup.lock/pid'), String(process.pid));
    const locked = worktree(canonical, ['new', 'baz', '--no-install']);
    expect(locked.status).toBe(1);
    expect(locked.stderr).toMatch(/another worktree setup/u);
    expect(existsSync(join(canonical, '.worktrees/baz'))).toBe(false);
    // A lock whose holder died is taken over.
    writeFileSync(join(canonical, '.git/wildshard-worktree-setup.lock/pid'), '999999999');
    expect(worktree(canonical, ['new', 'baz', '--no-install']).status).toBe(0);
  });
});
