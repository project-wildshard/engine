// DS11 guard (J221, J240): a plan worktree under <repo>/.worktrees/ is invisible to the parent checkout's whole-tree
// tools. It plants a tree holding a lint error, a failing test, an index.html and a secret-shaped string under this
// checkout's own .worktrees/, then runs the parent's lint, format, Vitest discovery, staged-blob and size checks and
// fails if any of them sees a planted file. Watchers and whole-root walkers are checked on small fixture roots.
// Repo-kit copies this test beside scripts/worktree-ignore.mjs into every org repo.
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, relative, resolve} from 'node:path';
import {afterAll, beforeAll, describe, expect, test} from 'vitest';
import {createServer} from 'vite';
import {treeHashes} from '../../scripts/shardfile-cache.mjs';
import {WORKTREE_GLOB, WORKTREES, isWorktreePath, worktreeWatchIgnored} from '../../scripts/worktree-ignore.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const PLANT = `${WORKTREES}/ds11-guard-${process.pid}-${Date.now().toString(36)}`;
const LINT_ERROR = 'export const zzGuard = (value: any) => { debugger; return value }\n';
const FILES = {
  'zz-guard.ts': LINT_ERROR,
  'src/client/engine/zz-guard.ts': LINT_ERROR,
  'scripts/zz-guard.mjs': 'debugger;\n',
  'test/zz-guard.test.ts': "import {expect, test} from 'vitest';\ntest('planted', () => { expect(1).toBe(2); });\n",
  'test/tooling/zz-guard.test.mjs': "import {expect, test} from 'vitest';\ntest('planted', () => { expect(1).toBe(2); });\n",
  'index.html': '<!doctype html><script type="module" src="./zz-entry.ts"></script>\n',
  'zz-entry.ts': "import 'zz-missing-package';\n",
  // Built at run time, so this file itself carries no secret-shaped string.
  'scripts/zz-secret.mjs': `export const key = '${['AKIA', 'IOSFODNN7', 'EXAMPLE'].join('')}';\n`,
};
const PLANTED = Object.keys(FILES).map(path => `${PLANT}/${path}`);

/** Every environment variable a parent Vitest run sets for its workers is dropped, so the child is a plain run. */
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST') && key !== 'TEST'));
/** @param {string} command @param {string[]} args */
const run = (command, args) => spawnSync(command, args, {cwd: ROOT, encoding: 'utf8', env, maxBuffer: 1 << 28, timeout: 60_000});
/** @param {string} text */
const seen = text => PLANTED.filter(path => text.includes(path) || text.includes(join(ROOT, path)));

/** @param {string} root @param {Record<string, string>} files */
function put(root, files) {
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), {recursive: true});
    writeFileSync(join(root, path), source);
  }
}

/** @type {string[]} */
const fixtures = [];
/** @param {Record<string, string>} files @param {string} [prefix] */
function fixture(files, prefix = 'worktree-ignore-') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  fixtures.push(root);
  put(root, files);
  return root;
}

beforeAll(() => put(join(ROOT, PLANT), FILES));
afterAll(() => {
  rmSync(join(ROOT, PLANT), {recursive: true, force: true});
  for (const root of fixtures.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('the shared ignore list', () => {
  test('names the root folder only', () => {
    expect(isWorktreePath('.worktrees')).toBe(true);
    expect(isWorktreePath('.worktrees/plan/src/a.ts')).toBe(true);
    expect(isWorktreePath('src/.worktrees/a.ts')).toBe(false);
    expect(isWorktreePath('.worktreesx/a.ts')).toBe(false);
    expect(WORKTREE_GLOB).toBe('.worktrees/**');
  });
  test('anchors the watcher pattern at its own root, so a worktree still watches its own files', () => {
    const [outer] = worktreeWatchIgnored('/a/re(po).x'), [inner] = worktreeWatchIgnored('/a/re(po).x/.worktrees/p');
    expect(outer.test('/a/re(po).x/.worktrees/p/src/a.ts')).toBe(true);
    expect(outer.test('/a/re(po).x/.worktrees')).toBe(true);
    expect(outer.test('/a/re(po).x/.worktreesx/a.ts')).toBe(false);
    expect(outer.test('/a/re(po)Ax/.worktrees/a.ts')).toBe(false);
    expect(inner.test('/a/re(po).x/.worktrees/p/src/a.ts')).toBe(false);
    expect(inner.test('/a/re(po).x/.worktrees/p/.worktrees/q/a.ts')).toBe(true);
  });
});

describe('the parent checkout never sees a planted worktree', () => {
  test('Git ignores it, so nothing of it can be staged for the secrets and size checks', () => {
    expect(run('git', ['check-ignore', '--', ...PLANTED]).stdout.trim().split('\n').sort()).toEqual([...PLANTED].sort());
    expect(seen(run('git', ['status', '--porcelain', '--untracked-files=all']).stdout)).toEqual([]);
    const staged = run('git', ['add', '--all', '--dry-run']);
    expect(staged.status).toBe(0);
    expect(seen(staged.stdout)).toEqual([]);
  });

  test("the kit lint (the whole root, pnpm lint:kit's own arguments) reports nothing from it", () => {
    // J329: one run per config, kit's on the root and src/'s on src/.
    const script = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts['lint:kit'];
    let files = 0;
    for (const command of script.split(' && ')) {
      const args = [...command.matchAll(/'([^']*)'|(\S+)/gu)].map(match => match[1] ?? match[2]).slice(1);
      expect(args[0]).toBe('scripts/lint-cli.mjs');
      const lint = run(process.execPath, [...args, '-f', 'json']);
      files += JSON.parse(lint.stdout).number_of_files;
      expect(seen(lint.stdout)).toEqual([]);
    }
    expect(files).toBeGreaterThan(0);
  });

  test('the game lint skips planted paths, and the root config ignores the folder even when named', () => {
    const game = run(process.execPath, ['scripts/lint-game.mjs', ...PLANTED]);
    expect(game.status).toBe(0);
    expect(seen(game.stdout + game.stderr)).toEqual([]);
    const named = run(process.execPath, ['scripts/lint-cli.mjs', '-c', '.oxlintrc.json', '-f', 'json', PLANT]);
    expect(named.stdout).toMatch(/No files found to lint/u);
    expect(JSON.parse(named.stdout.slice(named.stdout.indexOf('{'))).number_of_files).toBe(0);
  });

  test('a whole-root format check lists nothing from it', () => {
    const format = run(join(ROOT, 'node_modules/.bin/npr'), ['oxfmt', '-c', 'kit/.oxfmtrc.json', '--list-different', '.']);
    // --list-different exits 1 when some file differs; anything else, or any stderr, is a broken run.
    expect(format.error).toBeUndefined();
    expect([0, 1]).toContain(format.status);
    expect(format.stderr).toBe('');
    expect(format.stdout.split('\n').filter(Boolean).length).toBeGreaterThan(0);
    expect(seen(format.stdout + format.stderr)).toEqual([]);
  });

  test('Vitest discovers none of its tests', () => {
    const list = run(process.execPath, ['node_modules/vitest/vitest.mjs', 'list', '--filesOnly', '--json']);
    expect(list.status).toBe(0);
    const files = JSON.parse(list.stdout.slice(list.stdout.indexOf('[')));
    expect(files.length).toBeGreaterThan(0);
    expect(seen(list.stdout)).toEqual([]);
  });
});

describe('watchers and whole-root walkers', () => {
  /** Poll until `check` holds or `ms` pass. @param {() => boolean} check @param {number} ms */
  async function until(check, ms) {
    for (const started = Date.now(); !check() && Date.now() - started < ms;) await new Promise(done => setTimeout(done, 25));
    return check();
  }

  /**
   * Start Vite's real dev watcher on `root` with the shared ignore; the folders it watches, relative to `root`, once
   * it watches `src` and its folder set has held still for half a second. Linux's watcher walks the tree after `ready`,
   * so nothing here trusts `ready` alone.
   * @param {string} root @returns {Promise<string[]>}
   */
  async function watched(root) {
    const server = await createServer({configFile: false, root, logLevel: 'silent', appType: 'custom',
      server: {middlewareMode: true, ws: false, watch: {ignored: worktreeWatchIgnored(root)}}, optimizeDeps: {noDiscovery: true, include: []}});
    const folders = () => Object.keys(server.watcher.getWatched()).map(path => relative(root, path).replaceAll('\\', '/')).sort();
    try {
      server.watcher.add(root);
      expect(await until(() => folders().includes('src'), 10_000)).toBe(true);
      let last = folders().join('\n'), still = Date.now();
      await until(() => {
        const now = folders().join('\n');
        if (now !== last) { last = now; still = Date.now(); }
        return Date.now() - still >= 500;
      }, 10_000);
      return folders();
    } finally { await server.close(); }
  }

  test("Vite's dev watcher, with the shared ignore, never watches a nested worktree but watches its own tree", async () => {
    // A parenthesised root: chokidar normalizes backslashes, so a glob-escaped path would not match.
    const root = fixture({'index.html': '<!doctype html>\n', 'src/a.ts': 'export {};\n', '.worktrees/p/src/b.ts': 'export {};\n'}, 'worktree-ignore-(x)-');
    const folders = await watched(root);
    expect(folders).toContain('src');
    expect(folders.filter(path => isWorktreePath(path))).toEqual([]);
  });

  test('a worktree that holds the shared ignore still watches all of its own tree', async () => {
    const parent = fixture({'.worktrees/p/index.html': '<!doctype html>\n', '.worktrees/p/src/a.ts': 'export {};\n', '.worktrees/p/.worktrees/q/b.ts': 'export {};\n'});
    const folders = await watched(join(parent, '.worktrees/p'));
    expect(folders).toContain('src');
    expect(folders.filter(path => isWorktreePath(path))).toEqual([]);
  });

  test("the engine's Vite and Vitest configs use the shared ignore and an explicit dependency-scan input", () => {
    const vite = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8'), vitest = readFileSync(join(ROOT, 'vitest.config.ts'), 'utf8');
    expect(vite).toMatch(/watch: \{ ignored: worktreeWatchIgnored\(\) \}/u);
    // Vite 8 scans `build.rolldownOptions.input` when set and crawls every **/*.html only without it.
    expect(vite).toMatch(/input: \{ main: join\(process\.cwd\(\), 'index\.html'\)/u);
    expect(vite).not.toMatch(/optimizeDeps/u);
    expect(vitest).toMatch(/watch: \{ ignored: worktreeWatchIgnored\(\) \}/u);
    expect(vitest).toMatch(/exclude: \['\*\*\/node_modules\/\*\*', WORKTREE_GLOB,/u);
  });

  test("the shardfile cache's whole-root hash skips the folder", () => {
    const root = fixture({'src/a.ts': 'export {};\n', '.worktrees/p/src/a.ts': 'export {};\n', '.worktrees/p/out/big.bin': 'x'});
    const files = [...treeHashes(root).keys()];
    expect(files).toContain('src/a.ts');
    expect(files.filter(path => isWorktreePath(path))).toEqual([]);
  });
});
