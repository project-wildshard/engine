#!/usr/bin/env node
// WIRE-STABILITY WR9: two epoch-2 releases at adjacent wire minors play through J174's grace, both ways, on one save database.
//   node src/scripts/wire-pair.mjs [--old v0.1.42] [--new v0.1.46] [--grace-ms 60000] [--work-dir tmp/<lane>/wire-pair] [--keep]
// Each release's own server bundle (its GitHub release asset) runs on loopback with production's shape against one disposable
// Postgres (Docker, tmpfs), and one phone built from each release's own tree (`test/fixtures/dedicated/wirePairEntry.ts`, its
// NetClient and wire minor) plays the whole run as one device:
//   1. the old room seats both phones: the new phone is one wire minor ahead of its room;
//   2. a signed release file names the new build: the old room counts down (J174), saves everyone and says `restart`; the new
//      room boots on the same database and both phones come back where they stood: the old phone is one minor behind its room;
//   3. a release file names the old build again (a rollback): the new room counts down and saves, the old room reads the saves
//      the newer build wrote, and both phones come back where they stood again.
// Pass: every phone is seated in all three rooms, hears each countdown name the next build, is told `restart` (never `reload`,
// `retry` or `refused`), and each next seat's resume stands within 2 m of the last pose the phone saw. The report says each
// release's wire package and minor, the bundle's SHA-256, every seat and the database's save rows.
// J205: loopback only; nothing is sent off this Mac but the bundle, pack and catalogue reads (packs.wildshard.io, GitHub).
// Everything goes in tmp/wire-pair/<stamp>/ (or --work-dir under tmp/); the trees and bundles go after the run, the report stays.
import { agentFetch as fetch } from './agent-requests.mjs';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = absolute(import.meta.dirname, '..', '..');
const RELEASES = 'https://releases.wildshard.io';
const ORIGIN = 'https://packs.wildshard.io', BUNDLES = 'https://github.com/project-wildshard/engine/releases/download';
const POSTGRES_IMAGE = 'pgvector/pgvector:pg17', PORT = 18797, CELL = 'driftwood-isle', TOLERANCE_M = 2;
const { values } = parseArgs({ options: { old: { type: 'string', default: 'v0.1.42' }, new: { type: 'string', default: 'v0.1.46' },
  'grace-ms': { type: 'string', default: '60000' }, 'work-dir': { type: 'string' }, keep: { type: 'boolean', default: false } } });
const graceMs = Number(values['grace-ms']);
if (!/^v\d+\.\d+\.\d+$/u.test(values.old) || !/^v\d+\.\d+\.\d+$/u.test(values.new) || !Number.isInteger(graceMs) || graceMs < 5_000 || graceMs > 120_000)
  throw new Error('--old and --new are release tags; --grace-ms 5000..120000');
const workRoot = absolute(ROOT, 'tmp'), workBase = absolute(ROOT, values['work-dir'] ?? 'tmp/wire-pair');
if (workBase !== workRoot && !workBase.startsWith(`${workRoot}/`)) throw new Error('--work-dir stays under tmp/');
const stamp = new Date().toISOString().replaceAll(/[-:]/gu, '').replace(/\..*/u, 'Z'), work = join(workBase, stamp);
mkdirSync(work, { recursive: true });
const started = performance.now(), seconds = () => Math.round((performance.now() - started) / 1000);
/** @param {Record<string, unknown>} line */
const note = line => { const text = JSON.stringify({ at: 'wire-pair', s: seconds(), ...line }); console.info(text); writeFileSync(join(work, 'run.log'), `${text}\n`, { flag: 'a' }); };
const git = (/** @type {string[]} */ args) => execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 30 });
const sleep = async (/** @type {number} */ ms) => { await new Promise(resolve => { setTimeout(resolve, ms); }); };
/** A bounded wait on something this script itself started. */
async function until(/** @type {() => boolean} */ done, /** @type {number} */ ms, /** @type {string} */ what) {
  const end = performance.now() + ms;
  while (!done()) { if (performance.now() > end) throw new Error(`Timed out: ${what}`); await sleep(250); }
}

// --- The release's shards and item catalogue, as staging signs them (the packs every recent build cooked).
const key = /^EXPECTED_RELEASE_PUBLIC_KEY=([0-9a-f]+)$/mu.exec(readFileSync(join(ROOT, 'src/scripts/vps/setup.sh'), 'utf8'))?.[1];
if (key === undefined) throw new Error('No pinned release key in src/scripts/vps/setup.sh');
const signed = await (await fetch(`${RELEASES}/staging.json`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) })).json();
if (!verify(null, Buffer.from(signed.body), createPublicKey({ key: Buffer.from(key, 'hex'), format: 'der', type: 'spki' }), Buffer.from(signed.signature, 'hex'))) throw new Error('The staging release file has a bad signature');
/** @type {{ saveEpoch: number, shards: { slug: string, revision: number }[], items?: unknown }} */
const staging = JSON.parse(signed.body);

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];
let database = '';
const cleanup = () => {
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  if (database !== '') { try { execFileSync('docker', ['rm', '-f', database], { stdio: 'ignore' }); } catch { /* already gone */ } database = ''; }
};
process.once('exit', cleanup);
for (const [signal, code] of /** @type {const} */ ([['SIGINT', 130], ['SIGTERM', 143]])) process.once(signal, () => { cleanup(); process.exit(code); });

/**
 * One release: its commit, its server bundle (the release asset, SHA-256 recorded) and its phone, built from its own tree.
 * @param {string} tag
 */
function release(tag) {
  try { git(['rev-parse', '--verify', `${tag}^{commit}`]); } catch { git(['fetch', '--quiet', 'origin', 'tag', tag]); }
  const commit = git(['rev-parse', `${tag}^{commit}`]).toString().trim(), home = join(work, tag), tree = join(home, 'src');
  mkdirSync(tree, { recursive: true });
  execFileSync('tar', ['-x', '-C', tree], { input: git(['archive', commit]) });
  copyFileSync(join(ROOT, 'test/fixtures/dedicated/wirePairEntry.ts'), join(tree, 'test/fixtures/dedicated/wirePairEntry.ts'));
  // CI=1 keeps the install non-interactive; --config.ci=false keeps the global store on, which pnpm drops under ci (GVS G9)
  execFileSync('pnpm', ['install', '--frozen-lockfile', '--prefer-offline', '--ignore-scripts', '--reporter=silent', '--config.ci=false'], { cwd: tree, stdio: 'inherit', env: { ...process.env, CI: '1' } });
  execFileSync(process.execPath, ['src/scripts/build-server.mjs', '--build', commit, '--out', join(home, 'phone'), '--entry', 'wirePair=test/fixtures/dedicated/wirePairEntry.ts'], { cwd: tree, stdio: ['ignore', 'ignore', 'inherit'] });
  const wire = JSON.parse(readFileSync(join(tree, 'node_modules/@wildshard/wire/package.json'), 'utf8')).version;
  const minor = Number(/WIRE_MINOR = (\d+)/u.exec(readFileSync(join(tree, 'node_modules/@wildshard/wire/lib/src/major.js'), 'utf8'))?.[1]);
  const bundle = join(home, 'server.tar.gz'), served = join(home, 'server');
  execFileSync('curl', ['-fsSL', '-o', bundle, `${BUNDLES}/${tag}/engine-server-${commit}.tar.gz`]);
  mkdirSync(served, { recursive: true });
  execFileSync('tar', ['-xzf', bundle, '-C', served]);
  const sha256 = createHash('sha256').update(readFileSync(bundle)).digest('hex');
  note({ step: 'release', tag, commit, wire, minor, bundle: sha256 });
  return { tag, commit, wire, minor, sha256, served, phone: join(home, 'phone', 'wirePair.mjs') };
}
const older = release(values.old), newer = release(values.new);
if (newer.minor !== older.minor + 1) throw new Error(`${newer.tag} binds wire minor ${String(newer.minor)} and ${older.tag} binds ${String(older.minor)}: not adjacent minors`);

// --- One disposable Postgres, on loopback, in memory.
const password = randomBytes(18).toString('hex');
database = `wire-pair-${stamp.toLowerCase()}`;
execFileSync('docker', ['run', '-d', '--rm', '--name', database, '-e', `POSTGRES_PASSWORD=${password}`, '-p', `127.0.0.1:${String(PORT + 1)}:5432`, '--tmpfs', '/var/lib/postgresql/data', POSTGRES_IMAGE], { stdio: 'ignore' });
const ready = () => { try { execFileSync('docker', ['exec', database, 'pg_isready', '-U', 'postgres', '-h', '127.0.0.1'], { stdio: 'ignore' }); return true; } catch { return false; } };
await until(ready, 60_000, 'Postgres');
const databaseUrl = `postgres://postgres:${password}@127.0.0.1:${String(PORT + 1)}/postgres`;
const sql = (/** @type {string} */ query) => execFileSync('docker', ['exec', database, 'psql', '-U', 'postgres', '-At', '-F', '|', '-c', query], { encoding: 'utf8' }).trim();

// --- The signed release file the rooms read: this run's own key, production's channel.
const { publicKey, privateKey } = generateKeyPairSync('ed25519'), releaseFile = join(work, 'release.json');
const publish = (/** @type {number} */ serial, /** @type {{ commit: string }} */ build) => {
  const body = JSON.stringify({ channel: 'production', serial, engineBuild: build.commit, saveEpoch: staging.saveEpoch, shards: staging.shards, ...(staging.items === undefined ? {} : { items: staging.items }) });
  writeFileSync(releaseFile, JSON.stringify({ body, signature: sign(null, Buffer.from(body), privateKey).toString('hex') }));
  note({ step: 'published', serial, build: build.commit });
};

/** @typedef {{ child: import('node:child_process').ChildProcess, listening: boolean, exit: number | null, lines: Record<string, unknown>[] }} Room */
/** @param {ReturnType<typeof release>} build @param {string} name @returns {Promise<Room>} */
async function room(build, name) {
  const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', PACK_ORIGIN: ORIGIN, PACK_CACHE: join(work, 'packs'), DATABASE_URL: databaseUrl, SEAT_SECRET: randomBytes(32).toString('hex'),
    HOST: '127.0.0.1', PORT: String(PORT), RELEASE_CHANNEL: 'production', RELEASE_URL: pathToFileURL(releaseFile).href, RELEASE_POLL_MS: '2000', GRACE_MS: String(graceMs),
    RELEASE_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'der' }).toString('hex'), WORLD_CELLS: CELL, WORLD_WORKERS: '1', WORLD_SEATS: '8',
    TELEMETRY_URL: '', ERRORS_URL: '', SENTRY_DSN: '', RECORD_TAG: '' };
  const child = spawn(process.execPath, [join(build.served, 'main.mjs')], { cwd: build.served, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  /** @type {Room} */
  const made = { child, listening: false, exit: null, lines: [] };
  const log = join(work, `${name}.jsonl`);
  let buffer = '';
  child.stdout?.on('data', (/** @type {Buffer} */ chunk) => {
    writeFileSync(log, chunk, { flag: 'a' }); buffer += chunk.toString();
    for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try { const row = JSON.parse(line); made.lines.push(row); if (row.at === 'server.listening') made.listening = true; } catch { /* kept in the log */ }
    }
  });
  child.stderr?.on('data', (/** @type {Buffer} */ chunk) => { writeFileSync(log, chunk, { flag: 'a' }); });
  child.once('exit', code => { made.exit = code ?? -1; });
  await until(() => made.listening || made.exit !== null, 240_000, `${name} to listen`);
  if (!made.listening) throw new Error(`${name} did not listen (exit ${String(made.exit)}); see ${log}`);
  note({ step: 'room', name, build: build.commit, minor: build.minor });
  return made;
}

// --- The phones: one per release, one device each for the whole run.
/** @typedef {{ device: string, minor: number, refusedDials: number, seats: { resume: { at?: { x: number, y: number, z: number } } | null, last: { x: number, y: number, z: number } | null, countdowns: { build: string }[], ended: string | null, frames: number }[] }} PhoneReport */
const phones = [older, newer].map((build, index) => {
  const device = `device:wp-${stamp.slice(9, 15)}-${index === 0 ? 'old' : 'new'}`, result = join(work, `phone-${index === 0 ? 'old' : 'new'}.json`);
  return { build, device, result, child: /** @type {import('node:child_process').ChildProcess | null} */ (null), address: `198.18.0.${String(index + 1)}` };
});
/** A phone's report, or null before its first (a write caught halfway reads as none). */
const read = (/** @type {typeof phones[number]} */ phone) => {
  try { return /** @type {PhoneReport | null} */ (existsSync(phone.result) ? JSON.parse(readFileSync(phone.result, 'utf8')) : null); } catch { return null; }
};
const seated = (/** @type {number} */ count) => () => phones.every(phone => { const seats = (read(phone)?.seats ?? []).filter(seat => seat.frames > 0); return seats.length >= count && (seats[count - 1]?.frames ?? 0) > 30; });

const rooms = [];
try {
  publish(1, older);
  const first = await room(older, 'room-1-old');
  rooms.push(first);
  for (const phone of phones) {
    phone.child = spawn(process.execPath, [phone.build.phone, `ws://127.0.0.1:${String(PORT)}/`, phone.build.commit, phone.device, phone.address, phone.result], { stdio: ['ignore', 'inherit', 'inherit'] });
    children.push(phone.child);
  }
  await until(seated(1), 60_000, 'both phones seated in the old room');
  note({ step: 'seated', room: 1 });
  await sleep(15_000);

  publish(2, newer);
  await until(() => first.exit !== null, graceMs + 120_000, 'the old room to count down and drain');
  note({ step: 'drained', room: 1, exit: first.exit });
  const second = await room(newer, 'room-2-new');
  rooms.push(second);
  await until(seated(2), 60_000, 'both phones back in the new room');
  note({ step: 'seated', room: 2 });
  await sleep(15_000);

  publish(3, older);
  await until(() => second.exit !== null, graceMs + 120_000, 'the new room to count down and drain');
  note({ step: 'drained', room: 2, exit: second.exit });
  const third = await room(older, 'room-3-old');
  rooms.push(third);
  await until(seated(3), 60_000, 'both phones back in the old room');
  note({ step: 'seated', room: 3 });
  await sleep(10_000);

  for (const phone of phones) phone.child?.kill('SIGTERM');
  await until(() => phones.every(phone => phone.child?.exitCode !== null), 20_000, 'the phones to leave');
  third.child.kill('SIGTERM');
  await until(() => third.exit !== null, 60_000, 'the last room to drain');

  // --- The verdict.
  const builds = [older, newer, older], problems = /** @type {string[]} */ ([]);
  const phoneReports = phones.map(phone => {
    const said = read(phone);
    if (said === null) { problems.push(`${phone.device} wrote no report`); return null; }
    if (said.minor !== phone.build.minor) problems.push(`${phone.device} says wire minor ${String(said.minor)}, its tree ${String(phone.build.minor)}`);
    const seats = said.seats.filter(seat => seat.frames > 0);
    if (seats.length !== 3) problems.push(`${phone.device} was seated ${String(seats.length)} times, not 3`);
    const steps = seats.slice(1, 3).map((seat, index) => {
      const before = seats[index], at = seat.resume?.at, last = before?.last;
      const heard = before?.countdowns.some(countdown => countdown.build === builds[index + 1]?.commit) ?? false;
      const metres = at === undefined || last === null || last === undefined ? Number.NaN : Math.hypot(at.x - last.x, at.z - last.z);
      if (!heard) problems.push(`${phone.device} heard no countdown to room ${String(index + 2)}'s build`);
      if (before?.ended !== 'restart') problems.push(`${phone.device}'s seat ${String(index + 1)} ended ${String(before?.ended)}, not restart`);
      if (!(metres <= TOLERANCE_M)) problems.push(`${phone.device} came back ${String(metres)} m from where it stood`);
      return { room: index + 2, heardCountdown: heard, endedBefore: before?.ended ?? null, resumeMetres: Number(metres.toFixed(3)) };
    });
    // The last seat ends when the driver stops the phone (its own leave); no seat may end in a refusal.
    for (const seat of said.seats) if (seat.ended === 'reload' || seat.ended === 'retry' || seat.ended === 'refused') problems.push(`${phone.device} was told ${seat.ended}`);
    return { device: phone.device, release: phone.build.tag, minor: said.minor, seats: seats.length, refusedDials: said.refusedDials, steps };
  });
  for (const [index, made] of rooms.entries()) if (index < 2 && made.exit !== 0) problems.push(`room ${String(index + 1)} exited ${String(made.exit)} after its grace`);
  const graces = rooms.slice(0, 2).map(made => made.lines.find(line => line.at === 'grace') ?? null);
  if (graces.some(line => line === null)) problems.push('a room drained without logging its grace');
  const saves = sql('select player_id, reason, seq from player_save order by player_id').split('\n').filter(Boolean);
  const report = { wr9: 'wire-pair', pass: problems.length === 0, problems, graceMs, cell: CELL,
    releases: [older, newer].map(build => ({ tag: build.tag, commit: build.commit, wire: build.wire, minor: build.minor, bundleSha256: build.sha256 })),
    rooms: rooms.map((made, index) => ({ room: index + 1, release: builds[index]?.tag, exit: made.exit, grace: graces[index] ?? null })),
    phones: phoneReports, saves };
  writeFileSync(join(work, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  note({ step: 'done', pass: report.pass, problems, report: join(work, 'report.json') });
  process.exitCode = report.pass ? 0 : 1;
} finally {
  cleanup();
  if (!values.keep) for (const build of [older, newer]) for (const path of ['src', 'phone', 'server', 'server.tar.gz']) rmSync(join(work, build.tag, path), { recursive: true, force: true });
  if (!values.keep) rmSync(join(work, 'packs'), { recursive: true, force: true });
}
