// WL20: the commit typecheck sees tracked and staged files, never another
// lane's untracked scratch. Drives the real tsc on a tiny composite project.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coldSegment, commitTypecheck, tscConfig, typecheckSegments } from './commit-typecheck.mjs';
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

// Meta QA 11-25 row 104: the hook refused 17 errors CI never saw. A warm
// `tsc -b` replays the diagnostics its buildinfo holds for unchanged files;
// CI builds cold. The hook confirms a red build from cold before it refuses.
describe('commit typecheck agrees with CI (QA 11-25 row 104)', () => {
  test('only a build segment gets a cold confirm', () => {
    assert.equal(coldSegment('npr tsc -b tsconfig.layers.json --builders 8'), 'npr tsc -b tsconfig.layers.json --builders 8 --force');
    assert.equal(coldSegment('npr tsc -p src/tsconfig.json'), null);
    assert.equal(coldSegment('node src/scripts/gen.mjs --inputs-only'), null);
    assert.equal(coldSegment('npr tsc -b layers.json --force'), null);
  });
  test('a stale error in the warm cache passes; a real one still fails', { skip: !existsSync(TSC) && 'no tsc' }, () => {
    const { root, write, git, check } = fixture();
    assert.equal(check(), 0, 'clean tree builds the cache');
    const info = join(root, 'out', 'tsconfig.tsbuildinfo');
    const build = JSON.parse(readFileSync(info, 'utf8'));
    const id = build.fileNames.findIndex((name) => name.endsWith('lib/a.mjs')) + 1;
    build.semanticDiagnosticsPerFile = [[id, [{ start: 13, length: 1, code: 2571, category: 1, messageText: 'Object is of type unknown (stale).' }]]];
    build.errors = true;
    writeFileSync(info, JSON.stringify(build));
    const warm = () => spawnSync(process.execPath, [TSC, '-b', 'tsconfig.json'], { cwd: root, encoding: 'utf8', env: ENV });
    assert.match(warm().stdout, /stale/u, 'the warm build replays the cached error');
    assert.equal(check(), 0, 'the cold confirm is clean, so the hook passes');
    assert.equal(warm().status, 0, 'and the cache is healed');
    write('lib/a.mjs', 'export const a = 1;\na.nope();\n');
    git('add', 'lib/a.mjs');
    assert.notEqual(check(), 0, 'a real error fails warm and cold');
  });
  test('the hook, the push gate and CI typecheck the same configs', async () => {
    const scripts = JSON.parse(readFileSync(join(ENGINE, 'package.json'), 'utf8')).scripts;
    const configs = (segments) => segments.map(tscConfig).filter((found) => found !== null).map((found) => found[1]).sort();
    const hook = configs(typecheckSegments(scripts));
    assert.ok(hook.includes('tsconfig.layers.json'), `the typecheck script builds the layers: ${hook.join(', ')}`);
    // CI static (code mode) runs the very script the commit hook expands.
    assert.match(readFileSync(join(ENGINE, 'src', 'scripts', 'ci-static.sh'), 'utf8'), /\ncheck typecheck pnpm typecheck\n|"\$mode" = code \]; then check typecheck pnpm typecheck;/u);
    assert.match(readFileSync(join(ENGINE, '.githooks', 'run-checks.mjs'), 'utf8'), /commit-typecheck\.mjs/u, 'the commit lane runs this typecheck');
    // The push gate spells its typecheck out; it must name the same configs.
    const { staticChecks } = await import('./push-checks.mjs');
    const gate = staticChecks().find((check) => check.name.startsWith('typecheck'));
    assert.ok(gate !== undefined, 'the push gate has a typecheck');
    const gateSegments = gate.commands.flatMap((command) => {
      const at = command.indexOf('run');
      if (command[0] === 'pnpm' && at >= 0) return typecheckSegments(scripts, command.at(-1));
      return [command.slice(command[0] === 'pnpm' && command[1] === 'exec' ? 2 : 0).join(' ')];
    });
    assert.deepEqual(configs(gateSegments), hook, 'push gate typecheck configs drifted from the typecheck script');
  });
});
