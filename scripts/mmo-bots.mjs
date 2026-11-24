#!/usr/bin/env node
// MMO-PLAN MP0.4: real-socket bots from this Mac (J202), against an isolated production-shaped replica or the staging socket.
// Never production (J205): there is no flag for it, and the bots refuse any socket but loopback and staging.
//   node scripts/mmo-bots.mjs replica [--bots 32] [--seconds 120] [--seats 32] [--workers 4] [--cells driftwood-isle] [--database <url>]
//   node scripts/mmo-bots.mjs replica --spread --cells driftwood-isle,nalati-grasslands   (MP1.7: local cell distribution)
//   node scripts/mmo-bots.mjs replica --remote wildshard [--cpus 9-13] ...   (MP1.2: the replica on the box's cores, bots on this Mac)
//   node scripts/mmo-bots.mjs replica [--remote wildshard] --server-from <main commit> ...   (MP1.2: that commit's server code)
//   node scripts/mmo-bots.mjs replica --remote wildshard-agent --bots-on-host [--bot-cpus 14-15] ...   (MP1.2: bots on the box too)
//   node scripts/mmo-bots.mjs replica --box [--seconds 1800] ...   (MP1.2.d: the replica on the box's staging CPUs through the
//     allowlisted `wildshard-config replica`, bots on this Mac over the tailnet; no other command reaches the box)
//   node scripts/mmo-bots.mjs replica --box --box-saves postgres --pg-restart-at 120 ...   (MMO-SERVER E7.4b.c: the replica's
//     saves on the box's scratch cluster. Add --pg-restart-checkpoint to arm at that second and restart during a write.)
//   node scripts/mmo-bots.mjs staging [--bots 2] [--seconds 60]   (at most 4: one address)
//   node scripts/mmo-bots.mjs staging --outside-proof --bots 1 --seconds 60   (TC45: public Tunnel, no private health)
//   node scripts/mmo-bots.mjs staging --restart-proof [--bots 4] [--seconds 600]   (MW5, J504: once every bot sits, asks
//     staging-room-restart.yml for one staging restart; each bot must hear why, come back within 2 m and keep what it owns)
//   node scripts/mmo-bots.mjs staging --tailnet ...   (NET-LAG NL3: the same, over staging's tailnet Serve address, no Cloudflare)
// Both read the signed staging release file and check it against the public key setup.sh pins. The bots are built from that
// release's own commit (its tree, an offline install, build-server's `--entry`), so their source and wire match the signed release's claim.
// `replica` runs that release's exact server bundle (downloaded, SHA-256 checked) on loopback, with production's shape: its
// channel settings, 4 workers, 32 seats, Driftwood, packs read from R2, memory saves unless --database names a disposable one,
// and nothing sent off the Mac; each bot says its own address, as the door reads a proxy's. Its worker readings (tick p95, drops, RSS) join the bots' facts. `staging` joins the staging
// socket within its seats (16 by staging.env), leaving room for people, and at most 4 (one address); staging's 2 workers (J202) are its own setting.
// `--remote <ssh host>` (MMO-PLAN MP1.2, "bots on VPS cores", J202 "bots from this MacBook"): the same replica runs on that host as the
// ssh user, pinned to `--cpus` (staging's, so production's players keep theirs), on its loopback only, and an ssh tunnel brings its
// port to this Mac's loopback, so the bots and their forwarded addresses are exactly as on a local replica. The host's directory goes
// when the run ends. It never touches the host's servers, units, env files or databases. Its ssh link keeps itself alive
// (keepalives), so a quiet half hour doesn't end the run early with every bot 'lost'.
// `--bots-on-host` (MP1.2, J266): the bots run on the host as well, pinned to `--bot-cpus` (away from the replica's and both
// servers'), and dial the replica on the host's loopback, so no tunnel is needed: the hardened agent account forwards no ports.
// Their build goes over ssh into the run's host directory, their report comes back over ssh, and the directory goes as before.
// `--server-from <commit>` (MP1.2: measure a speed-up before a staging release carries it): the replica runs that commit's server
// code, built here under the release's build name, so the release's packs still match it. The bots are built from the same
// commit, so their code and wire are the server's exactly. It must descend from the release's build; the report names it
// (`serverFrom`). Every value that reaches the host's shell is a checked slug, number, hex or fixed path.
// Everything goes in tmp/mmo-bots/<stamp>/ by default, or in the bounded `--work-dir tmp/<lane>/...` path; the release tree is
// removed after the run and the report stays.
// oxlint-disable-next-line import/no-unassigned-import -- Install the network marker for this probe.
import './agent-fetch.mjs';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createHash, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = absolute(import.meta.dirname, '..');
const ORIGIN = 'https://packs.wildshard.io', BUNDLES = 'https://github.com/project-wildshard/engine/releases/download';
// MS7.3: only rooms-staging is a live socket. D7 keeps the health read private on the tailnet.
const STAGING_SOCKETS = ['wss://rooms-staging.wildshard.io'], STAGING_HEALTH = 'https://wildshard.tailb41b20.ts.net:8443/health';
const STAGING_SEATS = 16, STAGING_HEADROOM = 4, REPLICA_PORT = 18796;
// `--remote`'s ssh links keep themselves alive, so a quiet half hour doesn't end a run early with every bot 'lost'.
const ALIVE = ['-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=8', '-o', 'TCPKeepAlive=yes'];
// The door's SOCKETS_PER_IP: through Funnel every bot is this Mac's one address, and no header pretends otherwise.
const PER_ADDRESS = 4;
const [mode = '', ...rest] = process.argv.slice(2);
const { values } = parseArgs({ args: rest, options: { bots: { type: 'string' }, seconds: { type: 'string' }, seats: { type: 'string', default: '32' }, workers: { type: 'string', default: '4' },
  cells: { type: 'string', default: 'driftwood-isle' }, database: { type: 'string', default: 'memory:' }, keep: { type: 'boolean', default: false },
  remote: { type: 'string' }, cpus: { type: 'string', default: '9-13' }, 'server-from': { type: 'string' },
  'bots-on-host': { type: 'boolean', default: false }, 'bot-cpus': { type: 'string', default: '14-15' }, tailnet: { type: 'boolean', default: false },
  'work-dir': { type: 'string' }, spread: { type: 'boolean', default: false }, 'outside-proof': { type: 'boolean', default: false }, 'restart-proof': { type: 'boolean', default: false },
  box: { type: 'boolean', default: false }, 'box-saves': { type: 'string', default: 'memory' }, 'pg-restart-at': { type: 'string' },
  'pg-restart-checkpoint': { type: 'boolean', default: false } } });
const outsideProof = values['outside-proof'];
if (outsideProof && (mode !== 'staging' || values.tailnet || values.remote !== undefined || values['bots-on-host']))
  throw new Error('--outside-proof is one public staging client, without tailnet, SSH or a replica');
// MW5 (J504 signs off one staging restart under bots): the restart is staging's own workflow, asked for once the bots sit.
const restartProof = values['restart-proof'];
if (restartProof && (mode !== 'staging' || outsideProof || values.tailnet || values.remote !== undefined || values['bots-on-host']))
  throw new Error('--restart-proof is staging over the public Tunnel, without --outside-proof, tailnet, SSH or a replica');
if (values.spread && (mode !== 'replica' || values.remote !== undefined)) throw new Error('--spread is for a local replica');
const serverFrom = values['server-from'];
if (serverFrom !== undefined && (mode !== 'replica' || !/^[0-9a-f]{40}$/u.test(serverFrom))) throw new Error('--server-from is a full commit, for a replica');
// These reach the host's shell inside the replica's env line: only slugs and whole numbers.
if (!/^[a-z0-9-]+(?:,[a-z0-9-]+)*$/u.test(values.cells) || !/^\d{1,3}$/u.test(values.workers) || !/^\d{1,3}$/u.test(values.seats)) throw new Error('--cells is a slug list; --workers and --seats are whole numbers');
const remote = values.remote;
if (remote !== undefined && (mode !== 'replica' || !/^[\w.@-]+$/u.test(remote) || values.database !== 'memory:')) throw new Error('--remote is a replica on memory saves, named by an ssh host');
if (!/^[\d,-]+$/u.test(values.cpus) || !/^[\d,-]+$/u.test(values['bot-cpus'])) throw new Error('--cpus and --bot-cpus are taskset lists');
const botsOnHost = values['bots-on-host'];
if (botsOnHost && remote === undefined) throw new Error('--bots-on-host needs --remote');
// MP1.2.d: `--box` asks the box's own helper for the replica (staging's signed bundle, staging's CPUs, its tailnet address),
// so the lane never runs an ssh command of its own there. The helper bounds it to 3,900 s: the run plus 7 minutes to boot.
const box = values.box, BOX = 'wildshard-agent', BOX_SLACK = 420;
if (box && (mode !== 'replica' || remote !== undefined || values.database !== 'memory:' || values['server-from'] !== undefined || values.spread
  || !/^[1-4]$/u.test(values.workers) || !/^\d{1,2}$/u.test(values.seats) || Number(values.seats) > 64 || Number(values.seconds ?? 120) + BOX_SLACK > 3900))
  throw new Error('--box is a replica on memory saves from the signed staging bundle: no --remote, --server-from or --spread, 4 workers, 64 seats, 3,480 s at most');
// E7.4b.c: the scratch cluster is the box replica's only Postgres; its one restart is the helper's own verb.
const boxSaves = values['box-saves'], pgRestartAt = values['pg-restart-at'] === undefined ? undefined : Number(values['pg-restart-at']);
const pgRestartCheckpoint = values['pg-restart-checkpoint'];
if ((boxSaves !== 'memory' && boxSaves !== 'postgres') || (boxSaves === 'postgres' && !box)) throw new Error('--box-saves is memory or postgres, with --box');
if (pgRestartAt !== undefined && (boxSaves !== 'postgres' || !/^\d{1,4}$/u.test(values['pg-restart-at'] ?? '') || pgRestartAt < 10 || pgRestartAt >= Number(values.seconds ?? 120)))
  throw new Error('--pg-restart-at is a second inside the run, with --box-saves postgres');
if (pgRestartCheckpoint && (pgRestartAt === undefined || pgRestartAt + 75 >= Number(values.seconds ?? 120)))
  throw new Error('--pg-restart-checkpoint needs --pg-restart-at and more than 75 s of bot time after it');
if (values.tailnet && mode !== 'staging') throw new Error('--tailnet is for staging');
if (mode !== 'replica' && mode !== 'staging') { console.error('usage: mmo-bots.mjs replica|staging [--bots N] [--seconds S]'); process.exit(2); }
const bots = Number(values.bots ?? (outsideProof ? 1 : mode === 'replica' ? 32 : 2)), seconds = Number(values.seconds ?? (mode === 'replica' ? 120 : 60));
if (!Number.isInteger(bots) || bots < 1 || bots > 64 || !Number.isFinite(seconds) || seconds < 5 || seconds > 3600) throw new Error('--bots 1..64, --seconds 5..3600');
if (outsideProof && (bots !== 1 || seconds > 120)) throw new Error('--outside-proof needs --bots 1 and at most 120 seconds');
if (restartProof && (bots > PER_ADDRESS || seconds < 60 || seconds > 900)) throw new Error('--restart-proof needs at most 4 bots and 60 to 900 seconds');
const candidate = outsideProof || restartProof ? execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim() : null;
if ((outsideProof || restartProof) && execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {cwd: ROOT, encoding: 'utf8'}).trim() !== '')
  throw new Error('Commit the outside proof candidate before observing staging');
const workRoot = absolute(ROOT, 'tmp'), workBase = absolute(ROOT, values['work-dir'] ?? 'tmp/mmo-bots');
if (workBase !== workRoot && !workBase.startsWith(`${workRoot}/`)) throw new Error('--work-dir stays under tmp/');
const stamp = new Date().toISOString().replaceAll(/[-:]/gu, '').replace(/\..*/u, 'Z'), work = join(workBase, stamp),
  tag = outsideProof ? `x${stamp.slice(9, 15)}${randomBytes(3).toString('hex')}` : `${mode === 'replica' ? 'r' : 's'}${stamp.slice(9, 15)}`;
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
if (outsideProof && release.socket.replace(/\/$/u, '') !== STAGING_SOCKETS[0]) throw new Error('Outside proof requires the signed public staging Tunnel socket');
note({ step: 'release', channel: release.channel, serial: release.serial,
  ...(outsideProof ? {signedReleaseBuild: release.engineBuild} : {build: release.engineBuild}), socket: release.socket });

// --- Staging's seats, before a single hello: people first.
const health = async () => /** @type {{ build: string, players: number, cells: number, workers: number }} */ (await (await fetch(STAGING_HEALTH, { signal: AbortSignal.timeout(15_000) })).json());
// Checked before the build, so a full staging fails fast, and again just before the first hello, since the build takes a while.
const stagingRoom = async (/** @type {string} */ when) => {
  if (!STAGING_SOCKETS.includes(release.socket.replace(/\/$/u, ''))) throw new Error(`The staging release names ${release.socket}, not one of ${STAGING_SOCKETS.join(', ')}`);
  const before = await health();
  note({ step: 'staging-health', when, ...before });
  if (before.build !== release.engineBuild) throw new Error(`Staging serves ${before.build}, and its release names ${release.engineBuild}: wait for the pull`);
  if (bots > PER_ADDRESS) throw new Error(`The door seats ${String(PER_ADDRESS)} sockets per address, and every staging bot is this Mac's: --bots ${String(PER_ADDRESS)} at most`);
  const free = STAGING_SEATS - before.players - STAGING_HEADROOM;
  if (bots > free) throw new Error(`Staging has ${String(before.players)} of ${String(STAGING_SEATS)} seats taken; at most ${String(Math.max(0, free))} bots leave ${String(STAGING_HEADROOM)} for people`);
};
if (mode === 'staging' && !outsideProof) await stagingRoom('before the build');

// --- The bots, built from the release's own tree with this checkout's entry.
const tree = join(work, 'src'), out = join(work, 'build');
const git = (/** @type {string[]} */ args) => execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 30 });
const requireCandidate = () => {
  if ((outsideProof || restartProof) && (git(['rev-parse', 'HEAD']).toString().trim() !== candidate || git(['status', '--porcelain', '--untracked-files=all']).toString().trim() !== ''))
    throw new Error('Outside proof candidate changed during the run');
};
try { git(['cat-file', '-e', `${release.engineBuild}^{commit}`]); } catch { git(['fetch', '--quiet', 'origin', release.engineBuild]); }
mkdirSync(tree, { recursive: true });
const source = serverFrom ?? release.engineBuild;
if (serverFrom !== undefined) try { git(['merge-base', '--is-ancestor', release.engineBuild, serverFrom]); } catch { throw new Error(`--server-from ${serverFrom} does not descend from the release's ${release.engineBuild}`); }
execFileSync('tar', ['-x', '-C', tree], { input: git(['archive', source]) });
const botFiles = ['mmoBotsEntry.ts', 'mmoBotsGuard.ts', 'mmoBotsStats.ts'];
if (outsideProof) botFiles.push('outsideBotEntry.ts', 'outsideJourney.ts');
if (restartProof) botFiles.push('restartBotEntry.ts', 'restartJourney.ts');
const botEntry = outsideProof ? 'outsideBotEntry' : restartProof ? 'restartBotEntry' : 'mmoBotsEntry';
for (const name of botFiles) copyFileSync(join(ROOT, 'test/fixtures/dedicated', name), join(tree, 'test/fixtures/dedicated', name));
let begun = performance.now();
// CI=1 keeps the install non-interactive; --config.ci=false keeps the global store on, which pnpm drops under ci (GVS G9)
execFileSync('pnpm', ['install', '--frozen-lockfile', '--prefer-offline', '--ignore-scripts', '--reporter=silent', '--config.ci=false'], { cwd: tree, stdio: 'inherit', env: { ...process.env, CI: '1' } });
execFileSync(process.execPath, ['scripts/build-server.mjs', '--build', release.engineBuild, '--out', out, '--entry', `mmoBots=test/fixtures/dedicated/${botEntry}.ts`], { cwd: tree, stdio: ['ignore', 'ignore', 'inherit'] });
note({ step: 'built', seconds: Math.round((performance.now() - begun) / 1000), from: source });
/** `--server-from`: that commit's server from the bots' own tree, under the release's build name, packed as a release bundle is. */
let serverBundle = null;
if (serverFrom !== undefined) {
  serverBundle = join(work, 'server-from.tar.gz');
  execFileSync(process.execPath, ['scripts/build-server.mjs', '--build', release.engineBuild, '--out', join(work, 'server-from'), '--tar', serverBundle], { cwd: tree, stdio: ['ignore', 'ignore', 'inherit'] });
  note({ step: 'server-from', commit: serverFrom, as: release.engineBuild });
}

// --- The replica: the release's server bundle on loopback, production's shape, its own key and file.
/** @type {import('node:child_process').ChildProcess | null} */
let room = null;
/** @type {import('node:child_process').ChildProcess | null} */
let botsChild = null;
/** @type {Promise<void> | null} */
let stopping = null;
/** `--remote`: ends the host's replica and removes its directory. */
let remoteStop = () => { /* local: the replica is a child of this script */ };
/** `--remote`: runs one command on the host; `away` is the run's directory there, under the ssh user's home. */
/** @type {((command: string, input?: Buffer | string, timeout?: number) => Buffer) | null} */
let hostSsh = null;
let away = '';
/** The replica never outlives this script: an error, Ctrl-C or a kill takes it down too. Every caller waits on the one stop,
 * and `room` stays set until the process has gone, so the exit hook can still kill it. */
const stopRoom = async () => {
  stopping ??= (async () => {
    // The bots first: told to stop, they leave their seats (the leave flag) before the replica goes.
    const players = botsChild;
    if (players !== null && players.exitCode === null && players.signalCode === null) {
      const left = new Promise(resolve => { players.once('exit', resolve); });
      // On the host, the ssh client's signal never reaches the bots: they are told there, leave, and the ssh ends with them.
      if (botsOnHost && hostSsh !== null) try { hostSsh(`pkill -TERM -f '[/]${away}/bots/mmoBots.mjs'`, '', 20_000); } catch { /* already gone */ }
      else players.kill('SIGTERM');
      const force = setTimeout(() => { players.kill('SIGKILL'); }, 15_000);
      await left; clearTimeout(force);
    }
    remoteStop();
    const running = room;
    if (running === null || running.exitCode !== null || running.signalCode !== null) return;
    const gone = new Promise(resolve => { running.once('exit', resolve); });
    running.kill('SIGTERM');
    const force = setTimeout(() => { running.kill('SIGKILL'); }, 10_000);
    await gone; clearTimeout(force);
  })();
  await stopping;
};
for (const [signal, code] of /** @type {const} */ ([['SIGINT', 130], ['SIGHUP', 129], ['SIGTERM', 143]])) process.once(signal, () => { void stopRoom().finally(() => { process.exit(code); }); });
process.once('exit', () => { for (const child of [botsChild, room]) if (child !== null && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
try {
/** @type {{ players: number, p95: number, max: number, drops: number, ticksPerSecond: number, rss: number }[]} */
const readings = [];
// NL3 is an explicit private-route control after the signed public socket and matching health checks.
// It is separate from the public allowlist and never selected after a public connection failure.
const tailnetDoor = STAGING_HEALTH.replace(/^https:/u, 'wss:').replace(/\/health$/u, '');
let url = values.tailnet ? tailnetDoor : release.socket.replace(/\/$/u, '');
if (mode === 'replica') {
  const tarball = join(work, 'server.tar.gz'), served = join(work, 'server');
  // `--box`: the box's helper fetches and checks the bundle itself, so nothing is downloaded here.
  const bytes = box ? Buffer.alloc(0) : serverBundle !== null ? readFileSync(serverBundle) : Buffer.from(await (await fetch(`${BUNDLES}/${release.bundle.name}`, { signal: AbortSignal.timeout(300_000) })).arrayBuffer());
  if (!box && serverBundle === null && createHash('sha256').update(bytes).digest('hex') !== release.bundle.sha256) throw new Error('The release bundle differs from its SHA-256');
  if (!box) { writeFileSync(tarball, bytes); mkdirSync(served, { recursive: true }); execFileSync('tar', ['-xzf', tarball, '-C', served]); }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const body = JSON.stringify({ channel: 'production', serial: 1, engineBuild: release.engineBuild, saveEpoch: release.saveEpoch, shards: release.shards });
  writeFileSync(join(work, 'release.json'), JSON.stringify({ body, signature: sign(null, Buffer.from(body), privateKey).toString('hex') }));
  const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', PACK_ORIGIN: ORIGIN, PACK_CACHE: join(work, 'packs'), DATABASE_URL: values.database, SEAT_SECRET: randomBytes(32).toString('hex'),
    HOST: '127.0.0.1', PORT: String(REPLICA_PORT), RELEASE_CHANNEL: 'production', RELEASE_URL: pathToFileURL(join(work, 'release.json')).href,
    RELEASE_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'der' }).toString('hex'), WORLD_CELLS: values.cells, WORLD_WORKERS: values.workers, WORLD_SEATS: values.seats,
    TELEMETRY_URL: '', ERRORS_URL: '', SENTRY_DSN: '', RECORD_TAG: '' };
  const log = join(work, 'server.jsonl');
  /** `--box`: the replica's own first line names the build it runs, which must be the bots'. */
  let boxBuild = '';
  // Armed only once this run's own replica has said it started: a refused start (another lane's bench) must never stop that bench.
  const boxStop = () => { try { execFileSync('ssh', ['-o', 'BatchMode=yes', BOX, 'sudo -n /usr/local/sbin/wildshard-config replica stop'], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 60_000 }); } catch { /* already gone */ } };
  if (box) {
    room = spawn('ssh', ['-o', 'BatchMode=yes', ...ALIVE, BOX, `sudo -n /usr/local/sbin/wildshard-config replica start --seconds ${String(seconds + BOX_SLACK)}`
      + ` --workers ${values.workers} --seats ${values.seats} --cells ${values.cells} --saves ${boxSaves}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    note({ step: 'box', host: BOX, via: 'wildshard-config replica' });
  }
  else if (remote === undefined) room = spawn(process.execPath, [join(served, 'main.mjs')], { cwd: served, env, stdio: ['ignore', 'pipe', 'pipe'] });
  else {
    // The same bundle on the host: it fetches it itself and checks the same SHA-256, and the release file goes over ssh.
    away = `mmo-bench/${stamp}`;
    const ssh = (/** @type {string} */ command, /** @type {Buffer | string} */ input = '', timeout = 0) => execFileSync('ssh', ['-o', 'BatchMode=yes', ...ALIVE, remote, command], { input, stdio: ['pipe', 'pipe', 'inherit'], maxBuffer: 1 << 30, timeout });
    hostSsh = ssh;
    ssh(`mkdir -p ${away}/server && cat > ${away}/release.json`, readFileSync(join(work, 'release.json')));
    // `--server-from` sends its own bundle and its SHA-256; a release's is fetched there and checked against the release.
    const sha = serverBundle === null ? release.bundle.sha256 : createHash('sha256').update(bytes).digest('hex');
    if (serverBundle === null) ssh(`cd ${away} && curl -fsSL -o server.tar.gz ${BUNDLES}/${release.bundle.name}`);
    else ssh(`cat > ${away}/server.tar.gz`, bytes);
    ssh(`cd ${away} && echo '${sha}  server.tar.gz' | sha256sum -c --quiet && tar -xzf server.tar.gz -C server && rm server.tar.gz`);
    const there = { ...env, PACK_CACHE: `$HOME/${away}/packs`, RELEASE_URL: `file://$HOME/${away}/release.json` };
    const words = Object.entries(there).filter(([name]) => name !== 'PATH' && name !== 'HOME').map(([name, value]) => `${name}="${value}"`).join(' ');
    // Bots on the host go first whatever their ssh link did (a dropped link leaves them running there): told, then killed.
    const hostBots = botsOnHost ? `pkill -TERM -f '[/]${away}/bots/mmoBots.mjs' && sleep 8; pkill -KILL -f '[/]${away}/bots/mmoBots.mjs'; ` : '';
    remoteStop = () => { try { ssh(`${hostBots}pkill -TERM -f '[/]${away}/server/main.mjs'; sleep 2; pkill -KILL -f '[/]${away}/server/main.mjs'; rm -rf ${away}`, '', 60_000); } catch { /* the host already cleaned it */ } };
    // Bots on the host dial its loopback themselves; otherwise a tunnel brings the port here.
    const tunnel = botsOnHost ? [] : ['-o', 'ExitOnForwardFailure=yes', '-L', `${String(REPLICA_PORT)}:127.0.0.1:${String(REPLICA_PORT)}`];
    room = spawn('ssh', ['-o', 'BatchMode=yes', ...ALIVE, ...tunnel, remote,
      `cd ${away}/server && exec env ${words} taskset -c ${values.cpus} node "$HOME/${away}/server/main.mjs"`], { stdio: ['ignore', 'pipe', 'pipe'] });
    note({ step: 'remote', host: remote, cpus: values.cpus, dir: `~/${away}`, ...(botsOnHost ? { botsOnHost, botCpus: values['bot-cpus'] } : {}) });
  }
  let buffer = '', ready = false;
  room.stdout?.on('data', (/** @type {Buffer} */ chunk) => {
    writeFileSync(log, chunk, { flag: 'a' }); buffer += chunk.toString();
    for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try { const row = JSON.parse(line); if (row.at === 'replica' && box) { boxBuild = String(row.build); remoteStop = boxStop; } if (row.at === 'worker') { ready = true; readings.push(row); } } catch { /* kept in the log */ }
    }
  });
  room.stderr?.on('data', (/** @type {Buffer} */ chunk) => { writeFileSync(log, chunk, { flag: 'a' }); });
  begun = performance.now();
  const booted = () => ready;
  while (!booted() && room.exitCode === null && performance.now() - begun < 180_000) await new Promise(resolve => { setTimeout(resolve, 250); });
  if (!ready) throw new Error(`The replica did not boot; see ${log}`);
  url = `ws://127.0.0.1:${String(REPLICA_PORT)}/`;
  if (box) {
    if (boxBuild !== release.engineBuild) throw new Error(`The box's replica runs ${boxBuild || 'no named build'}, and the bots are ${release.engineBuild}: staging moved, run again`);
    url = `ws://${new URL(STAGING_HEALTH).hostname}:${String(REPLICA_PORT)}/`;
  }
  note({ step: 'replica', boot: Math.round((performance.now() - begun) / 1000), cells: values.cells, workers: Number(values.workers), seats: Number(values.seats) });
}

// --- The bots
requireCandidate();
if (mode === 'staging' && !outsideProof) await stagingRoom('before the first hello');
const result = join(work, 'bots.json'), playing = readings.length;
// The bot validates the exact target URL before it marks the WebSocket handshake in headers.
const botArgs = [release.engineBuild, String(bots), String(seconds), tag];
if (botsOnHost && hostSsh !== null) {
  // The bots' one bundle (no wasm: their route cursor is plain math) goes to the run's host directory; nothing else of this Mac does.
  hostSsh(`mkdir -p ${away}/bots && cat > ${away}/bots/mmoBots.mjs`, readFileSync(join(out, 'mmoBots.mjs')));
}
/** @type {{startedAt: string, ms: number, checkpointInFlight: true} | null} */
let checkpointRestart = null;
/** MW5: the restart workflow's dispatch, once the bots sit. @type {{ askedAt: string, error?: string } | null} */
let restartAsked = null;
const askRestart = () => {
  if (restartAsked !== null) return;
  restartAsked = { askedAt: new Date().toISOString() };
  execFile('gh', ['workflow', 'run', 'staging-room-restart.yml', '-R', 'project-wildshard/engine', '-f', 'channel=staging'], { timeout: 60_000 }, error => {
    if (error !== null && restartAsked !== null) restartAsked.error = error.message;
    note({ step: 'restart-asked', ...restartAsked });
  });
};
const code = await new Promise(resolve => {
  const child = botsOnHost && remote !== undefined
    ? spawn('ssh', ['-o', 'BatchMode=yes', ...ALIVE, remote, `cd ${away}/bots && exec taskset -c ${values['bot-cpus']} node "$HOME/${away}/bots/mmoBots.mjs" '${url}' ${botArgs.join(' ')} "$HOME/${away}/bots.json" forwarded`], { stdio: ['ignore', 'pipe', 'inherit'] })
    : spawn(process.execPath, [join(out, 'mmoBots.mjs'), url, ...botArgs, result, mode === 'replica' ? 'forwarded' : 'own', values.spread ? values.cells : '', values.tailnet ? 'tailnet' : 'public'], { stdio: ['ignore', 'pipe', 'inherit'] });
  botsChild = child;
  let restart = Promise.resolve();
  // E7.4b.c: at this second, the helper either restarts the scratch cluster or arms a restart during a checkpoint.
  const pgRestart = pgRestartAt === undefined ? null : setTimeout(() => {
    restart = new Promise(_resolve => {
      const asked = performance.now();
      const command = 'sudo -n /usr/local/sbin/wildshard-config replica pg-restart';
      const remoteCommand = `${command}${pgRestartCheckpoint ? ' --checkpoint' : ''}`;
      execFile('ssh', ['-o', 'BatchMode=yes', BOX, remoteCommand], { encoding: 'utf8', timeout: 120_000 }, (error, stdout) => {
        try {
          if (error !== null) throw error instanceof Error ? error : new Error('Scratch restart command failed');
          if (pgRestartCheckpoint) {
            const row = JSON.parse(stdout);
            if (row?.at !== 'scratch.restarted' || row.checkpointInFlight !== true || !Number.isFinite(row.ms)
              || typeof row.startedAt !== 'string' || !Number.isFinite(Date.parse(row.startedAt))) throw new Error('The helper returned no checkpoint restart witness');
            checkpointRestart = { startedAt: row.startedAt, ms: row.ms, checkpointInFlight: true };
          }
          note({ step: 'pg-restart', at: pgRestartAt, ms: Math.round(performance.now() - asked), said: stdout.trim() });
        } catch (failure) {
          note({ step: 'pg-restart', at: pgRestartAt, error: failure instanceof Error ? failure.message : String(failure) });
        } finally {
          _resolve();
        }
      });
    });
  }, pgRestartAt * 1000);
  child.once('exit', () => { if (pgRestart !== null) clearTimeout(pgRestart); });
  child.stdout.on('data', (/** @type {Buffer} */ chunk) => { if (restartProof && chunk.toString().includes('"at":"restart.ready"')) askRestart(); process.stdout.write(chunk); writeFileSync(join(work, 'bots.log'), chunk, { flag: 'a' }); });
  /** @type {ReturnType<typeof setTimeout> | null} */let force = null;
  const watchdog = outsideProof || restartProof ? setTimeout(() => {
    child.kill('SIGTERM'); force = setTimeout(() => {child.kill('SIGKILL');}, 10_000);
  }, (seconds + (restartProof ? 60 : 10)) * 1000) : null;
  child.once('exit', status => {if (watchdog !== null) clearTimeout(watchdog); if (force !== null) clearTimeout(force); void restart.then(() => resolve(status), () => resolve(1));});
});
let exit = typeof code === 'number' ? code : 1;
if (pgRestartCheckpoint && checkpointRestart === null) exit = 1;
if (botsOnHost && hostSsh !== null) writeFileSync(result, hostSsh(`cat ${away}/bots.json`));
/** @type {{complete?:unknown,left?:unknown,signedReleaseBuild?:unknown,url?:unknown,error?:unknown,
 * seated?:unknown,steady?:unknown,walked?:unknown,sawEveryone?:unknown,interArrivalMs?:unknown}} */
let observed = {};
/** @type {string | null} */let failure = null;
try {
  const raw = JSON.parse(readFileSync(result, 'utf8'));
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Bot report must be an object');
  observed = raw;
  requireCandidate();
  if (outsideProof && (observed?.complete !== true || observed?.left !== true || observed?.signedReleaseBuild !== release.engineBuild || observed?.url !== url))
    throw new Error(typeof observed.error === 'string' ? observed.error : 'Outside child did not return its complete, released witness');
  if (restartProof && (observed?.complete !== true || restartAsked === null || restartAsked.error !== undefined))
    throw new Error(typeof observed.error === 'string' ? observed.error : restartAsked?.error ?? 'The bots did not all ride the restart');
} catch (error) {
  if (!outsideProof && !restartProof) throw error;
  exit = 1; failure = error instanceof Error ? error.message : String(error);
}
const after = mode === 'staging' && !outsideProof ? await health() : null;
await stopRoom();
const full = readings.slice(playing).filter(row => values.spread ? row.players > 0 : row.players === bots);
const report = { ...observed, mode, exit, ...(outsideProof ? {outsideProof: true, candidate, signedReleaseBuild: release.engineBuild, releaseSerial: release.serial, url,
  complete: exit === 0 && observed?.complete === true, left: observed?.left === true,
  ...(exit === 0 ? {} : {error: failure ?? (typeof observed.error === 'string' ? observed.error : 'Outside child did not exit successfully')})} : {}), ...(serverFrom === undefined ? {} : { serverFrom }), ...(remote === undefined ? {} : { remote, cpus: values.cpus }),
  ...(botsOnHost ? { botsOnHost, botCpus: values['bot-cpus'] } : {}),
  ...(pgRestartCheckpoint ? { checkpointRestart } : {}),
  ...(restartProof ? { restartProof: true, candidate, restartAsked, ...(failure === null ? {} : { failure }) } : {}),
  ...(mode === 'staging' ? { stagingAfter: after } : {}),
  ...(full.length === 0 ? {} : { server: { windows: full.length, worstP95: Math.max(...full.map(row => row.p95)), meanP95: Number((full.reduce((sum, row) => sum + row.p95, 0) / full.length).toFixed(3)),
    max: Math.max(...full.map(row => row.max)), drops: full.reduce((sum, row) => sum + row.drops, 0), minTicksPerSecond: Math.min(...full.map(row => row.ticksPerSecond)), rssMB: Math.round(Math.max(...full.map(row => row.rss)) / 1048576) } }) };
writeFileSync(join(work, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
note({ step: 'done', exit, ...(outsideProof ? {complete: report.complete, left: report.left, candidate} : {
  seated: report.seated, steady: report.steady, walked: report.walked, sawEveryone: report.sawEveryone, interArrivalMs: report.interArrivalMs ?? null, server: report.server ?? null}), report: join(work, 'report.json') });
process.exitCode = exit;
} finally {
  await stopRoom();
  if (!values.keep) for (const path of [tree, out, join(work, 'server'), join(work, 'server.tar.gz'), join(work, 'packs'), join(work, 'server-from'), join(work, 'server-from.tar.gz')]) rmSync(path, { recursive: true, force: true });
}
process.exit(process.exitCode ?? 1);
