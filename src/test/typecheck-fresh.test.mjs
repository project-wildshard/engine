// Meta QA 11-25 row 53: opus-trailer's 5068a7365 added an untyped src/scripts/trailer/capture.mjs, main-push's gate called
// the typecheck green on a warm tsc -b cache, and main's cold CI went red (run 45662209325). Drives the real tsc (the
// one `npr tsc` runs in the gate) on a tiny composite project.
import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterAll, afterEach, expect, test} from 'vitest';
import {scratchDir} from '../scripts/.kit/scratch-dir.mjs';
import {freshen, freshenPush, pushedPaths} from '../scripts/typecheck-fresh.mjs';

const ENGINE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const task = process.env.WS_LANE_NAME ?? `test-typecheck-fresh-${process.pid}`;
const existed = existsSync(resolve(ENGINE, 'tmp', task));
const parent = scratchDir(task, 'typecheck-fresh fixture', {env: {...process.env, WS_LANE_NAME: task}});
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}); });
afterAll(() => { if (!existed && readdirSync(parent).every(name => name === '.owner')) rmSync(parent, {recursive: true}); });

const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const TSC = execFileSync(join(ENGINE, 'node_modules', '.bin', 'npr'), ['which', 'tsc'], {cwd: ENGINE, encoding: 'utf8', env}).trim().split('\n').at(-1) ?? '';

function fixture() {
  const root = mkdtempSync(join(parent, 'repo-')); roots.push(root);
  const write = (path, text) => { mkdirSync(dirname(join(root, path)), {recursive: true}); writeFileSync(join(root, path), text); };
  const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', env: {...env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t'}}).trim();
  git('init', '-q', '-b', 'main');
  write('.gitignore', '.tsc-layers/\n');
  write('tsconfig.json', JSON.stringify({files: [], references: [{path: './src/scripts'}]}));
  write('src/scripts/tsconfig.json', JSON.stringify({compilerOptions: {composite: true, allowJs: true, checkJs: true, strict: true, noEmit: true,
    module: 'nodenext', moduleResolution: 'nodenext', target: 'es2022', types: [], tsBuildInfoFile: '../../.tsc-layers/scripts.tsbuildinfo'}, include: ['**/*.mjs']}));
  write('src/scripts/typed.mjs', '/** @param {number} a */\nexport const twice = a => a * 2;\n');
  git('add', '.'); git('commit', '-q', '--no-verify', '-m', 'base');
  const tsc = () => spawnSync(TSC, ['-b', 'tsconfig.json'], {cwd: root, encoding: 'utf8', env});
  return {root, write, git, tsc};
}

test('a push adding an untyped .mjs script is refused, even when the warm tsc -b cache predates the file', () => {
  expect(existsSync(TSC)).toBe(true);
  const {root, write, git, tsc} = fixture();
  const base = git('rev-parse', 'HEAD');
  expect(tsc().status).toBe(0);
  // The script is older than the cache, as when the cache was written while it was still untracked (the commit lane's
  // overlay drops untracked files) and the gate copy cloned both with their mtimes. TypeScript 7.0.2's tsc -b then
  // calls the project up to date and reports nothing (checked by hand for this row; not asserted, so a TypeScript
  // upgrade that notices new roots does not turn this test red).
  write('src/scripts/trailer/capture.mjs', 'export function shot(k, d) {\n  return k + d;\n}\n');
  const old = new Date(Date.now() - 3_600_000);
  utimesSync(join(root, 'src/scripts/trailer/capture.mjs'), old, old);
  utimesSync(join(root, 'src/scripts/trailer'), old, old);
  utimesSync(join(root, 'src/scripts'), old, old);
  git('add', 'src/scripts/trailer/capture.mjs'); git('commit', '-q', '--no-verify', '-m', 'add capture');
  const head = git('rev-parse', 'HEAD');
  expect(statSync(join(root, 'src/scripts/trailer/capture.mjs')).mtimeMs).toBeLessThan(statSync(join(root, '.tsc-layers/scripts.tsbuildinfo')).mtimeMs);

  expect(freshenPush(`refs/heads/main ${head} refs/heads/main ${base}`, root)).toContain('1 pushed file(s)');
  const after = tsc();
  expect(after.status).not.toBe(0);
  expect(after.stdout + after.stderr).toMatch(/capture\.mjs\(1,\d+\): error TS7006/u);
});

test('the push range names added and changed files, never deleted ones, and skips a new ref', () => {
  const {root, write, git} = fixture();
  const base = git('rev-parse', 'HEAD');
  write('src/scripts/new.mjs', 'export const n = 1;\n');
  write('src/scripts/typed.mjs', 'export const twice = 2;\n');
  write('src/scripts/gone.mjs', 'export const g = 1;\n');
  git('add', '.'); git('commit', '-q', '--no-verify', '-m', 'mid');
  const mid = git('rev-parse', 'HEAD');
  git('rm', '-q', 'src/scripts/gone.mjs'); git('commit', '-q', '--no-verify', '-m', 'drop');
  const head = git('rev-parse', 'HEAD');
  expect(pushedPaths(`refs/heads/main ${head} refs/heads/main ${base}`, root)).toEqual(['src/scripts/new.mjs', 'src/scripts/typed.mjs']);
  expect(pushedPaths(`refs/heads/main ${mid} refs/heads/main ${base}`, root)).toEqual(['src/scripts/gone.mjs', 'src/scripts/new.mjs', 'src/scripts/typed.mjs']);
  expect(pushedPaths(`refs/heads/plan/x ${head} refs/heads/plan/x ${'0'.repeat(40)}`, root)).toEqual([]);
  expect(pushedPaths(undefined, root)).toEqual([]);
  // A path the push names but the copy lacks is skipped, not an error.
  expect(freshen(root, ['src/scripts/new.mjs', 'src/scripts/gone.mjs', 'src/scripts'])).toBe(1);
});

test('the gate freshens the push before its typecheck runs', () => {
  const source = readFileSync(join(ENGINE, '.githooks/push-checks.mjs'), 'utf8');
  const fresh = source.indexOf('freshenPush(split?planBaseRefs(env.WS_PUSH_REFS):env.WS_PUSH_REFS'), generated = source.indexOf("name:'gen:inputs'", fresh);
  expect(fresh).toBeGreaterThan(0);
  expect(generated).toBeGreaterThan(fresh);
  expect(source.indexOf('...staticChecks()', fresh)).toBeGreaterThan(fresh);
});
