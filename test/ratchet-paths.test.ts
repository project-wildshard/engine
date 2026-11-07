// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the real ratchet CLI against isolated source roots.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own only this fixture's source and baseline files.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the CLI independently from the fixture root.
import { resolve } from 'node:path';
import * as v from 'valibot';
import { expect, test } from 'vitest';
import { fullRatchetFiles } from '../lint/ratchet-files.mjs';

test('full census crosses an ignored parent with explicit source coverage', () => {
  const root = mkdtempSync(resolve('tmp/ratchet-coverage-'));
  try {
    const file = 'src/shards/ratchet-test/generators/positive.ts';
    mkdirSync(resolve(root, file, '..'), { recursive: true });
    writeFileSync(resolve(root, file), "import type { SlotRange } from '@wildshard/engine/models/slots';\nexport type Range = SlotRange;\n");
    writeFileSync(resolve(root, 'src/ignored.generated.ts'), 'export const ignored = 1;');
    const baseline = resolve(root, 'ratchet.json');
    const policy = { 'wildshard/generator-imports': { [file]: 1 }, 'wildshard/shard-engine-imports': { [file]: 1 } };
    writeFileSync(baseline, JSON.stringify(policy));
    expect(fullRatchetFiles(root, ['**/*.generated.ts'], {})).toEqual([file]);
    const result = spawnSync(process.execPath, [resolve('lint/ratchet.mjs'), '--root', root, '--baseline', baseline], {
      encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([key]) =>
        key !== 'WS_GENERATION_TREE_FILES' && key !== 'WS_GENERATION_TREE_ROOT')),
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('Ratchet census: 1 explicit files linted');
    expect(JSON.parse(readFileSync(baseline, 'utf8'))).toEqual(policy);
    writeFileSync(resolve(root, file), `${readFileSync(resolve(root, file), 'utf8')}import '@wildshard/engine/app/runtime';\n`);
    const increased = spawnSync(process.execPath, [resolve('lint/ratchet.mjs'), '--root', root, '--baseline', baseline], {
      encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([key]) =>
        key !== 'WS_GENERATION_TREE_FILES' && key !== 'WS_GENERATION_TREE_ROOT')),
    });
    expect(increased.status).toBe(1);
    expect(increased.stderr).toContain('was 1, now 2');
    expect(JSON.parse(readFileSync(baseline, 'utf8'))).toEqual(policy);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the ratchet refuses stale paths even with zero counts or an empty measurement scope', () => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/ratchet-paths-')), baseline = resolve(root, 'ratchet.json'), paths = resolve(root, 'paths.json');
  const run = (policy: object) => {
    writeFileSync(baseline, JSON.stringify(policy));
    return spawnSync(process.execPath, [resolve('lint/ratchet.mjs'), '--root', root, '--baseline', baseline, '--update', '--files-from', paths], { encoding: 'utf8' });
  };
  try {
    mkdirSync(resolve(root, 'src')); writeFileSync(resolve(root, 'src/live.ts'), 'export const live = 1;');
    writeFileSync(paths, '[]');
    for (const count of [0, 7]) {
      const policy = { 'wildshard/generator-imports': { 'src/gone.ts': count } }, result = run(policy);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Stale ratchet allowance: wildshard/generator-imports src/gone.ts');
      expect(JSON.parse(readFileSync(baseline, 'utf8'))).toEqual(policy);
    }
    for (const identity of ['src/gone.ts', 'src/gone.ts#GoneSchema', 'src']) {
      const policy = identity === 'src'
        ? { 'wildshard/generator-imports': { [identity]: 0 } }
        : { allow: { 'wildshard/explicit-schema-types': { [identity]: 'historical' } } };
      expect(run(policy).stderr).toContain('names no existing file');
    }
    const valid = { allow: { 'wildshard/engine-words': { 'src/live.ts': 'existing file' },
      'shardfile/custom-sections': { 'demo/custom/weather': 'logical section identity' } },
    'wildshard/generator-imports': { 'src/live.ts': 1 } };
    const result = run(valid);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(baseline, 'utf8'))).toEqual(valid);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('hard service imports exempt no legacy suffix (LD6 retired the last registered copy)', () => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/service-freeze-')), config = resolve(root, 'lint.json');
  const files = ['src/shards/retired-fixture-legacy/plugin.ts',
    'src/shards/retired-fixture-legacy/unregistered.ts', 'src/shards/pine-hollow/loadout/loadout.ts'];
  try {
    for (const file of files) {
      mkdirSync(resolve(root, file, '..'), { recursive: true });
      writeFileSync(resolve(root, file), "import { app } from '@wildshard/engine/app/runtime'; app();");
    }
    writeFileSync(config, JSON.stringify({ jsPlugins: [resolve('lint/wildshard-plugin.js')],
      categories: { correctness: 'off' }, rules: { 'wildshard/shard-services': 'error' } }));
    const result = spawnSync(process.execPath, [resolve('node_modules/oxlint/bin/oxlint'), '-c', config, '-f', 'json',
      ...files.map(file => resolve(root, file))], { encoding: 'utf8' });
    expect(result.status, result.stdout + result.stderr).toBe(1);
    const output = v.parse(v.object({ diagnostics: v.array(v.object({ filename: v.string(), code: v.string() })) }), JSON.parse(result.stdout));
    expect(output.diagnostics.map(row => row.code)).toEqual(['wildshard(shard-services)', 'wildshard(shard-services)', 'wildshard(shard-services)']);
    expect(output.diagnostics.map(row => resolve(row.filename)).sort()).toEqual(files.map(file => resolve(root, file)).sort());
  } finally { rmSync(root, { recursive: true, force: true }); }
});
