// MEMORY-STRUCTURE STR2, STR3 (J414, J419): the dev page's world. Local dev runs the game server as a Node process on this
// Mac, as staging and prod do, never as the in-page server worker, which only the deployed preview keeps. It is the rig's
// path (online-rig.mjs) made for a person: the dedicated server built from this checkout, a release file signed with a key
// kept under `work`, saves on disk in PGlite under `work/saves` (J419: a dev save survives a restart), and one page port.
// The page port serves the build and stamps every document with the world (`__WS_WORLD__`) on the way out, so any build,
// a devserver one or not, joins it; it serves the signed release beside the page, and a `sw.js` that removes itself (as
// sharddev's dev page does, NEW-SHARD-E2E F19). Everything listens on 127.0.0.1 only.
//
// `restart()` puts the world down (saves written), rebuilds the server bundle and starts it again on the same build: the
// open page redials and stays in play. `move(dist)` is a client rebuild: the page port serves the new build, the release
// names it, the world restarts on it, and the open page (its injected poll sees the new revision) opens it again.
import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { join, resolve as absolute } from 'node:path';
import { childListener, listenLoopback, rigFront } from './rig-listeners.mjs';

const ROOT = absolute(import.meta.dirname, '..');
/** `pnpm dev`'s page port. */
export const DEV_PORT = 4402;
/** The page's paths the dev port answers itself. */
export const DEV_RELEASE = '/__dev/release.json', DEV_STATE = '/__dev/state';
/** A dev page's service worker: it answers no request and removes itself (sharddev's `DEV_SERVICE_WORKER`). */
export const DEV_SERVICE_WORKER = "self.addEventListener('install',()=>{self.skipWaiting()});self.addEventListener('activate',(e)=>{e.waitUntil(self.registration.unregister())});\n";

/** The build id a client folder carries. @param {string} folder @returns {string} */
export const buildOf = folder => JSON.parse(readFileSync(join(folder, 'version.json'), 'utf8')).build;

/** The dev world's signing key: made once under `work`, kept, so a page's stamp and a save outlive a restart.
 * @param {string} work @returns {{public: string, private: string}} */
export function devKey(work) {
  const file = join(work, 'key.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const pair = generateKeyPairSync('ed25519');
  const key = { public: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('hex'), private: /** @type {string} */ (pair.privateKey.export({ type: 'pkcs8', format: 'pem' })) };
  mkdirSync(work, { recursive: true });
  writeFileSync(file, JSON.stringify(key), { mode: 0o600 });
  return key;
}

/** A document with the world's stamp first in its head and the dev poll last in its body. The poll opens the page again (a
 *  new `devrev`, never `location.reload()`: a reload reads as the player's own, which sends them to the title) once the
 *  page port serves another client build. @param {string} html @param {{release: string, key: string}} stamp @param {number} revision */
export function stampDevDocument(html, stamp, revision) {
  const head = /<head(?:\s[^>]*)?>/iu.exec(html);
  if (head === null) return html;
  const at = head.index + head[0].length;
  const world = `<script>globalThis.__WS_WORLD__=${JSON.stringify(stamp).replaceAll('<', String.raw`\u003c`)};</script>`;
  const poll = `<script>(()=>{const seen=${String(revision)};setInterval(async()=>{try{const s=await (await fetch(${JSON.stringify(DEV_STATE)},{cache:'no-store'})).json();if(s.revision!==seen){const u=new URL(location.href);u.searchParams.set('devrev',String(s.revision));location.replace(u.href)}}catch{}},500)})()</script>`;
  const stamped = `${html.slice(0, at)}${world}${html.slice(at)}`;
  return stamped.includes('</body>') ? stamped.replace('</body>', `${poll}</body>`) : `${stamped}${poll}`;
}

/** @param {string[]} args @param {string} what */
const run = (args, what) => { const done = spawnSync(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' }); if (done.status !== 0) throw new Error(`${what} stopped: ${String(done.status)}`); return done.stdout; };

/** @param {import('node:child_process').ChildProcess} child @param {number} [graceMs] */
const stopChild = (child, graceMs = 15_000) => new Promise(resolve => {
  if (child.exitCode !== null || child.signalCode !== null) { resolve(undefined); return; }
  const deadline = setTimeout(() => { child.kill('SIGKILL'); }, graceMs);
  child.once('exit', () => { clearTimeout(deadline); resolve(undefined); });
  child.kill('SIGTERM');
});

/** The dev world.
 * @param {{ dist: string, work: string, shard?: string, port?: number, saves?: 'disk' | 'memory', gridRoot?: string, log?: (line: string) => void }} options */
export async function openDevWorld({ dist, work, shard = '_template', port = DEV_PORT, saves = 'disk', gridRoot = ROOT, log = line => { console.log(line); } }) {
  if (!/^[a-z0-9_-]+$/u.test(shard)) throw new Error('A dev world shard must be a slug');
  work = absolute(work); mkdirSync(work, { recursive: true });
  const key = devKey(work);
  /** @type {(() => unknown)[]} */
  const resources = [];
  const close = async () => { for (const release of resources.splice(0).reverse()) { try { await release(); } catch (error) { log(`dev world: cleanup: ${String(error)}`); } } };
  try {
    const serverLog = createWriteStream(join(work, 'server.log'), { flags: 'a' });
    resources.push(() => { serverLog.end(); });
    // saves: PGlite on disk, behind its own loopback socket (the server speaks Postgres)
    let database = 'memory:';
    if (saves === 'disk') {
      const { PGlite } = await import('@electric-sql/pglite'), { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
      const db = new PGlite(join(work, 'saves')), front = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0, maxConnections: 16 });
      await front.start();
      resources.push(async () => { await front.stop(); await db.close(); });
      database = `postgresql://postgres@${front.getServerConn()}/postgres?sslmode=disable`;
    }
    const worldFront = await rigFront();
    resources.push(worldFront.close);
    const socket = `ws://127.0.0.1:${String(worldFront.port)}/`;
    // the page port listens first (0: the OS picks), so the stamp and the world's allowed origin name the bound port
    let pageOrigin = '', stamp = { release: '', key: key.public };
    let serial = 0, signed = '', revision = 0, build = '', served = 0;
    const origin = join(work, 'origin'), server = join(work, 'server');
    const book = run(['--input-type=module', '-e', `console.log((await import('./scripts/built-folder.mjs')).readBuiltShardfile(process.cwd(), '${shard}'))`], 'the product read').trim();
    /** The server book and bundle for a client build. @param {string} id */
    const serverFor = id => {
      run(['scripts/server-origin.mjs', origin, id, `--grid=${absolute(gridRoot)}`, `${shard}=${book}`], 'the server book');
      run(['scripts/build-server.mjs', '--build', id, '--out', server, '--dev'], 'the server build');
    };
    /** @param {string} id */
    const publish = id => {
      serial++;
      const body = JSON.stringify({ channel: 'staging', serial, engineBuild: id, saveEpoch: JSON.parse(readFileSync(join(ROOT, 'save-epoch.json'), 'utf8')).saveEpoch, shards: [{ slug: shard, revision: 1 }], socket });
      signed = JSON.stringify({ body, signature: sign(null, Buffer.from(body), key.private).toString('hex') });
    };
    /** @type {import('node:child_process').ChildProcess | undefined} */
    let world;
    const startWorld = async () => {
      const room = spawn(process.execPath, [join(server, 'main.mjs')], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env, RELEASE_URL: `${pageOrigin}${DEV_RELEASE}`, RELEASE_PUBLIC_KEY: key.public, RELEASE_CHANNEL: 'staging', PACK_ORIGIN: `file://${origin}/`, PACK_CACHE: join(work, 'packs'),
          DATABASE_URL: database, SEAT_SECRET: 'dev-world', HOST: '127.0.0.1', PORT: '0', ALLOWED_ORIGINS: [pageOrigin, pageOrigin.replace('127.0.0.1', 'localhost')].join(','), WILDSHARD_BUILD: build, WORLD_CELLS: shard,
          WORLD_WORKERS: '1', RELEASE_POLL_MS: '1000', GRACE_MS: '1000' } });
      room.stdout?.pipe(serverLog, { end: false }); room.stderr?.pipe(serverLog, { end: false });
      room.once('exit', code => { worldFront.clear(); if (world === room) log(`dev world: the server stopped (${String(code)}); see ${join(work, 'server.log')}`); });
      world = room;
      worldFront.point(await childListener(room, 'world-ready'));
    };
    const stopWorld = async () => { const room = world; world = undefined; if (room !== undefined) await stopChild(room); };
    resources.push(stopWorld);

    // the page host: preview-server.mjs on its own port, behind the dev port
    /** @type {import('node:child_process').ChildProcess | undefined} */
    let pages;
    /** @param {string} built */
    const servePages = async built => {
      const child = spawn(process.execPath, ['scripts/preview-server.mjs', '--outDir', absolute(built), '--port', '0', '--telemetry-dir', join(work, 'telemetry')], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
      const hostPort = await childListener(child, 'preview-ready');
      const old = pages; pages = child; served = hostPort;
      if (old !== undefined) void stopChild(old, 3000);
    };
    resources.push(async () => { if (pages !== undefined) await stopChild(pages, 3000); });

    const front = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      const answer = (/** @type {string} */ type, /** @type {string} */ body) => { response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'access-control-allow-origin': '*' }).end(body); };
      if (path === DEV_RELEASE) { answer('application/json', signed); return; }
      if (path === DEV_STATE) { answer('application/json', JSON.stringify({ revision, build, serial, world: world !== undefined })); return; }
      if (path === '/sw.js') { answer('text/javascript', DEV_SERVICE_WORKER); return; }
      // a document is read whole and stamped; everything else streams through untouched
      const page = request.method === 'GET' && (/\.html$/u.test(path) || !/\.[a-z0-9]+$/iu.test(path));
      const headers = { ...request.headers, host: `127.0.0.1:${String(served)}` };
      if (page) delete headers['accept-encoding'];
      const upstream = httpRequest({ host: '127.0.0.1', port: served, method: request.method, path: request.url, headers }, reply => {
        const type = String(reply.headers['content-type'] ?? '');
        if (!page || !type.startsWith('text/html')) { response.writeHead(reply.statusCode ?? 502, reply.headers); reply.pipe(response); return; }
        const chunks = /** @type {Buffer[]} */ ([]);
        reply.on('data', chunk => { chunks.push(chunk); });
        reply.on('end', () => {
          const body = Buffer.from(stampDevDocument(Buffer.concat(chunks).toString('utf8'), stamp, revision));
          const out = { ...reply.headers, 'content-length': String(body.length), 'cache-control': 'no-store' };
          delete out.etag; delete out['content-encoding'];
          response.writeHead(reply.statusCode ?? 200, out).end(body);
        });
      });
      upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
      request.pipe(upstream);
    });
    const bound = await listenLoopback(front, port);
    pageOrigin = `http://127.0.0.1:${String(bound)}`; stamp = { release: `${pageOrigin}${DEV_RELEASE}`, key: key.public };
    resources.push(async () => { front.closeAllConnections(); await new Promise(resolve => { front.close(() => { resolve(undefined); }); }); });

    /** Serve a client build: its pages, its server book and bundle, the release naming it, and a world on it. @param {string} built */
    const open = async built => {
      const id = buildOf(built);
      await servePages(built);
      serverFor(id);
      await stopWorld();
      build = id; publish(id);
      await startWorld();
      revision++;
    };
    await open(dist);
    const url = `${pageOrigin}/`;
    return { url, stamp, socket, database, port: bound,
      get build() { return build; }, get revision() { return revision; },
      /** The world down and up again on the same client build, its server bundle rebuilt from this checkout. */
      restart: async () => { await stopWorld(); serverFor(build); await startWorld(); },
      /** A new client build: pages, release and world move to it; open pages open it again. @param {string} built */
      move: open,
      close };
  } catch (error) { await close(); throw error; }
}
