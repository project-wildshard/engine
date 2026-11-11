#!/usr/bin/env node
// MMO-PLAN MP0.4: real-socket bots from this Mac (J202), against an isolated production-shaped replica or the staging socket.
// Never production (J205): there is no flag for it, and the bots refuse any socket but loopback and staging.
//   node scripts/mmo-bots.mjs replica [--bots 32] [--seconds 120] [--seats 32] [--workers 4] [--cells driftwood-isle] [--database <url>]
//   node scripts/mmo-bots.mjs staging [--bots 4] [--seconds 60]
// Both read the signed staging release file and check it against the public key setup.sh pins. The bots are built from that
// release's own commit (its tree, an offline install, build-server's `--entry`), so their build and wire are the server's.
// `replica` runs that release's exact server bundle (downloaded, SHA-256 checked) on loopback, with production's shape: its
// channel settings, 4 workers, 32 seats, Driftwood, packs read from R2, memory saves unless --database names a disposable one,
// and nothing sent off the Mac; each bot says its own address, as the door reads a proxy's. Its worker readings (tick p95, drops, RSS) join the bots' facts. `staging` joins the staging
// socket within its seats (16 by staging.env), leaving room for people, and at most 4 (one address); staging's 2 workers (J202) are its own setting.
// Everything goes in tmp/mmo-bots/<stamp>/, and the release tree is removed after the run; the report stays.
import { execFileSync, spawn } from 'node:child_process';
import { createHash, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = resolve(import.meta.dirname, '..');
const ORIGIN = 'https://wildshard-packs.wildshard.workers.dev', BUNDLES = 'https://github.com/project-wildshard/engine/releases/download';
const STAGING = 'wss://wildshard.tailb41b20.ts.net:8443', STAGING_SEATS = 16, STAGING_HEADROOM = 4, REPLICA_PORT = 18796;
// The door's SOCKETS_PER_IP: through Funnel every bot is this Mac's one address, and no header pretends otherwise.
const PER_ADDRESS = 4;
const [mode = '', ...rest] = process.argv.slice(2);
const { values } = parseArgs({ args: rest, options: { bots: { type: 'string' }, seconds: { type: 'string' }, seats: { type: 'string', default: '32' }, workers: { type: 'string', default: '4' },
  cells: { type: 'string', default: 'driftwood-isle' }, database: { type: 'string', default: 'memory:' }, keep: { type: 'boolean', default: false } } });
if (mode !== 'replica' && mode !== 'staging') { console.error('usage: mmo-bots.mjs replica|staging [--bots N] [--seconds S]'); process.exit(2); }
const bots = Number(values.bots ?? (mode === 'replica' ? 32 : 2)), seconds = Number(values.seconds ?? (mode === 'replica' ? 120 : 60));
if (!Number.isInteger(bots) || bots < 1 || bots > 64 || !Number.isFinite(seconds) || seconds < 5 || seconds > 3600) throw new Error('--bots 1..64, --seconds 5..3600');
const stamp = new Date().toISOString().replace(/[-:]/gu, '').replace(/\..*/u, 'Z'), work = join(ROOT, 'tmp/mmo-bots', stamp), tag = `${mode === 'replica' ? 'r' : 's'}${stamp.slice(9, 15)}`;
mkdirSync(work, { recursive: true });
/** @param {Record<string, unknown>} line */
const note = line => { const text = JSON.stringify({ at: 'mmo-bots', ...line }); console.info(text); writeFileSync(join(work, 'run.log'), `${text}\n`, { flag: 'a' }); };

// --- The release, as the VPS reads it: signed, pinned.
const key = /^EXPECTED_RELEASE_PUBLIC_KEY=([0-9a-f]+)$/mu.exec(readFileSync(join(ROOT, 'scripts/vps/setup.sh'), 'utf8'))?.[1];
if (key === undefined) throw new Error('No pinned release key in scripts/vps/setup.sh');
const signed = await (await fetch(`${ORIGIN}/releases/staging.json`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) })).json();
if (!verify(null, Buffer.from(signed.body), createPublicKey({ key: Buffer.from(key, 'hex'), format: 'der', type: 'spki' }), Buffer.from(signed.signature, 'hex'))) throw new Error('The staging release file has a bad signature');
/** @type {{ channel: string, serial: number, engineBuild: string, saveEpoch: number, shards: { slug: string, revision: number }[], bundle: { name: string, sha256: string }, socket: string }} */
const release = JSON.parse(signed.body);
if (release.channel !== 'staging' || !/^[0-9a-f]{40}$/u.test(release.engineBuild)) throw new Error('Unexpected staging release');
note({ step: 'release', channel: release.channel, serial: release.serial, build: release.engineBuild, socket: release.socket });

// --- Staging's seats, before a single hello: people first.
const health = async () => /** @type {{ build: string, players: number, cells: number, workers: number }} */ (await (await fetch(`${STAGING.replace('wss:', 'https:')}/health`, { signal: AbortSignal.timeout(15_000) })).json());
if (mode === 'staging') {
  if (release.socket.replace(/\/$/u, '') !== STAGING) throw new Error(`The staging release names ${release.socket}, not ${STAGING}`);
  const before = await health();
  note({ step: 'staging-health', ...before });
  if (before.build !== release.engineBuild) throw new Error(`Staging serves ${before.build}, and its release names ${release.engineBuild}: wait for the pull`);
  if (bots > PER_ADDRESS) throw new Error(`The door seats ${String(PER_ADDRESS)} sockets per address, and every staging bot is this Mac's: --bots ${String(PER_ADDRESS)} at most`);
  const free = STAGING_SEATS - before.players - STAGING_HEADROOM;
  if (bots > free) throw new Error(`Staging has ${String(before.players)} of ${String(STAGING_SEATS)} seats taken; at most ${String(Math.max(0, free))} bots leave ${String(STAGING_HEADROOM)} for people`);
}

// --- The bots, built from the release's own tree with this checkout's entry.
const tree = join(work, 'src'), out = join(work, 'build');
const git = (/** @type {string[]} */ args) => execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 30 });
try { git(['cat-file', '-e', `${release.engineBuild}^{commit}`]); } catch { git(['fetch', '--quiet', 'origin', release.engineBuild]); }
mkdirSync(tree, { recursive: true });
execFileSync('tar', ['-x', '-C', tree], { input: git(['archive', release.engineBuild]) });
copyFileSync(join(ROOT, 'test/fixtures/dedicated/mmoBotsEntry.ts'), join(tree, 'test/fixtures/dedicated/mmoBotsEntry.ts'));
let begun = performance.now();
execFileSync('pnpm', ['install', '--frozen-lockfile', '--prefer-offline', '--ignore-scripts', '--reporter=silent'], { cwd: tree, stdio: 'inherit', env: { ...process.env, CI: '1' } });
execFileSync(process.execPath, ['scripts/build-server.mjs', '--build', release.engineBuild, '--out', out, '--entry', 'mmoBots=test/fixtures/dedicated/mmoBotsEntry.ts'], { cwd: tree, stdio: ['ignore', 'ignore', 'inherit'] });
note({ step: 'built', seconds: Math.round((performance.now() - begun) / 1000), from: release.engineBuild });

// --- The replica: the release's server bundle on loopback, production's shape, its own key and file.
/** @type {import('node:child_process').ChildProcess | null} */
let room = null;
/** @type {{ players: number, p95: number, max: number, drops: number, ticksPerSecond: number, rss: number }[]} */
const readings = [];
let url = STAGING;
if (mode === 'replica') {
  const tarball = join(work, 'server.tar.gz'), served = join(work, 'server');
  const bytes = Buffer.from(await (await fetch(`${BUNDLES}/${release.bundle.name}`, { signal: AbortSignal.timeout(300_000) })).arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== release.bundle.sha256) throw new Error('The release bundle differs from its SHA-256');
  writeFileSync(tarball, bytes); mkdirSync(served, { recursive: true }); execFileSync('tar', ['-xzf', tarball, '-C', served]);
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const body = JSON.stringify({ channel: 'production', serial: 1, engineBuild: release.engineBuild, saveEpoch: release.saveEpoch, shards: release.shards });
  writeFileSync(join(work, 'release.json'), JSON.stringify({ body, signature: sign(null, Buffer.from(body), privateKey).toString('hex') }));
  const env = { PATH: process.env['PATH'] ?? '', HOME: process.env['HOME'] ?? '', PACK_ORIGIN: ORIGIN, PACK_CACHE: join(work, 'packs'), DATABASE_URL: values.database, SEAT_SECRET: randomBytes(32).toString('hex'),
    HOST: '127.0.0.1', PORT: String(REPLICA_PORT), RELEASE_CHANNEL: 'production', RELEASE_URL: pathToFileURL(join(work, 'release.json')).href,
    RELEASE_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'der' }).toString('hex'), WORLD_CELLS: values.cells, WORLD_WORKERS: values.workers, WORLD_SEATS: values.seats,
    TELEMETRY_URL: '', ERRORS_URL: '', SENTRY_DSN: '', RECORD_TAG: '' };
  const log = join(work, 'server.jsonl');
  room = spawn(process.execPath, [join(served, 'main.mjs')], { cwd: served, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let buffer = '', ready = false;
  room.stdout?.on('data', (/** @type {Buffer} */ chunk) => {
    writeFileSync(log, chunk, { flag: 'a' }); buffer += chunk.toString();
    for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try { const row = JSON.parse(line); if (row.at === 'worker') { ready = true; readings.push(row); } } catch { /* kept in the log */ }
    }
  });
  room.stderr?.on('data', (/** @type {Buffer} */ chunk) => { writeFileSync(log, chunk, { flag: 'a' }); });
  begun = performance.now();
  while (!ready && room.exitCode === null && performance.now() - begun < 180_000) await new Promise(done => { setTimeout(done, 250); });
  if (!ready) throw new Error(`The replica did not boot; see ${log}`);
  url = `ws://127.0.0.1:${String(REPLICA_PORT)}/`;
  note({ step: 'replica', boot: Math.round((performance.now() - begun) / 1000), cells: values.cells, workers: Number(values.workers), seats: Number(values.seats) });
}

// --- The bots
const result = join(work, 'bots.json'), playing = readings.length;
const code = await new Promise(done => {
  const child = spawn(process.execPath, [join(out, 'mmoBots.mjs'), url, release.engineBuild, String(bots), String(seconds), tag, result, mode === 'replica' ? 'forwarded' : 'own'], { stdio: ['ignore', 'pipe', 'inherit'] });
  child.stdout.on('data', (/** @type {Buffer} */ chunk) => { process.stdout.write(chunk); writeFileSync(join(work, 'bots.log'), chunk, { flag: 'a' }); });
  child.on('exit', done);
});
const after = mode === 'staging' ? await health() : null;
if (room !== null) {
  const gone = new Promise(done => { room?.once('exit', done); });
  room.kill('SIGTERM'); await gone;
}
const full = readings.slice(playing).filter(row => row.players === bots);
const report = { ...JSON.parse(readFileSync(result, 'utf8')), mode, exit: code,
  ...(mode === 'staging' ? { stagingAfter: after } : {}),
  ...(full.length === 0 ? {} : { server: { windows: full.length, worstP95: Math.max(...full.map(row => row.p95)), meanP95: Number((full.reduce((sum, row) => sum + row.p95, 0) / full.length).toFixed(3)),
    max: Math.max(...full.map(row => row.max)), drops: full.reduce((sum, row) => sum + row.drops, 0), minTicksPerSecond: Math.min(...full.map(row => row.ticksPerSecond)), rssMB: Math.round(Math.max(...full.map(row => row.rss)) / 1048576) } }) };
writeFileSync(join(work, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
note({ step: 'done', exit: code, seated: report.seated, steady: report.steady, walked: report.walked, sawEveryone: report.sawEveryone, server: report.server ?? null, report: join(work, 'report.json') });
if (!values.keep) for (const path of [tree, out, join(work, 'server'), join(work, 'server.tar.gz'), join(work, 'packs')]) rmSync(path, { recursive: true, force: true });
process.exit(Number(code));
