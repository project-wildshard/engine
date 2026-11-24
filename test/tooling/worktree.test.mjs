// DEV-SPEED DS12: scripts/worktree.mjs against real git. A bare repo stands in for GitHub; the canonical checkout is a
// clone of it with local edits and a local commit, so the tests can tell a cloned file from the origin/main blob.
import {spawn, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {afterEach, describe, expect, test} from 'vitest';
import {ENDED_IDLE_MS, INSTALLED_LOCK, MAX_WORKTREES, SLUG, endedList, endedWorktrees, followMain, parseArgs, refreshCanonicalInstall, withStoreUse} from '../../scripts/worktree.mjs';

const SCRIPT = resolve(import.meta.dirname, '../../scripts/worktree.mjs');
/** @type {string[]} */
const roots = [];
mkdirSync('tmp/codex-netlag', {recursive: true});
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}); });

/** No hook paths, no herdr, no inherited Git or Vitest state: a plain lane shell. */
const ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && !key.startsWith('CLAUDE_') && !key.startsWith('HERDR') && !key.startsWith('VITEST'))),
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com',
  WS_LANE_RECEIPTS: resolve('tmp/codex-netlag/worktree-fixture-receipts.log'),
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
  const base = mkdtempSync(resolve('tmp/codex-netlag/worktree-new-'));
  roots.push(base);
  const origin = join(base, 'origin.git'), seed = join(base, 'seed'), canonical = join(base, 'engine');
  git(base, ['init', '-q', '--bare', '-b', 'main', origin]);
  git(base, ['init', '-q', '-b', 'main', seed]);
  put(seed, 'package.json', '{"name":"fixture","private":true,"scripts":{}}\n');
  put(seed, '.gitignore', '/.worktrees/\n/tmp/\n/dist-content/\n');
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
    expect(parseArgs(['new', 'foo'])).toEqual({slug: 'foo', row: null, install: true, pins: true, herdr: true, clone: true});
    expect(parseArgs(['new', 'foo', '--no-install', '--no-pins'])).toMatchObject({install: false, pins: false});
    for (const bad of [[], ['old', 'foo'], ['new'], ['new', 'Foo'], ['new', '../x'], ['new', 'foo', '--force']]) expect(() => parseArgs(bad)).toThrow();
    expect(SLUG.test('dev-speed.2')).toBe(true);
  });

  test('makes .worktrees/<slug> on plan/<slug> at origin/main, clean, with origin/main bytes, a record and land steps', () => {
    const {canonical, base} = repos();
    put(canonical, 'dist-content/assets/content.bin', 'regenerable content');
    const receipts = join(base, 'receipts.log');
    const made = worktree(canonical, ['new', 'foo', '--no-install'], {WS_LANE_NAME: 'lane-x', WS_LANE_RECEIPTS: receipts, CLAUDE_CODE_SESSION_ID: 'inherited-parent', CODEX_THREAD_ID: 'thread-worktree-fixture'});
    expect(made.status, made.stderr).toBe(0);
    const tree = join(canonical, '.worktrees/foo');
    expect(git(tree, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('plan/foo');
    expect(git(tree, ['rev-parse', 'HEAD'])).toBe(git(canonical, ['rev-parse', 'origin/main']));
    expect(git(tree, ['status', '--porcelain', '--untracked-files=no'])).toBe('');
    expect(existsSync(join(tree, '.owner'))).toBe(true);
    expect(JSON.parse(readFileSync(join(tree, '.owner'), 'utf8'))).toMatchObject({session: 'thread-worktree-fixture', agent: 'codex'});
    // Never the canonical checkout's local commit, uncommitted edit or ignored files.
    expect(readFileSync(join(tree, 'src/ahead.ts'), 'utf8')).toBe('export const ahead = 1;\n');
    expect(readFileSync(join(tree, 'src/dirty.ts'), 'utf8')).toBe('export const dirty = 1;\n');
    expect(existsSync(join(tree, 'tmp/secret.env'))).toBe(false);
    expect(spawnSync('test', ['-x', join(tree, 'bin/run.sh')]).status).toBe(0);
    expect(spawnSync('readlink', [join(tree, 'src/link.ts')], {encoding: 'utf8'}).stdout.trim()).toBe('same.ts');
    const record = JSON.parse(readFileSync(join(tree, 'tmp/worktree-setup.json'), 'utf8'));
    expect(record.steps.map((/** @type {{step: string}} */ row) => row.step)).toEqual(['fetch', 'add', 'checkout', ...(process.platform === 'darwin' ? ['content'] : [])]);
    if (process.platform === 'darwin') {
      expect(record.steps.find((/** @type {{step: string}} */ row) => row.step === 'content').detail).toMatch(/^clone /u);
      expect(readFileSync(join(tree, 'dist-content/assets/content.bin'), 'utf8')).toBe('regenerable content');
      put(tree, 'dist-content/assets/content.bin', 'changed clone');
      expect(readFileSync(join(canonical, 'dist-content/assets/content.bin'), 'utf8')).toBe('regenerable content');
    }
    if (process.platform === 'darwin') expect(record.steps[2].detail).toMatch(/^4 of 7 tracked files cloned/u);
    expect(made.stdout).toContain('WS_LANE_NAME=lane-x node scripts/land.mjs');
    expect(readFileSync(receipts, 'utf8')).toMatch(/^\d\d:\d\d UTC lane-x worktree new engine\/\.worktrees\/foo on plan\/foo from [0-9a-f]{10} in .*; df (?:cost|gained) [\d,]+ MiB, du \d+\.\d\d GiB, free [\d.]+ GiB$/mu);
    // REPO-DISK DK10: the record keeps df before and after and the worktree's du.
    expect(record.disk.dfCostBytes).toBe(record.disk.freeBefore - record.disk.freeAfter);
    expect(record.disk.duKib).toBeGreaterThan(0);
  });

  test.skipIf(process.platform !== 'darwin')('DK10: a refused optional content clone keeps setup usable and removes its partial output', () => {
    const {canonical, base} = repos(), bin = join(base, 'bin'), partial = join(canonical, '.worktrees/foo/dist-content');
    put(canonical, 'dist-content/assets/content.bin', 'regenerable content');
    put(base, 'bin/python3', `#!/bin/sh\nmkdir -p '${partial}'\nprintf partial > '${partial}/partial.bin'\necho 'fixture clone failure' >&2\nexit 1\n`);
    spawnSync('chmod', ['+x', join(bin, 'python3')]);
    const made = worktree(canonical, ['new', 'foo', '--no-install'], {PATH: `${bin}:${ENV.PATH ?? ''}`});
    expect(made.status, made.stderr).toBe(0);
    expect(made.stderr).toContain('content clone skipped');
    const tree = join(canonical, '.worktrees/foo');
    expect(existsSync(partial)).toBe(false);
    expect(existsSync(join(tree, '.owner'))).toBe(true);
    expect(existsSync(join(tree, 'tmp/worktree-setup.json'))).toBe(true);
    expect(readFileSync(join(tree, 'src/same.ts'), 'utf8')).toBe('export const same = 1;\n');
  });

  test('keeps the canonical checkout on origin/main: fast-forwards a clean one, never moves a diverged or edited one', () => {
    const {origin, canonical, base} = repos();
    // The fixture's canonical checkout has a local commit and an edit: it is named and left exactly where it is.
    const before = git(canonical, ['rev-parse', 'HEAD']);
    const diverged = worktree(canonical, ['new', 'a', '--no-install']);
    expect(diverged.status, diverged.stderr).toBe(0);
    expect(diverged.stdout).toMatch(/CANONICAL MAIN DIVERGED: 1 ahead, 0 behind origin\/main; left alone/u);
    expect(git(canonical, ['rev-parse', 'HEAD'])).toBe(before);
    expect(readFileSync(join(canonical, 'src/dirty.ts'), 'utf8')).toBe('export const dirty = "uncommitted";\n');
    // A second, clean clone that is only behind is fast-forwarded to origin/main.
    const clean = join(base, 'clean');
    git(base, ['clone', '-q', origin, clean]);
    const pusher = join(base, 'pusher');
    git(base, ['clone', '-q', origin, pusher]);
    put(pusher, 'src/new.ts', 'export const fresh = 1;\n');
    git(pusher, ['add', 'src/new.ts']);
    git(pusher, ['commit', '-q', '-m', 'main moves']);
    git(pusher, ['push', '-q', 'origin', 'main']);
    const behind = worktree(clean, ['new', 'b', '--no-install']);
    expect(behind.status, behind.stderr).toBe(0);
    expect(behind.stdout).toMatch(/canonical main fast-forwarded 1 commit\(s\)/u);
    expect(git(clean, ['rev-parse', 'HEAD'])).toBe(git(clean, ['rev-parse', 'origin/main']));
    // With a tracked edit it is left alone.
    git(pusher, ['commit', '-q', '--allow-empty', '-m', 'main moves again']);
    git(pusher, ['push', '-q', 'origin', 'main']);
    put(clean, 'src/same.ts', 'export const same = 2;\n');
    const edited = worktree(clean, ['new', 'c', '--no-install']);
    expect(edited.stdout).toMatch(/canonical main 1 behind; tracked edits \(src\/same\.ts\); their owner commits or discards them; left alone/u);
  });

  test('J206 review: never fast-forwards over an ignored file or a git operation in progress; a process inside does not block it', async () => {
    const {origin, base} = repos();
    const clean = join(base, 'clean'), pusher = join(base, 'pusher');
    git(base, ['clone', '-q', origin, clean]);
    git(base, ['clone', '-q', origin, pusher]);
    const move = (/** @type {string} */ path, /** @type {string} */ body) => {
      put(pusher, path, body);
      git(pusher, ['add', '-f', path]);
      git(pusher, ['commit', '-q', '-m', `track ${path}`]);
      git(pusher, ['push', '-q', 'origin', 'main']);
    };
    // Upstream starts tracking tmp/keep.txt, which the clone holds as an ignored file of its own.
    move('tmp/keep.txt', 'upstream\n');
    put(clean, 'tmp/keep.txt', 'mine\n');
    const ignored = worktree(clean, ['new', 'a', '--no-install']);
    expect(ignored.stdout).toMatch(/fast-forward refused/u);
    expect(readFileSync(join(clean, 'tmp/keep.txt'), 'utf8')).toBe('mine\n');
    rmSync(join(clean, 'tmp/keep.txt'));
    // A failed `git am` leaves main clean with rebase-apply/ present.
    mkdirSync(join(clean, '.git/rebase-apply'));
    const busy = worktree(clean, ['new', 'b', '--no-install']);
    expect(busy.stdout).toMatch(/git rebase-apply in progress; left alone/u);
    rmSync(join(clean, '.git/rebase-apply'), {recursive: true});
    // A terminal or dev server sitting in the checkout no longer blocks it: clean, on main and behind is enough.
    const sleeper = spawn('sleep', ['30'], {cwd: clean, stdio: 'ignore'});
    try {
      await new Promise(done => setTimeout(done, 200));
      const head = git(clean, ['rev-parse', 'HEAD']);
      const used = worktree(clean, ['new', 'c', '--no-install']);
      expect(used.stdout).not.toMatch(/working in it/u);
      expect(used.stdout).toMatch(/canonical main fast-forwarded 1 commit\(s\)/u);
      expect(git(clean, ['rev-parse', 'HEAD'])).not.toBe(head);
    } finally { sleeper.kill(); }
  });

  test('from inside a linked worktree it still makes the new one under the canonical checkout', () => {
    const {canonical} = repos();
    expect(worktree(canonical, ['new', 'one', '--no-install']).status).toBe(0);
    const made = worktree(join(canonical, '.worktrees/one/src'), ['new', 'two', '--no-install']);
    expect(made.status, made.stderr).toBe(0);
    expect(existsSync(join(canonical, '.worktrees/two/package.json'))).toBe(true);
  });

  test('refuses an existing worktree or branch, a live setup lock and an abandoned one', () => {
    const {canonical} = repos();
    expect(worktree(canonical, ['new', 'foo', '--no-install']).status).toBe(0);
    expect(worktree(canonical, ['new', 'foo', '--no-install']).stderr).toMatch(/already exists/u);
    git(canonical, ['branch', 'plan/bar', 'main']);
    expect(worktree(canonical, ['new', 'bar', '--no-install']).stderr).toMatch(/branch plan\/bar already exists/u);
    expect(git(canonical, ['rev-parse', 'plan/bar'])).toBe(git(canonical, ['rev-parse', 'main']));
    const lock = join(canonical, '.git/wildshard-worktree-setup.lock');
    writeFileSync(lock, `${process.pid} ${Date.now()} live`);
    const locked = worktree(canonical, ['new', 'baz', '--no-install']);
    expect(locked.status).toBe(1);
    expect(locked.stderr).toMatch(/another worktree setup/u);
    expect(existsSync(join(canonical, '.worktrees/baz'))).toBe(false);
    expect(readFileSync(lock, 'utf8')).toMatch(/ live$/u);
    // A dead holder's lock, or a live pid's lock older than any setup (a reused pid), is named, never taken over.
    writeFileSync(lock, `999999999 ${Date.now()} dead`);
    expect(worktree(canonical, ['new', 'baz', '--no-install']).stderr).toMatch(/looks abandoned \(pid 999999999 gone[\s\S]*rm .*wildshard-worktree-setup\.lock/u);
    writeFileSync(lock, `${process.pid} ${Date.now() - 11 * 60_000} old`);
    expect(worktree(canonical, ['new', 'baz', '--no-install']).stderr).toMatch(/looks abandoned \(pid \d+ reused/u);
    expect(readFileSync(lock, 'utf8')).toMatch(/ old$/u);
    rmSync(lock);
    expect(worktree(canonical, ['new', 'baz', '--no-install']).status).toBe(0);
    expect(existsSync(lock)).toBe(false);
  });

  test('never clones a hidden edit, a mode the index disagrees with, a converted file or a swapped-in directory', () => {
    const {canonical} = repos();
    // assume-unchanged hides an edit from `git ls-files -m`.
    put(canonical, 'src/same.ts', 'export const same = "hidden";\n');
    git(canonical, ['update-index', '--assume-unchanged', 'src/same.ts']);
    // With core.filemode off, the index keeps 100755 while the working file lost its x bit.
    git(canonical, ['config', 'core.filemode', 'false']);
    spawnSync('chmod', ['-x', join(canonical, 'bin/run.sh')]);
    // skip-worktree, and the path is now a directory holding a secret.
    git(canonical, ['update-index', '--skip-worktree', 'package.json']);
    rmSync(join(canonical, 'package.json'));
    put(canonical, 'package.json/secret.env', 'TOKEN=never-copied\n');
    const made = worktree(canonical, ['new', 'foo', '--no-install']);
    expect(made.status, made.stderr).toBe(0);
    const tree = join(canonical, '.worktrees/foo');
    expect(readFileSync(join(tree, 'src/same.ts'), 'utf8')).toBe('export const same = 1;\n');
    expect(spawnSync('test', ['-x', join(tree, 'bin/run.sh')]).status).toBe(0);
    expect(readFileSync(join(tree, 'package.json'), 'utf8')).toContain('"name":"fixture"');
    expect(git(tree, ['status', '--porcelain', '--untracked-files=no'])).toBe('');
    expect(existsSync(join(tree, '.owner'))).toBe(true);
  });

  test('writes an ident-expanded file through git, not as a raw clone', () => {
    const {canonical, origin, base} = repos();
    const seed = join(base, 'seed');
    put(seed, '.gitattributes', '*.id ident\n');
    put(seed, 'version.id', '$Id$\n');
    git(seed, ['add', '.gitattributes', 'version.id']);
    git(seed, ['commit', '-q', '-m', 'ident']);
    git(seed, ['push', '-q', 'origin', 'main']);
    git(canonical, ['pull', '-q', '--rebase', '--autostash', origin, 'main']);
    const made = worktree(canonical, ['new', 'foo', '--no-install']);
    expect(made.status, made.stderr).toBe(0);
    expect(readFileSync(join(canonical, '.worktrees/foo/version.id'), 'utf8')).toMatch(/^\$Id: [0-9a-f]{40} \$\n$/u);
  });

  test('refuses a repo whose tracked hooks would not run there, and takes back its worktree and branch', () => {
    const {canonical, origin, base} = repos();
    const seed = join(base, 'seed');
    put(seed, '.githooks/pre-commit', '#!/bin/sh\nexit 0\n');
    spawnSync('chmod', ['+x', join(seed, '.githooks/pre-commit')]);
    git(seed, ['add', '.githooks/pre-commit']);
    git(seed, ['commit', '-q', '-m', 'hooks']);
    git(seed, ['push', '-q', 'origin', 'main']);
    git(canonical, ['fetch', '-q', origin]);
    const refused = worktree(canonical, ['new', 'foo', '--no-install']);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(/core\.hooksPath is unset/u);
    expect(existsSync(join(canonical, '.worktrees/foo'))).toBe(false);
    expect(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/plan/foo'], {cwd: canonical, env: ENV}).status).not.toBe(0);
    git(canonical, ['config', 'core.hooksPath', '.githooks']);
    // A tracked hook that lost its x bit in the commit would not run either.
    git(seed, ['update-index', '--chmod=-x', '.githooks/pre-commit']);
    git(seed, ['commit', '-q', '-m', 'hook not executable']);
    git(seed, ['push', '-q', 'origin', 'main']);
    expect(worktree(canonical, ['new', 'foo', '--no-install']).stderr).toMatch(/hook pre-commit is missing or not executable/u);
    expect(existsSync(join(canonical, '.worktrees/foo'))).toBe(false);
    git(seed, ['update-index', '--chmod=+x', '.githooks/pre-commit']);
    git(seed, ['commit', '-q', '-m', 'hook executable']);
    git(seed, ['push', '-q', 'origin', 'main']);
    expect(worktree(canonical, ['new', 'foo', '--no-install']).status).toBe(0);
  });

  test('a name the clone check cannot read, and autocrlf in any spelling, leave the file to git', () => {
    const {canonical, origin, base} = repos();
    const seed = join(base, 'seed');
    put(seed, 'odd\nname.txt', 'odd\n');
    put(seed, 'plain.txt', 'line\n');
    git(seed, ['add', '.']);
    git(seed, ['commit', '-q', '-m', 'odd names']);
    git(seed, ['push', '-q', 'origin', 'main']);
    git(canonical, ['pull', '-q', '--rebase', '--autostash', origin, 'main']);
    git(canonical, ['config', 'core.autocrlf', 'YES']);
    const made = worktree(canonical, ['new', 'foo', '--no-install']);
    expect(made.status, made.stderr).toBe(0);
    const tree = join(canonical, '.worktrees/foo');
    expect(readFileSync(join(tree, 'odd\nname.txt'), 'utf8')).toBe('odd\r\n');
    // checkout-index writes CRLF under autocrlf; a raw LF clone would have passed the hash.
    expect(readFileSync(join(tree, 'plain.txt'), 'utf8')).toBe('line\r\n');
  });
});

describe('worktree install and the store prune reservation (GVS G10)', () => {
  /** @returns {{users: string, reservation: string, env: NodeJS.ProcessEnv}} */
  const box = () => {
    const base = mkdtempSync(resolve('tmp/codex-netlag/store-use-'));
    roots.push(base);
    const users = join(base, 'store-users'), reservation = join(base, 'store-maintenance.lock');
    return {users, reservation, env: {WS_STORE_USERS: users, WS_STORE_RESERVATION: reservation}};
  };
  /** A stand-in prune: holds the exclusive flock until killed. @param {string} path */
  const holdLock = (path) => {
    const child = spawn('python3', ['-c', 'import fcntl,sys,time\nf=open(sys.argv[1],"a+")\nfcntl.flock(f,fcntl.LOCK_EX)\nprint("held",flush=True)\ntime.sleep(30)', path]);
    return new Promise((resolveHeld) => { child.stdout.once('data', () => resolveHeld(child)); });
  };
  test('announces itself before it checks, refuses while a prune holds the store, and cleans up', async () => {
    const {users, reservation, env} = box();
    let seen = /** @type {string[]} */ ([]);
    expect(withStoreUse(env, 'worktree install', () => { seen = readdirSync(users); return 7; })).toBe(7);
    expect(seen).toEqual([`${process.pid}.json`]);
    expect(readdirSync(users)).toEqual([]);
    const prune = /** @type {import('node:child_process').ChildProcess} */ (await holdLock(reservation));
    try {
      let ran = false;
      expect(() => withStoreUse(env, 'worktree install', () => { ran = true; })).toThrow(/store prune is running/u);
      expect(ran).toBe(false);
      expect(readdirSync(users)).toEqual([]);
    } finally { prune.kill(); }
  });
  test('a lock file nobody holds (a finished prune) does not block an install', () => {
    const {reservation, env} = box();
    writeFileSync(reservation, '');
    expect(withStoreUse(env, 'worktree install', () => 'ok')).toBe('ok');
  });
});

// 2026-11-16: the canonical install kept shard-format 0.5.7 hours after pnpm-lock.yaml moved to 0.7.0, and every shared
// preview (which links the canonical node_modules) refused Template rev 8. followMain now refreshes the install.
describe('followMain keeps the canonical install on its lockfile', () => {
  const canonicalWithLock = () => {
    const {origin, base} = repos();
    const seed = join(base, 'seed');
    put(seed, 'pnpm-lock.yaml', 'lockfileVersion: 9.0\n# v1\n');
    git(seed, ['add', 'pnpm-lock.yaml']);
    git(seed, ['commit', '-q', '-m', 'lock v1', '--', 'pnpm-lock.yaml']);
    git(seed, ['push', '-q', 'origin', 'main']);
    const canonical = join(base, 'fresh');
    git(base, ['clone', '-q', origin, canonical]);
    const store = join(base, 'store-users');
    return {seed, canonical, env: {...ENV, WS_STORE_USERS: store, WS_STORE_RESERVATION: join(base, 'no-prune.lock')}};
  };
  test('installs once when the lockfile moved, records it, and skips it next time', () => {
    const {seed, canonical, env} = canonicalWithLock();
    mkdirSync(join(canonical, 'node_modules'));
    /** @type {string[]} */ const installs = [];
    const install = (/** @type {string} */ cwd) => { installs.push(cwd); };
    const lock1 = git(canonical, ['rev-parse', 'HEAD:pnpm-lock.yaml']);
    expect(followMain(canonical, git(canonical, ['rev-parse', 'origin/main']), {env, install})).toBe(`canonical main current; canonical install refreshed for pnpm-lock.yaml ${lock1.slice(0, 10)}`);
    expect(readFileSync(join(canonical, INSTALLED_LOCK), 'utf8')).toBe(`${lock1}\n`);
    expect(followMain(canonical, git(canonical, ['rev-parse', 'origin/main']), {env, install})).toBe('canonical main current');
    expect(installs).toEqual([canonical]);
    // A land moves main with a new lockfile: the fast-forward brings the install along.
    put(seed, 'pnpm-lock.yaml', 'lockfileVersion: 9.0\n# v2: shard-format 0.7.0\n');
    git(seed, ['commit', '-q', '-m', 'lock v2', '--', 'pnpm-lock.yaml']);
    git(seed, ['push', '-q', 'origin', 'main']);
    git(canonical, ['fetch', '-q', 'origin', 'main']);
    const lock2 = git(canonical, ['rev-parse', 'origin/main:pnpm-lock.yaml']);
    expect(followMain(canonical, git(canonical, ['rev-parse', 'origin/main']), {env, install})).toBe(`canonical main fast-forwarded 1 commit(s); canonical install refreshed for pnpm-lock.yaml ${lock2.slice(0, 10)}`);
    expect(installs).toHaveLength(2);
  });
  test('no node_modules, no install; a failed install is a loud line, never a throw, and is retried next time', () => {
    const {canonical, env} = canonicalWithLock();
    const base = git(canonical, ['rev-parse', 'origin/main']);
    const never = () => { throw new Error('must not install'); };
    expect(refreshCanonicalInstall(canonical, {env, install: never})).toBe('');
    mkdirSync(join(canonical, 'node_modules'));
    const fail = () => { throw new Error('pnpm: lockfile out of date'); };
    expect(followMain(canonical, base, {env, install: fail})).toMatch(/^canonical main current; CANONICAL INSTALL STALE: pnpm install --frozen-lockfile failed \(pnpm: lockfile out of date\); run it in /u);
    expect(existsSync(join(canonical, INSTALLED_LOCK))).toBe(false);
  });
  test('a checkout left alone (not on main) is not installed into', () => {
    const {canonical, env} = canonicalWithLock();
    mkdirSync(join(canonical, 'node_modules'));
    git(canonical, ['switch', '-q', '-c', 'side']);
    const never = () => { throw new Error('must not install'); };
    expect(followMain(canonical, git(canonical, ['rev-parse', 'origin/main']), {env, install: never})).toMatch(/^canonical not on main \(refs\/heads\/side\); left alone$/u);
  });
});

// J358 (Jake 2026-11-15: no auto delete in scripts; replaces Build-max C4's cap reaper, 738764b36): a full cap refuses and
// lists each ended worktree with its copy-first removal command; nothing is removed.
describe('a full cap lists ended worktrees', () => {
  test('lists landed, clean worktrees idle 30 min with copy-first commands; keeps every worktree and branch', () => {
    const {canonical} = repos();
    // .owner marks each worktree, as the real .gitignore ignores it.
    writeFileSync(join(canonical, '.git/info/exclude'), '/.owner\n');
    const slugs = Array.from({length: MAX_WORKTREES}, (_, index) => `full-${String(index)}`);
    for (const slug of slugs) expect(worktree(canonical, ['new', slug, '--no-install']).status).toBe(0);
    put(join(canonical, '.worktrees/full-0'), 'src/same.ts', 'export const same = "work in progress";\n');
    // Fresh worktrees have not ended: the cap refuses with no list.
    const refused = worktree(canonical, ['new', 'next', '--no-install']);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(new RegExp(`cap ${String(MAX_WORKTREES)}\\)`, 'u'));
    expect(refused.stderr).not.toMatch(/ended worktrees/u);
    expect(endedWorktrees(canonical, ENV)).toEqual([]);
    // 31 min on: every clean one has ended, full-0 (dirty) has not; nothing is removed.
    const ended = endedWorktrees(canonical, ENV, Date.now() + ENDED_IDLE_MS + 60_000).map(row => row.slug);
    expect(ended).toHaveLength(MAX_WORKTREES - 1);
    expect(ended).not.toContain('full-0');
    for (const slug of slugs) {
      expect(existsSync(join(canonical, '.worktrees', slug))).toBe(true);
      expect(spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/plan/${slug}`], {cwd: canonical, env: ENV}).status).toBe(0);
    }
    expect(endedList([{slug: 'full-1', idleHours: 2}])).toMatch(/node scripts\/keep-copy\.mjs \.worktrees\/full-1 && git worktree remove \.worktrees\/full-1 && git branch -d plan\/full-1 /u);
  });

  test('the canonical refresh installs when pnpm\'s installed lockfile disagrees with a matching record', () => {
    const {origin, base} = repos();
    const seed = join(base, 'seed');
    put(seed, 'pnpm-lock.yaml', 'lockfileVersion: 9.0\n# v1\n');
    git(seed, ['add', 'pnpm-lock.yaml']);
    git(seed, ['commit', '-q', '-m', 'lock v1', '--', 'pnpm-lock.yaml']);
    git(seed, ['push', '-q', 'origin', 'main']);
    const canonical = join(base, 'fresh');
    git(base, ['clone', '-q', origin, canonical]);
    const env = {...ENV, WS_STORE_USERS: join(base, 'store-users'), WS_STORE_RESERVATION: join(base, 'no-prune.lock')};
    const lock = git(canonical, ['rev-parse', 'HEAD:pnpm-lock.yaml']);
    put(canonical, INSTALLED_LOCK, `${lock}\n`);
    put(canonical, 'node_modules/.pnpm/lock.yaml', 'lockfileVersion: 9.0\n# v0\n');
    /** @type {string[]} */ const installs = [];
    const install = (/** @type {string} */ cwd) => { installs.push(cwd); put(cwd, 'node_modules/.pnpm/lock.yaml', 'lockfileVersion: 9.0\n# v1\n'); };
    expect(refreshCanonicalInstall(canonical, {env, install})).toBe(`canonical install refreshed for pnpm-lock.yaml ${lock.slice(0, 10)}`);
    expect(refreshCanonicalInstall(canonical, {env, install})).toBe('');
    expect(installs).toEqual([canonical]);
  });
});
