#!/usr/bin/env node
// PAGE-SIZE PZ3 (J276): a built page reads its content from a content base on a second origin. The page origin serves the
// built page with `contentBase` stamped in its boot bank; the content origin serves the same build with CORS, as PC1's
// bucket rule answers. Each level boots solo, its server in the page's worker. The page origin's log must hold no
// `/shardfiles/`, `/programs/`, `/assets/spawn/` or shard `/assets/` read, page and server worker both. The two origins
// share a host, so they share cookies: the content origin must never see one (CORS with no credentials). The SW's side is
// PZ10, so the journey runs with the service worker off.
//
//   node scripts/content-base-proof.mjs [--dist=dist] [--slugs=driftwood-isle,pine-hollow] [--browser-timeout=240]
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve as resolvePath, sep } from 'node:path';
import { chromium, devices } from 'playwright';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { stampContentBase } from './app-build/contentBase.mjs';

/** @param {string} name @param {string} fallback */
const option = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const sameOrigin = process.argv.includes('--same-origin'), dist = resolvePath(option('dist', 'dist')), slugs = option('slugs', 'driftwood-isle,pine-hollow').split(','), timeout = Number(option('browser-timeout', '240')) * 1000;
if (!existsSync(resolvePath(dist, 'index.html'))) throw new Error(`${dist} has no built page: run pnpm build:game`);
const build = JSON.parse(readFileSync(resolvePath(dist, 'version.json'), 'utf8')).build;
/** @type {Record<string, string>} */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ktx2': 'image/ktx2', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
// PAGE-SIZE PZ4: build:game splits the page (dist/) from its content (dist-content/). The content origin serves
// dist-content/; the page origin serves dist/ alone, or both with --same-origin. A joined dist serves from dist/.
const contentDist = `${dist}-content`;
/** @param {string} root @param {string} path */
const fileIn = (root, path) => {
  const file = resolvePath(root, `.${decodeURIComponent(path)}`);
  if (!file.startsWith(root + sep)) return null;
  if (existsSync(file) && statSync(file).isFile()) return file;
  const index = resolvePath(file, 'index.html');
  return existsSync(index) ? index : null;
};
/** @param {string} path */
const pageFileOf = path => fileIn(dist, path) ?? (sameOrigin ? fileIn(contentDist, path) : null);
/** @param {string} path */
const contentFileOf = path => fileIn(contentDist, path) ?? fileIn(dist, path);
/** @param {import('node:http').ServerResponse} response @param {string} file @param {string|undefined} range @param {Record<string,string>} extra */
function send(response, file, range, extra) {
  const size = statSync(file).size, headers = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'no-cache', ...extra,
    ...file.endsWith('.pack.br') ? { 'content-encoding': 'br', 'content-type': 'application/octet-stream' } : {} };
  const wanted = range === undefined ? null : /^bytes=(\d+)-(\d*)$/u.exec(range);
  if (wanted !== null && !file.endsWith('.br')) {
    const start = Number(wanted[1]), end = wanted[2] === '' ? size - 1 : Math.min(Number(wanted[2]), size - 1);
    response.writeHead(206, { ...headers, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${size}` });
    createReadStream(file, { start, end }).pipe(response); return;
  }
  response.writeHead(200, { ...headers, ...file.endsWith('.br') ? {} : { 'content-length': String(size) } });
  createReadStream(file).pipe(response);
}
/** @param {import('node:http').Server} server @returns {Promise<string>} */
const listen = server => new Promise(resolve => { server.listen(0, '127.0.0.1', () => { const address = server.address(); resolve(`http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`); }); });

/** @type {{path: string, slug: string}[]} */ const pageLog = [];
/** @type {{path: string, origin: string|undefined, cookie: boolean, method: string, slug: string}[]} */ const contentLog = [];
let current = '', contentOrigin = '';
const pageServer = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://x').pathname; pageLog.push({ path, slug: current });
  if (path === '/' || path === '/index.html') {
    // a page cookie: the content origin shares this host, so a credentialed read would carry it there
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store', 'set-cookie': 'pz3=page; Path=/; SameSite=Lax' }).end(stampContentBase(readFileSync(resolvePath(dist, 'index.html'), 'utf8'), sameOrigin ? '' : contentOrigin));
    return;
  }
  const file = pageFileOf(path);
  if (file === null) { response.writeHead(404).end(); return; }
  send(response, file, request.headers.range, {});
});
const pageOrigin = await listen(pageServer);
const contentServer = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://x').pathname, origin = request.headers.origin;
  contentLog.push({ path, origin, cookie: request.headers.cookie !== undefined, method: request.method ?? 'GET', slug: current });
  /** @type {Record<string, string>} */
  const cors = origin === pageOrigin ? { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-expose-headers': 'ETag, Content-Length, Content-Range', 'cross-origin-resource-policy': 'cross-origin' } : { 'cross-origin-resource-policy': 'cross-origin' };
  if (request.method === 'OPTIONS') { response.writeHead(204, { ...cors, 'access-control-allow-methods': 'GET, HEAD', 'access-control-allow-headers': 'Range' }).end(); return; }
  const file = contentFileOf(path);
  if (file === null) { response.writeHead(404, cors).end(); return; }
  send(response, file, request.headers.range, cors);
});
contentOrigin = `${await listen(contentServer)}/`;

// shard content on the page origin: the product, programs, cooked spawn files, and each shard's art mounts (S1 to S7)
const shards = new Set([...readdirSync(resolvePath(existsSync(resolvePath(contentDist, 'shardfiles')) ? contentDist : dist, 'shardfiles')), 'nalati', 'far-reach', 'nine-dragon', 'practice']);
const shardPrefixes = ['/shardfiles/', '/programs/', '/assets/spawn/', ...[...shards].flatMap(shard => [`/assets/${shard}/`, `/assets/gpu/${shard}/`, `/assets/baked/${shard}/`])];
/** @param {string} path */
const shardContent = path => shardPrefixes.some(prefix => path.startsWith(prefix));
/** @param {string} path */
const isContent = path => !/\.(?:js|mjs|css|map)$/u.test(path) && (/^\/(?:shardfiles|programs)\//u.test(path) || (path.startsWith('/assets/') && !path.startsWith('/assets/physics/')));

const browser = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--mute-audio', ...process.platform === 'darwin' ? ['--use-angle=metal'] : []] });
/** @type {unknown[]} */ const results = [];
/** @type {string[]} */ const failures = [];
try {
  for (const slug of slugs) {
    current = slug;
    const context = await browser.newContext({ ...devices['iPhone 16 Pro'], isMobile: false, serviceWorkers: 'block' });
    const page = await context.newPage(), /** @type {string[]} */ errors = [];
    page.on('pageerror', error => { errors.push(String(error)); });
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    page.on('requestfailed', request => { errors.push(`failed ${request.url()} ${request.failure()?.errorText ?? ''}`); });
    const started = Date.now();
    try {
      await page.goto(`${pageOrigin}/?chunk=${slug}&mute=1&nolock=1&sw=0`, { waitUntil: 'load', timeout });
      // booted: the loader completed, and the page's worker client is joined to its in-page server
      await page.waitForFunction(() => {
        const timing = Reflect.get(window, '__bootTiming');
        return typeof window.__workerClient === 'function' && window.__workerClient().frames > 0 && Array.isArray(timing?.entries) && timing.entries.some(/** @param {{operation: string}} row */ row => row.operation === 'app:loader-complete');
      }, undefined, { timeout });
    } catch (error) {
      const card = await page.evaluate(() => document.querySelector('.ws-load')?.textContent?.replaceAll(/\s+/gu, ' ').slice(0, 400) ?? '').catch(() => '');
      failures.push(`${slug}: did not boot solo: ${String(error).split('\n')[0]} · card: ${card}`);
    }
    console.error(`[pz3] ${slug} ${Date.now() - started} ms`);
    const booted = await page.evaluate(() => ({ frames: typeof window.__workerClient === 'function' ? window.__workerClient().frames : 0, world: Reflect.get(globalThis, '__WS_WORLD__') !== undefined })).catch(() => ({ frames: 0, world: false }));
    await context.close();
    const ownContent = pageLog.filter(row => row.slug === slug && shardContent(row.path)).map(row => row.path);
    const otherContent = pageLog.filter(row => row.slug === slug && isContent(row.path) && !shardContent(row.path)).map(row => row.path);
    const cdn = contentLog.filter(row => row.slug === slug);
    const serverBook = cdn.some(row => row.path === `/assets/spawn/server-${build}.json`), serverParts = cdn.filter(row => row.path.startsWith('/assets/spawn/server/')).length;
    const row = { slug, ms: Date.now() - started, frames: booted.frames, onlineWorld: booted.world, cdnReads: cdn.length, cdnProduct: cdn.filter(entry => entry.path.startsWith(`/shardfiles/${slug}/`)).length,
      serverBook, serverParts, preflights: cdn.filter(entry => entry.method === 'OPTIONS').length, cookies: cdn.filter(entry => entry.cookie && entry.origin !== undefined).length,
      // CSS background art (the title cards): a stylesheet image is a no-cors read, which no fetch layer can make CORS
      noCors: cdn.filter(entry => entry.method === 'GET' && entry.origin !== pageOrigin).map(entry => entry.path),
      // listed, not failed: a stylesheet image sends the cookies its host has. Here both origins share 127.0.0.1's jar; on
      // play.wildshard.io the page sets no cookie packs.wildshard.io would get.
      noCorsCookies: cdn.filter(entry => entry.cookie && entry.origin === undefined).length,
      pageShardContent: ownContent, pageEngineArt: [...new Set(otherContent)].slice(0, 20), pageEngineArtCount: otherContent.length, errors: errors.slice(0, 8) };
    results.push(row);
    if (booted.frames === 0) failures.push(`${slug}: no worker client frame`);
    if (booted.world) failures.push(`${slug}: page carries an online world`);
    if (row.cdnProduct === 0) failures.push(`${slug}: no product read from the content base`);
    if (!serverBook || serverParts === 0) failures.push(`${slug}: the server worker did not read its book and parts from the content base`);
    if (ownContent.length > 0) failures.push(`${slug}: ${ownContent.length} shard content reads on the page origin: ${ownContent.slice(0, 5).join(' ')}`);
    if (row.preflights > 0) failures.push(`${slug}: ${row.preflights} CORS preflights`);
    if (row.cookies > 0) failures.push(`${slug}: ${row.cookies} CORS content reads carried a cookie`);
    const unexpected = row.noCors.filter(path => !/\/blobs\/image\/[a-f0-9]{64}\.(?:jpg|png|webp)$/u.test(path));
    if (unexpected.length > 0) failures.push(`${slug}: no-cors content reads that are not card art: ${unexpected.slice(0, 5).join(' ')}`);
  }
} finally {
  await browser.close(); pageServer.close(); contentServer.close();
}
console.log(JSON.stringify({ gate: 'content-base-proof', build, pageOrigin, contentOrigin, pass: failures.length === 0, results, failures }, null, 1));
process.exitCode = failures.length === 0 ? 0 : 1;
