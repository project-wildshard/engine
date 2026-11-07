#!/usr/bin/env node
// E7.2c (J180, C21): the signed release file names a bundle and its SHA-256, and this brings that bundle to the VPS. It imports only `node:*`,
// because it must run before any bundle is on disk. Each bundle keeps the signed file that named it, so a restart can still serve it.
//   node pull.mjs --fetch   Before the grace, from the running server. Fetch, check and unpack. Nothing live moves. A failure exits 1, so the grace never starts.
//   node pull.mjs           `ExecStartPre`. The same, then `current` moves. A failure exits 0 if a bundle is there, so the old one comes back up.
// Settings: RELEASE_URL, RELEASE_PUBLIC_KEY, BUNDLE_ORIGIN, WILDSHARD_HOME.
import { spawnSync } from 'node:child_process';
import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** @param {string} name */
const need = name => { const value = process.env[name]; if (value === undefined || value === '') throw new Error(`The pull needs ${name}`); return value; };
/** @param {Record<string, unknown>} line */
const log = line => { console.info(JSON.stringify({ at: 'pull', ...line })); };
const home = process.env.WILDSHARD_HOME ?? '/var/lib/wildshard/production', bundles = join(home, 'bundles'), current = join(home, 'current');
/** `engineBuild` names a folder. */
const BUILD = /^\w[\w.+-]*$/u, SHA256 = /^[0-9a-f]{64}$/u;

/** @typedef {{ channel: string, serial: number, engineBuild: string, saveEpoch: number, shards: {slug: string, revision: number}[], bundle?: {name: string, sha256: string}, socket?: string }} Release */
/**
 * What a signed file says, as `releaseFile.ts` reads it: a bad signature throws before a byte of the body is believed.
 * @param {string} text
 * @returns {Release}
 */
function readRelease(text) {
  const { body, signature } = JSON.parse(text);
  if (typeof body !== 'string' || typeof signature !== 'string') throw new Error('Invalid signed release');
  const key = createPublicKey({ key: Buffer.from(need('RELEASE_PUBLIC_KEY'), 'hex'), format: 'der', type: 'spki' });
  if (!verify(null, Buffer.from(body), key, Buffer.from(signature, 'hex'))) throw new Error('A release file has a bad signature');
  const release = JSON.parse(body);
  const whole = (/** @type {unknown} */ value) => typeof value === 'number' && Number.isInteger(value) && value >= 0;
  if (!['production', 'staging', 'preview'].includes(release.channel) || !whole(release.serial) || (!whole(release.saveEpoch) || release.saveEpoch < 1)
    || typeof release.engineBuild !== 'string' || !BUILD.test(release.engineBuild)
    || !Array.isArray(release.shards) || release.shards.some((/** @type {{slug?: unknown, revision?: unknown} | null} */ row) => row === null || typeof row !== 'object' || typeof row.slug !== 'string' || !whole(row.revision))
    || (release.bundle !== undefined && (release.bundle === null || typeof release.bundle.name !== 'string' || release.bundle.name.length === 0 || typeof release.bundle.sha256 !== 'string' || !SHA256.test(release.bundle.sha256)))
    || (release.socket !== undefined && typeof release.socket !== 'string')) throw new Error('Invalid release metadata');
  if (release.channel !== (process.env.RELEASE_CHANNEL ?? 'production')) throw new Error('Release channel mismatch');
  return { channel: release.channel, serial: release.serial, engineBuild: release.engineBuild, saveEpoch: release.saveEpoch,
    shards: release.shards.map((/** @type {{slug: string, revision: number}} */ row) => ({ slug: row.slug, revision: row.revision })),
    ...(release.bundle === undefined ? {} : { bundle: { name: release.bundle.name, sha256: release.bundle.sha256 } }),
    ...(release.socket === undefined ? {} : { socket: release.socket }) };
}
/** A kept release. Existing installations never turn unreadable metadata into a first pull.
 * @param {string} folder
 * @param {boolean} unpublished
 * @returns {Release | null}
 */
function heldRelease(folder, unpublished = false) {
  if (!existsSync(folder)) return null;
  let text;
  try { text = readFileSync(join(folder, 'release.json'), 'utf8'); }
  catch (error) { if (unpublished && error instanceof Error && 'code' in error && error.code === 'ENOENT') return null; throw error; }
  return readRelease(text);
}
/** @param {Release} release @param {Release | null} held */
function forwardOnly(release, held) {
  if (held !== null && (release.serial < held.serial || (release.serial === held.serial && JSON.stringify(release) !== JSON.stringify(held)))) throw new Error('Release is older than or conflicts with a kept release');
}
/** @param {string} folder @param {Release} release */
function checkBundle(folder, release) {
  const identity = JSON.parse(readFileSync(join(folder, 'bundle.json'), 'utf8'));
  if (identity.engineBuild !== release.engineBuild || !existsSync(join(folder, 'main.mjs'))) throw new Error('Bundle build does not match the release');
}
/** Publish a whole, flushed record without truncating the last usable one.
 * @param {string} path
 * @param {string} text
 */
function atomicWrite(path, text) {
  const temporary = `${path}.${randomUUID()}.tmp`, fd = openSync(temporary, 'wx', 0o600);
  try {
    try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, path);
    const directory = openSync(dirname(path), 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally { rmSync(temporary, { force: true }); }
}
/** @param {string} url */
async function get(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`No file at ${url}: ${String(response.status)}`);
  return Buffer.from(await response.arrayBuffer());
}
/**
 * Into the folder only once whole and checked: a folder that exists is a bundle that passed.
 * @param {Release} release
 * @param {string} folder
 */
async function unpack(release, folder) {
  const name = release.bundle?.name, sha256 = release.bundle?.sha256;
  if (typeof name !== 'string' || !SHA256.test(sha256 ?? '')) throw new Error(`Release ${String(release.serial)} names no bundle`);
  const bytes = await get(`${need('BUNDLE_ORIGIN')}/${name}`), hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== sha256) throw new Error(`${name} has a bad hash: ${hash}`);
  const incoming = `${folder}.${randomUUID()}.incoming`, archive = `${incoming}.tar.gz`;
  mkdirSync(incoming, { recursive: true });
  writeFileSync(archive, bytes);
  const tar = spawnSync('tar', ['-xzf', archive, '-C', incoming], { stdio: 'inherit' });
  rmSync(archive, { force: true });
  if (tar.status !== 0 || !existsSync(join(incoming, 'main.mjs'))) { rmSync(incoming, { recursive: true, force: true }); throw new Error(`${name} did not unpack to a server`); }
  try { checkBundle(incoming, release); atomicWrite(join(incoming, '.bundle-sha256'), sha256); renameSync(incoming, folder); }
  catch (error) { rmSync(incoming, { recursive: true, force: true }); throw error; }
}
/**
 * A rename over the link, so `current` is never missing.
 * @param {string} folder
 */
function flip(folder) {
  const link = `${current}.next`;
  rmSync(link, { force: true });
  symlinkSync(folder, link);
  renameSync(link, current);
}

const fetchOnly = process.argv.includes('--fetch');
try {
  const text = (await get(need('RELEASE_URL'))).toString('utf8'), release = readRelease(text), held = heldRelease(current);
  const named = new Set(release.shards.map(row => row.slug));
  for (const cell of (process.env.WORLD_CELLS ?? 'driftwood-isle').split(',')) if (!named.has(cell)) throw new Error(`The release has no ${cell}`);
  forwardOnly(release, held);
  const folder = join(bundles, release.engineBuild);
  forwardOnly(release, heldRelease(folder, true));
  mkdirSync(bundles, { recursive: true });
  if (existsSync(folder)) {
    const digest = readFileSync(join(folder, '.bundle-sha256'), 'utf8');
    if (digest !== release.bundle?.sha256 || !existsSync(join(folder, 'main.mjs'))) throw new Error('Cached bundle is incomplete or has a different digest');
    checkBundle(folder, release);
    log({ build: release.engineBuild, serial: release.serial, already: true });
  }
  else { await unpack(release, folder); log({ build: release.engineBuild, serial: release.serial, unpacked: true }); }
  atomicWrite(join(folder, 'release.json'), text);
  if (!fetchOnly) flip(folder);
} catch (error) {
  console.error(JSON.stringify({ at: 'pull', error: String(error), kept: existsSync(join(current, 'main.mjs')) }));
  // Nothing live changed. Only a pull with no bundle at all stops the service, and systemd tries again.
  process.exit(fetchOnly || !existsSync(join(current, 'main.mjs')) ? 1 : 0);
}
