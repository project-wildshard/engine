// oxlint-disable-next-line import/no-nodejs-modules -- Compare the retained terrain metadata and own only a scratch cache.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Bound the cache to the fixture.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Report measured generator timings independently of engine logging.
import process from 'node:process';
// oxlint-disable-next-line import/no-nodejs-modules -- Execute the same one-chunk author module as the CLI.
import { Buffer } from 'node:buffer';
import { expect, test } from 'vitest';
import { build, parseSync } from 'vite';
import { generatorImportViolation } from '../lint/shard-imports.mjs';
import { generate } from '../src/shards/_template/shard.config';
import { templateTerrain } from '../src/shards/_template/generators/terrain';
import { TEMPLATE_BEHAVIOUR, TEMPLATE_BOSS } from './fixtures/templateSource';
import { templateBehaviour } from '../src/shards/_template/generators/behaviour';
import { templateFolder } from '../src/shards/_template/generators/folder';
import { templatePropRows } from '../src/shards/_template/generators/props';
import { createProjectGeneration, isProjectGenerator } from '../src/sharddev/projectGeneration';
import { hashImmutableBytes } from '../src/shared/host/immutable';
import { assertConfigBoundary } from '../src/sharddev/configBoundary';
import { parseShardfile } from '../src/shared/host/shardfile';

test('template direct generation and a cache hit retain every original world row and asset byte', async () => {
  mkdirSync('tmp', { recursive: true }); const cache = mkdtempSync(resolve('tmp', 'template-generation-'));
  try {
    const before = performance.now(), { assets: original, ...rows } = templateTerrain(), props = templatePropRows(), produced = performance.now() - before;
    const assets = new Map<string, Uint8Array>(), root = resolve('src/shards/_template');
    const coldAt = performance.now(), cold = await generate(createProjectGeneration(root, 'c'.repeat(64), assets, cache)), coldMs = performance.now() - coldAt;
    const hitAt = performance.now(), hit = await generate(createProjectGeneration(root, 'c'.repeat(64), assets, cache)), hitMs = performance.now() - hitAt;
    expect(JSON.stringify(cold.shard)).toBe(JSON.stringify(templateFolder(rows, props, TEMPLATE_BEHAVIOUR, TEMPLATE_BOSS))); expect(hit.shard).toEqual(cold.shard); expect(hit.output).toEqual(cold.output);
    if (hit.map === undefined || cold.map === undefined) throw new Error('Missing Template map');
    expect(Buffer.compare(hit.map.pixels, cold.map.pixels)).toBe(0);
    const expected = new Map([...original, ...props.assets]);
    const boss = assets.get(TEMPLATE_BOSS.hash); if (boss === undefined) throw new Error('Missing generated boss'); expected.set(TEMPLATE_BOSS.hash, boss);
    expect(boss.length).toBe(TEMPLATE_BOSS.compressed);
    expect(hashImmutableBytes(boss)).toBe(TEMPLATE_BOSS.hash);
    for (const row of Object.values(await templateBehaviour(createProjectGeneration(root, 'c'.repeat(64), assets, cache)))) {
      const bytes = assets.get(row.hash); if (bytes === undefined) throw new Error('Missing actual compiled module'); expected.set(row.hash, bytes);
    } expect([...assets.keys()].sort()).toEqual([...expected.keys()].sort());
    for (const [hash, bytes] of assets) {
      const old = expected.get(hash); if (old === undefined) throw new Error('Unexpected world asset');
      expect(Buffer.compare(bytes, old), hash).toBe(0);
    }
    process.stdout.write(`${JSON.stringify({ templateWorldMs: produced, coldProgramMs: coldMs, cachedProgramMs: hitMs, files: assets.size })}\n`);
  } finally { rmSync(cache, { recursive: true, force: true }); }
});

test('the actual template build closure bundles and executes through the unchanged config boundary', async () => {
  const result = await build({ configFile: false, logLevel: 'silent', build: { write: false, minify: false,
    lib: { entry: resolve('src/shards/_template/shard.config.ts'), formats: ['es'], fileName: 'config' }, rolldownOptions: { external: [/^node:/u] } } });
  const built = Array.isArray(result) ? result[0] : result;
  if (built === undefined || !('output' in built)) throw new Error('Missing template bundle');
  const chunks = built.output.filter(row => row.type === 'chunk'); expect(chunks).toHaveLength(1);
  const chunk = chunks[0]; if (chunk === undefined) throw new Error('Missing template chunk');
  assertConfigBoundary([...chunk.imports, ...chunk.dynamicImports]);
  const loaded: unknown = await import(`data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`);
  if (typeof loaded !== 'object' || loaded === null || !('generate' in loaded) || !isProjectGenerator(loaded.generate)) throw new Error('Missing template build function');
  const cache = mkdtempSync(resolve('tmp', 'template-bundle-')), assets = new Map<string, Uint8Array>();
  try {
    const generated = await loaded.generate(createProjectGeneration(resolve('src/shards/_template'), hashImmutableBytes(new TextEncoder().encode(chunk.code)), assets, cache));
    if (typeof generated !== 'object' || generated === null || !('shard' in generated)) throw new Error('Missing generated declaration');
    const source = parseShardfile(generated.shard);
    expect(source.identity.slug).toBe('template');
    expect(source.files.filter(file => assets.has(file.hash))).toHaveLength(assets.size - 1);
    expect(assets.size).toBeGreaterThan(0);
  } finally { rmSync(cache, { recursive: true, force: true }); }
});


test('Template boss and output sources use the unchanged SDK-only author import surface', () => {
  for (const file of ['boss.ts', 'folderOutput.ts']) {
    const path = resolve('src/shards/_template/generators', file), parsed = parseSync(path, readFileSync(path, 'utf8'));
    expect(parsed.errors).toEqual([]);
    for (const node of parsed.program.body) if (node.type === 'ImportDeclaration') expect(generatorImportViolation(path, node.source.value), node.source.value).toBeNull();
  }
});
