// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the real lint and ratchet entry points.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own bounded fixtures under the repository scratch root.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only fixture and checker paths.
import { resolve } from 'node:path';
import * as v from 'valibot';
import { expect, test } from 'vitest';
import { hardRules } from '../scripts/guard-counts.mjs';

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
    expect(output.diagnostics.map(row => resolve(row.filename)).sort()).toEqual(Object.keys(files).slice(0, 11)
      .map(file => resolve(root, 'src/shards', file)).sort());
    const registered = resolve(root, 'src/shards/driftwood-isle/blender/fp-arms/gate.mjs');
    writeFileSync(registered, "import '@wildshard/sharddev/runtime/sim';");
    const runtimeImport = spawnSync(process.execPath, [resolve('node_modules/oxlint/bin/oxlint'), '-c', config,
      '--no-ignore', registered], { encoding: 'utf8' });
    expect(runtimeImport.status, runtimeImport.stdout + runtimeImport.stderr).toBe(1);
    expect(runtimeImport.stdout).toContain('cannot import trusted SDK runtime');
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
