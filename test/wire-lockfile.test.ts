// WIRE-STABILITY WR2: `@wildshard/wire` is a subdirectory of the shardfile repo. pnpm 10.34.9 writes its lockfile entry
// without the subdirectory (`gitHosted` and an integrity instead of `path`), and a frozen install from an empty store,
// as CI does, then installs the repo root (`@wildshard/format`) under the wire's name. Its frozen install honours a
// `path` in the resolution, so the lockfile keeps one; a plain `pnpm install` that rewrites it fails here, not in CI.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// WR6 installs a second copy, the last wire release (`@wildshard/wire-released`), beside the bound one. Each pin in
// package.json has exactly one entry, at its own commit, that keeps the subdirectory.
test('every wire pin has one lockfile entry that keeps its subdirectory path', () => {
  const lock = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
  const pins = [pkg.dependencies['@wildshard/wire'], pkg.devDependencies['@wildshard/wire-released']].map(spec => /#([0-9a-f]{40})&path:\/packages\/wire$/u.exec(spec ?? '')?.[1]);
  expect(pins.every(sha => sha !== undefined), 'both wire pins name a commit and the subdirectory').toBe(true);
  const blocks = lock.split('\n\n').filter(block => block.includes('resolution:'));
  for (const sha of new Set(pins)) {
    const entries = blocks.filter(block => block.includes(`shardfile/tar.gz/${sha ?? ''}#path:/packages/wire'`));
    expect(entries, `one entry for ${sha ?? ''}`).toHaveLength(1);
    expect(entries[0]).toContain(`resolution: {path: /packages/wire, tarball: https://codeload.github.com/project-wildshard/shardfile/tar.gz/${sha ?? ''}}`);
    expect(entries[0]).not.toMatch(/gitHosted/u);
  }
});
