// oxlint-disable-next-line import/no-nodejs-modules -- The guard checks actual source imports, not a parallel list.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only the real factory source under test.
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { parseSync } from 'vite';
import { generatorImportViolation } from '../lint/shard-imports.mjs';
import { nineProductFrom } from '../src/shards/nine-dragon-stack/generators/productDefinition';
import product, { nineProduct, inputs } from './fixtures/nine-product-inputs';


test('owned inputs compose the supplied view contract', () => {
  const declaration = nineProductFrom(inputs);
  expect(declaration).toEqual(product);
  expect(nineProductFrom(inputs, { pages: 3 })).toEqual(nineProduct({ pages: 3 }));
});

test('the declaration factory admits supplied inputs instead of consulting a generated file', () => {
  expect(() => nineProductFrom({ ...inputs, navigation: { ...inputs.navigation, navigation: { ...inputs.navigation.navigation, file: 'bad' } } })).toThrow();
  const path = resolve('src/shards/nine-dragon-stack/generators/productDefinition.ts');
  const parsed = parseSync(path, readFileSync(path, 'utf8'));
  expect(parsed.errors).toEqual([]);
  for (const node of parsed.program.body) if (node.type === 'ImportDeclaration') {
    expect(node.source.value).not.toContain('.generated.');
    expect(generatorImportViolation(path, node.source.value), node.source.value).toBeNull();
  }
});
