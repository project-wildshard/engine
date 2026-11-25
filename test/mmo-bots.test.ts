// MMO-PLAN MP0.4: the bots' one hard rule (J205): loopback or the staging socket, never production. The bots themselves run
// only from scripts/mmo-bots.mjs against a replica or staging; this checks the guards they carry without opening a socket.
// oxlint-disable-next-line import/no-nodejs-modules -- Read the scripts as text.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Run the driver's argument check only.
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';
import { botCells, botTarget, BOX_REPLICA_SOCKET, SOCKETS_PER_ADDRESS, STAGING_SOCKET, STAGING_SOCKETS, TAILNET_SOCKET } from './fixtures/dedicated/mmoBotsGuard';
import { interArrival } from './fixtures/dedicated/mmoBotsStats';

const entry = readFileSync('test/fixtures/dedicated/mmoBotsEntry.ts', 'utf8'), driver = readFileSync('scripts/mmo-bots.mjs', 'utf8');
const proofDrivers = ['scripts/e7-doctor-proof.mjs', 'scripts/e7-live-staging-proof.mjs', 'scripts/e7-voice-staging-proof.mjs'].map(file => readFileSync(file, 'utf8'));

test('replica cells distribute uneven counts with cell-local peers and refuse unsafe targets', () => {
  const targets = botCells('ws://127.0.0.1:18796/', 5, 'driftwood-isle,nalati-grasslands');
  expect(targets.map(row => [row.cell, row.peers])).toEqual([['driftwood-isle',2],['nalati-grasslands',1],['driftwood-isle',2],['nalati-grasslands',1],['driftwood-isle',2]]);
  expect(targets.map(row => new URL(row.url).searchParams.get('chunk'))).toEqual(targets.map(row => row.cell));
  expect(botCells('ws://127.0.0.1:18796/', 2, '').map(row => row.peers)).toEqual([1,1]);
  for (const cells of ['only-one','a,a','a,b,c,d,e,f','a,b;run','a,']) expect(() => botCells('ws://127.0.0.1:18796/',5,cells)).toThrow(/Spread needs/u);
  expect(() => botCells(STAGING_SOCKET,2,'a,b')).toThrow(/loopback replica only/u);
});

test('the default route accepts loopback and rooms-staging only', () => {
  expect(STAGING_SOCKET).toBe('wss://rooms-staging.wildshard.io');
  expect(STAGING_SOCKETS).toEqual(['wss://rooms-staging.wildshard.io']);
  for (const url of ['ws://127.0.0.1:18796/', 'ws://localhost:18796/', 'ws://[::1]:18796/', 'wss://rooms-staging.wildshard.io', 'wss://rooms-staging.wildshard.io/']) {
    expect(() => botTarget(url, 'own', 2), url).not.toThrow();
  }
  // Retired public sockets, production, other paths/hosts and plaintext all refuse.
  for (const url of ['wss://wildshard.tailb41b20.ts.net:8443', 'wss://wildshard.tailb41b20.ts.net:8443/', 'wss://wildshard.tailb41b20.ts.net', 'wss://wildshard.tailb41b20.ts.net:443/', 'wss://rooms.wildshard.io/', 'wss://rooms.wildshard.io',
    'ws://rooms-staging.wildshard.io/', 'wss://rooms-staging.wildshard.io:8443/', 'wss://rooms-staging.wildshard.io/other', 'ws://wildshard.tailb41b20.ts.net:8443/',
    'wss://wildshard.tailb41b20.ts.net:8443/other', 'wss://wildshard.tailb41b20.ts.net:8443/?x=1', 'ws://10.0.0.5:18796/', 'wss://127.0.0.1:18796/', 'ws://127.0.0.1.example.com/']) {
    expect(() => botTarget(url, 'own', 1), url).toThrow(/J205/u);
  }
  // The guard runs before any bot is made, and the driver copies it beside the entry it builds.
  expect(entry.indexOf("botTarget(url, addresses, bots, route === 'tailnet')")).toBeGreaterThan(0);
  expect(entry.indexOf("botTarget(url, addresses, bots, route === 'tailnet')")).toBeLessThan(entry.indexOf('new RoomBot('));
  expect(driver).toContain("['mmoBotsEntry.ts', 'mmoBotsGuard.ts', 'mmoBotsStats.ts']");
  // Bot sources must never choose a production socket or human release file.
  for (const text of [entry, driver]) {
    expect(text).not.toMatch(/wss:\/\/wildshard\.tailb41b20\.ts\.net/u);
    expect(text).not.toContain('rooms.wildshard.io');
    expect(text).not.toContain('releases/production.json');
  }
  // This browser-source rail denies retired socket literals. Origin, CORS and
  // private-health assertions remain in the actual proof drivers.
  for (const text of proofDrivers) expect(text).not.toMatch(/wss:\/\/wildshard\.tailb41b20\.ts\.net/u);
});

test('private-route diagnostic is explicit, exact and keeps the one-address seat bound', () => {
  expect(() => botTarget(TAILNET_SOCKET, 'own', 2)).toThrow(/J205/u);
  expect(() => botTarget(TAILNET_SOCKET, 'own', 2, true)).not.toThrow();
  expect(() => botTarget(TAILNET_SOCKET, 'own', SOCKETS_PER_ADDRESS + 1, true)).toThrow(/at most 4 sockets/u);
  expect(() => botTarget(TAILNET_SOCKET, 'forwarded', 2, true)).toThrow(/loopback replica only/u);
  for (const url of [STAGING_SOCKET, 'ws://127.0.0.1:18796/', `${TAILNET_SOCKET}/other`, `${TAILNET_SOCKET}/?x=1`, 'wss://rooms.wildshard.io/']) {
    expect(() => botTarget(url, 'own', 2, true), url).toThrow();
  }
  const run = spawnSync(process.execPath, ['scripts/mmo-bots.mjs', 'replica', '--tailnet'], { encoding: 'utf8', timeout: 10_000 });
  expect(run.status).not.toBe(0);
  expect(run.stderr).toContain('--tailnet is for staging');
  expect(run.stdout).not.toContain('release');
});

test('the driver has two modes, neither of them production, and refuses anything else before the network', () => {
  for (const mode of ['production', 'prod', '']) {
    const run = spawnSync(process.execPath, ['scripts/mmo-bots.mjs', mode], { encoding: 'utf8', timeout: 10_000 });
    expect(run.status, mode).toBe(2);
    expect(run.stderr).toContain('usage: mmo-bots.mjs replica|staging');
  }
  expect(driver).toContain("if (mode !== 'replica' && mode !== 'staging')");
});

test('the driver can keep a run in a lane-owned scratch folder', () => {
  expect(driver).toContain("'work-dir': { type: 'string' }");
  expect(driver).toContain("values['work-dir'] ?? 'tmp/mmo-bots'");
  expect(driver).toContain("throw new Error('--work-dir stays under tmp/')");
});

test('forwarded addresses belong to a loopback replica alone; staging gets the one Mac address and the 4-socket door limit', () => {
  expect(() => botTarget(STAGING_SOCKET, 'forwarded', 2)).toThrow(/loopback replica only/u);
  expect(() => botTarget('ws://127.0.0.1:18796/', 'forwarded', 32)).not.toThrow();
  expect(() => botTarget('ws://127.0.0.1:18796/', 'own', SOCKETS_PER_ADDRESS + 1)).toThrow(/at most 4 sockets/u);
  expect(() => botTarget(STAGING_SOCKET, 'own', SOCKETS_PER_ADDRESS + 1)).toThrow(/at most 4 sockets/u);
  expect(() => botTarget('ws://127.0.0.1:18796/', 'spoof', 2)).toThrow(/Unknown address mode/u);
  expect(() => botTarget('ws://127.0.0.1:18796/', 'forwarded', 65)).toThrow(/Between 1 and 64/u);
  expect(SOCKETS_PER_ADDRESS).toBe(4);
  expect(driver).toContain("mode === 'replica' ? 'forwarded' : 'own'");
  expect(driver).toMatch(/^const PER_ADDRESS = 4;$/mu);
  expect(readFileSync('src/server/host/dedicated/world.ts', 'utf8')).toMatch(/const SOCKETS_PER_IP = 4,/u);
});

test('staging keeps seats for people and checks its build and seats again just before a hello', () => {
  expect(driver).toMatch(/STAGING_SEATS = 16, STAGING_HEADROOM = 4/u);
  const seats = driver.indexOf('bots leave'), recheck = driver.indexOf("await stagingRoom('before the first hello')"), bundle = driver.indexOf("spawn(process.execPath, [join(out, 'mmoBots.mjs')");
  expect(seats).toBeGreaterThan(0); expect(seats).toBeLessThan(bundle);
  expect(recheck).toBeGreaterThan(driver.indexOf("execFileSync(process.execPath, ['scripts/build-server.mjs'")); expect(recheck).toBeLessThan(bundle);
  expect(driver).toContain('Staging serves ${before.build}, and its release names ${release.engineBuild}');
});

test('the replica sends nothing off the Mac and runs on loopback with production shape', () => {
  expect(driver).toContain("TELEMETRY_URL: '', ERRORS_URL: '', SENTRY_DSN: ''");
  expect(driver).toContain("HOST: '127.0.0.1'");
  expect(driver).toMatch(/seats: \{ type: 'string', default: '32' \}, workers: \{ type: 'string', default: '4' \}/u);
  expect(driver).toContain("RELEASE_CHANNEL: 'production'");
  expect(driver).toContain('The release bundle differs from its SHA-256');
});

test('every bot leaves with the leave flag, so no held body keeps a staging seat', () => {
  expect(entry).toContain("walker.bot.transport.control('ready', new Uint8Array([LEAVE_FLAG]).buffer)");
  expect(readFileSync('src/server/host/dedicated/socketPump.ts', 'utf8')).toContain('export const LEAVE_FLAG = 1;');
  expect(entry).toContain('const LEAVE_FLAG = 1;');
});

test('the replica is stopped on every way out: the end, an error, or a signal', () => {
  expect(driver).toMatch(/\} finally \{\n {2}await stopRoom\(\);/u);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) expect(driver).toContain(`'${signal}'`);
  expect(driver).toContain("process.once('exit', () => { for (const child of [botsChild, room]) if (child !== null && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });");
  // One stop that every caller waits on, and `room` is never cleared before its process has gone.
  expect(driver).toContain('stopping ??= (async () => {');
  // The bots go first, and leave their seats when told to stop.
  expect(driver.indexOf('players.kill(\'SIGTERM\')')).toBeLessThan(driver.indexOf('running.kill(\'SIGTERM\')'));
  expect(driver).toContain('botsChild = child;');
  expect(entry).toContain('process.once(signal, () => {');
  expect(entry.split("walker.bot.transport.control('ready', new Uint8Array([LEAVE_FLAG]).buffer)").length - 1).toBe(2);
  expect(driver).not.toMatch(/(?<!let )room = null;/u);
  expect(driver).toContain("[['SIGINT', 130], ['SIGHUP', 129], ['SIGTERM', 143]]");
});

test('bots on the host need --remote, dial its loopback with no tunnel, and are told to leave there before the replica stops', () => {
  for (const args of [['--bots-on-host'], ['--remote', 'wildshard-agent', '--bots-on-host', '--bot-cpus', '14;rm']]) {
    const run = spawnSync(process.execPath, ['scripts/mmo-bots.mjs', 'replica', ...args], { encoding: 'utf8', timeout: 10_000 });
    expect(run.status, args.join(' ')).not.toBe(0);
    expect(run.stderr).toMatch(/--bots-on-host needs --remote|--bot-cpus are taskset lists/u);
  }
  expect(driver).toContain("const tunnel = botsOnHost ? [] : ['-o', 'ExitOnForwardFailure=yes', '-L'");
  // The same loopback URL and forwarded addresses as a local replica's bots, pinned to their own cores.
  expect(driver).toContain('exec taskset -c ${values[\'bot-cpus\']} node "$HOME/${away}/bots/mmoBots.mjs" \'${url}\' ${botArgs.join(\' \')} "$HOME/${away}/bots.json" forwarded');
  const tellBots = driver.indexOf("hostSsh(`pkill -TERM -f '[/]${away}/bots/mmoBots.mjs'`, '', 20_000)");
  expect(tellBots).toBeGreaterThan(0); expect(tellBots).toBeLessThan(driver.indexOf("running.kill('SIGTERM')"));
  // A dropped bots link still leaves no bot running: the host stop tells, then kills them before the replica goes.
  expect(driver).toContain("const hostBots = botsOnHost ? `pkill -TERM -f '[/]${away}/bots/mmoBots.mjs' && sleep 8; pkill -KILL -f '[/]${away}/bots/mmoBots.mjs'; ` : '';");
  expect(driver).toContain("ssh(`${hostBots}pkill -TERM -f '[/]${away}/server/main.mjs';");
  // Their report comes back before remoteStop removes the host directory.
  expect(driver.indexOf('hostSsh(`cat ${away}/bots.json`)')).toBeLessThan(driver.indexOf('await stopRoom();\nconst full'));
});

test('the driver passes the allowed URL verbatim and bots mark the handshake in headers', () => {
  expect(driver).toContain("[join(out, 'mmoBots.mjs'), url, ...botArgs, result");
  expect(driver).not.toContain('agentUrl(');
  expect(entry).toContain("...agentHeaders(), 'user-agent': agentUserAgent('node')");
  for (const target of [STAGING_SOCKET, BOX_REPLICA_SOCKET, TAILNET_SOCKET]) {
    expect(() => botTarget(`${target}/?agent=proof`, 'own', 2, target === TAILNET_SOCKET)).toThrow(/J205/u);
  }
});

// NET-LAG NL3: each bot's frame inter-arrival over the play window (p50, p95, max), and all bots' together, so one run says whether
// frames came evenly (a clean 30 Hz server reads p95 near 33 ms) or bunched, and a loopback, a Cloudflare and a tailnet run compare.
test('the report carries frame inter-arrival per bot and over all bots', () => {
  expect(interArrival([])).toBeNull();
  expect(interArrival([33, 34, 33, 32, 33, 120, 33, 33, 34, 33, 33, 33, 33, 33, 33, 33, 33, 33, 33, 66])).toEqual({ gaps: 20, p50: 33, p95: 66, max: 120 });
  expect(interArrival([33.333, 33.333])).toEqual({ gaps: 2, p50: 33.3, p95: 33.3, max: 33.3 });
  expect(entry).toContain('interArrival: interArrival(walker.gaps)');
  expect(entry).toContain('interArrivalMs: interArrival(walkers.flatMap(walker => walker.gaps))');
});

test("MP1.2.d: the box replica's tailnet door takes forwarded bots, and nothing else on the box does", () => {
  expect(BOX_REPLICA_SOCKET).toBe('ws://wildshard.tailb41b20.ts.net:18796');
  expect(() => botTarget(`${BOX_REPLICA_SOCKET}/`, 'forwarded', 32)).not.toThrow();
  for (const url of ['ws://wildshard.tailb41b20.ts.net:8790/', 'ws://wildshard.tailb41b20.ts.net:8791/', 'wss://wildshard.tailb41b20.ts.net:18796/',
    `${BOX_REPLICA_SOCKET}/other`, `${BOX_REPLICA_SOCKET}/?x=1`, 'ws://rooms.wildshard.io:18796/'])
    expect(() => botTarget(url, 'forwarded', 2), url).toThrow(/J205/u);
  // The driver asks the box's allowlisted helper and nothing else, and dials the same door the guard allows.
  expect(driver).toContain('sudo -n /usr/local/sbin/wildshard-config replica start --seconds');
  expect(driver).toContain("'sudo -n /usr/local/sbin/wildshard-config replica stop'");
  expect(driver).toContain('url = `ws://${new URL(STAGING_HEALTH).hostname}:${String(REPLICA_PORT)}/`;');
  expect(driver).toMatch(/REPLICA_PORT = 18796;/u);
  for (const args of [['--box', '--remote', 'wildshard'], ['--box', '--workers', '8'], ['--box', '--seats', '65'], ['--box', '--seconds', '3600'], ['--box', '--spread']]) {
    const run = spawnSync(process.execPath, ['scripts/mmo-bots.mjs', 'replica', ...args], { encoding: 'utf8', timeout: 10_000 });
    expect(run.status, args.join(' ')).not.toBe(0);
    expect(run.stderr, args.join(' ')).toMatch(/--box is a replica on memory saves|--spread is for a local replica/u);
  }
  const staging = spawnSync(process.execPath, ['scripts/mmo-bots.mjs', 'staging', '--box'], { encoding: 'utf8', timeout: 10_000 });
  expect(staging.status).not.toBe(0);
});

test("MP1.2.d: a refused box start never stops another lane's replica", () => {
  // `replica stop` is armed only by this run's own replica line, never before the start is known to be ours.
  expect(driver.split('remoteStop = boxStop').length).toBe(2);
  expect(driver).toContain("if (row.at === 'replica' && box) { boxBuild = String(row.build); remoteStop = boxStop; }");
  const run = spawnSync(process.execPath, ['scripts/mmo-bots.mjs', 'replica', '--box', '--workers', '1;id'], { encoding: 'utf8', timeout: 10_000 });
  expect(run.status).not.toBe(0);
});

test('MMO-SERVER E7.4b.c: scratch saves only on the box replica, and one restart inside the run, through the helper', () => {
  for (const [args, why] of [
    [['replica', '--box-saves', 'postgres'], '--box-saves is memory or postgres, with --box'],
    [['replica', '--box', '--box-saves', 'main'], '--box-saves is memory or postgres, with --box'],
    [['replica', '--box', '--pg-restart-at', '30'], '--pg-restart-at is a second inside the run'],
    [['replica', '--box', '--box-saves', 'postgres', '--seconds', '60', '--pg-restart-at', '60'], '--pg-restart-at is a second inside the run'],
    [['replica', '--box', '--box-saves', 'postgres', '--pg-restart-checkpoint'], '--pg-restart-checkpoint needs --pg-restart-at'],
    [['replica', '--box', '--box-saves', 'postgres', '--seconds', '120', '--pg-restart-at', '60', '--pg-restart-checkpoint'], 'more than 75 s of bot time'],
  ] as const) {
    const run = spawnSync(process.execPath, ['scripts/mmo-bots.mjs', ...args], { encoding: 'utf8', timeout: 10_000 });
    expect(run.status, args.join(' ')).not.toBe(0);
    expect(run.stderr, args.join(' ')).toContain(why);
  }
  expect(driver).toContain("'sudo -n /usr/local/sbin/wildshard-config replica pg-restart'");
  expect(driver).toContain(' --saves ${boxSaves}');
});

// QA 11-24 row 5 (11-25): the first release-proof bots died with their lane's shell between 12:20 and 12:50 UTC, before the
// countdown they waited hours for, with nothing on the record. They now ignore SIGHUP, sit in their own process group and log
// any signal or exit; the usage says to start them detached.
test('release-proof bots outlive the lane shell that started them and record any signal', () => {
  expect(driver).toMatch(/if \(releaseProof\) \{\n  process\.on\('SIGHUP'/u);
  expect(driver).toContain("process.once('exit', code => { note({ step: 'exit', code }); });");
  expect(driver).toContain("{ stdio: ['ignore', 'pipe', 'inherit'], detached: releaseProof }");
  expect(driver).toContain('nohup node scripts/mmo-bots.mjs staging --release-proof');
});
