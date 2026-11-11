// WIRE-STABILITY WR2: `@wildshard/wire` is a subdirectory of the shardfile repo. pnpm 10.34.9 writes its lockfile entry
// without the subdirectory (`gitHosted` and an integrity instead of `path`), and a frozen install from an empty store,
// as CI does, then installs the repo root (`@wildshard/format`) under the wire's name. Its frozen install honours a
// `path` in the resolution, so the lockfile keeps one; a plain `pnpm install` that rewrites it fails here, not in CI.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// WR6 installs a second copy, the last wire release (`@wildshard/wire-released`), beside the bound one: both entries keep it.
test('every wire lockfile entry keeps its subdirectory path', () => {
  const lock = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
  const entries = lock.split('\n\n').filter(block => block.trimStart().startsWith("'@wildshard/wire@https://") && block.includes('resolution:'));
  expect(entries.length, 'the bound wire, and the released one unless it is the same commit').toBeGreaterThanOrEqual(1);
  for (const entry of entries) {
    expect(entry).toMatch(/resolution: \{path: \/packages\/wire, tarball: https:\/\/codeload\.github\.com\/project-wildshard\/shardfile\/tar\.gz\/[0-9a-f]{40}\}/u);
    expect(entry).not.toMatch(/gitHosted/u);
  }
});
