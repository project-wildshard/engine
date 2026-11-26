// Build-max C4: an install behind its lockfile is found from pnpm's own installed copy, whatever moved the lock.
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {afterEach, expect, test} from 'vitest';
import {installLag} from '../scripts/install-lag.mjs';
import {freshInstall} from '../scripts/.kit/main-push.mjs';

/** @type {string[]} */
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}); });
const LOCK = "lockfileVersion: '9.0'\npackages:\n  '@wildshard/shard-format@0.67.0':\n    resolution: {tarball: https://example.test/f.tgz}\n";

function checkout() {
  const parent = resolve(process.env.VITEST_TMP_ROOT ?? 'tmp/vitest');
  mkdirSync(parent, {recursive: true});
  const root = mkdtempSync(join(parent, 'install-lag-'));
  roots.push(root);
  writeFileSync(join(root, 'pnpm-lock.yaml'), LOCK);
  return root;
}
/** @param {string} root @param {string} text */
const installed = (root, text) => { mkdirSync(join(root, 'node_modules/.pnpm'), {recursive: true}); writeFileSync(join(root, 'node_modules/.pnpm/lock.yaml'), text); };

test('a current install, a never-installed checkout and pnpm\'s gitHosted note are not behind', () => {
  const root = checkout();
  expect(installLag(root)).toBe('');
  installed(root, LOCK.replace('resolution: {', 'resolution: {gitHosted: true, '));
  expect(installLag(root)).toBe('');
});

test('engine 2026-11-21: the lock moved to shard-format 0.67.0 while 0.66.0 stayed installed', () => {
  const root = checkout();
  installed(root, LOCK.replaceAll('0.67.0', '0.66.0'));
  expect(installLag(root)).toBe('pnpm-lock.yaml moved since the last install');
});

test('main-push installs a lagging checkout before its gate, and stops loudly when the install fails', () => {
  const root = checkout(), store = join(root, 'store');
  const env = {...process.env, WS_STORE_USERS: join(store, 'users'), WS_STORE_RESERVATION: join(store, 'none.lock')};
  /** @type {string[]} */ const ran = [];
  const install = (/** @type {string} */ cwd) => { ran.push(cwd); installed(cwd, LOCK); return {status: 0, stderr: '', stdout: ''}; };
  expect(freshInstall(root, {env, install})).toBe('');
  installed(root, LOCK.replaceAll('0.67.0', '0.66.0'));
  expect(freshInstall(root, {env, install})).toBe('installed: pnpm-lock.yaml moved since the last install');
  expect(ran).toEqual([root]);
  expect(freshInstall(root, {env, install})).toBe('');
  installed(root, LOCK.replaceAll('0.67.0', '0.66.0'));
  expect(() => freshInstall(root, {env, install: () => ({status: 1, stderr: 'ERR_PNPM_OUTDATED_LOCKFILE', stdout: ''})}))
    .toThrow(/node_modules is behind \(pnpm-lock\.yaml moved since the last install\) and pnpm install --frozen-lockfile failed: ERR_PNPM_OUTDATED_LOCKFILE/u);
});
