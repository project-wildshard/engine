// oxlint-disable-next-line import/no-nodejs-modules -- Exercise ordinary commits only in an owned tiny Git repository.
import { execFileSync, spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Copy only the checked source tools and remove the owned fixture.
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep every fixture beneath repository tmp.
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { linkNodeModules } from '../scripts/link-node-modules.mjs';

test('source staging uses candidate inputs and preserves loose files and peer stages', () => {
  mkdirSync('tmp', { recursive: true });
  const repository = resolve('.'), root = mkdtempSync(resolve('tmp', 'source-stage-commit-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && !key.startsWith('WS_COMMIT_') && !['WS_GIT_CHECK_ROOT', 'WS_GIT_CHECK_REV', 'WS_GIT_NATIVE_ROOT'].includes(key)));
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const put = (file: string, text: string): void => {
    mkdirSync(resolve(root, file, '..'), { recursive: true }); writeFileSync(resolve(root, file), text);
  };
  const run = (patch: string) => spawnSync('scripts/commit.sh', ['--patch', patch, 'fix(fixture): preserve candidate sources', '--', 'src/input.json'], { cwd: root, env, encoding: 'utf8', timeout: 15_000 });
  try {
    git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'core.hooksPath', '/dev/null'); git('config', 'commit.gpgsign', 'false');
    put('.gitignore', 'node_modules/\ntmp/\n');
    mkdirSync(resolve(root, 'scripts'));
    for (const file of ['commit.sh', 'committed-source-tables.mjs', 'git-source-view.mjs', 'gen-source.mjs'])
      copyFileSync(resolve(repository, 'scripts', file), resolve(root, 'scripts', file));
    chmodSync(resolve(root, 'scripts/commit.sh'), 0o755);
    put('scripts/source-generators.mjs', `import {readFileSync} from 'node:fs';import {resolve} from 'node:path';
export const SOURCE_GENERATORS=[{id:'fixture',outputs:['src/table.ts','src/budget.json'],inputs:['src/input.json'],committed:true,generate:async root=>{
 const data=JSON.parse(readFileSync(resolve(root,'src/input.json'),'utf8'));
 if(typeof data.value!=='number')throw Error('Invalid fixture source value');
 return {'src/table.ts':'export const value='+data.value+';\\n','src/budget.json':JSON.stringify({startedAt:process.env.WS_COMMIT_STARTED_AT})};
}}];export function selectSourceGenerators(paths){return paths.some(path=>path==='src/input.json'||path==='src/table.ts')?SOURCE_GENERATORS:[];}`);
    put('src/input.json', '{"value":1}\n'); put('src/table.ts', 'export const value=1;\n'); put('src/budget.json', '{}'); put('peer.txt', 'original\n');
    put('.githooks/pre-commit', `#!/usr/bin/env python3
import json, os, subprocess
if os.getenv('WS_COMMIT_WRAPPER') == '1':
    row=json.loads(subprocess.check_output(['git','show',':src/budget.json']))
    assert int(os.environ['WS_COMMIT_STARTED_AT']) > int(row['startedAt']), 'source work consumed ordinary hook budget'
`);
    chmodSync(resolve(root, '.githooks/pre-commit'), 0o755);
    git('add', '.'); git('commit', '-qm', 'fixture');
    git('config', 'core.hooksPath', '.githooks');
    linkNodeModules(repository, root);
    put('src/input.json', '{"value":7}\n'); put('src/table.ts', 'foreign loose output\n'); put('peer.txt', 'peer stage\n');
    git('add', 'src/input.json', 'peer.txt');
    put('tmp/own.patch', '--- a/src/input.json\n+++ b/src/input.json\n@@ -1 +1 @@\n-{"value":1}\n+{"value":2}\n');
    const result = run(resolve(root, 'tmp/own.patch'));
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(git('show', 'HEAD:src/input.json')).toBe('{"value":2}');
    expect(git('show', 'HEAD:src/table.ts')).toBe('export const value=2;');
    expect(git('show', 'HEAD:peer.txt')).toBe('original');
    expect(git('show', ':src/input.json')).toBe('{"value":7}');
    expect(git('show', ':peer.txt')).toBe('peer stage');
    expect(readFileSync(resolve(root, 'src/input.json'), 'utf8')).toBe('{"value":7}\n');
    expect(readFileSync(resolve(root, 'src/table.ts'), 'utf8')).toBe('foreign loose output\n');
    const before = git('rev-parse', 'HEAD'), index = readFileSync(resolve(root, '.git/index'));
    put('tmp/refused.patch', '--- a/src/input.json\n+++ b/src/input.json\n@@ -1 +1 @@\n-{"value":2}\n+{"value":"invalid"}\n');
    const refused = run(resolve(root, 'tmp/refused.patch'));
    expect(refused.status).not.toBe(0); expect(refused.stderr).toContain('Invalid fixture source value');
    expect(git('rev-parse', 'HEAD')).toBe(before); expect(readFileSync(resolve(root, '.git/index'))).toEqual(index);
    expect(readFileSync(resolve(root, 'src/table.ts'), 'utf8')).toBe('foreign loose output\n');
    // Canonical in-memory staging must retain ordinary Git's ignore refusal
    // when a new committed-table row forgot its matching ignore correction.
    put('scripts/source-generators.mjs', readFileSync(resolve(root, 'scripts/source-generators.mjs'), 'utf8').replaceAll('src/table.ts', 'src/ignored.ts'));
    put('.gitignore', 'node_modules/\ntmp/\nsrc/ignored.ts\n');
    git('add', 'scripts/source-generators.mjs', '.gitignore');
    git('commit', '-qm', 'fixture ignored producer', '--', 'scripts/source-generators.mjs', '.gitignore');
    const ignoredHead = git('rev-parse', 'HEAD'), ignoredIndex = readFileSync(resolve(root, '.git/index'));
    put('tmp/ignored.patch', '--- a/src/input.json\n+++ b/src/input.json\n@@ -1 +1 @@\n-{"value":2}\n+{"value":3}\n');
    const ignored = run(resolve(root, 'tmp/ignored.patch'));
    expect(ignored.status).not.toBe(0); expect(ignored.stderr).toContain('generated sources are ignored: src/ignored.ts');
    expect(git('rev-parse', 'HEAD')).toBe(ignoredHead); expect(readFileSync(resolve(root, '.git/index'))).toEqual(ignoredIndex);
    expect(() => readFileSync(resolve(root, 'src/ignored.ts'))).toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
