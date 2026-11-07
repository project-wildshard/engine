import { scenes } from './fixtures/nine-product-inputs';
// oxlint-disable-next-line import/no-nodejs-modules -- Compile the real author entry without executing its runtime.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Check the actual factory source with the defining import guard.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { build, parseSync } from 'vite';
import { generatorImportViolation } from '../lint/shard-imports.mjs';
import { nineBuildBlocks } from '../src/shards/nine-dragon-stack/generators/worldEntry';
import { BLEND_ADD_KEEP_ALPHA } from '../src/client/game/plugin/shaderFamily';
import { assertConfigBoundary } from '../src/sharddev/configBoundary';

test('Nine authored streaks retain the original blend state without importing a runtime host', () => {
  const row = Object.values(nineBuildBlocks(scenes)).flat().find(entry => entry.kind === 'look' && entry.look === 'nine-streaks');
  expect(row).toMatchObject({ state: { transparent: true, ...BLEND_ADD_KEEP_ALPHA } });
});

test('the actual Nine output factory bundles as one build-only module', async () => {
  const result = await build({ configFile: false, logLevel: 'silent', build: { write: false, minify: false,
    lib: { entry: resolve('src/shards/nine-dragon-stack/generators/productOutput.ts'), formats: ['es'], fileName: 'config' }, rolldownOptions: { external: [/^node:/u, 'assemblyscript/dist/asc.js'] } } });
  const built = Array.isArray(result) ? result[0] : result;
  if (built === undefined || !('output' in built)) throw new Error('Missing Nine output bundle');
  const chunks = built.output.filter(row => row.type === 'chunk'); expect(chunks).toHaveLength(1);
  for (const chunk of chunks) {
    assertConfigBoundary([...chunk.imports, ...chunk.dynamicImports]);
    expect(Object.keys(chunk.modules).some(path => path.endsWith('/src/client/game/shardfile/clientPlan.ts'))).toBe(false);
  }
});

test('the extracted factory uses only the unchanged author-package surface', () => {
  const path = resolve('src/shards/nine-dragon-stack/generators/productOutput.ts');
  const parsed = parseSync(path, readFileSync(path, 'utf8'));
  expect(parsed.errors).toEqual([]);
  for (const node of parsed.program.body) if (node.type === 'ImportDeclaration') {
    expect(generatorImportViolation(path, node.source.value), node.source.value).toBeNull();
  }
});
