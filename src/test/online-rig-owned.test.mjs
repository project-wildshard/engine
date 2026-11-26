import { afterAll, expect, test } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { claimFixture, confirmPostgres, fixtureKey, fixtureRequestOrigins, freeFixturePorts, ownedEphemeralPostgres, ownedPostgres, plainPath } from '../scripts/online-rig-owned.mjs';
import { openRig, PG_PORT } from '../scripts/online-rig.mjs';

const base = resolve('tmp/codex-pagesize');
mkdirSync(base, { recursive: true });
const root = mkdtempSync(resolve(base, 'rig-guards-'));
afterAll(() => { rmSync(root, { recursive: true, force: true }); });
const at = name => resolve(root, name);
test('fixture admission includes only the owned world door HTTP health sibling', () => {
  const origins = fixtureRequestOrigins('http://127.0.0.1:18851', 'ws://127.0.0.1:18852/');
  expect(origins).toEqual(new Set(['http://127.0.0.1:18851', 'ws://127.0.0.1:18852', 'http://127.0.0.1:18852']));
  expect(origins.has('http://127.0.0.1:18853')).toBe(false);
  expect(() => fixtureRequestOrigins('https://example.com', 'ws://127.0.0.1:18852/')).toThrow('loopback');
  expect(() => fixtureRequestOrigins('http://127.0.0.1:18851', 'ws://example.com:18852/')).toThrow('loopback');
});
const pair = generateKeyPairSync('ed25519');
const key = { public: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('hex'), private: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
const keyFile = at('key.json');
writeFileSync(keyFile, JSON.stringify(key), { mode: 0o600 });

test('fixtures claim only a fresh leaf and never remove existing data', () => {
  const fresh = at('fresh');
  expect(claimFixture(fresh)).toBe(fresh);
  writeFileSync(resolve(fresh, 'sentinel'), 'keep');
  expect(() => claimFixture(fresh)).toThrow();
  expect(readFileSync(resolve(fresh, 'sentinel'), 'utf8')).toBe('keep');
  expect(() => ownedPostgres({ bin: 'not-a-bin', data: fresh, port: 0 })).toThrow();
});

test('symlinks in the leaf or an ancestor refuse without writing through them', () => {
  symlinkSync(root, at('linked'), 'dir');
  expect(() => plainPath(at('linked'))).toThrow('symbolic link');
  expect(() => claimFixture(at('linked/foreign'))).toThrow('symbolic link');
  expect(existsSync(at('foreign'))).toBe(false);
});

test('fixture signing requires a private, matching Ed25519 pair', () => {
  expect(fixtureKey(keyFile)).toEqual(key);
  chmodSync(keyFile, 0o644);
  expect(() => fixtureKey(keyFile)).toThrow('0600');
  chmodSync(keyFile, 0o600);
  writeFileSync(at('mismatch.json'), JSON.stringify({ ...key, public: '00' }), { mode: 0o600 });
  expect(() => fixtureKey(at('mismatch.json'))).toThrow('matching Ed25519');
  symlinkSync(keyFile, at('key-link'));
  expect(() => fixtureKey(at('key-link'))).toThrow('symbolic link');
});

test('an occupied port refuses the isolated rig before a build or mutation', async () => {
  const occupied = createServer();
  await new Promise(resolve => { occupied.listen(PG_PORT, '127.0.0.1', resolve); });
  try {
    await expect(freeFixturePorts([PG_PORT])).rejects.toThrow();
    await expect(openRig({ dist: 'not-a-build', work: at('unclaimed'), keyFile, saves: 'memory', isolated: true })).rejects.toThrow();
    expect(existsSync(at('unclaimed'))).toBe(false);
    expect(occupied.listening).toBe(true);
  } finally { await new Promise((resolve, reject) => { occupied.close(error => { if (error) reject(error); else resolve(); }); }); }
});

test('the connected database must report the claimed real data directory', async () => {
  const own = at('pg-own'), other = at('pg-other');
  mkdirSync(own); mkdirSync(other);
  await expect(confirmPostgres({ query: async () => ({ rows: [{ data: other }] }) }, own)).rejects.toThrow('unowned Postgres');
  await expect(confirmPostgres({ query: async () => ({ rows: [{ data: own }] }) }, own)).resolves.toBeUndefined();
});

test('ephemeral database admission preserves foreign data and its listener on refusal', async () => {
  const data = at('foreign-ephemeral'); mkdirSync(data); writeFileSync(resolve(data, 'sentinel'), 'keep');
  await expect(ownedEphemeralPostgres({ bin: 'not-a-bin', data })).rejects.toThrow();
  expect(readFileSync(resolve(data, 'sentinel'), 'utf8')).toBe('keep');
  expect(() => claimFixture(data)).toThrow();
});
