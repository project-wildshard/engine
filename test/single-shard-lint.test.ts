// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the real oxlint entry point on both shard layouts.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own bounded fixtures under the repository scratch root.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only fixture and checker paths.
import { relative, resolve } from 'node:path';
import * as v from 'valibot';
import { expect, test } from 'vitest';
import plugin from '../lint/wildshard-plugin.js';
import { lintFile, repoShardSlug, shardFile, shardOfFilename, shardSourceDirs } from '../lint/shard-source.mjs';

// SA45 (J317): a single-shard repo keeps its shard at src/; the author lint must read it as it reads src/shards/<slug>/.
const FILES: Record<string, string> = {
  'shard.config.ts': 'export default (() => ({}))();',
  'manifest.json': '{ "slug": "sample-isle" }',
  'generators/build.ts': "import { run } from '@wildshard/sharddev/runtime/sim'; export default run;",
  'data/flags.ts': 'export const isNalati = true;',
  'data/logic.ts': "import type { Object3D } from 'three'; import { isNalati } from './flags'; export const run = (_: Object3D) => isNalati;",
  'runtime/index.ts': "import gen from '../generators/build'; import '@wildshard/commons/packs'; export const w = window.innerWidth; export default gen;",
  'blender/rig.mjs': "import { AnimationMixer } from 'three'; export const mixer = new AnimationMixer(null);",
  'look/view.ts': "import { app } from '@wildshard/engine/client/app'; export const page = app;",
};
const Output = v.object({ diagnostics: v.array(v.object({ filename: v.string(), code: v.string(), message: v.string(),
  labels: v.array(v.object({ span: v.object({ line: v.number(), column: v.number() }) })) })) });

function write(base: string) {
  for (const [file, text] of Object.entries(FILES)) {
    const path = resolve(base, file);
    mkdirSync(resolve(path, '..'), { recursive: true }); writeFileSync(path, text);
  }
}
/** Findings by shard-local file; a message that names a file names its real path, so read both layouts' as `src/`. */
function lint(config: string, base: string) {
  const files = Object.keys(FILES).filter(file => !file.endsWith('.json')).map(file => resolve(base, file));
  const result = spawnSync(process.execPath, [resolve('node_modules/oxlint/bin/oxlint'), '-c', config, '-f', 'json', '--no-ignore', ...files],
    { encoding: 'utf8', env: { ...process.env, WILDSHARD_RATCHET_FILE: resolve(base, 'no-ratchet.json') } });
  return v.parse(Output, JSON.parse(result.stdout)).diagnostics
    .map(row => `${row.code} ${relative(base, resolve(row.filename)).replaceAll('\\', '/')}:${row.labels[0]?.span.line}:${row.labels[0]?.span.column} ${row.message.replaceAll('src/shards/sample-isle/', 'src/')}`).sort();
}

test('the author lint gives a single-shard src/ the same findings as src/shards/<slug>/', () => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/single-shard-lint-')), config = resolve(root, 'lint.json');
  const multi = resolve(root, 'multi'), single = resolve(root, 'single');
  try {
    write(resolve(multi, 'src/shards/sample-isle'));
    write(resolve(single, 'src'));
    writeFileSync(config, JSON.stringify({ jsPlugins: [resolve('lint/wildshard-plugin.js')], categories: { correctness: 'off' },
      rules: Object.fromEntries(Object.keys(plugin.rules).map(name => [`wildshard/${name}`, 'error'])) }));
    const shards = lint(config, resolve(multi, 'src/shards/sample-isle')), repo = lint(config, resolve(single, 'src'));
    expect(repo).toEqual(shards);
    const codes = new Set(shards.map(row => row.split(' ')[0]));
    for (const code of ['layer', 'no-shard-runtime', 'generator-imports', 'no-runtime-generator', 'runtime-commons', 'shard-sandbox', 'shard-services', 'sim-no-render'])
      expect(codes, code).toContain(`wildshard(${code})`);
    // The shard-only layer checks run (trusted runtime, commons packs); the file sits in a layer; shard rules are exempt.
    expect(shards.filter(row => row.includes('File outside') || row.includes('outside the layers'))).toEqual([]);
    for (const code of ['no-shard-branch', 'no-raw-animation-mixer']) expect(codes, code).not.toContain(`wildshard(${code})`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('one helper names the shard, its local path and root in both layouts', () => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/single-shard-source-'));
  const multi = resolve(root, 'multi'), single = resolve(root, 'single'), unnamed = resolve(root, 'shard-unnamed'), hand = resolve(root, 'hand');
  try {
    write(resolve(multi, 'src/shards/sample-isle'));
    write(resolve(single, 'src'));
    mkdirSync(resolve(unnamed, 'src'), { recursive: true }); writeFileSync(resolve(unnamed, 'src/shard.config.ts'), 'export {};');
    mkdirSync(resolve(hand, 'src'), { recursive: true }); writeFileSync(resolve(hand, 'src/shard.json'), '{ "identity": { "slug": "hand-made" } }');
    expect([repoShardSlug(multi), repoShardSlug(single), repoShardSlug(unnamed), repoShardSlug(hand)]).toEqual([null, 'sample-isle', 'shard-unnamed', 'hand-made']);
    const local = { slug: 'sample-isle', local: 'runtime/index.ts', path: 'src/shards/sample-isle/runtime/index.ts' };
    expect(shardFile(multi, 'src/shards/sample-isle/runtime/index.ts')).toEqual({ ...local, base: 'src/shards/sample-isle' });
    expect(shardFile(single, 'src/runtime/index.ts')).toEqual({ ...local, base: 'src' });
    expect([shardFile(multi, 'src/engine/x.ts'), shardFile(single, 'scripts/x.ts')]).toEqual([null, null]);
    expect([shardSourceDirs(multi), shardSourceDirs(single)]).toEqual([['src/shards'], ['src']]);
    const engine = resolve('.');
    expect(lintFile(resolve(single, 'src/runtime/index.ts'), engine)).toMatchObject({ root: single, file: 'src/runtime/index.ts', path: local.path });
    expect(lintFile(resolve(multi, 'src/shards/sample-isle/runtime/index.ts'), engine)).toMatchObject({ root: multi, file: local.path, path: local.path });
    expect(lintFile(resolve('src/client/engine/x.ts'), engine)).toMatchObject({ file: 'src/client/engine/x.ts', path: 'src/client/engine/x.ts', shard: null });
    expect(shardOfFilename(resolve(single, 'src/data/logic.ts'))).toEqual({ slug: 'sample-isle', local: 'data/logic.ts', dir: `${single}/src/` });
    expect(shardOfFilename(resolve(multi, 'src/shards/sample-isle/data/logic.ts'))).toEqual({ slug: 'sample-isle', local: 'data/logic.ts', dir: `${multi}/src/shards/sample-isle/` });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
