// oxlint-disable-next-line import/no-nodejs-modules -- Prove exact staged and committed source policy in owned Git fixtures.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own and remove bounded source/output fixtures.
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep all fixture files under repository scratch.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Nested fixtures must not inherit the shared index.
import { env as processEnv } from 'node:process';
import { expect, test } from 'vitest';
import { GENERATED_SOURCE_POLICY, checkGeneratedSourceRevision, checkGeneratedSourceTree,
  generatedSourceIncreases, generatedSourcePolicy, sidelessPath } from '../scripts/generated-source.mjs';
import { unsortedPath } from '../lint/layer-exports.mjs';
import { commitCheckFailed } from '../scripts/precommit-jobs.mjs';
import { ignoredBy, precommitInputs } from '../scripts/precommit-inputs.mjs';

const old = 'src/shards/fixture/data/old.generated.json', source = 'a'.repeat(40);
const policy = (files: string[] = [old]) => generatedSourcePolicy({ schema: 'generated-source/1', source, files });
async function fixture(run: (root: string, git: (...args: string[]) => string, put: (file: string, text: string) => void) => void | Promise<void>): Promise<void> {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/generated-source-'));
  const env = Object.fromEntries(Object.entries(processEnv).filter(([key]) => !key.startsWith('GIT_')));
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, env, encoding: 'utf8' }).trim();
  const put = (file: string, text: string): void => { mkdirSync(resolve(root, file, '..'), { recursive: true }); writeFileSync(resolve(root, file), text); };
  try {
    git('init', '-q'); git('config', 'core.hooksPath', '/dev/null'); git('config', 'user.name', 'fixture'); git('config', 'user.email', 'fixture@example.invalid');
    put(GENERATED_SOURCE_POLICY, JSON.stringify(policy())); put(old, '{}');
    git('add', '.'); git('commit', '-qm', 'fixture'); await run(root, git, put);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('source debt is exact, canonical and shrinking without wildcard or dependency allowances', () => {
  expect(generatedSourceIncreases(policy(), policy([]))).toEqual([]);
  expect(generatedSourceIncreases(policy(), policy(['src/new.generated.ts']))).toHaveLength(1);
  expect(commitCheckFailed({ name: 'binary JSON', code: 124, timedOut: true, output: 'GENERATED-SOURCE src/new.generated.ts: refused' })).toBe(true);
  for (const file of ['src/../out/cache.bin', 'src/data/*', 'src/data/', 'src/sharddev/node_modules/dependency.js', old]) {
    expect(() => policy(file === old ? [old, old] : [file])).toThrow('policy');
  }
});

test.each(['test/fixtures/**', 'test/fixtures/'])('fixture-only commits respect ignore eligibility while ordinary source still requires typed lint (%s)', pattern => fixture(async (root, git, put) => {
  put('.oxlintrc.json', JSON.stringify({ignorePatterns:[pattern]}));
  put('test/fixtures/rows.ts', 'export const rows = [];'); git('add', '.');
  const missing = resolve(root, 'missing-oxlint');
  await expect(precommitInputs(root, missing)).resolves.toBeUndefined();
  put('test/fixtures-neighbour/checked.ts', 'export const checked = true;'); git('add', 'test/fixtures-neighbour/checked.ts');
  await expect(precommitInputs(root, missing)).rejects.toThrow('typed lint: refused');
}));

test('a source debt row follows its file across a side move and nowhere else', () => {
  const unmoved = 'src/game/shard/fixture.generated.ts', moved = 'src/server/game/shard/fixture.generated.ts';
  expect(generatedSourceIncreases(policy([unmoved]), policy([moved]))).toEqual([]);
  expect(generatedSourceIncreases(policy([moved]), policy(['src/client/game/shard/fixture.generated.ts']))).toEqual([]);
  expect(generatedSourceIncreases(policy([unmoved]), policy([unmoved, moved]))).toHaveLength(1);
  expect(generatedSourceIncreases(policy([unmoved]), policy(['src/server/game/shard/other.generated.ts']))).toHaveLength(1);
  expect(generatedSourceIncreases(policy([unmoved]), policy(['src/server/engine/shard/fixture.generated.ts']))).toHaveLength(1);
  for (const path of [moved, unmoved, 'src/sharddev/server/a.ts', 'src/cook/engine/b.ts', 'src/shards/client/c.ts']) expect(sidelessPath(path)).toBe(unsortedPath(path));
});

test('new staged generated files and headers refuse even when the working copy is clean', () => fixture((root,git, put) => {
  put('src/authored.ts', 'export const rows = [];'); put('src/rows.json', '{"rows":[]}'); git('add', 'src/authored.ts', 'src/rows.json');
  expect(checkGeneratedSourceRevision(root, ':', 'HEAD', ['src/authored.ts', 'src/rows.json'])).toEqual([]);
  const file = 'src/new.generated.ts', renamed = 'src/renamed.ts';
  put(file, 'export const rows = [];'); put(renamed, '// Generated by build-rows\nexport const rows = [];');
  git('add', file, renamed); put(file, ''); put(renamed, '');
  const failures = checkGeneratedSourceRevision(root, ':', 'HEAD', [file, renamed]);
  expect(failures).toHaveLength(2); expect(failures.join('\n')).toContain(renamed);
}));

test('absent outputs remain a completed-tree refusal and cannot grant themselves debt', () => fixture((root, git, put) => {
  const file = 'src/shards/fixture/data/rows.json', catalogue = 'scripts/source-generation-outputs.json';
  put(catalogue, JSON.stringify({ producers: { 'scripts/fixture.mjs': [old, file, 'out/fixture/body.bin'] } })); git('add', catalogue);
  expect(checkGeneratedSourceRevision(root, ':', 'HEAD', [catalogue])).toEqual([]);
  expect(checkGeneratedSourceTree(root)).toEqual([expect.stringContaining(file)]);
  put(GENERATED_SOURCE_POLICY, JSON.stringify(policy([old, file]))); git('add', GENERATED_SOURCE_POLICY);
  expect(checkGeneratedSourceRevision(root, ':', 'HEAD', [catalogue, GENERATED_SOURCE_POLICY])).toEqual([expect.stringContaining('allowance grew')]);
}));

test('committed checks ignore dirty output catalogues and a deleted policy stays a refusal', () => fixture((root, git, put) => {
  put('scripts/source-generation-outputs.json', JSON.stringify({ producers: { 'scripts/fixture.mjs': [old] } })); git('add', '.'); git('commit', '-qm', 'catalogue');
  put('scripts/source-generation-outputs.json', JSON.stringify({ producers: { 'scripts/fixture.mjs': ['src/poison.generated.ts'] } }));
  expect(checkGeneratedSourceRevision(root, 'HEAD', 'HEAD^', ['scripts/source-generation-outputs.json'])).toEqual([]);
  unlinkSync(resolve(root, GENERATED_SOURCE_POLICY)); git('add', GENERATED_SOURCE_POLICY);
  expect(checkGeneratedSourceRevision(root, ':', 'HEAD', [GENERATED_SOURCE_POLICY])).toEqual([expect.stringContaining('policy deleted')]);
}));

test('post-generation checks see unexpected ignored bytes without treating authored files or dependencies as generated', () => fixture((root, _git, put) => {
  put('.gitignore', 'src/cache/\nsrc/sdk/node_modules/\n');
  put('src/authored.ts', 'export const value = 1;'); put('src/authored.json', '{"rows":[]}');
  put('src/sharddev/node_modules/fixture/index.js', 'dependency');
  expect(checkGeneratedSourceTree(root)).toEqual([]);
  put('src/cache/opaque.bin', 'new generated bytes');
  expect(checkGeneratedSourceTree(root)).toEqual([expect.stringContaining('src/cache/opaque.bin')]);
  unlinkSync(resolve(root, 'src/cache/opaque.bin'));
  put('src/cache/odd[0].bin', 'an invalid allowance path still cannot hide a generated output');
  expect(checkGeneratedSourceTree(root)).toEqual([expect.stringContaining('src/cache/odd[0].bin')]);
}));

test('sealed build manifests expose newly produced source files without a Git checkout', () => fixture((root, git, put) => {
  put('.push-tracked.json', JSON.stringify(git('ls-files').split('\n')));
  put('src/cache/opaque.bin', 'unregistered output');
  expect(checkGeneratedSourceTree(root)).toEqual([expect.stringContaining('src/cache/opaque.bin')]);
}));

test('G656 reviewed app source outputs stay allowed separately from shard output debt', () => fixture((root, git, put) => {
  const file = 'src/game/table.generated.ts';
  put('lint/generated-import-debt.json', JSON.stringify({ sources: [file] })); put(file, '// Generated by app tables\nexport const rows = [];');
  git('add', '.');
  expect(checkGeneratedSourceRevision(root, ':', 'HEAD', [file])).toEqual([]);
  expect(checkGeneratedSourceTree(root)).toEqual([]);
}));


test('pre-commit reads a bare ignored folder at any depth, as oxlint does', () => {
  expect(ignoredBy('scripts/docs/sdk-schemas.mjs', 'docs/')).toBe(true);
  expect(ignoredBy('docs/note.ts', 'docs/')).toBe(true);
  expect(ignoredBy('scripts/fixtures/x.ts', 'test/fixtures/')).toBe(false);
  expect(ignoredBy('test/fixtures/x.ts', 'test/fixtures/')).toBe(true);
  expect(ignoredBy('src/x.generated.ts', '**/*.generated.*')).toBe(true);
});
