// Meta MINI-FLOW MF12: a spent GitHub quota is a wait, never "no CI run"; reads can go through the reader App.
import {generateKeyPairSync, verify} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {afterEach, expect, test} from 'vitest';
import {GitHubLimitError, appJwt, backoffMs, ghFailure, quotaReset, readerEnv, readerToken} from '../../scripts/gh-limit.mjs';

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

/** A reader App on disk with a real key pair. */
function app() {
  mkdirSync('tmp/mini-flow', {recursive: true});
  const dir = mkdtempSync(resolve('tmp/mini-flow/gh-reader-'));
  roots.push(dir);
  const {privateKey, publicKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
  writeFileSync(join(dir, 'github-reader.pem'), privateKey.export({type: 'pkcs8', format: 'pem'}));
  writeFileSync(join(dir, 'github-reader-client-id'), 'Iv23reader\n');
  return {dir, publicKey, env: {WS_GH_READER_DIR: dir, WS_GH_READER_CACHE: join(dir, 'cache/token.json')}};
}

test('the App JWT is RS256, signed by the key, issued by the client ID, nine minutes with a minute of skew', () => {
  const {dir, publicKey} = app();
  const jwt = appJwt('Iv23reader', readFileSync(join(dir, 'github-reader.pem'), 'utf8'), 1_000_000);
  const [head, body, signature] = jwt.split('.');
  expect(JSON.parse(Buffer.from(head, 'base64url').toString())).toEqual({alg: 'RS256', typ: 'JWT'});
  expect(JSON.parse(Buffer.from(body, 'base64url').toString())).toEqual({iat: 940, exp: 1540, iss: 'Iv23reader'});
  expect(verify('RSA-SHA256', Buffer.from(`${head}.${body}`), publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
});

test('readerToken mints a read-only installation token once, caches it privately, and re-mints near expiry', () => {
  const {env} = app();
  /** @type {string[]} */ const calls = [];
  const call = (/** @type {string} */ method, /** @type {string} */ url, /** @type {string} */ _jwt, /** @type {string} */ body) => {
    calls.push(`${method} ${url}${body === undefined ? '' : ` ${body}`}`);
    return method === 'GET' ? {id: 77} : {token: `ghs_${calls.length}`, expires_at: new Date(3_600_000).toISOString()};
  };
  expect(readerToken({env, now: 0, call})).toBe('ghs_2');
  expect(calls).toEqual(['GET https://api.github.com/orgs/project-wildshard/installation',
    'POST https://api.github.com/app/installations/77/access_tokens {"permissions":{"actions":"read","checks":"read","contents":"read"}}']);
  expect(statSync(env.WS_GH_READER_CACHE).mode & 0o777).toBe(0o600);
  expect(readerToken({env, now: 3_000_000, call})).toBe('ghs_2');
  expect(calls).toHaveLength(2);
  expect(readerToken({env, now: 3_400_000, call})).toBe('ghs_4');
});

test('no App files, WS_GH_READER=0, or a failed mint: reads stay on the gh user', () => {
  const missing = {WS_GH_READER_DIR: '/nonexistent', WS_GH_READER_CACHE: '/nonexistent/t.json'};
  expect(readerToken({env: missing})).toBeUndefined();
  expect(readerEnv(missing)).toBe(missing);
  const {env} = app();
  expect(readerToken({env: {...env, WS_GH_READER: '0'}, call: () => { throw new Error('must not mint'); }})).toBeUndefined();
  expect(readerToken({env, now: 10, call: () => { throw new Error('GET answered 401'); }})).toBeUndefined();
  // The failure holds for ten minutes in this process: no mint attempt per call.
  expect(readerToken({env, now: 20, call: () => { throw new Error('must not retry yet'); }})).toBeUndefined();
});
