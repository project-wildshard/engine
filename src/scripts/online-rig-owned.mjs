// FM3: admit only fresh, local fixtures before the online rig can mutate them.
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve as absolute } from 'node:path';
import { createServer } from 'node:net';
import { rigFront } from './rig-listeners.mjs';
import { spawnSync } from 'node:child_process';

/** Refuse symlinks in every existing path component, including the leaf.
 * @param {string} path */
export function plainPath(path) {
  const full = absolute(path);
  for (let part = full; ; part = dirname(part)) {
    try { if (lstatSync(part).isSymbolicLink()) throw new Error('A fixture path cannot contain a symbolic link'); }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
    if (dirname(part) === part) break;
  }
  return full;
}
/** Fixture keys are private regular files, not the operator's OTA key.
 * @param {string} path */
export function fixtureKey(path) {
  plainPath(path);
  const stat = lstatSync(path);
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) throw new Error('A fixture key must be a regular 0600 file');
  const key = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof key.private !== 'string' || typeof key.public !== 'string') throw new Error('A fixture key needs its private/public pair');
  const privateKey = createPrivateKey(key.private);
  if (privateKey.asymmetricKeyType !== 'ed25519' || createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('hex') !== key.public) throw new Error('A fixture key must be a matching Ed25519 pair');
  return { private: key.private, public: key.public };
}
/** All ports must be free before starting a database, never attach to an existing service.
 * @param {readonly number[]} ports */
export async function freeFixturePorts(ports) {
  const held = [];
  try {
    for (const port of ports) {
      const server = createServer();
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { resolve(undefined); }); });
      held.push(server);
    }
  } finally { await Promise.all(held.map(server => new Promise((resolve, reject) => { server.close(error => { if (error) reject(error); else resolve(undefined); }); }))); }
}
/** Claim a new directory with mkdir's exclusive leaf semantics. Never remove somebody else's contents.
 * @param {string} path */
export function claimFixture(path) {
  const full = plainPath(path);
  mkdirSync(dirname(full), { recursive: true });
  mkdirSync(full, { mode: 0o700 });
  return full;
}
/** Only the owned page and world door, including the HTTP health sibling of its WebSocket origin.
 * @param {string} page @param {string} socket */
export function fixtureRequestOrigins(page, socket) {
  const document = new URL(page), world = new URL(socket);
  if (document.protocol !== 'http:' || world.protocol !== 'ws:' ||
    [document, world].some(url => url.hostname !== '127.0.0.1' || url.username !== '' || url.password !== '' || url.port === '')) {
    throw new Error('Fixture request origins must be explicit owned loopback ports');
  }
  const health = new URL(world); health.protocol = 'http:';
  return new Set([document.origin, world.origin, health.origin]);
}
/** A fresh native Postgres, with a stop capability returned only after our successful start.
 * @param {{bin: string, data: string, port: number, socketOnly?: boolean}} options */
export function ownedPostgres({ bin, data, port, socketOnly = false }) {
  const full = claimFixture(data);
  const run = (/** @type {string} */ name, /** @type {string[]} */ args) => {
    const result = spawnSync(absolute(bin, name), args, { encoding: 'utf8', timeout: 30_000 });
    if (result.error !== undefined || result.status !== 0) throw new Error(`Owned Postgres ${name} failed (${String(result.status)}): ${(result.stderr ?? '').slice(-600)}`, { cause: result.error });
  };
  let started = false;
  const close = () => { if (started) {
    try { lstatSync(absolute(full, 'postmaster.pid')); } catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') { started = false; return; } throw error; }
    run('pg_ctl', ['-D', full, '-m', 'fast', '-w', 'stop']); started = false;
  } };
  try {
    run('initdb', ['-D', full, '-U', 'postgres', '-A', 'trust', '--no-locale', '--encoding=UTF8']);
    started = true;
    run('pg_ctl', ['-D', full, '-o', socketOnly ? `-p ${String(port)} -k . -c listen_addresses=''` : `-p ${String(port)} -k '' -c listen_addresses=127.0.0.1`, '-w', '-l', absolute(full, 'server.log'), 'start']);
    const pid = readFileSync(absolute(full, 'postmaster.pid'), 'utf8').split('\n');
    if (pid[1] !== realpathSync(full) || Number(pid[3]) !== port) throw new Error('Owned Postgres identity differs from its fresh data directory');
    return { data: full, close };
  } catch (error) {
    try { close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Owned Postgres setup and cleanup failed', { cause: cleanup }); }
    throw error;
  }
}
/** Confirm the connection reached our actual data directory before any DROP DATABASE.
 * @param {import('pg').Client} client @param {string} data */
export async function confirmPostgres(client, data) {
  const answer = await client.query("select current_setting('data_directory') as data");
  if (typeof answer.rows[0]?.data !== 'string' || realpathSync(answer.rows[0].data) !== realpathSync(data)) throw new Error('Refusing to recreate databases on an unowned Postgres instance');
}

/** PostgreSQL refuses port zero. Keep its private socket inside the fresh data
 * directory and forward an OS-assigned, continuously owned TCP listener to it.
 * @param {{bin: string, data: string}} options */
export async function ownedEphemeralPostgres({ bin, data }) {
  const path = relative(process.cwd(), absolute(data, '.s.PGSQL.5432'));
  if (Buffer.byteLength(path) >= 104) throw new Error('Owned Postgres needs a shorter relative data path for its Unix socket');
  const front = await rigFront();
  /** @type {ReturnType<typeof ownedPostgres>|undefined} */
  let database;
  const close = async () => { try { await front.close(); } finally { database?.close(); } };
  try {
    database = ownedPostgres({ bin, data, port: 5432, socketOnly: true });
    front.pointSocket(path);
    return { data: database.data, port: front.port, close };
  } catch (error) {
    try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Ephemeral Postgres setup and cleanup failed', { cause: cleanup }); }
    throw error;
  }
}
