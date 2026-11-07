// @vitest-environment happy-dom
// oxlint-disable-next-line import/no-nodejs-modules -- Own a tiny CI-output directory, without generators or a build.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- All fixture files remain under repository scratch.
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { readBuiltShardfile } from '../scripts/built-product.mjs';

test('DOM suites can select CI products without loading a build CLI', () => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/built-product-dom-')), directory = resolve(root, 'out/fixture');
  try {
    mkdirSync(directory, { recursive: true }); writeFileSync(resolve(directory, 'shard.json'), '{}');
    const sha = 'a'.repeat(40);
    expect(readBuiltShardfile(root, 'fixture', { env: { WS_TEST_PRODUCTS_SHA: sha, VERCEL_GIT_COMMIT_SHA: sha } })).toBe(directory);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
