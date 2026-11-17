#!/usr/bin/node
// MMO-SERVER-PLAN MP1.2.d: the cap bench on the box's own cores, with no ssh command but the allowlisted helper.
// `sudo wildshard-config replica start|stop` runs this as root from /opt/wildshard-vps (harden.sh's root-owned copy of a
// signed tag's scripts/vps). scripts/mmo-bots.mjs --box drives it; the bots stay on the Mac (J202) and dial the tailnet.
//   replica.mjs start <seconds> <workers> <seats> <cells>
//     Staging's signed release file (its RELEASE_URL, checked as pull.mjs checks it, with the pinned key) names a bundle.
//     Root fetches that bundle into a root-owned folder, checks its SHA-256, and runs it as a throwaway replica in
//     production's shape: a fresh key signs a one-off production release for the same build, saves stay in memory, and no
//     secret, Sentry DSN, record or telemetry address is given. It runs as the fixed transient unit wildshard-replica:
//     DynamicUser, staging's CPUs (9-12), 6 GB, at most <seconds>, on 127.0.0.1:18797. Its door is the transient socket
//     wildshard-replica-door on the box's tailnet address, port 18796 only (ufw lets tailscale0 in; Caddy and 443 never see
//     it), where systemd-socket-proxyd hands each connection to loopback: the replica's door trusts a bot's X-Forwarded-For
//     only from a loopback peer (doorTrust.ts), so 32 bots from one Mac each count as their own address, as on a local
//     replica. Its stdout (the worker lines mmo-bots.mjs reads) comes back to the caller, and both go when it ends.
//   replica.mjs stop      ends both units and removes the folder.
// Nothing a channel's user can write is read (Codex J206): no bundle folder, no pulled release.json.
import { spawnSync } from 'node:child_process';
import { createHash, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Public SPKI DER, equal to setup.sh's EXPECTED_RELEASE_PUBLIC_KEY and wildshard-apply.mjs's (the engine's test holds them equal).
export const RELEASE_PUBLIC_KEY = '302a300506032b657003210012e17122631777e2a6ad68e2fb4883d856def46f812aa9a3e49d701ed44ad17b';
export const UNIT = 'wildshard-replica', DOOR = 'wildshard-replica-door', PORT = 18796, INNER = 18797, CPUS = '9-12';
const PROXYD = '/usr/lib/systemd/systemd-socket-proxyd';
const PACK_ORIGIN = 'https://packs.wildshard.io', MAX_BUNDLE = 256 * 1024 * 1024;
const CELL = /^[a-z0-9][a-z0-9-]{0,63}(?:,[a-z0-9][a-z0-9-]{0,63}){0,7}$/u, HEX40 = /^[0-9a-f]{40}$/u, HEX64 = /^[0-9a-f]{64}$/u;
const BUNDLE_NAME = /^[A-Za-z0-9._-]{1,120}(?:\/[A-Za-z0-9._-]{1,120})?$/u;

/** The limits wildshard-config checks too, so a direct caller gets the same refusals. */
export function limits(/** @type {string[]} */ args) {
  const [seconds = '', workers = '', seats = '', cells = ''] = args;
  if (args.length !== 4 || !/^\d{2,4}$/u.test(seconds) || Number(seconds) < 60 || Number(seconds) > 3900) return null;
  if (!/^[1-4]$/u.test(workers) || !/^\d{1,2}$/u.test(seats) || Number(seats) < 1 || Number(seats) > 64 || !CELL.test(cells)) return null;
  return { seconds: Number(seconds), workers: Number(workers), seats: Number(seats), cells };
}

/**
 * Staging's release as a signed file says it, or null. A bad signature is never believed (pull.mjs `readRelease`).
 * @param {string} text @param {string} key
 * @returns {{ engineBuild: string, serial: number, saveEpoch: number, shards: unknown[], bundle: { name: string, sha256: string } } | null}
 */
export function stagingRelease(text, key) {
  let signed;
  try { signed = JSON.parse(text); } catch { return null; }
  if (typeof signed?.body !== 'string' || typeof signed?.signature !== 'string' || !/^(?:[0-9a-f]{2})+$/u.test(signed.signature)) return null;
  const spki = createPublicKey({ key: Buffer.from(key, 'hex'), format: 'der', type: 'spki' });
  if (spki.asymmetricKeyType !== 'ed25519' || !verify(null, Buffer.from(signed.body), spki, Buffer.from(signed.signature, 'hex'))) return null;
  let release;
  try { release = JSON.parse(signed.body); } catch { return null; }
  if (release?.channel !== 'staging' || typeof release.engineBuild !== 'string' || !HEX40.test(release.engineBuild)) return null;
  if (!Number.isInteger(release.serial) || !Number.isInteger(release.saveEpoch) || !Array.isArray(release.shards)) return null;
  if (typeof release.bundle?.name !== 'string' || !BUNDLE_NAME.test(release.bundle.name) || release.bundle.name.includes('..')
    || typeof release.bundle.sha256 !== 'string' || !HEX64.test(release.bundle.sha256)) return null;
  return release;
}

/**
 * The replica's own one-off production release for staging's build, signed by a fresh key (mmo-bots.mjs's local replica).
 * @param {{ engineBuild: string, saveEpoch: number, shards: unknown[] }} release
 */
export function replicaRelease(release) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const body = JSON.stringify({ channel: 'production', serial: 1, engineBuild: release.engineBuild, saveEpoch: release.saveEpoch, shards: release.shards });
  return { text: JSON.stringify({ body, signature: sign(null, Buffer.from(body), privateKey).toString('hex') }),
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('hex') };
}

/**
 * systemd-run's words for the replica: the sandbox, the bounds and the env. Every value is checked or this script's own.
 * @param {{ seconds: number, workers: number, seats: number, cells: string, host: string, publicKey: string, folder: string }} run
 */
export function unitArgs(run) {
  if (!/^100\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(run.host)) throw new Error(`${run.host} is not a tailnet address`);
  const env = { PACK_ORIGIN, PACK_CACHE: `/var/cache/${UNIT}`, DATABASE_URL: 'memory:', SEAT_SECRET: randomBytes(32).toString('hex'),
    HOST: '127.0.0.1', PORT: String(INNER), RELEASE_CHANNEL: 'production', RELEASE_URL: pathToFileURL(join(run.folder, 'release.json')).href,
    RELEASE_PUBLIC_KEY: run.publicKey, WORLD_CELLS: run.cells, WORLD_WORKERS: String(run.workers), WORLD_SEATS: String(run.seats),
    TELEMETRY_URL: '', ERRORS_URL: '', SENTRY_DSN: '', RECORD_TAG: '', METRICS_PORT: '', PLAYTEST: '' };
  const properties = ['DynamicUser=yes', `AllowedCPUs=${CPUS}`, 'MemoryMax=6G', 'TasksMax=512', `RuntimeMaxSec=${String(run.seconds)}`,
    `CacheDirectory=${UNIT}`, `WorkingDirectory=${join(run.folder, 'server')}`, 'ProtectSystem=strict', 'ProtectHome=yes', 'PrivateTmp=yes',
    'PrivateDevices=yes', 'NoNewPrivileges=yes', 'ProtectKernelTunables=yes', 'ProtectKernelModules=yes', 'ProtectKernelLogs=yes',
    'ProtectControlGroups=yes', 'ProtectClock=yes', 'ProtectHostname=yes', 'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6',
    'RestrictNamespaces=yes', 'RestrictSUIDSGID=yes', 'LockPersonality=yes', 'SystemCallFilter=@system-service', 'CapabilityBoundingSet=',
    'UMask=0077'];
  return [`--unit=${UNIT}`, '--collect', '--pipe', '--quiet', '--service-type=exec', ...properties.flatMap(value => ['-p', value]),
    ...Object.entries(env).flatMap(([name, value]) => ['--setenv', `${name}=${value}`]), '/usr/bin/node', join(run.folder, 'server', 'main.mjs')];
}

/**
 * systemd-run's words for the door: a socket on the tailnet address only, handed to loopback, gone with the replica.
 * @param {{ seconds: number, host: string }} run
 */
export function doorArgs(run) {
  if (!/^100\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(run.host)) throw new Error(`${run.host} is not a tailnet address`);
  const properties = ['DynamicUser=yes', `AllowedCPUs=${CPUS}`, 'MemoryMax=256M', `RuntimeMaxSec=${String(run.seconds)}`, 'ProtectSystem=strict',
    'ProtectHome=yes', 'PrivateTmp=yes', 'PrivateDevices=yes', 'NoNewPrivileges=yes', 'CapabilityBoundingSet=', 'RestrictAddressFamilies=AF_UNIX AF_INET',
    'RestrictNamespaces=yes', 'LockPersonality=yes', 'SystemCallFilter=@system-service'];
  return [`--unit=${DOOR}`, '--collect', '--quiet', `--socket-property=ListenStream=${run.host}:${String(PORT)}`,
    ...properties.flatMap(value => ['-p', value]), PROXYD, '--connections-max=128', `127.0.0.1:${String(INNER)}`];
}

// The engine's test hands it a made-up /etc, its own key and stand-ins; never as root, so sudo cannot.
const test = process.geteuid?.() !== 0 ? process.env.WILDSHARD_REPLICA_TEST : undefined;
const ETC = `${test ?? ''}/etc/wildshard`, FOLDER = test !== undefined ? join(test, 'replica') : `/var/lib/${UNIT}`;
const CLEAN = { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', HOME: '/root', LANG: 'C.UTF-8' };

/** @param {string} message @returns {never} */
function stop(message) { console.error(`stop    ${message}`); process.exit(1); }
/** One line on stderr, so stdout carries only the server's own lines. @param {string} what @param {string} message */
function say(what, message) { try { console.error(`${what.padEnd(7)} ${message}`); } catch { /* the caller went away */ } }
/** @param {string} command @param {string[]} args */
function exec(command, args, inherit = false) {
  const stand = test !== undefined ? process.env[`WILDSHARD_REPLICA_TEST_${command.split('/').pop()?.replaceAll('-', '_').toUpperCase() ?? ''}`] : undefined;
  return spawnSync(stand ?? command, args, { encoding: 'utf8', cwd: '/', env: test !== undefined ? { ...process.env, ...CLEAN, PATH: process.env.PATH ?? CLEAN.PATH } : CLEAN,
    stdio: inherit ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'] });
}
/** staging.env's value for a key, as systemd reads it; only RELEASE_URL and BUNDLE_ORIGIN are asked for. @param {string} key */
function stagingEnv(key) {
  const text = existsSync(`${ETC}/staging.env`) ? readFileSync(`${ETC}/staging.env`, 'utf8') : '';
  return [...text.matchAll(new RegExp(`^${key}=(.*)$`, 'gmu'))].pop()?.[1]?.trim().replaceAll(/^["']|["']$/gu, '');
}
/** At most `limit` bytes of an https answer. @param {string} url @param {number} limit */
async function fetchCapped(url, limit) {
  if (test !== undefined) return readFileSync(join(test, 'fetch', encodeURIComponent(url)));
  if (!url.startsWith('https://')) stop(`${url} is not https`);
  const answer = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!answer.ok || answer.body === null) stop(`${url} answered ${String(answer.status)}`);
  const parts = [];
  let size = 0;
  for await (const part of answer.body) { size += part.length; if (size > limit) stop(`${url} is over ${String(limit)} bytes`); parts.push(part); }
  return Buffer.concat(parts);
}
const UNITS = [`${UNIT}.service`, `${DOOR}.socket`, `${DOOR}.service`];
const active = () => UNITS.some(unit => exec('/usr/bin/systemctl', ['is-active', '--quiet', unit]).status === 0);
const end = () => { exec('/usr/bin/systemctl', ['stop', ...UNITS]); rmSync(FOLDER, { recursive: true, force: true }); };

async function main() {
  const [verb, ...args] = process.argv.slice(2);
  if (test === undefined) process.chdir('/');
  if (verb === 'stop' && args.length === 0) {
    end();
    say('ok', `${UNIT} and ${DOOR} stopped; ${FOLDER} removed`);
    return 0;
  }
  const bounds = verb === 'start' ? limits(args) : null;
  if (bounds === null) stop('usage: replica.mjs start <seconds 60-3900> <workers 1-4> <seats 1-64> <cells> | stop');
  if (active()) stop(`${UNIT} is already running: one replica at a time (stop it with: sudo wildshard-config replica stop)`);

  const releaseUrl = stagingEnv('RELEASE_URL'), origin = stagingEnv('BUNDLE_ORIGIN');
  if (releaseUrl === undefined || origin === undefined) stop('staging.env names no RELEASE_URL or BUNDLE_ORIGIN');
  const key = test !== undefined ? process.env.WILDSHARD_REPLICA_TEST_KEY ?? '' : RELEASE_PUBLIC_KEY;
  const release = stagingRelease((await fetchCapped(releaseUrl, 65_536)).toString('utf8'), key);
  if (release === null) stop("staging's release file is not signed by the release key, or is not a staging release");
  say('ok', `staging serial ${String(release.serial)} is signed: build ${release.engineBuild}`);

  const bytes = await fetchCapped(`${origin}/${release.bundle.name}`, MAX_BUNDLE);
  if (createHash('sha256').update(bytes).digest('hex') !== release.bundle.sha256) stop(`${release.bundle.name} differs from its signed SHA-256`);
  rmSync(FOLDER, { recursive: true, force: true });
  mkdirSync(join(FOLDER, 'server'), { recursive: true, mode: 0o755 });
  writeFileSync(join(FOLDER, 'server.tar.gz'), bytes, { mode: 0o600 });
  const unpack = exec('/usr/bin/tar', ['-xzf', join(FOLDER, 'server.tar.gz'), '-C', join(FOLDER, 'server'), '--no-same-owner', '--no-same-permissions']);
  rmSync(join(FOLDER, 'server.tar.gz'), { force: true });
  if (unpack.status !== 0 || !existsSync(join(FOLDER, 'server', 'main.mjs'))) stop(`${release.bundle.name} did not unpack to a server`);
  // Root's files, readable by the replica's dynamic user and written by nobody else.
  exec('/usr/bin/chmod', ['-R', 'u=rwX,go=rX', FOLDER]);
  const own = replicaRelease(release);
  writeFileSync(join(FOLDER, 'release.json'), own.text, { mode: 0o644 });

  const host = exec('/usr/bin/tailscale', ['ip', '-4']).stdout?.trim().split('\n')[0] ?? '';
  const words = unitArgs({ ...bounds, host, publicKey: own.publicKey, folder: FOLDER }), door = doorArgs({ seconds: bounds.seconds, host });
  if (exec('/usr/bin/systemd-run', door).status !== 0) { end(); stop(`${DOOR} did not open ${host}:${String(PORT)}`); }
  // The first stdout line says which build runs, so mmo-bots.mjs checks it against the bots' own before a hello.
  console.info(JSON.stringify({ at: 'replica', build: release.engineBuild, serial: release.serial, host, port: PORT, cpus: CPUS, seconds: bounds.seconds }));
  say('run', `${UNIT} on ${host}:${String(PORT)}, CPUs ${CPUS}, ${String(bounds.workers)} workers, ${String(bounds.seats)} seats, at most ${String(bounds.seconds)} s`);
  const served = exec('/usr/bin/systemd-run', words, true);
  end();
  say('ok', `${UNIT} ended (${String(served.status)}); ${DOOR} closed; ${FOLDER} removed`);
  return served.status ?? 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(await main());
