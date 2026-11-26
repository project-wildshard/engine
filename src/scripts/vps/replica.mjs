#!/usr/bin/node
// MMO-SERVER-PLAN MP1.2.d: the cap bench on the box's own cores, with no ssh command but the allowlisted helper.
// `sudo wildshard-config replica start|stop` runs this as root from /opt/wildshard-vps (harden.sh's root-owned copy of a
// signed tag's src/scripts/vps). src/scripts/mmo-bots.mjs --box drives it; the bots stay on the Mac (J202) and dial the tailnet.
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
//   replica.mjs start <seconds> <workers> <seats> <cells> postgres
//     MMO-SERVER E7.4b.b: the same, but its saves go to a scratch cluster, a throwaway apt Postgres 16 cluster
//     (16 wildshard_replica, port 5439, socket only, peer for postgres and one per-run scram password for the replica's
//     role), so a Postgres outage can be witnessed on apt Postgres without blipping a channel's saves. Only the constants
//     below name a cluster: the channels' own cluster and databases are never touched.
//   replica.mjs pg-restart [--checkpoint]  restarts only the scratch cluster. With the flag, wait for a blocked save.
//   replica.mjs stop      ends both units, drops the scratch cluster and removes the folder.
// Nothing a channel's user can write is read (Codex J206): no bundle folder, no pulled release.json.
import { agentFetch as fetch } from '../agent-requests.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

// Public SPKI DER, equal to setup.sh's EXPECTED_RELEASE_PUBLIC_KEY and wildshard-apply.mjs's (the engine's test holds them equal).
export const RELEASE_PUBLIC_KEY = '302a300506032b657003210012e17122631777e2a6ad68e2fb4883d856def46f812aa9a3e49d701ed44ad17b';
export const UNIT = 'wildshard-replica', DOOR = 'wildshard-replica-door', PORT = 18796, INNER = 18797, CPUS = '9-12';
const PROXYD = '/usr/lib/systemd/systemd-socket-proxyd';
// E7.4b.b: the scratch cluster. Its name, port, role and database are this file's own, never a channel's.
// Debian's postgresql@ unit uses %I in its config path. The version separator is the only dash in the instance.
export const PG_VERSION = '16', CLUSTER = 'wildshard_replica', PG_PORT = 5439, PG_ROLE = 'replica', PG_DATABASE = 'saves_replica';
const OLD_CLUSTER = 'wildshard-replica';
const PG_SOCKET = '/var/run/postgresql', PG_UNIT = `postgresql@${PG_VERSION}-${CLUSTER}.service`;
const PACK_ORIGIN = 'https://packs.wildshard.io', MAX_BUNDLE = 256 * 1024 * 1024;
const CELL = /^[a-z0-9][a-z0-9-]{0,63}(?:,[a-z0-9][a-z0-9-]{0,63}){0,7}$/u, HEX40 = /^[0-9a-f]{40}$/u, HEX64 = /^[0-9a-f]{64}$/u;
const BUNDLE_NAME = /^[A-Za-z0-9._-]{1,120}(?:\/[A-Za-z0-9._-]{1,120})?$/u;

/** The limits wildshard-config checks too, so a direct caller gets the same refusals. */
export function limits(/** @type {string[]} */ args) {
  const [seconds = '', workers = '', seats = '', cells = '', saves = 'memory'] = args;
  if ((args.length !== 4 && args.length !== 5) || (saves !== 'memory' && saves !== 'postgres') || !/^\d{2,4}$/u.test(seconds) || Number(seconds) < 60 || Number(seconds) > 3900) return null;
  if (!/^[1-4]$/u.test(workers) || !/^\d{1,2}$/u.test(seats) || Number(seats) < 1 || Number(seats) > 64 || !CELL.test(cells)) return null;
  return { seconds: Number(seconds), workers: Number(workers), seats: Number(seats), cells, saves };
}

/** E7.4b.b: the replica's saves on the scratch cluster, over its socket, with this run's password. @param {string} password */
export function scratchUrl(password) {
  if (!/^[0-9a-f]{32,64}$/u.test(password)) throw new Error('the scratch password is hex');
  return `postgresql://${PG_ROLE}:${password}@localhost:${String(PG_PORT)}/${PG_DATABASE}?host=${PG_SOCKET}`;
}

/** The scratch cluster's pg_hba: postgres by peer for setup, the replica's role by password, nothing over TCP. */
export const SCRATCH_HBA = `local all postgres peer\nlocal ${PG_DATABASE} ${PG_ROLE} scram-sha-256\n`;

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
 * @param {{ seconds: number, workers: number, seats: number, cells: string, host: string, publicKey: string, folder: string, database?: string }} run
 */
export function unitArgs(run) {
  if (!/^100\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(run.host)) throw new Error(`${run.host} is not a tailnet address`);
  const database = run.database ?? 'memory:';
  if (database !== 'memory:' && !database.startsWith(`postgresql://${PG_ROLE}:`)) throw new Error('the replica saves in memory or on the scratch cluster');
  const env = { PACK_ORIGIN, PACK_CACHE: `/var/cache/${UNIT}`, DATABASE_URL: database, SEAT_SECRET: randomBytes(32).toString('hex'),
    HOST: '127.0.0.1', PORT: String(INNER), RELEASE_CHANNEL: 'production', RELEASE_URL: pathToFileURL(join(run.folder, 'release.json')).href,
    RELEASE_PUBLIC_KEY: run.publicKey, WORLD_CELLS: run.cells, WORLD_WORKERS: String(run.workers), WORLD_SEATS: String(run.seats),
    TELEMETRY_URL: '', ERRORS_URL: '', SENTRY_DSN: '', RECORD_TAG: '', METRICS_PORT: '', PLAYTEST: '' };
  const properties = ['DynamicUser=yes', `AllowedCPUs=${CPUS}`, 'MemoryMax=6G', 'TasksMax=512', `RuntimeMaxSec=${String(run.seconds)}`,
    `CacheDirectory=${UNIT}`, `WorkingDirectory=${join(run.folder, 'server')}`, 'ProtectSystem=strict', 'ProtectHome=yes', 'PrivateTmp=yes',
    'PrivateDevices=yes', 'NoNewPrivileges=yes', 'ProtectKernelTunables=yes', 'ProtectKernelModules=yes', 'ProtectKernelLogs=yes',
    'ProtectControlGroups=yes', 'ProtectClock=yes', 'ProtectHostname=yes', 'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6',
    'RestrictNamespaces=yes', 'RestrictSUIDSGID=yes', 'LockPersonality=yes', 'SystemCallFilter=@system-service', 'CapabilityBoundingSet=',
    'UMask=0077', 'MemoryHigh=5G', 'OOMScoreAdjust=1000'];
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
const ETC = `${test ?? ''}/etc/wildshard`, PG_CONFIG = `${test ?? ''}/etc/postgresql/${PG_VERSION}`;
const PG_ETC = join(PG_CONFIG, CLUSTER), FOLDER = test !== undefined ? join(test, 'replica') : `/var/lib/${UNIT}`;
const CLEAN = { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', HOME: '/root', LANG: 'C.UTF-8' };
const childEnv = test !== undefined ? { ...process.env, ...CLEAN, PATH: process.env.PATH ?? CLEAN.PATH } : CLEAN;

/** @param {string} command */
function executable(command) {
  return (test === undefined ? undefined : process.env[`WILDSHARD_REPLICA_TEST_${command.split('/').pop()?.replaceAll('-', '_').toUpperCase() ?? ''}`]) ?? command;
}

/** @param {string} message @returns {never} */
function stop(message) { console.error(`stop    ${message}`); process.exit(1); }
/** One line on stderr, so stdout carries only the server's own lines. @param {string} what @param {string} message */
function say(what, message) { try { console.error(`${what.padEnd(7)} ${message}`); } catch { /* the caller went away */ } }
/** @param {string} command @param {string[]} args @param {{ inherit?: boolean, input?: string }} [how] */
function exec(command, args, how = {}) {
  const { inherit = false, input } = how;
  return spawnSync(executable(command), args, { encoding: 'utf8', cwd: '/', env: childEnv,
    ...(input === undefined ? {} : { input }), stdio: [input === undefined ? 'ignore' : 'pipe', inherit ? 'inherit' : 'pipe', inherit ? 'inherit' : 'pipe'] });
}
/** E7.4b.b: drop the scratch cluster if it exists. It holds only a replica's throwaway saves. */
function dropScratch() {
  for (const name of [CLUSTER, OLD_CLUSTER]) {
    if (existsSync(join(PG_CONFIG, name))) exec('/usr/bin/pg_dropcluster', ['--stop', PG_VERSION, name]);
  }
}
/** E7.4b.b: a fresh scratch cluster with the replica's role and database; its DATABASE_URL, or a stop. */
function makeScratch() {
  dropScratch();
  const password = randomBytes(24).toString('hex');
  /** @type {[string, string[]][]} */
  const steps = [
    ['/usr/bin/pg_createcluster', [PG_VERSION, CLUSTER, '--port', String(PG_PORT)]],
    ['/usr/bin/pg_conftool', [PG_VERSION, CLUSTER, 'set', 'listen_addresses', '']],
  ];
  for (const [command, args] of steps) if (exec(command, args).status !== 0) { dropScratch(); stop(`${command.split('/').pop() ?? command} failed for the scratch cluster`); }
  writeFileSync(join(PG_ETC, 'pg_hba.conf'), SCRATCH_HBA, { mode: 0o640 });
  // Never started by a boot: a cluster a killed run left behind waits, stopped, for the next start or stop to drop it.
  writeFileSync(join(PG_ETC, 'start.conf'), 'manual\n', { mode: 0o644 });
  if (exec('/usr/bin/pg_ctlcluster', [PG_VERSION, CLUSTER, 'start']).status !== 0) { dropScratch(); stop('the scratch cluster did not start'); }
  // The password goes on stdin, never argv, so no process list shows it.
  const sql = `CREATE ROLE ${PG_ROLE} LOGIN PASSWORD '${password}';\nCREATE DATABASE ${PG_DATABASE} OWNER ${PG_ROLE};\n`;
  if (exec('/usr/sbin/runuser', ['-u', 'postgres', '--', '/usr/bin/psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-p', String(PG_PORT), '-d', 'postgres'], { input: sql }).status !== 0) {
    dropScratch(); stop('the scratch cluster refused its role or database');
  }
  say('ok', `scratch cluster ${PG_VERSION}/${CLUSTER} on port ${String(PG_PORT)}, socket only`);
  return scratchUrl(password);
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
const running = () => exec('/usr/bin/systemctl', ['is-active', '--quiet', `${UNIT}.service`]).status === 0;
const end = () => { exec('/usr/bin/systemctl', ['stop', ...UNITS]); dropScratch(); rmSync(FOLDER, { recursive: true, force: true }); };

// The scratch database alone holds this lock. Readers still run, and the proof catches the real replica role's
// save INSERT waiting on this exact transaction. Keep the session open until systemd stops Postgres.
const CHECKPOINT_SQL = `BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL idle_in_transaction_session_timeout = '15s';
LOCK TABLE public.player_save IN SHARE MODE;
DO $checkpoint$
BEGIN
  LOOP
    PERFORM pg_stat_clear_snapshot();
    EXIT WHEN EXISTS (
      SELECT FROM pg_stat_activity
      WHERE datname = current_database()
        AND usename = '${PG_ROLE}'
        AND wait_event_type = 'Lock'
        AND query LIKE 'insert into player_save (%'
        AND pg_backend_pid() = ANY(pg_blocking_pids(pid))
    );
    PERFORM pg_sleep(0.05);
  END LOOP;
END;
$checkpoint$;
SELECT 'checkpoint.waiting';
`;

/** @param {boolean} checkpointInFlight */
function restartScratch(checkpointInFlight) {
  const started = Date.now(), restarted = exec('/usr/bin/systemctl', ['restart', PG_UNIT]);
  if (restarted.status !== 0) throw new Error(`${PG_UNIT} did not restart`);
  console.info(JSON.stringify({ at: 'scratch.restarted', unit: PG_UNIT, ms: Date.now() - started,
    ...(checkpointInFlight ? { checkpointInFlight, startedAt: new Date(started).toISOString() } : {}) }));
}

async function restartAtCheckpoint() {
  const session = spawn(executable('/usr/sbin/runuser'), ['-u', 'postgres', '--', '/usr/bin/psql', '-XqAt',
    '-v', 'ON_ERROR_STOP=1', '-h', PG_SOCKET, '-p', String(PG_PORT), '-d', PG_DATABASE],
  { cwd: '/', env: childEnv, stdio: ['pipe', 'pipe', 'ignore'] });
  const closed = new Promise(resolve => { session.once('close', resolve); });
  const lines = createInterface({ input: session.stdout });
  const limit = setTimeout(() => lines.close(), 70_000);
  session.on('error', () => lines.close());
  session.stdin.on('error', () => lines.close());
  try {
    session.stdin.write(CHECKPOINT_SQL);
    for await (const line of lines) {
      if (line !== 'checkpoint.waiting') continue;
      restartScratch(true);
      return;
    }
    throw new Error('no blocked checkpoint write on the scratch cluster');
  } finally {
    clearTimeout(limit);
    lines.close();
    session.stdin.end();
    const kill = setTimeout(() => { session.kill(); }, 1000);
    await closed;
    clearTimeout(kill);
  }
}

async function main() {
  const [verb, ...args] = process.argv.slice(2);
  if (test === undefined) process.chdir('/');
  if (verb === 'stop' && args.length === 0) {
    end();
    say('ok', `${UNIT} and ${DOOR} stopped; scratch cluster dropped; ${FOLDER} removed`);
    return 0;
  }
  const checkpoint = args.length === 1 && args[0] === '--checkpoint';
  if (verb === 'pg-restart' && (args.length === 0 || checkpoint)) {
    if (!existsSync(PG_ETC) || !running()) stop('no replica runs on the scratch cluster (start one with --saves postgres)');
    try {
      if (checkpoint) await restartAtCheckpoint();
      else restartScratch(false);
    } catch (error) {
      stop(error instanceof Error ? error.message : String(error));
    }
    return 0;
  }
  const bounds = verb === 'start' ? limits(args) : null;
  if (bounds === null) stop('usage: replica.mjs start <seconds 60-3900> <workers 1-4> <seats 1-64> <cells> [memory|postgres] | pg-restart [--checkpoint] | stop');
  // One start at a time, held for the whole run: a second waits for nothing and stops, so it never wipes the first's folder
  // or stops its units (flock -E 75 on a lock in /run, which a reboot clears).
  if (test === undefined && process.env.WILDSHARD_REPLICA_LOCKED !== '1') {
    const locked = spawnSync('/usr/bin/flock', ['-n', '-E', '75', `/run/${UNIT}.lock`, process.execPath, process.argv[1] ?? '', ...process.argv.slice(2)],
      { stdio: 'inherit', env: { ...CLEAN, WILDSHARD_REPLICA_LOCKED: '1' } });
    if (locked.status === 75) stop(`another replica start holds /run/${UNIT}.lock: one replica at a time`);
    return locked.status ?? 1;
  }
  if (running()) stop(`${UNIT} is already running: one replica at a time (stop it with: sudo wildshard-config replica stop)`);
  // Under the lock with no replica running, a door or folder left by a killed start is stale: it goes first.
  end();
  const host = exec('/usr/bin/tailscale', ['ip', '-4']).stdout?.trim().split('\n')[0] ?? '';
  if (!/^100\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(host)) stop(`the box has no tailnet address (${host === '' ? 'none' : host}): the replica's door opens only there`);

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
  // The box's UMASK 027 would leave it 0640 root's, unreadable by the replica's dynamic user (MP1.2.d3's first run), so the mode is set.
  writeFileSync(join(FOLDER, 'release.json'), own.text, { mode: 0o644 });
  chmodSync(join(FOLDER, 'release.json'), 0o644);

  const database = bounds.saves === 'postgres' ? makeScratch() : 'memory:';
  const words = unitArgs({ ...bounds, host, publicKey: own.publicKey, folder: FOLDER, database }), door = doorArgs({ seconds: bounds.seconds, host });
  if (exec('/usr/bin/systemd-run', door).status !== 0) { end(); stop(`${DOOR} did not open ${host}:${String(PORT)}`); }
  // The first stdout line says which build runs, so mmo-bots.mjs checks it against the bots' own before a hello.
  console.info(JSON.stringify({ at: 'replica', build: release.engineBuild, serial: release.serial, host, port: PORT, cpus: CPUS, seconds: bounds.seconds, saves: bounds.saves }));
  say('run', `${UNIT} on ${host}:${String(PORT)}, CPUs ${CPUS}, ${String(bounds.workers)} workers, ${String(bounds.seats)} seats, at most ${String(bounds.seconds)} s`);
  const served = exec('/usr/bin/systemd-run', words, { inherit: true });
  end();
  say('ok', `${UNIT} ended (${String(served.status)}); ${DOOR} closed; ${FOLDER} removed`);
  return served.status ?? 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(await main());
