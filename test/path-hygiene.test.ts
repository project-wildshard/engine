// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the real CLI against owned source fixtures.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixtures stay under the repository scratch root.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the CLI before changing its fixture working directory.
import { dirname, resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Use the test worker's Node runtime for the subprocess.
import { execPath } from 'node:process';
import { expect, test } from 'vitest';
import { checkShardLayout, checkShards } from '../scripts/check-shards.mjs';

test('ownership declaration suffixes preserve the module existence check', () => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp', 'path-hygiene-'));
  const put = (path: string, content: string): void => {
    mkdirSync(dirname(resolve(root, path)), { recursive: true });
    writeFileSync(resolve(root, path), content);
  };
  const run = (): ReturnType<typeof spawnSync> => spawnSync(execPath, [resolve('scripts/check-paths.mjs')], { cwd: root, encoding: 'utf8' });
  try {
    put('src/live.ts', 'export const live = 1;');
    put('scripts/shard-components.mjs', "const owner = 'src/live.ts#live';");
    put('scripts/documented.py', '"""A retired path: src/deleted.ts"""\npattern = r"test/scripts/[^/]+\\.test\\.ts"\n');
    expect(run().status).toBe(0);
    put('scripts/shard-components.mjs', "const owner = 'src/deleted.ts#live';");
    expect(run().status).toBe(1);
    put('scripts/shard-components.mjs', "const owner = 'src/live.ts#live';");
    put('scripts/consumer.py', "source = r'test/missing.ts'\n");
    expect(run().status).toBe(1);
    put('scripts/consumer.py', '');
    put('scripts/consumer.mjs', "const source = 'src/missing.ts';");
    expect(run().status).toBe(1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a logical src/format label is checked where the installed package holds it', () => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp', 'path-hygiene-'));
  const put = (path: string, content: string): void => {
    mkdirSync(dirname(resolve(root, path)), { recursive: true });
    writeFileSync(resolve(root, path), content);
  };
  const run = (): ReturnType<typeof spawnSync> => spawnSync(execPath, [resolve('scripts/check-paths.mjs')], { cwd: root, encoding: 'utf8' });
  try {
    put('node_modules/@wildshard/format/src/format/live.ts', 'export const live = 1;');
    put('scripts/shard-components.mjs', "const owner = 'src/format/live.ts#live';");
    expect(run().status).toBe(0);
    put('scripts/shard-components.mjs', "const owner = 'src/format/gone.ts#live';");
    expect(run().status).toBe(1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Python dynamic/regex strings are not bare tokens while real Python and shell literals stay strict', () => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp', 'path-lexing-'));
  const put = (path: string, content: string): void => {
    mkdirSync(dirname(resolve(root, path)), { recursive: true });
    writeFileSync(resolve(root, path), content);
  };
  const run = (): ReturnType<typeof spawnSync> => spawnSync(execPath, [resolve('scripts/check-paths.mjs')], { cwd: root, encoding: 'utf8' });
  try {
    put('src/live.ts', 'export const live = 1;');
    put('scripts/paths.py', `layer = "game"
pattern = r"^src/shards/[a-z0-9_-]+/assets/"
source = f"src/{layer}/package.json"
upper = F"src/{layer}/value.ts"
literal = "src/live.ts"
`);
    put('scripts/paths.sh', 'cat src/live.ts\n');
    expect(run().status).toBe(0);
    put('scripts/paths.py', "literal = r'src/missing.ts'\n");
    expect(run().status).toBe(1);
    put('scripts/paths.py', '');
    put('scripts/paths.sh', 'cat src/missing.ts\n');
    expect(run().status).toBe(1);
    put('scripts/paths.sh', "cat 'src/missing.ts'\n");
    expect(run().status).toBe(1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a -legacy folder suffix grants no layout exemption', () => {
  const config = { sourceLayout: { requiredFiles: [], allowedFiles: [], folders: [] } };
  expect(checkShardLayout({ 'sample-legacy': ['retired.ts'] }, config)).toEqual(['sample-legacy/retired.ts: outside the standalone source layout']);
});

test('primary layout refuses runtime and stale root modules even beside a manifest bridge', () => {
  const config = { sourceLayout: { requiredFiles: ['shard.config.ts'], allowedFiles: ['manifest.json'], folders: ['data', 'generators'] } };
  expect(checkShardLayout({ example: ['manifest.json', 'runtime/', 'plugin.ts'] }, config)).toEqual([
    'example/runtime/: outside the standalone source layout', 'example/plugin.ts: outside the standalone source layout',
    'example: missing required shard.config.ts',
  ]);
  expect(checkShardLayout({ example: ['shard.config.ts', 'manifest.json', 'row.d.json.ts'] }, config)).toEqual([]);
});

test('declared output catalogues admit only their own generated discovery files', () => {
  const config = { sourceLayout: { requiredFiles: [], allowedFiles: ['manifest.json'], folders: [] } };
  const files = ['manifest.json', 'outputs.json', 'discovery.plot-one.generated.ts'];
  const outputs = { plots: ['plot-one'] };
  expect(checkShardLayout({ plots: files }, config, outputs)).toEqual([]);
  expect(checkShardLayout({ plots: [...files, 'discovery.rogue.generated.ts'] }, config, outputs))
    .toEqual(['plots/discovery.rogue.generated.ts: outside the standalone source layout']);
  expect(checkShardLayout({ plots: files }, config)).toHaveLength(2);
});

test('source layout admits only the bounded SDK policy receipt under build storage', () => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp', 'generated-layout-'));
  const put = (path: string, content: string): void => {
    mkdirSync(dirname(resolve(root, path)), { recursive: true });
    writeFileSync(resolve(root, path), content);
  };
  const base = 'src/shards/example', policy = `${base}/.wildshard/build-policy.json`;
  try {
    put('lint/shard-layout.json', JSON.stringify({ sourceLayout: { requiredFiles: ['shard.config.ts', 'README.md'], allowedFiles: [], folders: ['generators'] } }));
    put('lint/shard-platform.json', '{"baseline":{}}');
    put(`${base}/shard.config.ts`, 'export default {};'); put(`${base}/README.md`, '# Example');
    const valid = JSON.stringify({version:1,decisionLegacyLines:100});
    put(policy, valid); expect(checkShards(root)).toEqual([]);
    const rogue = `${base}/.wildshard/hidden.ts`;
    put(rogue, 'export const hidden = 1;');
    expect(checkShards(root)).toEqual(['example/.wildshard/: outside the standalone source layout']);
    unlinkSync(resolve(root, rogue));
    put(policy, JSON.stringify({version:1,decisionLegacyLines:100,unlisted:true}));
    expect(checkShards(root)).toHaveLength(1);
    put(policy, ' '.repeat(4097)); expect(checkShards(root)).toHaveLength(1);
    unlinkSync(resolve(root, policy)); symlinkSync(resolve(root, `${base}/shard.config.ts`), resolve(root, policy));
    expect(checkShards(root)).toHaveLength(1);
    unlinkSync(resolve(root, policy)); put(policy, valid);
    expect(checkShards(root)).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
