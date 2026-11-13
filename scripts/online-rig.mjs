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

/** `pgBin` 'memory:' keeps the saves in the server's memory, for a proof that never reads them back (voice-proof.mjs): no Postgres.
 * `more` are other shards the release names, `cells` the server's `WORLD_CELLS` (default `shard`), and `socket` the address the
 * release names when a proof puts its own front door before the server (grid-gate-proof.mjs). `crossing` (on by default, GC35 / J322; false sets
 * `WORLD_CROSSING=off`, a bench's lone cells) is `WORLD_CROSSING=worker` (GC15): each worker hosts the road between its cells from the grid pack the bake left in this checkout (grid-crossing-walk-proof.mjs),
 * and `workers` sets `WORLD_WORKERS` (the rig's release is production's, 4 by default; staging runs 2).
 * @param {{ dist: string, nextDist?: string, work: string, keyFile: string, pgBin: string, pgData: string, shard?: string, seats?: number, more?: string[], cells?: string, socket?: string, crossing?: boolean, workers?: number }} options */
export async function openRig({ dist, nextDist = '', work, keyFile, pgBin, pgData, shard = 'driftwood-isle', seats, more = [], cells = shard, socket = `ws://127.0.0.1:${String(WORLD_PORT)}/`, crossing = true, workers }) {
  const memory = pgBin === 'memory:';
  const key = JSON.parse(readFileSync(keyFile, 'utf8')), build = buildOf(dist), nextBuild = nextDist === '' ? '' : buildOf(nextDist), DATABASE = memory ? 'memory:' : database('saves_online');
  mkdirSync(work, { recursive: true });
  const slugs = [shard, ...more], books = slugs.map(slug => `${slug}=${run(['--input-type=module', '-e', `console.log((await import('./scripts/built-product.mjs')).readBuiltShardfile(process.cwd(), '${slug}'))`], 'the product read').trim()}`);
  const origin = join(work, 'origin'), server = join(work, 'server');
  rmSync(join(work, 'packs'), { recursive: true, force: true });
  run(['scripts/server-origin.mjs', origin, build, ...books], 'the server book');
  if (nextBuild !== '') run(['scripts/server-origin.mjs', origin, nextBuild, ...books], 'the next server book');
  run(['scripts/build-server.mjs', '--build', build, '--out', server], 'the server build');

  let signed = '';
  /** @param {number} serial @param {string} engineBuild */
  const publish = (serial, engineBuild) => {
    const body = JSON.stringify({ channel: 'production', serial, engineBuild, saveEpoch: 1, shards: slugs.map(slug => ({ slug, revision: 1 })), socket });
    signed = JSON.stringify({ body, signature: sign(null, Buffer.from(body), key.private).toString('hex') });
  };
  publish(1, build);
  const release = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }).end(signed); });
  await new Promise(resolve => { release.listen(RELEASE_PORT, '127.0.0.1', () => { resolve(null); }); });

  const pgCtl = join(pgBin, 'pg_ctl'), log = createWriteStream(join(work, 'server.log'));
  if (!memory) {
    spawnSync(pgCtl, ['-D', pgData, '-o', `-p ${String(PG_PORT)} -k /tmp -c listen_addresses=127.0.0.1`, '-w', '-l', join(work, 'pg.log'), 'start'], { stdio: 'inherit' });
    const admin = new Client({ connectionString: database('postgres') });
    await admin.connect();
    await admin.query('drop database if exists saves_online'); await admin.query('create database saves_online'); await admin.end();
  }

  const world = (running = build) => {
    const room = spawn(process.execPath, [join(server, 'main.mjs')], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, RELEASE_URL: `http://127.0.0.1:${String(RELEASE_PORT)}/release.json`, RELEASE_PUBLIC_KEY: key.public, PACK_ORIGIN: `file://${origin}/`, PACK_CACHE: join(work, 'packs'), DATABASE_URL: DATABASE, SEAT_SECRET: 'online-proof', HOST: '127.0.0.1', PORT: String(WORLD_PORT), ALLOWED_ORIGINS: `http://127.0.0.1:${String(PAGE_PORT)}`, WILDSHARD_BUILD: running, WORLD_CELLS: cells, RELEASE_POLL_MS: '500', GRACE_MS: '6000', ...seats === undefined ? {} : { WORLD_SEATS: String(seats) }, WORLD_CROSSING: crossing ? 'worker' : 'off', ...workers === undefined ? {} : { WORLD_WORKERS: String(workers) } } });
    room.stdout.pipe(log, { end: false }); room.stderr.pipe(log, { end: false });
    return room;
  };
  /** @param {import('node:child_process').ChildProcess} room */
  const stopped = room => new Promise(resolve => { room.on('exit', resolve); room.kill('SIGTERM'); setTimeout(resolve, 8000); });
  /** @param {import('node:child_process').ChildProcess} room */
  const exited = room => new Promise(resolve => { room.on('exit', resolve); setTimeout(resolve, 15_000); });
  /** The page host's half of a deploy: the page's origin serves this build from now on. @param {string} built */
  const serve = async built => {
    const pageServer = spawn(process.execPath, ['scripts/preview-server.mjs', '--outDir', absolute(built), '--port', String(PAGE_PORT)], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
    for (let tries = 0; tries < 100 && !(await fetch(`http://127.0.0.1:${String(PAGE_PORT)}/version.json`).then(found => found.ok).catch(() => false)); tries++) await sleep(100);
    return pageServer;
  };
  let main = world(), pages = await serve(dist);
  return { shard, build, nextBuild, publish, DATABASE, base: `http://127.0.0.1:${String(PAGE_PORT)}`, Client,
    /** The server goes down, for a test of its coming back. */
    stop: () => stopped(main),
    /** The server up on this build. @param {string} [running] */
    start: running => { main = world(running); },
    /** A draining server's own exit. */
    drained: () => exited(main),
    /** The page's origin moves to this build. @param {string} built */
    pagesServe: async built => { pages.kill('SIGTERM'); await sleep(200); pages = await serve(built); },
    close: async () => {
      pages.kill('SIGTERM');
      await stopped(main);
      release.close();
      if (!memory) spawnSync(pgCtl, ['-D', pgData, '-m', 'fast', '-w', 'stop'], { stdio: 'ignore' });
    } };
}
