// Meta MINI-AUTONOMY MA6: gh-read runs gh with the reader App's token, or as plain gh without one.
import {spawnSync} from 'node:child_process';
import {chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {delimiter, join, resolve} from 'node:path';
import {afterEach, expect, test} from 'vitest';

/** @type {string[]} */
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}); });

/** A stand-in gh that prints its arguments and GH_TOKEN, and exits 7. */
function fakeGh() {
  mkdirSync('tmp/mini-autonomy', {recursive: true});
  const dir = mkdtempSync(resolve('tmp/mini-autonomy/gh-read-'));
  roots.push(dir);
  writeFileSync(join(dir, 'gh'), '#!/bin/sh\necho "$* token=${GH_TOKEN:-none}"\nexit 7\n');
  chmodSync(join(dir, 'gh'), 0o755);
  return dir;
}

const run = (/** @type {NodeJS.ProcessEnv} */ env) =>
  spawnSync(process.execPath, ['src/scripts/gh-read.mjs', 'run', 'list', '-L', '1'], {encoding: 'utf8', env});

test('a fresh cached reader token goes to gh as GH_TOKEN; gh\'s exit code comes back', () => {
  const dir = fakeGh();
  writeFileSync(join(dir, 'github-reader.pem'), 'key\n');
  writeFileSync(join(dir, 'github-reader.client-id'), 'Iv23reader\n');
  writeFileSync(join(dir, 'cache.json'), JSON.stringify({token: 'ghs_reader', expiresAt: Date.now() + 3_600_000}));
  const result = run({PATH: `${dir}${delimiter}${process.env.PATH ?? ''}`, WS_GH_READER_DIR: dir, WS_GH_READER_CACHE: join(dir, 'cache.json')});
  expect(result.stdout.trim()).toBe('run list -L 1 token=ghs_reader');
  expect(result.status).toBe(7);
});

test('no App key: plain gh', () => {
  const dir = fakeGh();
  const result = run({PATH: `${dir}${delimiter}${process.env.PATH ?? ''}`, WS_GH_READER_DIR: dir, WS_GH_READER_CACHE: join(dir, 'none.json')});
  expect(result.stdout.trim()).toBe('run list -L 1 token=none');
});
