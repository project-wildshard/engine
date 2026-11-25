// @vitest-environment node
import {expect, test} from 'vitest';
import {readFileSync} from 'node:fs';
import {hardenDue, selectCookRelease} from '../scripts/release-cook.mjs';

const build = 'a'.repeat(40), staging = {tag: `server-staging-${build}`, build};

test('staging moves the cook from its signed server tag before a production tag exists', () => {
  expect(selectCookRelease(staging, {tag: 'v0.1.32', build: 'b'.repeat(40)}, {build})).toEqual(staging);
  expect(() => selectCookRelease(staging, staging, {build: 'b'.repeat(40)})).toThrow('exact signed staging');
  expect(() => selectCookRelease({...staging, tag: 'server-production-' + build}, staging, {build})).toThrow('exact signed staging');
});

test('finishing an older production train cannot rewind a cook already following newer staging', () => {
  const production = {tag: 'v0.1.33', build};
  expect(selectCookRelease(staging, production, {tag: 'v0.1.33'})).toEqual(production);
  expect(() => selectCookRelease({...staging, build: 'b'.repeat(40)}, production, {tag: 'v0.1.33'})).toThrow('Cook follows staging');
  expect(() => selectCookRelease(staging, production, {tag: 'v0.1.32'})).toThrow('Cook follows staging');
});

// FAST-RELEASE FR-A11: a release applies its own harden when scripts/vps changed since the box's last harden.
test('harden is due when scripts/vps changed since the last harden, and only then', () => {
  const applied = 'b'.repeat(40);
  const diff = (paths: string[] | null) => () => paths;
  expect(hardenDue(build, build, diff([])).due).toBe(false);
  expect(hardenDue(applied, build, diff(['src/main.ts', 'docs/server-release.md']))).toEqual({due: false, why: 'no harden input changed since bbbbbbbb'});
  expect(hardenDue(applied, build, diff(['scripts/vps/harden-grafana.sh']))).toEqual({due: true, why: '1 harden input(s) changed since bbbbbbbb (scripts/vps/harden-grafana.sh)'});
  expect(hardenDue(applied, build, diff(['scripts/vps/a', 'scripts/vps/b', 'scripts/vps/c', 'scripts/vps/d'])).why).toContain('4 harden input(s)');
  expect(hardenDue(applied, build, diff(null)).due).toBe(true);
  expect(hardenDue(undefined, build, diff([])).due).toBe(true);
  expect(hardenDue('not-a-commit', build, diff([])).due).toBe(true);
});

test('wildshard-apply stamps the harden release-cook reads', () => {
  const stamp = /const HARDEN_STAMP = '([^']+)'/u;
  const apply = readFileSync('scripts/vps/wildshard-apply.mjs', 'utf8'), cook = readFileSync('scripts/release-cook.mjs', 'utf8');
  expect(stamp.exec(apply)?.[1]).toBe('/var/lib/wildshard-harden-applied');
  expect(stamp.exec(cook)?.[1]).toBe(stamp.exec(apply)?.[1]);
  // Only a harden that exited 0 writes it, and world-readable, so wildshard-agent reads it without sudo.
  expect(apply).toMatch(/which === 'harden' && run\.status === 0\) \{\s*writeFileSync\(HARDEN_STAMP, `\$\{commit\} \$\{tag\}\\n`, \{ mode: 0o644 \}\)/u);
});
