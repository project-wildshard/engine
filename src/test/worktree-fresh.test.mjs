// J505 (QA-FEEDBACK-2026-11-23-b): a canonical checkout behind origin/main runs origin/main's worktree tool, never its
// own stale copy (2026-11-23: the canonical engine sat 490 commits behind and still capped worktrees at 6).
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {afterEach, expect, test} from 'vitest';
import {WORKTREE_TOOL, freshTool, localImports} from '../scripts/worktree-fresh.mjs';

const REPO = resolve(import.meta.dirname, '../..');
/** @type {string[]} */
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}); });
const ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && !key.startsWith('VITEST'))),
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
const tool = (/** @type {number} */ cap) => `console.log('worktree cap ${String(cap)}');\n`;

/** origin and a canonical clone at the same commit, the tool capping at 6 */
function repos() {
  mkdirSync(join(REPO, 'tmp'), {recursive: true});
  const base = mkdtempSync(join(REPO, 'tmp', 'worktree-fresh-'));
  roots.push(base);
  const origin = join(base, 'origin.git'), seed = join(base, 'seed'), canonical = join(base, 'engine');
  git(base, ['init', '-q', '--bare', '-b', 'main', origin]);
  git(base, ['init', '-q', '-b', 'main', seed]);
  put(seed, 'src/scripts/.kit/worktree.mjs', tool(6));
  put(seed, '.gitignore', '/tmp/\n');
  git(seed, ['add', '.']);
  git(seed, ['commit', '-q', '-m', 'cap 6']);
  git(seed, ['remote', 'add', 'origin', origin]);
  git(seed, ['push', '-q', 'origin', 'main']);
  git(base, ['clone', '-q', origin, canonical]);
  return {seed, canonical};
}

test('WORKTREE_TOOL names every file worktree.mjs runs, through every local import', () => {
  const seen = new Set(), queue = ['src/scripts/.kit/worktree.mjs'];
  while (queue.length > 0) {
    const file = queue.shift() ?? '';
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...localImports(REPO, file));
  }
  expect([...seen].toSorted()).toEqual([...WORKTREE_TOOL].toSorted());
});

test('a canonical checkout behind origin/main runs origin/main\'s tool, not its own', () => {
  const {seed, canonical} = repos();
  const self = join(canonical, 'src/scripts/.kit/worktree.mjs');
  expect(freshTool({canonical, self, env: ENV})).toEqual({run: 'here', why: 'origin/main\'s copy'});
  put(seed, 'src/scripts/.kit/worktree.mjs', tool(10));
  git(seed, ['commit', '-q', '-am', 'cap 10']);
  git(seed, ['push', '-q', 'origin', 'main']);
  const plan = freshTool({canonical, self, env: ENV});
  expect(plan.run).toBe('fresh');
  if (plan.run !== 'fresh') return;
  expect(plan.stale).toEqual(['src/scripts/.kit/worktree.mjs']);
  expect(plan.sha).toBe(git(seed, ['rev-parse', 'HEAD']));
  expect(readFileSync(plan.script, 'utf8')).toBe(tool(10));
  expect(spawnSync(process.execPath, [plan.script], {encoding: 'utf8'}).stdout).toBe('worktree cap 10\n');
  // the canonical checkout itself is left as it was: its own copy still says 6
  expect(readFileSync(self, 'utf8')).toBe(tool(6));
  // a second run reuses the export
  const again = freshTool({canonical, self, env: ENV});
  expect(again.run === 'fresh' && again.script).toBe(plan.script);
});

test('the relaunched copy and another repo\'s tool run as they are', () => {
  const {seed, canonical} = repos();
  put(seed, 'src/scripts/.kit/worktree.mjs', tool(10));
  git(seed, ['commit', '-q', '-am', 'cap 10']);
  git(seed, ['push', '-q', 'origin', 'main']);
  const self = join(canonical, 'src/scripts/.kit/worktree.mjs');
  expect(freshTool({canonical, self, env: {...ENV, WS_WORKTREE_FRESH: '1'}}).run).toBe('here');
  expect(freshTool({canonical, self: join(REPO, 'src/scripts/.kit/worktree.mjs'), env: ENV})).toEqual({run: 'here', why: 'a tool from another repo'});
});
