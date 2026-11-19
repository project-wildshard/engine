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

// WR6 keeps the previous npm minor beside the bound wire for cross-version proof.
test('the released wire fixture resolves its exact npm pin by integrity', () => {
  const spec = pkg.devDependencies['@wildshard/wire-released'] ?? '';
  const version = /^npm:@wildshard\/wire@(\d+\.\d+\.\d+)$/u.exec(spec)?.[1];
  expect(version, 'the previous wire release is an exact npm alias').toBeDefined();
  const importer = /'@wildshard\/wire-released':\n {8}specifier: (npm:@wildshard\/wire@[^\n]+)\n {8}version: '@wildshard\/wire@(\d+\.\d+\.\d+)(?:\([^\n]*\))?'/u.exec(lock);
  expect(importer?.slice(1), 'the alias importer names the same registry release').toEqual([spec, version]);
  const packages = [...lock.matchAll(/'@wildshard\/wire@(\d+\.\d+\.\d+)':\n {4}resolution: \{integrity: sha512-/gu)];
  expect(packages.filter(row => row[1] === version), 'one integrity-locked previous release').toHaveLength(1);
});
