// E7.2d, E7.9: one world on this Mac for any page to join: a signed file, the built server on real Postgres, and a page server that a deploy can swap. It starts
// nothing it does not stop, and it opens no port past loopback. Its key is made once for the build, and signs a file on 127.0.0.1 and nothing else.
import { spawn, spawnSync } from 'node:child_process';
import { sign } from 'node:crypto';
import { createWriteStream, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve as absolute } from 'node:path';
import { Client } from 'pg';
import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';
import { rigOptions } from './online-rig-options.mjs';
import { claimFixture, fixtureKey, freeFixturePorts, ownedPostgres, confirmPostgres } from './online-rig-owned.mjs';

const ROOT = absolute(import.meta.dirname, '..');
/** The rig's four loopback ports, from 18796 (a lane beside another rig names its own: WS_RIG_PORTS=18856; its dist is stamped
 *  with http://127.0.0.1:<that + 3>/release.json). */
const PORTS = Number(process.env.WS_RIG_PORTS ?? 18796);
if (!Number.isInteger(PORTS) || PORTS < 1024 || PORTS > 65532) throw new Error(`WS_RIG_PORTS must be a port from 1024 to 65532, not ${String(process.env.WS_RIG_PORTS)}`);
export const RELEASE_PORT = PORTS + 3, WORLD_PORT = PORTS + 1, PAGE_PORT = PORTS + 2, PG_PORT = PORTS;
/** @param {string} name */
const database = name => { const url = new URL(`postgresql://127.0.0.1:${String(PG_PORT)}/${name}`); url.username = 'postgres'; url.searchParams.set('sslmode', 'disable'); return url.href; };
/** @param {string} folder */
export const buildOf = folder => JSON.parse(readFileSync(join(folder, 'version.json'), 'utf8')).build;
/** @param {number} ms */
const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });

/** @param {string[]} args @param {string} what */
const run = (args, what) => { const done = spawnSync(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' }); if (done.status !== 0) throw new Error(`${what} stopped: ${String(done.status)}`); return done.stdout; };

/** A Playwright page from a bare context to a seat. @param {import('playwright').Browser} browser @param {Record<string, unknown>} device @param {string} url @param {string} name */
export async function enterPage(browser, device, url, name) {
  const context = await browser.newContext(device), page = await context.newPage(), errors = /** @type {string[]} */ ([]);
  page.on('pageerror', error => { errors.push(error.message.slice(0, 240)); });
  page.on('console', line => { if (line.type() === 'error') errors.push(line.text().slice(0, 240)); });
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  await page.goto(url, { waitUntil: 'load' });
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
 * @param {{ dist: string, nextDist?: string, work: string, keyFile: string, pgBin?: string, pgData?: string, saves?: 'memory', shard?: string, seats?: number, more?: string[], cells?: string, socket?: string, workers?: number, origins?: string[], channel?: string, isolated?: boolean }} options */
export async function openRig({ dist, nextDist = '', work, keyFile, saves, pgBin = '', pgData = '', shard = 'driftwood-isle', seats, more = [], cells = shard, socket = `ws://127.0.0.1:${String(WORLD_PORT)}/`, workers, origins = [], channel = 'production', isolated = false }) {
  if (origins.some(origin => new URL(origin).origin !== origin || new URL(origin).hostname !== '127.0.0.1')) throw new Error('A rig lets in loopback page origins only');
  const { memory } = rigOptions({ saves, pgBin, pgData, socket });
  const key = isolated ? fixtureKey(keyFile) : JSON.parse(readFileSync(keyFile, 'utf8'));
  if (isolated) { await freeFixturePorts([PG_PORT, WORLD_PORT, PAGE_PORT, RELEASE_PORT]); claimFixture(work); }
  /** @type {(()=>unknown)[]} */
  const resources = [];
  const close = async () => {
    const errors = [];
    for (const release of resources.splice(0).reverse()) { try { await release(); } catch (error) { errors.push(error); } }
    if (errors.length > 0) throw new AggregateError(errors, 'Online rig cleanup failed');
  };
  try {
  const build = buildOf(dist), nextBuild = nextDist === '' ? '' : buildOf(nextDist), DATABASE = memory ? 'memory:' : database('saves_online');
  mkdirSync(work, { recursive: true });
  const slugs = [shard, ...more];
  if (slugs.some(slug => !/^[a-z0-9_-]+$/u.test(slug))) throw new Error('A rig shard must be a slug');
  const books = slugs.map(slug => `${slug}=${run(['--input-type=module', '-e', `console.log((await import('./scripts/built-product.mjs')).readBuiltShardfile(process.cwd(), '${slug}'))`], 'the product read').trim()}`);
  const origin = join(work, 'origin'), server = join(work, 'server');
  rmSync(join(work, 'packs'), { recursive: true, force: true });
  run(['scripts/server-origin.mjs', origin, build, ...books], 'the server book');
  if (nextBuild !== '') run(['scripts/server-origin.mjs', origin, nextBuild, ...books], 'the next server book');
  run(['scripts/build-server.mjs', '--build', build, '--out', server], 'the server build');

  let signed = '';
  /** @param {number} serial @param {string} engineBuild @param {string} [signedChannel] */
  const publish = (serial, engineBuild, signedChannel = channel) => {
    const body = JSON.stringify({ channel: signedChannel, serial, engineBuild, saveEpoch: 1, shards: slugs.map(slug => ({ slug, revision: 1 })), socket });
    signed = JSON.stringify({ body, signature: sign(null, Buffer.from(body), key.private).toString('hex') });
  };
  publish(1, build);
  const release = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }).end(signed); });
  await new Promise((resolve, reject) => { release.once('error', reject); release.listen(RELEASE_PORT, '127.0.0.1', () => { resolve(null); }); });
  resources.push(async () => { release.closeAllConnections(); await release[Symbol.asyncDispose](); });

  const pgCtl = join(pgBin, 'pg_ctl'), log = createWriteStream(join(work, 'server.log'));
  resources.push(() => { log.end(); });
  if (!memory) {
    if (isolated) { const pg = ownedPostgres({ bin: pgBin, data: pgData, port: PG_PORT }); resources.push(pg.close); }
    else {
      const result = spawnSync(pgCtl, ['-D', pgData, '-o', `-p ${String(PG_PORT)} -k /tmp -c listen_addresses=127.0.0.1`, '-w', '-l', join(work, 'pg.log'), 'start'], { stdio: 'inherit' });
      if (result.status !== 0) throw new Error('The rig could not start Postgres; no database was changed');
      resources.push(() => { if (spawnSync(pgCtl, ['-D', pgData, '-m', 'fast', '-w', 'stop'], { stdio: 'ignore' }).status !== 0) throw new Error('The rig could not stop its Postgres'); });
    }
    const admin = new Client({ connectionString: database('postgres') });
    try {
      await admin.connect();
      if (isolated) await confirmPostgres(admin, pgData);
      await admin.query('drop database if exists saves_online'); await admin.query('create database saves_online');
    } finally { await admin.end(); }
  }

  const world = (running = build) => {
    const room = spawn(process.execPath, [join(server, 'main.mjs')], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, RELEASE_URL: `http://127.0.0.1:${String(RELEASE_PORT)}/release.json`, RELEASE_PUBLIC_KEY: key.public, PACK_ORIGIN: `file://${origin}/`, PACK_CACHE: join(work, 'packs'), DATABASE_URL: DATABASE, SEAT_SECRET: 'online-proof', HOST: '127.0.0.1', PORT: String(WORLD_PORT), ALLOWED_ORIGINS: [`http://127.0.0.1:${String(PAGE_PORT)}`, ...origins].join(','), WILDSHARD_BUILD: running, WORLD_CELLS: cells, RELEASE_POLL_MS: '500', GRACE_MS: '6000', ...seats === undefined ? {} : { WORLD_SEATS: String(seats) }, ...workers === undefined ? {} : { WORLD_WORKERS: String(workers) } } });
    room.stdout.pipe(log, { end: false }); room.stderr.pipe(log, { end: false });
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
  /** The page host's half of a deploy: the page's origin serves this build from now on. @param {string} built */
  const serve = async built => {
    const pageServer = spawn(process.execPath, ['scripts/preview-server.mjs', '--outDir', absolute(built), '--port', String(PAGE_PORT), '--telemetry-dir', join(work, 'telemetry')], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
    resources.push(() => stopped(pageServer));
    let last = 'no response';
    for (let tries = 0; tries < 300; tries++) {
      if (pageServer.exitCode !== null || pageServer.signalCode !== null) throw new Error('The owned page server exited before readiness');
      const ready = await fetch(`http://127.0.0.1:${String(PAGE_PORT)}/version.json`, { signal: AbortSignal.timeout(2000) }).then(async found => {
        const version = await found.json(); last = `status ${String(found.status)}, build ${String(version.build)}`;
        return found.ok && version.build === buildOf(built);
      }).catch((/** @type {unknown} */ error) => { last = error instanceof Error ? error.name : 'read failed'; return false; });
      if (ready) return pageServer;
      await sleep(100);
    }
    throw new Error(`The owned page server did not serve its build (${last})`);
  };
  let main = world();
  resources.push(() => stopped(main));
  let pages = await serve(dist);
  return { shard, build, nextBuild, publish, DATABASE, base: `http://127.0.0.1:${String(PAGE_PORT)}`, Client,
    /** The server goes down, for a test of its coming back. */
    stop: () => stopped(main),
    /** The server up on this build. @param {string} [running] */
    start: running => { if (main.exitCode === null && main.signalCode === null) throw new Error('Stop the current rig world before starting another'); main = world(running); },
    /** A draining server's own exit. */
    drained: () => exited(main),
    /** The page's origin moves to this build. @param {string} built */
    pagesServe: async built => { await stopped(pages); pages = await serve(built); },
    close };
  } catch (error) {
    try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Online rig setup and cleanup failed', { cause: cleanup }); }
    throw error;
  }
}
