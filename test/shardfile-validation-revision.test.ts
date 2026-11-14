// oxlint-disable-next-line import/no-nodejs-modules -- Owned revision fixtures.
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { dirname, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { shardfileValidationRevision } from '../scripts/shardfile-validation-revision.mjs';

const owned: string[] = [];
afterEach(() => { for (const root of owned.splice(0)) rmSync(root, { recursive: true, force: true }); });
function put(root: string, path: string, text: string): void { mkdirSync(dirname(resolve(root, path)), { recursive: true }); writeFileSync(resolve(root, path), text); }
it('invalidates on admission, schemas and verified transport changes, while gameplay and generated tables stay independent', () => {
  mkdirSync('tmp', { recursive: true }); const root = mkdtempSync(resolve('tmp/validation-revision-')); owned.push(root);
  put(root, 'package.json', '{"version":"1.0.0","dependencies":{"valibot":"1.0.0"}}'); put(root, 'pnpm-lock.yaml', 'lock');
  const paths = ['src/client/game/shardfile/folder.ts', 'src/client/game/shardfile/readAsset.ts', 'src/client/engine/pwa/cacheNames.ts'];
  for (const path of paths) put(root, path, 'first');
  let before = shardfileValidationRevision(root);
  for (const path of paths) { put(root, path, 'second'); const after = shardfileValidationRevision(root); expect(after).not.toBe(before); before = after; }
  for (const path of ['src/game/combat/feel.ts', 'src/engine/render/sky.ts', 'src/game/shardfile/schema.generated.ts', 'src/client/game/shardfile/product.test.ts']) put(root, path, 'unrelated');
  expect(shardfileValidationRevision(root)).toBe(before);
  // LS1 (J250): the lockfile and the release version are not inputs, so an installed engine (neither lockfile nor
  // tests) computes the same value live; a dependency spec is.
  put(root, 'pnpm-lock.yaml', 'another lock'); put(root, 'package.json', '{"version":"2.0.0","dependencies":{"valibot":"1.0.0"}}');
  expect(shardfileValidationRevision(root)).toBe(before);
  put(root, 'package.json', '{"version":"2.0.0","dependencies":{"valibot":"1.0.1"}}');
  expect(shardfileValidationRevision(root)).not.toBe(before);
});

it('an installed engine (no lockfile, no tests) computes the checkout\'s value with its own copy of the helper (LS1, J250)', async () => {
  mkdirSync('tmp', { recursive: true }); const checkout = mkdtempSync(resolve('tmp/validation-checkout-')), installed = mkdtempSync(resolve('tmp/validation-installed-')); owned.push(checkout, installed);
  for (const root of [checkout, installed]) {
    put(root, 'package.json', '{"version":"1.0.0","dependencies":{"valibot":"1.0.0"}}');
    put(root, 'src/client/game/shardfile/folder.ts', 'product'); put(root, 'src/client/engine/pwa/Cache_Names.ts', 'names'); put(root, 'src/client/engine/pwa/cacheNames.ts', 'names');
    mkdirSync(resolve(root, 'scripts'), { recursive: true }); copyFileSync(resolve('scripts/shardfile-validation-revision.mjs'), resolve(root, 'scripts/shardfile-validation-revision.mjs'));
  }
  put(checkout, 'pnpm-lock.yaml', 'lock'); put(checkout, 'src/client/game/shardfile/product.test.ts', 'a test the package does not ship');
  const helper = async (root: string): Promise<typeof shardfileValidationRevision> => ((await import(resolve(root, 'scripts/shardfile-validation-revision.mjs'))) as { shardfileValidationRevision: typeof shardfileValidationRevision }).shardfileValidationRevision;
  // The installed helper has no lockfile beside it, so an author folder without one falls back to it: the real sharddev path.
  expect((await helper(installed))(resolve(installed, 'author-folder'))).toBe((await helper(checkout))(checkout));
});
