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
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { join, resolve as absolute } from 'node:path';
import { childListener, listenLoopback, rigFront } from './rig-listeners.mjs';

const ROOT = absolute(import.meta.dirname, '..', '..');
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

/** The server bundle's build arguments for a client build. A world only this Mac reaches keeps the dev control channel, staging
 *  snapshot or not (meta QA 2026-11-22: J490's local proofs raise flags on the staging grid); a public one (`serve-local.mjs`) never
 *  has it. The bundle bakes the client build's own catalogue whenever the build has one, so the server numbers each cell's frame as
 *  that page does (`cellFrame`): a server on the in-tree grid sent a shard the build placed off it (meta QA 11-24 row 45's
 *  proof-stranger) as frame 1, which the page read as its first grid cell, and it left for Pine Hollow.
 * @param {{ id: string, out: string, built: string, dev: boolean }} options @returns {string[]} */
export function devServerBuildArgs({ id, out, built, dev }) {
  const catalogue = join(built, 'catalogue.json');
  return ['--build', id, '--out', out, ...dev ? ['--dev'] : [], ...existsSync(catalogue) ? ['--catalogue', catalogue] : []];
}

/** The dev world.
 * `product` is the shard's built product folder (STR5: `wildshard dev` names the author's build); by default the one this
 * checkout's pins installed (`built-folder.mjs` `readBuiltShardfile`).
 * `publicOrigin` and `publicSocket` name the page and the world's socket as another device reaches them through an HTTPS
 * proxy in front of the loopback ports (`serve-local.mjs`); `socketPort` fixes the world
 * socket's loopback port for that proxy. Staging mode serves the full snapshot; only a public world builds the server without
 * dev controls.
 * @param {{ dist: string, work: string, shard?: string, product?: string, port?: number, saves?: 'disk' | 'memory', gridRoot?: string,
 *   publicOrigin?: string, publicSocket?: string, socketPort?: number, staging?: readonly { slug: string, uploadNumber: number }[], log?: (line: string) => void }} options */
export async function openDevWorld({ dist, work: requestedWork, shard = 'brasscap-mesa', product, port = DEV_PORT, saves = 'disk', gridRoot = ROOT, publicOrigin, publicSocket, socketPort = 0, staging, log = line => { console.log(line); } }) {
  if (!/^[a-z0-9_-]+$/u.test(shard)) throw new Error('A dev world shard must be a slug');
  const work = absolute(requestedWork); mkdirSync(work, { recursive: true });
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
    const worldFront = await rigFront(socketPort);
    resources.push(worldFront.close);
    const socket = publicSocket ?? `ws://127.0.0.1:${String(worldFront.port)}/`;
    // the page port listens first (0: the OS picks), so the stamp and the world's allowed origin name the bound port
    let pageOrigin = '', stamp = { release: '', key: key.public };
    let serial = 0, signed = '', revision = 0, build = '', served = 0;
    const origin = join(work, 'origin'), server = join(work, 'server');
    // a staging row with no local product (staging listed glowfen before this checkout's pins held it, 2026-11-21: every
    // --staging world died at start) is left off this grid with a warning; the world's own --shard still has to exist
    const read = product === undefined ? JSON.parse(run(['--input-type=module', '-e',
      "const {readBuiltShardfile} = await import('./src/scripts/built-folder.mjs'); const books = [], missing = []; for (const slug of process.argv.slice(1)) { try { books.push(slug + '=' + readBuiltShardfile(process.cwd(), slug)); } catch (error) { if (!String(error).includes('no pinned product')) throw error; missing.push(slug); } } console.log(JSON.stringify({ books, missing }));",
      '--', ...staging?.map(row => row.slug) ?? [shard]], 'the product read').trim()) : { books: [`${shard}=${absolute(product)}`], missing: [] };
    if (read.missing.includes(shard)) throw new Error(`No shard source and no pinned product: ${shard}`);
    if (read.missing.length > 0) console.warn(`dev world: no local product for ${read.missing.join(', ')}; left off this grid (node src/scripts/pins.ts install)`);
    const books = /** @type {string[]} */ (read.books);
    const shards = staging?.filter(row => !read.missing.includes(row.slug)).map(row => ({ slug: row.slug, revision: row.uploadNumber })) ?? [{ slug: shard, revision: 1 }];
    const cells = staging === undefined ? shard : [shard, ...shards.map(row => row.slug).filter(slug => slug !== shard)].join(',');
    const secret = staging === undefined ? 'dev-world' : randomBytes(32).toString('hex');
    /** The server book and bundle for a client build. @param {string} id @param {string} built */
    const serverFor = (id, built) => {
      run(['src/scripts/server-origin.mjs', origin, id, `--grid=${absolute(gridRoot)}`, ...books], 'the server book');
      run(['src/scripts/build-server.mjs', ...devServerBuildArgs({ id, out: server, built, dev: publicOrigin === undefined })], 'the server build');
    };
    /** @param {string} id */
    const publish = id => {
      serial++;
      const body = JSON.stringify({ channel: 'staging', serial, engineBuild: id, saveEpoch: JSON.parse(readFileSync(join(ROOT, 'save-epoch.json'), 'utf8')).saveEpoch, shards, socket });
      signed = JSON.stringify({ body, signature: sign(null, Buffer.from(body), key.private).toString('hex') });
    };
    /** @type {import('node:child_process').ChildProcess | undefined} */
    let world;
    const startWorld = async () => {
      const room = spawn(process.execPath, [join(server, 'main.mjs')], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env, RELEASE_URL: `${pageOrigin}${DEV_RELEASE}`, RELEASE_PUBLIC_KEY: key.public, RELEASE_CHANNEL: 'staging', PACK_ORIGIN: `file://${origin}/`, PACK_CACHE: join(work, 'packs'),
          DATABASE_URL: database, SEAT_SECRET: secret, HOST: '127.0.0.1', PORT: '0', ALLOWED_ORIGINS: [pageOrigin, pageOrigin.replace('127.0.0.1', 'localhost'), ...publicOrigin === undefined ? [] : [publicOrigin]].join(','), WILDSHARD_BUILD: build, WORLD_CELLS: cells,
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
      const child = spawn(process.execPath, ['src/scripts/preview-server.mjs', '--outDir', absolute(built), '--port', '0', '--telemetry-dir', join(work, 'telemetry')], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
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
      const page = request.method === 'GET' && (path.endsWith('.html') || !/\.[a-z0-9]+$/iu.test(path));
      const headers = { ...request.headers, host: `127.0.0.1:${String(served)}` };
      if (page) delete headers['accept-encoding'];
      const upstream = httpRequest({ host: '127.0.0.1', port: served, method: request.method, path: request.url, headers }, reply => {
        const type = reply.headers['content-type'] ?? '';
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
    pageOrigin = `http://127.0.0.1:${String(bound)}`; stamp = { release: `${publicOrigin ?? pageOrigin}${DEV_RELEASE}`, key: key.public };
    resources.push(async () => { front.closeAllConnections(); await new Promise(resolve => { front.close(() => { resolve(undefined); }); }); });

    /** Serve a client build: its pages, its server book and bundle, the release naming it, and a world on it. @param {string} built */
    let activeDist = dist;
    const open = async built => {
      const id = buildOf(built);
      await servePages(built);
      serverFor(id, built);
      await stopWorld();
      build = id; publish(id);
      await startWorld();
      activeDist = built; revision++;
    };
    await open(dist);
    const url = `${publicOrigin ?? pageOrigin}/`;
    return { url, stamp, socket, database, port: bound,
      get build() { return build; }, get revision() { return revision; },
      /** The world down and up again on the same client build, its server bundle rebuilt from this checkout. The bundle builds
       *  while the old world still runs (as `move` does), so the world is down only for its drain and start: rebuilding it
       *  down took 7 s of a hosted T1 J run's 10 s redial window (TR-4b), and a bundle that fails to build leaves it up.
       *  Resolves to the time (`Date.now()`) the old world was told to stop. */
      restart: async () => { serverFor(build, activeDist); const down = Date.now(); await stopWorld(); await startWorld(); return down; },
      /** A new client build: pages, release and world move to it; open pages open it again. @param {string} built */
      move: open,
      close };
  } catch (error) { await close(); throw error; }
}
