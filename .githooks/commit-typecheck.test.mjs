// WL20: the commit typecheck sees tracked and staged files, never another
// lane's untracked scratch. Drives the real tsc on a tiny composite project.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commitTypecheck, tscConfig, typecheckSegments } from './commit-typecheck.mjs';
import { ENV } from './test-helpers.mjs';

const ENGINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const TSC = join(ENGINE, 'node_modules', '@typescript', 'typescript6', 'bin', 'tsc6');
const roots = [];
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  mkdirSync(join(ENGINE, 'tmp'), { recursive: true });
  const root = mkdtempSync(join(ENGINE, 'tmp', 'commit-typecheck-'));
  roots.push(root);
  const write = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', env: ENV });
  git('init', '-q', '-b', 'main');
  write('package.json', JSON.stringify({ scripts: { 'typecheck:lib': `node ${TSC} -b tsconfig.json`, typecheck: 'pnpm typecheck:lib' } }));
  write('.gitignore', 'out/\n.tsc-layers/\n');
  write('tsconfig.json', JSON.stringify({ files: [], references: [{ path: './lib' }] }));
  write('lib/tsconfig.json', JSON.stringify({
    compilerOptions: { composite: true, allowJs: true, checkJs: true, strict: true, declaration: true, emitDeclarationOnly: true, outDir: '../out', module: 'nodenext', moduleResolution: 'nodenext', target: 'es2022', types: [] },
    include: ['*.mjs'],
  }));
  write('lib/a.mjs', 'export const a = 1;\n');
  git('add', '.');
  return { root, write, git, check: () => commitTypecheck(root, { env: ENV, stdio: 'pipe' }) };
}

describe('commit typecheck (WL20)', () => {
  test('expands pnpm scripts and finds the tsc config', () => {
    const segments = typecheckSegments({ kit: 'npr tsc -p src/tsconfig.json', typecheck: 'pnpm kit && pnpm gen && npr tsc -b layers.json --builders 8', gen: 'node gen.mjs' });
    assert.deepEqual(segments, ['npr tsc -p src/tsconfig.json', 'node gen.mjs', 'npr tsc -b layers.json --builders 8']);
    assert.deepEqual(tscConfig(segments[2]), [3, 'layers.json']);
    assert.equal(tscConfig(segments[1]), null);
  });
  test('a broken untracked file does not fail; the same file staged does', { skip: !existsSync(TSC) && 'no tsc' }, () => {
    const { write, git, check } = fixture();
    assert.equal(check(), 0, 'clean tree passes');
    write('lib/scratch.mjs', 'const x = 1;\nx.nope();\n');
    assert.equal(check(), 0, 'untracked scratch is not in the commit');
    git('add', 'lib/scratch.mjs');
    assert.notEqual(check(), 0, 'staged broken file fails');
  });
  test('a tracked error still fails beside untracked files', { skip: !existsSync(TSC) && 'no tsc' }, () => {
    const { write, check } = fixture();
    write('lib/scratch.mjs', 'export const s = 1;\n');
    write('lib/a.mjs', 'export const a = 1;\na.nope();\n');
    assert.notEqual(check(), 0);
  });
});
