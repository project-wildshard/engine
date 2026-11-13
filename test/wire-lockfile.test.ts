// WIRE-STABILITY WR2: `@wildshard/wire` is a subdirectory of the shard-format repo (shardfile until J308). pnpm 10.34.9
// writes its lockfile entry without the subdirectory (`gitHosted` and an integrity instead of `path`), and a frozen
// install from an empty store, as CI does, then installs the repo root (`@wildshard/shard-format`) under the wire's
// name. Its frozen install honours a `path` in the resolution, so the lockfile keeps one; a plain `pnpm install` that
// rewrites it fails here, not in CI.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const lock = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };

// NPM-PUBLISH NP6: the bound wire is the npm release, so a consumer installs no git dependency; its lock entry is the registry's.
test('the bound wire is an npm release, locked by integrity', () => {
  const spec = pkg.dependencies['@wildshard/wire'] ?? '';
  expect(spec, 'a semver range, never a git or link spec').toMatch(/^\^?\d+\.\d+\.\d+$/u);
  const version = /'@wildshard\/wire@(\d+\.\d+\.\d+)':\n {4}resolution: \{integrity: sha512-/u.exec(lock)?.[1];
  expect(version, 'one registry entry for @wildshard/wire').toBeDefined();
});

// WR6 installs a second copy, the last wire release (`@wildshard/wire-released`), beside the bound one: a git dev dependency (consumers
// never install it). Its pin has exactly one entry, at its own commit, that keeps the subdirectory.
test('the released wire pin has one lockfile entry that keeps its subdirectory path', () => {
  const pins = [pkg.devDependencies['@wildshard/wire-released']]
    .map(spec => /^github:project-wildshard\/shard-format#([0-9a-f]{40})&path:\/packages\/wire$/u.exec(spec ?? '')?.[1]);
  expect(pins.every(sha => sha !== undefined), 'the released wire pin names a shard-format commit and the subdirectory').toBe(true);
  const blocks = lock.split('\n\n').filter(block => block.includes('resolution:'));
  for (const sha of new Set(pins)) {
    const tarball = `https://codeload.github.com/project-wildshard/shard-format/tar.gz/${sha ?? ''}`;
    const entries = blocks.filter(block => block.includes(`${tarball}#path:/packages/wire'`));
    expect(entries, `one entry for ${sha ?? ''}`).toHaveLength(1);
    expect(entries[0]).toContain(`resolution: {path: /packages/wire, tarball: ${tarball}}`);
    expect(entries[0]).not.toMatch(/gitHosted/u);
  }
});
