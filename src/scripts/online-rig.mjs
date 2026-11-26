// E7.2d, E7.9: one world on this Mac for any page to join: a signed file, the built server on real Postgres, and a page server that a deploy can swap. It starts
// nothing it does not stop, and it opens no port past loopback. Its key is made once for the build, and signs a file on 127.0.0.1 and nothing else.
import { spawn, spawnSync } from 'node:child_process';
import { sign } from 'node:crypto';
import { createWriteStream, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve as absolute } from 'node:path';
import { Client } from 'pg';
import { childListener, databaseFront, listenLoopback, rigFront } from './rig-listeners.mjs';
import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';
import { rigOptions, rigSocketPath } from './online-rig-options.mjs';
import { claimFixture, fixtureKey, freeFixturePorts, ownedPostgres, ownedEphemeralPostgres, confirmPostgres } from './online-rig-owned.mjs';
import { signRetention } from './code-retention.mjs';
import { enterZone } from './zone-entry.mjs';

const ROOT = absolute(import.meta.dirname, '..', '..');
/** The rig's four loopback ports, from 18796 (a lane beside another rig names its own: WS_RIG_PORTS=18856; its dist is stamped
 *  with http://127.0.0.1:<that + 3>/release.json). */
const PORTS = Number(process.env.WS_RIG_PORTS ?? 18796);
if (!Number.isInteger(PORTS) || PORTS < 1024 || PORTS > 65532) throw new Error(`WS_RIG_PORTS must be a port from 1024 to 65532, not ${String(process.env.WS_RIG_PORTS)}`);
export const RELEASE_PORT = PORTS + 3, WORLD_PORT = PORTS + 1, PAGE_PORT = PORTS + 2, PG_PORT = PORTS;
/** @param {string} name */
const database = (name, port = PG_PORT) => { const url = new URL(`postgresql://127.0.0.1:${String(port)}/${name}`); url.username = 'postgres'; url.searchParams.set('sslmode', 'disable'); return url.href; };
/** @param {string} folder */
export const buildOf = folder => JSON.parse(readFileSync(join(folder, 'version.json'), 'utf8')).build;
/** @param {number} ms */
const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });

/** @param {string[]} args @param {string} what */
const run = (args, what) => { const done = spawnSync(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' }); if (done.status !== 0) throw new Error(`${what} stopped: ${String(done.status)}`); return done.stdout; };

/** The run flags a rig's play page carries; the zone goes in the tap (CP16, J522). */
export const PLAY_FLAGS = 'mute=1&nolock=1&skipintro=1';

/** A Playwright page from a bare context to a seat. `to` is a zone to enter by its tap (`enterZone`, with `PLAY_FLAGS` unless
 *  it names its own), or a page address that names none (the title, a sign-in link).
 *  @param {import('playwright').Browser} browser @param {Record<string, unknown>} device
 *  @param {string | { zone: string, base: string, flags?: string }} to @param {string} name */
export async function enterPage(browser, device, to, name) {
  const context = await browser.newContext(device), page = await context.newPage(), errors = /** @type {string[]} */ ([]);
  page.on('pageerror', error => { errors.push(error.message.slice(0, 240)); });
  page.on('console', line => { if (line.type() === 'error') errors.push(line.text().slice(0, 240)); });
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  await (typeof to === 'string' ? page.goto(to, { waitUntil: 'load' }) : enterZone(page, { flags: PLAY_FLAGS, ...to }));
  await page.locator('#ws-name-box input').waitFor({ timeout: 150_000 });
  await page.locator('#ws-name-box input').fill(name);
  await page.locator('#ws-name-box button[type=submit]').click();
  return { page, context, errors };
}
/** A page that has its Name in, on to the world. @param {import('playwright').Page} page */
export async function intoWorld(page) {
  await page.waitForFunction(() => typeof window.__workerClient === 'function' && window.__wildshard?.world?.player !== undefined, undefined, { timeout: 120_000 });
  await page.evaluate(FLOOR_GRID_ENTER);
  await page.waitForFunction(() => (/** @type {NonNullable<typeof window.__workerClient>} */ (window.__workerClient))().frames > 30, undefined, { timeout: 60_000 });
}

/** `saves: 'memory'` (or legacy `pgBin` 'memory:') keeps the saves in the server's memory, for a proof that never reads them back (voice-proof.mjs): no Postgres.
 * `more` are other shards the release names, `cells` the server's `WORLD_CELLS` (default `shard`), and `socket` the address the
 * release names when a proof puts its own front door before the server (grid-gate-proof.mjs). Every rig has the road;
 * J353 removed the continuous-crossing switch. `workers` sets `WORLD_WORKERS` (the rig's release is production's,
 * 4 by default; staging runs 2). FM3: `origins` are loopback page origins the server also lets in, and `channel`
 * is the release file's channel (`production`).
 * FM8s: `pgBin` 'pglite:' runs the saves on PGlite in this process, behind a front the proof can hold or refuse (`rig.database`).
 * FM5b4/mode 10: `nextDist` is a second build of the same stamp. The release port has two signed views (meta MMO-FAILURE-MODES-PLAN,
 * the local chaos proxy): `/release.json` is the world's and `/__release.json` the page's (the proxy's page route), so `pageView`
 * can run the page's ahead of the world's; `retain` serves a signed `/code-retention.json` on the page origin; `move` carries the
 * world and the page origin to the other build, as a deploy does.
 * @param {{ dist: string, nextDist?: string, work: string, keyFile: string, pgBin?: string, pgData?: string, saves?: 'memory', shard?: string, seats?: number, more?: string[], cells?: string, socket?: string, workers?: number, origins?: string[], channel?: string, isolated?: boolean, port?: 0, gridRoot?: string, placement?: {url:string,key:string} }} options */
export async function openRig({ dist, nextDist = '', work, keyFile, saves, pgBin = '', pgData = '', shard = 'driftwood-isle', seats, more = [], cells = shard, socket = `ws://127.0.0.1:${String(WORLD_PORT)}/`, workers, origins = [], channel = 'production', isolated = false, port, gridRoot = ROOT, placement }) {
  if (origins.some(origin => new URL(origin).origin !== origin || new URL(origin).hostname !== '127.0.0.1')) throw new Error('A rig lets in loopback page origins only');
  const { memory } = rigOptions({ saves, pgBin, pgData, socket });
  if (port !== undefined && port !== 0) throw new Error('A rig port option must be zero; use WS_RIG_PORTS for legacy named ports');
  const ephemeral = port === 0;
  const key = isolated || ephemeral ? fixtureKey(keyFile) : JSON.parse(readFileSync(keyFile, 'utf8'));
  if (isolated || ephemeral) { if (!ephemeral) await freeFixturePorts([PG_PORT, WORLD_PORT, PAGE_PORT, RELEASE_PORT]); claimFixture(work); }
  /** @type {(()=>unknown)[]} */
  const resources = [];
  const close = async () => {
    const errors = [];
    for (const release of resources.splice(0).reverse()) { try { await release(); } catch (error) { errors.push(error); } }
    if (errors.length > 0) throw new AggregateError(errors, 'Online rig cleanup failed');
  };
  try {
  const worldFront = ephemeral ? await rigFront() : undefined;
  if (worldFront !== undefined) resources.push(worldFront.close);
  // a rig with a second build fronts its page port too, so a move swaps the page host with no downtime
  const pageFront = ephemeral ? await rigFront() : nextDist === '' ? undefined : await rigFront(PAGE_PORT);
  if (pageFront !== undefined) resources.push(pageFront.close);
  const worldPort = worldFront?.port ?? WORLD_PORT, pagePort = pageFront?.port ?? PAGE_PORT;
  let signedSocket = ephemeral && socket === `ws://127.0.0.1:${String(WORLD_PORT)}/` ? `ws://127.0.0.1:${String(worldPort)}/` : socket;
  const build = buildOf(dist), nextBuild = nextDist === '' ? '' : buildOf(nextDist);
  let pgPort = PG_PORT;
  mkdirSync(work, { recursive: true });
  const slugs = [shard, ...more];
  if (slugs.some(slug => !/^[a-z0-9_-]+$/u.test(slug))) throw new Error('A rig shard must be a slug');
  const books = slugs.map(slug => `${slug}=${run(['--input-type=module', '-e', `console.log((await import('./src/scripts/built-folder.mjs')).readBuiltShardfile(process.cwd(), '${slug}'))`], 'the product read').trim()}`);
  const origin = join(work, 'origin'), server = join(work, 'server');
  rmSync(join(work, 'packs'), { recursive: true, force: true });
  run(['src/scripts/server-origin.mjs', origin, build, `--grid=${absolute(gridRoot)}`, ...books], 'the server book');
  if (nextBuild !== '') run(['src/scripts/server-origin.mjs', origin, nextBuild, `--grid=${absolute(gridRoot)}`, ...books], 'the next server book');
  run(['src/scripts/build-server.mjs', '--build', build, '--out', server], 'the server build');

  let signed = '', pageSigned = '', current = { serial: 1, engineBuild: build, channel };
  /** @param {{ serial: number, engineBuild: string, channel: string }} row @param {string} [named] the socket the file names */
  const signRelease = (row, named = signedSocket) => {
    const body = JSON.stringify({ channel: row.channel, serial: row.serial, engineBuild: row.engineBuild, saveEpoch: 2, shards: slugs.map(slug => ({ slug, revision: 1 })), socket: named });
    return JSON.stringify({ body, signature: sign(null, Buffer.from(body), key.private).toString('hex') });
  };
  /** Both views name this release; a page view set before is dropped. @param {number} serial @param {string} engineBuild @param {string} [signedChannel] @param {string} [publicSocket] */
  const publish = (serial, engineBuild, signedChannel = channel, publicSocket = signedSocket) => {
    rigOptions({ saves: 'memory', socket: publicSocket }); signedSocket = publicSocket;
    current = { serial, engineBuild, channel: signedChannel };
    signed = signRelease(current); pageSigned = '';
  };
  publish(1, build);
  /** The page's view names another build until the next publish (null: the world's view again). The world never reads it.
   * FM4b modes 6 and 7: `named` makes the page's view name another address (a negative target: an `.invalid` name, the proxy's
   * fixture-certificate listener); the world's view and the server never read it.
   * @param {string | null} engineBuild @param {string} [named] */
  const pageView = (engineBuild, named) => { pageSigned = engineBuild === null ? '' : signRelease({ ...current, engineBuild }, named); };
  const release = createServer((request, response) => {
    const page = new URL(request.url ?? '/', 'http://127.0.0.1').pathname === '/__release.json' && pageSigned !== '';
    response.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }).end(page ? pageSigned : signed);
  });
  const releasePort = await listenLoopback(release, ephemeral ? 0 : RELEASE_PORT);
  resources.push(async () => { release.closeAllConnections(); await release[Symbol.asyncDispose](); });

  const pgCtl = join(pgBin, 'pg_ctl'), log = createWriteStream(join(work, 'server.log'));
  resources.push(() => { log.end(); });
  // FM8s: PGlite in this process on a Unix socket in the work folder, behind `databaseFront` on the rig's database port
  const pglite = pgBin === 'pglite:';
  /** @type {Awaited<ReturnType<typeof databaseFront>> | undefined} */
  let dbFront;
  if (pglite) {
    if (ephemeral) throw new Error('A pglite: rig uses the named ports');
    const { PGlite } = await import('@electric-sql/pglite'), { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
    const path = rigSocketPath(absolute(work));
    rmSync(path, { force: true });
    const db = new PGlite(), pgSocket = new PGLiteSocketServer({ db, path, maxConnections: 16 });
    await pgSocket.start();
    resources.push(async () => { await pgSocket.stop(); await db.close(); rmSync(path, { force: true }); });
    const front = await databaseFront(PG_PORT, path);
    dbFront = front; resources.push(() => front.close());
  }
  if (!memory) {
    if (pglite) { /* started above */ }
    else if (ephemeral) { const pg = await ownedEphemeralPostgres({ bin: pgBin, data: pgData }); pgPort = pg.port; resources.push(pg.close); }
    else if (isolated) { const pg = ownedPostgres({ bin: pgBin, data: pgData, port: PG_PORT }); resources.push(pg.close); }
    else {
      const result = spawnSync(pgCtl, ['-D', pgData, '-o', `-p ${String(PG_PORT)} -k /tmp -c listen_addresses=127.0.0.1`, '-w', '-l', join(work, 'pg.log'), 'start'], { stdio: 'inherit' });
      if (result.status !== 0) throw new Error('The rig could not start Postgres; no database was changed');
      resources.push(() => { if (spawnSync(pgCtl, ['-D', pgData, '-m', 'fast', '-w', 'stop'], { stdio: 'ignore' }).status !== 0) throw new Error('The rig could not stop its Postgres'); });
    }
    const admin = new Client({ connectionString: database('postgres', pgPort) });
    try {
      await admin.connect();
      if ((isolated || ephemeral) && !pglite) await confirmPostgres(admin, pgData);
      await admin.query('drop database if exists saves_online'); await admin.query('create database saves_online');
    } finally { await admin.end(); }
  }

  const DATABASE = memory ? 'memory:' : database('saves_online', pgPort);
  const worldEnv = { ...process.env };
  delete worldEnv.PULL_SCRIPT;
  if (placement !== undefined) {
    worldEnv.PLACEMENT_URL = placement.url;
    worldEnv.PLACEMENT_PUBLIC_KEY = placement.key;
  }
  const waitForWorld = isolated || ephemeral;
  const readyWorld = async (/** @type {import('node:child_process').ChildProcess} */ child) => {
    if (!waitForWorld) return;
    try {
      const listening = await childListener(child, 'world-ready');
      if (worldFront !== undefined) worldFront.point(listening);
      else if (listening !== worldPort) throw new Error('The world bound an unexpected port');
    } catch (error) {
      throw new Error(`The signed rig rooms did not start. See ${join(work, 'server.log')}`, { cause: error });
    }
  };
  const world = (running = build) => {
    const room = spawn(process.execPath, [join(server, 'main.mjs')], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe', waitForWorld ? 'ipc' : 'ignore'],
      env: { ...worldEnv, RELEASE_CHANNEL: channel, RELEASE_URL: `http://127.0.0.1:${String(releasePort)}/release.json`, RELEASE_PUBLIC_KEY: key.public, PACK_ORIGIN: `file://${origin}/`, PACK_CACHE: join(work, 'packs'), DATABASE_URL: DATABASE, SEAT_SECRET: 'online-proof', HOST: '127.0.0.1', PORT: String(ephemeral ? 0 : worldPort), ALLOWED_ORIGINS: [`http://127.0.0.1:${String(pagePort)}`, ...origins].join(','), WILDSHARD_BUILD: running, WORLD_CELLS: cells, RELEASE_POLL_MS: '500', GRACE_MS: '6000', ...seats === undefined ? {} : { WORLD_SEATS: String(seats) }, ...workers === undefined ? {} : { WORLD_WORKERS: String(workers) } } });
    room.once('exit', () => { worldFront?.clear(); });
    room.stdout?.pipe(log, { end: false }); room.stderr?.pipe(log, { end: false });
    return room;
  };
  /** @param {import('node:child_process').ChildProcess} room */
  const stopped = room => new Promise((resolve, reject) => {
    if (room.exitCode !== null || room.signalCode !== null) { resolve(undefined); return; }
    let forced = false;
    const deadline = setTimeout(() => { forced = true; room.kill('SIGKILL'); }, 8000);
    room.once('exit', () => { clearTimeout(deadline); if (forced) reject(new Error('An owned rig child required SIGKILL')); else resolve(undefined); });
    room.once('error', error => { clearTimeout(deadline); reject(error); });
    room.kill('SIGTERM');
  });
  /** @param {import('node:child_process').ChildProcess} room */
  const exited = room => new Promise((resolve, reject) => {
    if (room.exitCode !== null || room.signalCode !== null) { resolve(undefined); return; }
    const timer = setTimeout(() => { reject(new Error('The owned world did not drain')); }, 15_000);
    room.once('exit', () => { clearTimeout(timer); resolve(undefined); });
  });
  /** @type {import('node:child_process').ChildProcess | undefined} */
  let pages;
  /** A page host serving `built`: on the page port, or behind `pageFront` on its own. Ready when it answers its build directly.
   * @param {string} built */
  const launch = async built => {
    const fronted = pageFront !== undefined;
    const pageServer = spawn(process.execPath, ['src/scripts/preview-server.mjs', '--outDir', absolute(built), '--port', String(fronted ? 0 : pagePort), '--telemetry-dir', join(work, 'telemetry')], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit', fronted ? 'ipc' : 'ignore'] });
    resources.push(() => stopped(pageServer));
    const hostPort = fronted ? await childListener(pageServer, 'preview-ready') : pagePort;
    let last = 'no response';
    for (let tries = 0; tries < 300; tries++) {
      if (pageServer.exitCode !== null || pageServer.signalCode !== null) throw new Error('The owned page server exited before readiness');
      const ready = await fetch(`http://127.0.0.1:${String(hostPort)}/version.json`, { signal: AbortSignal.timeout(2000) }).then(async found => {
        const version = await found.json(); last = `status ${String(found.status)}, build ${String(version.build)}`;
        return found.ok && version.build === buildOf(built);
      }).catch((/** @type {unknown} */ error) => { last = error instanceof Error ? error.name : 'read failed'; return false; });
      if (ready) return { pageServer, hostPort };
      await sleep(100);
    }
    throw new Error(`The owned page server did not serve its build (${last})`);
  };
  /** The page host's half of a deploy: the page's origin serves this build from now on. @param {string} built */
  const serve = async built => {
    const { pageServer, hostPort } = await launch(built);
    pageServer.once('exit', () => { if (pages === pageServer) pageFront?.clear(); });
    pageFront?.point(hostPort);
    return pageServer;
  };
  // The page origin is bound before the world admits browser origins.
  pages = await serve(dist);
  let main = world();
  resources.push(() => stopped(main));
  await readyWorld(main);
  /** @param {string} [running] */
  const start = async running => {
    if (main.exitCode === null && main.signalCode === null) throw new Error('Stop the current rig world before starting another');
    main = world(running);
    try { await readyWorld(main); }
    catch (error) { await stopped(main); throw error; }
  };
  // FM5b4: the signed retention file, written into every build folder the page origin can serve, and removed at close
  const folders = nextDist === '' ? [dist] : [dist, nextDist];
  let retaining = false;
  const unretain = () => { for (const folder of folders) rmSync(join(folder, 'code-retention.json'), { force: true }); };
  unretain();
  /** The page origin's `/code-retention.json`, signed with the rig key (null: none, a legacy page). `engineBuild` and `channel`
   *  default to the page's view of the release, as the page reads it against a fresh release.
   * @param {{ keptBuilds: string[], engineBuild?: string, channel?: string, retireAt?: number, issuedAt?: number } | null} spec */
  const retain = spec => {
    if (spec === null) { unretain(); return; }
    const viewed = pageSigned === '' ? current : JSON.parse(JSON.parse(pageSigned).body);
    const { keptBuilds, engineBuild = viewed.engineBuild, channel: signedChannel = viewed.channel, retireAt, issuedAt = Date.now() } = spec;
    const text = signRetention({ purpose: 'code-retention', channel: signedChannel, engineBuild, keptBuilds, issuedAt, ...retireAt === undefined ? {} : { retireAt } }, key.private, key.public);
    if (!retaining) { retaining = true; resources.push(unretain); }
    for (const folder of folders) writeFileSync(join(folder, 'code-retention.json'), text);
  };
  /** A deploy: the page origin serves the build, both views of the release name it, `published` runs (the countdown is under way),
   *  the old world drains and the world starts on it. @param {string} built @param {{ published?: () => unknown }} [how] */
  const move = async (built, { published } = {}) => {
    if (nextBuild === '') throw new Error('A move needs a rig with a second build (nextDist)');
    const target = buildOf(built);
    if (target !== build && target !== nextBuild) throw new Error(`A rig moves only between its two builds, not ${target}`);
    // as a real deploy: the page host serves the build before the release names it, so a tab the world sends home lands on it
    if (pageFront === undefined) { if (pages !== undefined) await stopped(pages); pages = await serve(built); }
    else {
      // new connections reach the new host at once; the old one finishes what it holds, then stops
      const old = pages, next = await launch(built);
      pages = next.pageServer;
      next.pageServer.once('exit', () => { if (pages === next.pageServer) pageFront.clear(); });
      pageFront.retarget(next.hostPort);
      if (old !== undefined) void sleep(8000).then(() => stopped(old)).catch(() => undefined);
    }
    publish(current.serial + 1, target, current.channel);
    await published?.();
    await exited(main);
    await start(target);
  };
  return { shard, build, nextBuild, publish, pageView, retain, move, DATABASE, base: `http://127.0.0.1:${String(pagePort)}`, worldOrigin: `http://127.0.0.1:${String(worldPort)}`, releaseOrigin: `http://127.0.0.1:${String(releasePort)}`, socket: signedSocket, ports: { page: pagePort, world: worldPort, release: releasePort, ...(memory ? {} : { database: pgPort }) }, Client,
    /** FM8s: a `pglite:` rig's database, broken on purpose: `hold` (queries wait), `refuse` (connections drop), `pass`. */
    ...dbFront === undefined ? {} : { database: { fault: dbFront.fault, mode: dbFront.mode, stats: dbFront.stats } },
    /** The server goes down, for a test of its coming back. */
    stop: () => stopped(main),
    /** The server up on this build. @param {string} [running] */
    start,
    /** A draining server's own exit. */
    drained: () => exited(main),
    /** The page's origin moves to this build. @param {string} built */
    pagesServe: async built => { pageFront?.clear(); if (pages !== undefined) await stopped(pages); pages = await serve(built); },
    close };
  } catch (error) {
    try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Online rig setup and cleanup failed', { cause: cleanup }); }
    throw error;
  }
}
