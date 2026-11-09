#!/usr/bin/env node
// Phase 2's narrow file and Serve boundaries. No installed dependencies.
import { randomBytes } from 'node:crypto';
import { closeSync, constants, fchmodSync, fchownSync, fsyncSync, fstatSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** @param {unknown} value @returns {Record<string, unknown>} */
function object(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a configuration object');
  return /** @type {Record<string, unknown>} */ (value);
}
/** @param {unknown} value @returns {Record<string, unknown>} */
function optionalObject(value) { return value === undefined || value === null ? {} : object(value); }
/** @param {unknown} value @param {string} key */
function soleTrue(value, key) {
  const row = object(value);
  return Object.keys(row).length === 1 && row[key] === true;
}
/** Inspect every path on a host:port: Funnel exposes all of them.
 * @param {unknown} value @param {string} host @param {boolean} complete */
function network(value, host, complete) {
  if (!/^[a-z0-9.-]+\.ts\.net$/u.test(host)) throw new Error('Invalid tailnet DNS name');
  const config = object(value), tcp = optionalObject(config.TCP), web = optionalObject(config.Web), funnel = optionalObject(config.AllowFunnel);
  if (Object.keys(optionalObject(config.Foreground)).length > 0) throw new Error('Refuse foreground Serve sessions; inspect tailscale serve status');
  for (const [key, allowed] of Object.entries(funnel)) {
    if ((allowed !== true && allowed !== false) || ![`${host}:443`, `${host}:8443`].includes(key)) throw new Error('Refuse a foreign AllowFunnel host:port');
  }
  /** @type {readonly [string, string, string, boolean][]} */
  const routes = [['443', '8790', 'HTTPS', true], ['8443', '8791', 'HTTPS', true], ['8790', '8790', 'HTTP', false]];
  for (const [port, target, protocol, published] of routes) {
    const key = `${host}:${port}`;
    for (const other of Object.keys(web)) if (other.endsWith(`:${port}`) && other !== key) throw new Error(`Refuse another Serve host on port ${port}`);
    if (tcp[port] !== undefined && !soleTrue(tcp[port], protocol)) throw new Error(`Refuse a foreign TCP handler on port ${port}`);
    if (web[key] !== undefined) {
      const entry = object(web[key]), handlers = object(entry.Handlers), root = object(handlers['/']);
      if (Object.keys(entry).length !== 1 || Object.keys(handlers).length !== 1 || Object.keys(root).length !== 1 || root.Proxy !== `http://127.0.0.1:${target}`) throw new Error(`Refuse foreign Serve paths on port ${port}`);
    }
    if ((tcp[port] === undefined) !== (web[key] === undefined)) throw new Error(`Refuse an incomplete Serve route on port ${port}`);
    if (funnel[key] === true && web[key] === undefined) throw new Error(`Refuse an unowned public port ${port}`);
    if (!published && funnel[key] === true) throw new Error('The health Serve port must remain tailnet-only');
    if (complete && (web[key] === undefined || (published && funnel[key] !== true))) throw new Error(`Missing expected route on port ${port}`);
    console.info(`${web[key] === undefined ? 'would' : 'ok'} ${published ? 'Funnel' : 'private Serve'} port ${port} to loopback ${target}`);
  }
}

/** The expected key is embedded in setup.sh, never trusted from this home file alone.
 * @param {string} path @param {string} expected @param {number} uid */
function pin(path, expected, uid) {
  const pattern = /^302a300506032b6570032100[0-9a-f]{64}$/u;
  if (!pattern.test(expected)) throw new Error('Invalid embedded release public key');
  const supplied = process.env.RELEASE_PUBLIC_KEY;
  if (supplied !== undefined && supplied !== expected) throw new Error('RELEASE_PUBLIC_KEY differs from the embedded public key');
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd), value = readFileSync(fd, 'utf8').trim();
    if (!stat.isFile() || stat.uid !== uid || (stat.mode & 0o022) !== 0 || !pattern.test(value) || value !== expected) throw new Error('Staged public key has unsafe metadata or differs from the embedded key');
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT' || supplied !== expected) throw error;
  } finally { if (fd !== undefined) closeSync(fd); }
  console.info('ok trusted release public key');
}

/** Fill only exact blank rows. All other bytes, including the seat secret, survive.
 * @param {string} path @param {string} channel @param {string} key @param {boolean} check @param {number} uid @param {number} gid */
function prefill(path, channel, key, check, uid, gid) {
  if (!['production', 'staging'].includes(channel)) throw new Error('Unknown release channel');
  const values = { PACK_ORIGIN: 'https://wildshard-packs.wildshard.workers.dev', RELEASE_URL: `https://wildshard-packs.wildshard.workers.dev/releases/${channel}.json`, RELEASE_PUBLIC_KEY: key };
  let before, stat;
  try {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { stat = fstatSync(fd); if (!stat.isFile()) throw new Error('Settings must be a regular file'); before = readFileSync(fd); }
    finally { closeSync(fd); }
  } catch (error) {
    if (check && error instanceof Error && 'code' in error && ['EACCES', 'EPERM'].includes(String(error.code))) { console.info(`cannot verify ${channel} env (needs sudo)`); return; }
    throw error;
  }
  const original = before.toString('utf8');
  if (!Buffer.from(original).equals(before)) throw new Error('Settings are not valid UTF-8; preserve the original');
  let text = original;
  for (const [name, value] of Object.entries(values)) {
    const rows = text.match(new RegExp(`^${name}=[^\\n]*`, 'gm')) ?? [];
    if (rows.length !== 1) throw new Error(`Expected exactly one ${name} row in ${channel} env`);
    if (rows[0] === `${name}=`) { console.info(`${check ? 'would' : 'doing'} fill ${name} in ${channel} env`); text = text.replaceAll(new RegExp(`^${name}=(?=\\n|$)`, 'gm'), `${name}=${value}`); }
    else {
      console.info(`${rows[0] === `${name}=${value}` ? 'ok' : 'warn'} keep filled ${name} in ${channel} env`);
      if (name === 'RELEASE_PUBLIC_KEY' && rows[0] !== `${name}=${value}`) throw new Error(`Existing ${channel} release trust differs; preserve it and refuse activation`);
    }
  }
  if (check) {
    if (stat.uid !== uid || stat.gid !== gid || (stat.mode & 0o777) !== 0o640) console.info(`would repair ${channel} env metadata`);
    return;
  }
  if (text === original) {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { fchmodSync(fd, 0o640); fchownSync(fd, uid, gid); }
    finally { closeSync(fd); }
    return;
  }
  const temporary = join(dirname(path), `.phase2-${randomBytes(12).toString('hex')}`);
  let fd, failure;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    writeFileSync(fd, text); fchmodSync(fd, 0o640); fchownSync(fd, uid, gid); fsyncSync(fd); closeSync(fd); fd = undefined;
    const current = lstatSync(path);
    if (current.isSymbolicLink() || current.ino !== stat.ino || current.dev !== stat.dev || !readFileSync(path).equals(before)) throw new Error('Settings changed during prefill; preserve the current file');
    renameSync(temporary, path);
    const directory = openSync(dirname(path), 'r'); try { fsyncSync(directory); } finally { closeSync(directory); }
  } catch (error) { failure = error; }
  try { if (fd !== undefined) closeSync(fd); } catch (error) { failure ??= error; }
  try { unlinkSync(temporary); } catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') failure ??= error; }
  if (failure !== undefined) throw failure instanceof Error ? failure : new Error('Atomic env prefill failed', { cause: failure });
}

const [mode, ...args] = process.argv.slice(2);
try {
  if (mode === 'network') network(JSON.parse(readFileSync(0, 'utf8')), args[0] ?? '', args[1] === '--complete');
  else if (mode === 'pin') pin(args[0] ?? '', args[1] ?? '', Number(args[2]));
  else if (mode === 'prefill') prefill(args[0] ?? '', args[1] ?? '', args[2] ?? '', args[3] === '--check', Number(args[4]), Number(args[5]));
  else throw new Error('Expected network, pin or prefill');
} catch (error) { console.error(error instanceof Error ? error.message : 'Phase 2 state check failed'); process.exitCode = 1; }
