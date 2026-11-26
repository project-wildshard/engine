// Meta MINI-FLOW MF12: a spent GitHub quota is a wait, never "no CI run"; reads can go through the reader App.
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {afterEach, expect, test} from 'vitest';
import {GitHubLimitError, backoffMs, ghFailure, quotaReset, readerEnv, readerToken} from '../scripts/gh-limit.mjs';

/** @type {string[]} */
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}); });

test('a quota reply becomes a GitHubLimitError that waits for the reset; anything else is one poll', () => {
  const limited = ghFailure('gh api x', 'gh: API rate limit exceeded for user ID 1. (HTTP 403)', () => 10_000);
  expect(limited).toBeInstanceOf(GitHubLimitError);
  expect(backoffMs(limited, 60_000, 0)).toBe(60_000);
  expect(backoffMs(limited, 1_000, 0)).toBe(11_000);
  const denied = ghFailure('gh api x', 'gh: Resource not accessible by integration (HTTP 403)', () => { throw new Error('not asked'); });
  expect(denied).not.toBeInstanceOf(GitHubLimitError);
  expect(backoffMs(denied, 60_000, 0)).toBe(60_000);
  expect(ghFailure('gh api x', 'You have exceeded a secondary rate limit', () => 5)).toBeInstanceOf(GitHubLimitError);
});

test('quotaReset reads the latest reset among spent resources, else waits a minute', () => {
  const reply = (/** @type {unknown} */ body) => () => ({status: 0, stdout: JSON.stringify(body)});
  expect(quotaReset(reply({resources: {core: {remaining: 0, reset: 200}, search: {remaining: 0, reset: 100}, graphql: {remaining: 9, reset: 999}}}), 0)).toBe(200_000);
  expect(quotaReset(reply({resources: {core: {remaining: 10, reset: 200}}}), 5)).toBe(60_005);
  expect(quotaReset(() => ({status: 1, stdout: ''}), 5)).toBe(60_005);
});

/** A reader App on disk and a stand-in meta checkout; the key's contents do not matter here, meta's minter reads them. */
function app(clientName = 'github-reader-client-id') {
  mkdirSync('tmp/mini-flow', {recursive: true});
  const dir = mkdtempSync(resolve('tmp/mini-flow/gh-reader-'));
  roots.push(dir);
  writeFileSync(join(dir, 'github-reader.pem'), 'key\n');
  writeFileSync(join(dir, clientName), 'Iv23reader\n');
  mkdirSync(join(dir, 'scripts')); // script-paths: a fake meta (WS_META_DIR), whose scripts/ never moved
  writeFileSync(join(dir, 'scripts/gh-reader-token.mjs'), '');
  return {dir, env: {WS_GH_READER_DIR: dir, WS_GH_READER_CACHE: join(dir, 'cache.json'), WS_META_DIR: dir}};
}

test('a fresh cached token is used as is; a stale one asks meta\'s minter', () => {
  const {dir, env} = app();
  writeFileSync(env.WS_GH_READER_CACHE, JSON.stringify({token: 'ghs_cached', expiresAt: 3_600_000}));
  /** @type {string[]} */ const asked = [];
  const mint = (/** @type {string} */ minter) => { asked.push(minter); return {status: 0, stdout: 'ghs_new\n', stderr: ''}; };
  expect(readerToken({env, now: 0, mint})).toBe('ghs_cached');
  expect(asked).toEqual([]);
  expect(readerToken({env, now: 3_400_000, mint})).toBe('ghs_new');
  expect(asked).toEqual([join(dir, 'scripts/gh-reader-token.mjs')]);
});

test('no App files, WS_GH_READER=0, or a failed mint: reads stay on the gh user', () => {
  const missing = {WS_GH_READER_DIR: '/nonexistent', WS_GH_READER_CACHE: '/nonexistent/t.json'};
  expect(readerToken({env: missing})).toBeUndefined();
  expect(readerEnv(missing)).toBe(missing);
  const {env} = app();
  const never = () => { throw new Error('must not mint'); };
  expect(readerToken({env: {...env, WS_GH_READER: '0'}, mint: never})).toBeUndefined();
  expect(readerToken({env, now: 10, mint: () => ({status: 1, stdout: '', stderr: 'GET answered 401'})})).toBeUndefined();
  // The failure holds for ten minutes in this process: no mint per call.
  expect(readerToken({env, now: 20, mint: never})).toBeUndefined();
});

test('the client ID may be github-reader.client-id, the name the mini key went in under (meta MA6)', () => {
  const {env} = app('github-reader.client-id');
  const mint = () => ({status: 0, stdout: 'ghs_dotted\n', stderr: ''});
  // Past the ten-minute hold a failed mint above may have set in this process.
  expect(readerToken({env, now: 3_400_000, mint})).toBe('ghs_dotted');
});
