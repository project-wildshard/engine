// A released engine's source binds every wire field. Its npm dependency must use the same build as the frozen lock.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const lock = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
const releases = [...lock.matchAll(/'@wildshard\/wire@(\d+\.\d+\.\d+)':\n {4}resolution: \{integrity: sha512-/gu)];

// NPM-PUBLISH NP6: the bound wire is the npm release, so a consumer installs no git dependency; its lock entry is the registry's.
test('the bound wire is the same exact npm release in the manifest and the lock', () => {
  const spec = pkg.dependencies['@wildshard/wire'] ?? '';
  expect(spec, 'a fresh install must use the wire this source binds').toMatch(/^\d+\.\d+\.\d+$/u);
  const importer = /'@wildshard\/wire':\n {8}specifier: ([^\n]+)\n {8}version: (\d+\.\d+\.\d+)/u.exec(lock);
  expect(importer?.slice(1)).toEqual([spec, spec]);
  expect(releases.filter(row => row[1] === spec), 'one integrity-locked bound release').toHaveLength(1);
});

// WR6 keeps the previous npm minor beside the bound wire for cross-version proof.
test('the released wire fixture resolves its exact npm pin by integrity', () => {
  const spec = pkg.devDependencies['@wildshard/wire-released'] ?? '';
  const version = /^npm:@wildshard\/wire@(\d+\.\d+\.\d+)$/u.exec(spec)?.[1];
  expect(version, 'the previous wire release is an exact npm alias').toBeDefined();
  const importer = /'@wildshard\/wire-released':\n {8}specifier: (npm:@wildshard\/wire@[^\n]+)\n {8}version: '@wildshard\/wire@(\d+\.\d+\.\d+)(?:\([^\n]*\))?'/u.exec(lock);
  expect(importer?.slice(1), 'the alias importer names the same registry release').toEqual([spec, version]);
  expect(releases.filter(row => row[1] === version), 'one integrity-locked previous release').toHaveLength(1);
});
