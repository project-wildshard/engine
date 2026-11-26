// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the real lint and ratchet entry points.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own bounded fixtures under the repository scratch root.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only fixture and checker paths.
import { resolve } from 'node:path';
import * as v from 'valibot';
import { expect, test } from 'vitest';
import { hardRules } from '../src/scripts/guard-counts.mjs';

test('primary authoring law refuses runtime, executable configs and runtime imports without a suffix exemption', () => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/no-shard-runtime-')), config = resolve(root, 'lint.json');
  const files: Record<string, string> = {
    'far-reach/runtime/index.ts': 'export const run = () => 1;',
    'sample/data/logic.ts': 'export const run = () => 1;',
    'sample/shard.config.ts': 'export default (() => ({}))();',
    'sample/generators/build.ts': "import { run } from '@wildshard/sharddev/runtime/sim'; export default run;",
    'sample/generators/type.ts': "type Host = import('../../../sharddev/runtime/sim').Host;",
    'sample/generators/late.ts': "export const run = () => import('@wildshard/sharddev/runtime/sim');",
    // Node reads `%2e%2e` as `..`: an escaped path still reaches the runtime.
    'sample/generators/escaped.ts': "type Host = import('./%2e%2e/%2E%2E/%2e%2e/sharddev/runtime/sim').Host;",
    'sample-legacy/runtime/index.ts': 'export default {};',
    'nine-dragon-stack-legacy/unregistered.ts': 'export default {};',
    // LD6 retired the last inventoried copy: its old runtime path is an ordinary refusal now.
    'nine-dragon-stack-legacy/runtime/index.ts': 'export default {};',
    'sample/blender/unregistered.mjs': 'export const author = () => 1;',
    'sample/runtime/index.mjs': 'export const run = () => 1;',
    'sample/generators/output.ts': 'export const build = () => 1;',
    'sample/data/row.d.json.ts': 'declare const row: { readonly x: number }; export default row;',
    'sample/data/row.d.ts': 'export interface Row { readonly x: number }',
    'sample/discovery.generated.ts': 'export default {};',
    'other/shard.config.ts': "import { parseShardfile as parse } from '@wildshard/engine/host/shardfile'; export default parse({x:-1});",
    'nine-dragon-stack/blender/viewmodel/rig/check-clips.mjs': 'export const author = () => 1;',
    'driftwood-isle/blender/fp-arms/gate.mjs': 'export const author = () => 1;',
  };
  try {
    for (const [file, source] of Object.entries(files)) {
      const path = resolve(root, 'src/shards', file);
      mkdirSync(resolve(path, '..'), { recursive: true }); writeFileSync(path, source);
    }
    writeFileSync(config, JSON.stringify({ jsPlugins: [resolve('lint/wildshard-plugin.js')],
      categories: { correctness: 'off' }, rules: { 'wildshard/no-shard-runtime': 'error' } }));
    const result = spawnSync(process.execPath, [resolve('node_modules/oxlint/bin/oxlint'), '-c', config, '-f', 'json',
      '--no-ignore', ...Object.keys(files).map(file => resolve(root, 'src/shards', file))], { encoding: 'utf8' });
    const output = v.parse(v.object({ diagnostics: v.array(v.object({ filename: v.string(), code: v.string() })) }), JSON.parse(result.stdout));
    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(output.diagnostics.every(row => row.code === 'wildshard(no-shard-runtime)')).toBe(true);
    const refused = [...Object.keys(files).slice(0, 12),
      'nine-dragon-stack/blender/viewmodel/rig/check-clips.mjs',
      'driftwood-isle/blender/fp-arms/gate.mjs'];
    expect(output.diagnostics.map(row => resolve(row.filename)).sort()).toEqual(refused
      .map(file => resolve(root, 'src/shards', file)).sort());
    const registered = resolve(root, 'src/shards/driftwood-isle/blender/fp-arms/gate.mjs');
    writeFileSync(registered, "import '@wildshard/sharddev/runtime/sim';");
    const runtimeImport = spawnSync(process.execPath, [resolve('node_modules/oxlint/bin/oxlint'), '-c', config,
      '--no-ignore', registered], { encoding: 'utf8' });
    expect(runtimeImport.status, runtimeImport.stdout + runtimeImport.stderr).toBe(1);
    expect(runtimeImport.stdout).toContain('cannot import trusted SDK runtime');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Meta QA 11-25 row 126: a single-shard repo registers its Blender sources in src/blender/targets.json; the old
// scripts/blender/targets.json still registers them for one SDK minor; an unregistered sibling stays refused.
test('a shard repo registers Blender sources in src/blender/targets.json, or for now the old scripts/blender place', () => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/no-shard-runtime-blender-')), config = resolve(root, 'lint.json');
  const manifest = JSON.stringify({ targets: { 'sample-isle/rig': { script: 'src/blender/rig.py', sources: ['src/blender/bake.mjs'] } } });
  try {
    writeFileSync(config, JSON.stringify({ jsPlugins: [resolve('lint/wildshard-plugin.js')],
      categories: { correctness: 'off' }, rules: { 'wildshard/no-shard-runtime': 'error' } }));
    for (const at of ['src/blender/targets.json', 'scripts/blender/targets.json']) {
      const repo = resolve(root, at.split('/')[0]);
      for (const [file, text] of Object.entries({ 'src/manifest.json': '{ "slug": "sample-isle" }', 'src/shard.config.ts': 'export {};',
        'src/blender/bake.mjs': 'export const author = () => 1;', 'src/blender/stray.mjs': 'export const author = () => 1;', [at]: manifest })) {
        mkdirSync(resolve(repo, file, '..'), { recursive: true }); writeFileSync(resolve(repo, file), text);
      }
      const result = spawnSync(process.execPath, [resolve('node_modules/oxlint/bin/oxlint'), '-c', config, '-f', 'json', '--no-ignore',
        resolve(repo, 'src/blender/bake.mjs'), resolve(repo, 'src/blender/stray.mjs')], { cwd: repo, encoding: 'utf8' });
      const output = v.parse(v.object({ diagnostics: v.array(v.object({ filename: v.string() })) }), JSON.parse(result.stdout));
      expect(output.diagnostics.map(row => resolve(repo, row.filename)), at).toEqual([resolve(repo, 'src/blender/stray.mjs')]);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the runtime freeze is hard and neither ratchet write mode can add an allowance', () => {
  expect(hardRules(resolve('.oxlintrc.json')).has('wildshard/no-shard-runtime')).toBe(true);
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/no-runtime-ratchet-')), baseline = resolve(root, 'ratchet.json');
  try {
    for (const mode of ['--add-rule', '--rebaseline-rule']) {
      const policy = mode === '--add-rule' ? {} : { 'wildshard/no-shard-runtime': {} };
      writeFileSync(baseline, JSON.stringify(policy));
      const result = spawnSync(process.execPath, [resolve('lint/ratchet.mjs'), '--root', root, '--baseline', baseline,
        mode, 'wildshard/no-shard-runtime'], { encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('hard rules cannot be ratcheted');
      expect(JSON.parse(readFileSync(baseline, 'utf8'))).toEqual(policy);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
