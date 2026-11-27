// oxlint-disable-next-line import/no-nodejs-modules -- Check the actual source gate in an owned Git repository.
import { execFileSync, spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixtures contain only tiny checked scripts and are removed.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep isolated fixtures beneath repository tmp.
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { linkNodeModules } from '../src/scripts/link-node-modules.mjs';

test('the source gate refuses stale committed tables even after generation repairs them', () => {
  mkdirSync('tmp', { recursive: true });
  const repository = resolve('.'), root = mkdtempSync(resolve('tmp', 'committed-source-tables-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && !['WS_GIT_CHECK_ROOT', 'WS_GIT_CHECK_REV', 'WS_GIT_NATIVE_ROOT'].includes(key)));
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const put = (file: string, text: string): void => {
    mkdirSync(resolve(root, file, '..'), { recursive: true }); writeFileSync(resolve(root, file), text);
  };
  const run = (tree: string) => spawnSync(process.execPath, ['src/scripts/committed-source-tables.mjs', '--check', `--tree=${tree}`], { cwd: root, env, encoding: 'utf8', timeout: 10_000 });
  try {
    git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'core.hooksPath', '/dev/null'); git('config', 'commit.gpgsign', 'false');
    put('.gitignore', 'node_modules/\ntmp/\n'); mkdirSync(resolve(root, 'src', 'scripts'), { recursive: true });
    for (const file of ['committed-source-tables.mjs', 'git-source-view.mjs', 'gen-source.mjs'])
      copyFileSync(resolve(repository, 'src', 'scripts', file), resolve(root, 'src', 'scripts', file));
    const producer = `import {readFileSync} from 'node:fs';import {resolve} from 'node:path';
export const SOURCE_GENERATORS=[{id:'fixture',outputs:['src/table.ts'],inputs:['src/input.json'],committed:true,
generate:async root=>({'src/table.ts':'export const value='+JSON.parse(readFileSync(resolve(root,'src/input.json'),'utf8')).value+';\\n'})}];
export function selectSourceGenerators(){return SOURCE_GENERATORS;}`;
    put('src/scripts/source-generators.mjs', producer); put('src/input.json', '{"value":1}'); put('src/table.ts', 'export const value=1;\n');
    git('add', '.'); git('commit', '-qm', 'fixture'); linkNodeModules(repository, root);
    const initial = git('rev-parse', 'HEAD');
    put('src/input.json', '{"value":999}'); put('src/scripts/source-generators.mjs', 'throw Error("loose producer poison");');
    const good = run(initial); expect(good.status, good.stdout + good.stderr).toBe(0);
    put('src/input.json', '{"value":2}'); put('src/scripts/source-generators.mjs', producer);
    git('add', 'src/input.json'); git('commit', '-qm', 'fixture stale source');
    const stale = git('rev-parse', 'HEAD');
    // Simulate generation having already repaired the stale checked-in output.
    put('src/table.ts', 'export const value=2;\n'); put('src/input.json', '{"value":1}');
    put('src/scripts/source-generators.mjs', 'throw Error("loose producer poison");');
    const index = readFileSync(resolve(root, '.git/index')), refused = run(stale);
    expect(refused.status).toBe(1); expect(refused.stderr).toContain('Committed source table is stale: src/table.ts');
    expect(readFileSync(resolve(root, '.git/index'))).toEqual(index);
    expect(readFileSync(resolve(root, 'src/table.ts'), 'utf8')).toBe('export const value=2;\n');
    git('add', 'src/table.ts'); git('commit', '-qm', 'fixture repaired table', '--', 'src/table.ts');
    const repaired = git('rev-parse', 'HEAD'); put('src/table.ts', 'actual generated poison');
    const actual = run(repaired);
    expect(actual.status).toBe(1); expect(actual.stderr).toContain('Committed source output differs: src/table.ts');
    expect(readFileSync(resolve(root, 'src/table.ts'), 'utf8')).toBe('actual generated poison');
    put('src/table.ts', 'export const value=2;\n');
    const accepted = run(repaired); expect(accepted.status, accepted.stdout + accepted.stderr).toBe(0);
    expect(readFileSync(resolve(root, 'src/scripts/source-generators.mjs'), 'utf8')).toContain('loose producer poison');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// QA 11-26 row 33: the boot publication facts file had no writer, only a proof a fixture ran read it, and half its rows
// named files no build has. It is retired with that proof and the --after-publication mode; nothing may name them again.
test('nothing names the retired boot publication facts, their proof or the after-publication mode', () => {
  const tracked = execFileSync('git', ['ls-files', '-z', '--', 'src', 'test', 'package.json', '.github', 'vite.config.ts'], { encoding: 'utf8' })
    .split('\0').filter(file => file !== '' && file !== 'test/committed-source-tables.test.ts' && !file.startsWith('test/fixtures/ci/'));
  const retired = ['boot-publication.generated.json', 'boot-publication-proof', '--after-publication', 'publishBootPublication', 'readBootPublication'];
  const named = tracked.flatMap(file => { const text = readFileSync(file, 'utf8'); return retired.filter(word => text.includes(word)).map(word => `${file}: ${word}`); });
  expect(named).toEqual([]);
});
