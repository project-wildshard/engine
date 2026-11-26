// oxlint-disable-next-line import/no-nodejs-modules -- A planted node_modules on disk.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { join, resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { admits, installedOrgPackages, probes, rangeGaps } from '../src/scripts/node-ranges.mjs';

// Meta QA 11-25 row 42 (J505): format 0.79.2 said `>=24.18.0 <25` under engine's `<27`, and server-release 45703635653
// died at `pnpm install` on Node 26.13.1. The push gate's check:node-ranges reads every installed org package's range.
const made = [];
afterEach(() => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function install(packages) {
  const root = mkdtempSync(resolve('tmp/node-ranges-')); made.push(root);
  for (const [dir, pkg] of Object.entries(packages)) {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, 'package.json'), JSON.stringify(pkg));
  }
  return root;
}

test('ranges read the way pnpm reads the org ranges', () => {
  expect(admits('>=24.18.0 <27', '26.13.1')).toBe(true);
  expect(admits('>=24.18.0 <25', '26.13.1')).toBe(false);
  expect(admits('>=24.18.0 <25', '24.17.9')).toBe(false);
  expect(admits('>=20 <21 || >=24.18.0 <27', '20.5.0')).toBe(true);
  expect(probes('>=24.18.0 <27')).toEqual(['24.18.0', '24.999.999', '25.0.0', '25.999.999', '26.0.0', '26.999.999']);
});

test('an installed org package capped at <25 under engine <27 is refused, naming the Nodes it misses', () => {
  const root = install({
    'node_modules/@wildshard/format': { name: '@wildshard/shard-format', version: '0.79.2', engines: { node: '>=24.18.0 <25' } },
    'node_modules/.pnpm/@wildshard+sdk@0.6.1/node_modules/@wildshard/sdk': { name: '@wildshard/sdk', version: '0.6.1', engines: { node: '>=24.18.0 <27' } },
    'node_modules/@wildshard/wire': { name: '@wildshard/wire', version: '1.5.0' },
    'node_modules/@wildshard/engine': { name: '@wildshard/engine', version: '0.1.90', engines: { node: '>=24.18.0 <27' } },
  });
  const packages = installedOrgPackages(root);
  expect(packages.map(pkg => pkg.name)).toEqual(['@wildshard/sdk', '@wildshard/shard-format', '@wildshard/wire']);
  expect(rangeGaps('>=24.18.0 <27', packages)).toEqual([{ name: '@wildshard/shard-format', version: '0.79.2',
    range: '>=24.18.0 <25', missed: ['25.0.0', '25.999.999', '26.0.0', '26.999.999'] }]);
});

test('the fixed release, a range admitting every Node engine allows, passes', () => {
  const root = install({
    'node_modules/@wildshard/format': { name: '@wildshard/shard-format', version: '0.79.3', engines: { node: '>=24.18.0 <27' } },
  });
  expect(rangeGaps('>=24.18.0 <27', installedOrgPackages(root))).toEqual([]);
});

test('a range part the check cannot read stops the check instead of passing it', () => {
  expect(() => admits('^24.18.0', '24.18.0')).toThrow(/unread range part/u);
});
