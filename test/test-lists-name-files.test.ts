// oxlint-disable-next-line import/no-nodejs-modules -- Each listed test path must be a file in this tree.
import { existsSync } from 'node:fs';
import { expect, test } from 'vitest';
import { CI_NATIVE_GROUPS, CPU_EXCLUSIVE_TESTS } from '../src/scripts/vitest-ci-files';

// Main red on d3cead51: CI21-PORT's removals (746b4fc7 and the Sky pairing a05466fc) left their files in the lists CI runs
// from, and test/local-gate-scenarios.test.ts read one (ENOENT). A file CI runs by name is a file that exists.
// (scripts/test-products.json is the selector's data too: its scenario keys stay, local-gate-scenarios selects them.)
test('the CI native groups and CPU-exclusive tests name only test files that exist, and no group is empty', () => {
  const listed = [...Object.values(CI_NATIVE_GROUPS).flat(), ...CPU_EXCLUSIVE_TESTS];
  expect(listed.filter(path => !existsSync(path))).toEqual([]);
  const groups: Readonly<Record<string, readonly string[]>> = CI_NATIVE_GROUPS;
  expect(Object.entries(groups).filter(([, files]) => files.length === 0).map(([name]) => name)).toEqual([]);
});
