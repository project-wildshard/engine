// WIRE-STABILITY WR2: `@wildshard/wire` is a subdirectory of the shardfile repo. pnpm 10.34.9 writes its lockfile entry
// without the subdirectory (`gitHosted` and an integrity instead of `path`), and a frozen install from an empty store,
// as CI does, then installs the repo root (`@wildshard/format`) under the wire's name. Its frozen install honours a
// `path` in the resolution, so the lockfile keeps one; a plain `pnpm install` that rewrites it fails here, not in CI.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

test('the wire lockfile entry keeps its subdirectory path', () => {
  const lock = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
  const entry = lock.split('\n\n').find(block => block.trimStart().startsWith("'@wildshard/wire@https://") && block.includes('resolution:'));
  expect(entry, 'a @wildshard/wire package entry').toBeDefined();
  expect(entry).toMatch(/resolution: \{path: \/packages\/wire, tarball: https:\/\/codeload\.github\.com\/project-wildshard\/shardfile\/tar\.gz\/[0-9a-f]{40}\}/u);
  expect(entry).not.toMatch(/gitHosted/u);
});
