#!/usr/bin/env node
// PAGE-SIZE PZ10 (J276): the service worker keeps CDN content across an update, and Clear downloads leaves none.
// PZ3's two-port journey with the worker on. A clone of the split page (`dist/`) is stamped with a content base on a second
// local origin (PZ2's `/content/<set>/` layout, served from `dist-content/` the way PC1's CDN serves R2: CORS for the page,
// CORP, `timing-allow-origin`, a year `immutable`) and its worker is baked from the stamped document, as PZ8's release does.
//
//   1. first: Driftwood boots on a first visit, and again under the installed worker; its books are precached at their CDN
//      URLs into `ws-content-v1`;
//   2. update: the build is remade with no shard change (the same content, a new document, so a new worker and build id;
//      `refreshServiceWorker`, as a bake does) and adopted; Driftwood boots under it. The content origin must see zero part
//      reads in this phase, and `ws-content-v1` must still hold what it held;
//   3. clear: the page runs `clearDownloads()` (the real module, bundled from source); `caches.keys()` must be empty;
//   4. cold: the next load must read every CDN file from the network: Resource Timing `transferSize` above 0 for each (the
//      year-cached copies are gone because both origins' `/clear-cache.json` answered `Clear-Site-Data: "cache"`).
//
//   node --import ./scripts/bake-loader.mjs scripts/content-sw-proof.mjs [--dist=dist] [--set=<16 hex>] [--slug=driftwood-isle] [--browser-timeout=240]
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve as resolvePath, sep } from 'node:path';
import { chromium, devices } from 'playwright';
import { rolldown } from 'rolldown';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { stampContentBase } from './app-build/contentBase.mjs';

const { refreshServiceWorker, writeServiceWorker } = await import('./app-build/serviceWorker.ts');
/** @param {string} name @param {string} fallback */
const option = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const root = resolvePath(import.meta.dirname, '..'), dist = resolvePath(option('dist', 'dist')), contentDist = `${dist}-content`;
const set = option('set', 'a10a10a10a10a10a'), slug = option('slug', 'driftwood-isle'), timeout = Number(option('browser-timeout', '240')) * 1000;
if (!/^[a-f0-9]{16}$/u.test(set)) throw new Error(`--set takes 16 hex: ${set}`);
if (!existsSync(join(dist, 'index.html')) || !existsSync(contentDist)) throw new Error(`${dist} is not a split build: run pnpm build:game`);
const scratch = join(root, 'tmp/content-sw-proof'), pageDir = join(scratch, 'page');
rmSync(scratch, { recursive: true, force: true }); mkdirSync(scratch, { recursive: true });
// an APFS clone on macOS: the page is about 70 MB, and the bake rewrites only index.html, sw.js and one sw-core file
execFileSync('cp', [...process.platform === 'darwin' ? ['-cR'] : ['-R'], dist, pageDir]);
// the bake finds a split output's books in `<page>-content/`
symlinkSync(contentDist, `${pageDir}-content`);
/** @type {Record<string, string>} */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ktx2': 'image/ktx2', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
/** @param {string} base @param {string} path */
const fileIn = (base, path) => {
  const file = resolvePath(base, `.${decodeURIComponent(path)}`);
  return file.startsWith(base + sep) && existsSync(file) && statSync(file).isFile() ? file : null;
};
/** @param {import('node:http').ServerResponse} response @param {string} file @param {string|undefined} range @param {Record<string,string>} extra */
function send(response, file, range, extra) {
  const size = statSync(file).size, headers = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'accept-ranges': 'bytes', ...extra,
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
const listen = server => new Promise(done => { server.listen(0, '127.0.0.1', () => { const address = server.address(); done(`http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`); }); });

// the real Clear downloads, bundled from source for the page to import (no menu taps, the same code)
const clearBundle = await rolldown({ input: join(root, 'src/client/engine/boot/clearDownloads.ts'), platform: 'browser', transform: { target: 'es2022' } });
const clearModule = (await clearBundle.generate({ format: 'es' })).output.find(file => file.type === 'chunk')?.code ?? '';
await clearBundle.close();
const CLEAR = { 'content-type': 'application/json', 'cache-control': 'no-store', 'clear-site-data': '"cache"' };

let phase = 'first';
/** @type {{phase: string, origin: 'page'|'content', path: string, method: string, status: number}[]} */ const log = [];
const pageServer = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://x').pathname, row = { phase, origin: /** @type {const} */ ('page'), path, method: request.method ?? 'GET', status: 200 };
  log.push(row);
  if (path === '/' || path === '/index.html') { response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(readFileSync(join(pageDir, 'index.html'))); return; }
  if (path === '/clear-cache.json') { response.writeHead(200, CLEAR).end('{}'); return; }
  if (path === '/__pz10/clear.js') { response.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }).end(clearModule); return; }
  const file = fileIn(pageDir, path);
  if (file === null) { row.status = 404; response.writeHead(404).end(); return; }
  send(response, file, request.headers.range, { 'cache-control': path === '/sw.js' ? 'no-cache' : 'public, max-age=31536000, immutable' });
});
const pageOrigin = await listen(pageServer);
const folder = `/content/${set}`;
const contentServer = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://x').pathname, row = { phase, origin: /** @type {const} */ ('content'), path: url, method: request.method ?? 'GET', status: 200 };
  log.push(row);
  /** @type {Record<string, string>} */
  const cors = { ...request.headers.origin === pageOrigin ? { 'access-control-allow-origin': pageOrigin, vary: 'Origin', 'access-control-expose-headers': 'ETag, Content-Length, Content-Range' } : {},
    'cross-origin-resource-policy': 'cross-origin', 'timing-allow-origin': '*' };
  if (request.method === 'OPTIONS') { response.writeHead(204, { ...cors, 'access-control-allow-methods': 'GET, HEAD', 'access-control-allow-headers': 'Range' }).end(); return; }
  // PC1's zone rule: the content origin's own clear file
  if (url === '/clear-cache.json') { response.writeHead(200, { ...cors, ...CLEAR }).end('{"clear":"cache"}'); return; }
  const file = url.startsWith(`${folder}/`) ? fileIn(contentDist, url.slice(folder.length)) ?? fileIn(dist, url.slice(folder.length)) : null;
  if (file === null) { row.status = 404; response.writeHead(404, cors).end(); return; }
  send(response, file, request.headers.range, { ...cors, 'cache-control': 'public, max-age=31536000, immutable' });
});
const contentOrigin = await listen(contentServer), contentBase = `${contentOrigin}${folder}/`;

// PZ8's order: stamp the document, then bake the worker from it
writeFileSync(join(pageDir, 'index.html'), stampContentBase(readFileSync(join(pageDir, 'index.html'), 'utf8'), contentBase));
await writeServiceWorker(pageDir, root);

const browser = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--mute-audio', ...process.platform === 'darwin' ? ['--use-angle=metal'] : []] });
/** @type {string[]} */ const failures = [];
/** @type {Record<string, unknown>} */ const result = { slug, contentBase };
const address = `${pageOrigin}/?chunk=${slug}&mute=1&nolock=1`;
/** @param {import('playwright').Page} page */
const booted = page => page.waitForFunction(() => {
  const timing = Reflect.get(window, '__bootTiming');
  return typeof window.__workerClient === 'function' && window.__workerClient().frames > 0 && Array.isArray(timing?.entries) && timing.entries.some(/** @param {{operation: string}} row */ row => row.operation === 'app:loader-complete');
}, undefined, { timeout });
/** @param {import('playwright').Page} page */
const contentKeys = page => page.evaluate(async () => (await caches.keys()).includes('ws-content-v1') ? (await (await caches.open('ws-content-v1')).keys()).map(request => request.url) : []);
/** @param {import('playwright').Page} page @param {() => Promise<boolean>} test @param {string} what */
async function until(page, test, what) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await test().catch(() => false)) return; await page.waitForTimeout(250); }
  throw new Error(`timed out: ${what}`);
}
/** DL1's ask, as the page makes it at control: the worker answers once this build's code and books are held.
 * @param {import('playwright').Page} page */
const precache = page => page.evaluate(() => new Promise(done => {
  const worker = navigator.serviceWorker.controller, channel = new MessageChannel();
  if (worker === null) { done('no controller'); return; }
  channel.port1.onmessage = event => { done(event.data); };
  worker.postMessage({ type: 'PRECACHE' }, [channel.port2]);
})).catch(error => String(error));
/** @param {string} name */
const parts = name => log.filter(row => row.phase === name && row.origin === 'content' && row.path.endsWith('.pack.br'));
try {
  const context = await browser.newContext({ ...devices['iPhone 16 Pro'], isMobile: false });
  const page = await context.newPage(), /** @type {string[]} */ errors = [];
  page.on('pageerror', error => { errors.push(String(error)); });
  const build = JSON.parse(readFileSync(join(pageDir, 'version.json'), 'utf8')).build;
  const books = [`${contentBase}assets/spawn/packs-${build}.json`, `${contentBase}assets/spawn/server-${build}.json`];
  try {
    // 1. a first visit, then a load under the installed worker, whose generation (code and books) is then held
    await page.goto(address, { waitUntil: 'load', timeout }); await booted(page);
    await page.goto(address, { waitUntil: 'load', timeout }); await booted(page);
    await until(page, () => page.evaluate(() => navigator.serviceWorker.controller !== null), 'worker control');
    const answer = await precache(page);
    const held = await contentKeys(page);
    result.first = { precache: answer, contentCache: held.length, parts: held.filter(key => key.endsWith('.pack.br')).length, cdnPartReads: parts('first').length, books: books.map(book => held.includes(book)) };
    if (typeof answer !== 'object' || answer === null || Reflect.get(answer, 'ok') !== true) failures.push(`first: the precache answered ${JSON.stringify(answer)}`);
    if (!books.every(book => held.includes(book))) failures.push(`first: the books are not precached at their CDN URLs (${books.join(', ')})`);

    // 2. a rebuild with no shard change: a new document, so a new worker and build id over the same content
    phase = 'update';
    const before = readFileSync(join(pageDir, 'index.html'), 'utf8');
    writeFileSync(join(pageDir, 'index.html'), before.replace('</body>', '<!-- pz10 rebuild --></body>'));
    refreshServiceWorker(pageDir, before);
    const oldBuild = await page.evaluate(() => window.__ws_sw?.version().then(value => value?.build));
    await page.goto(address, { waitUntil: 'load', timeout }); await booted(page);
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())?.update(); });
    await until(page, () => page.evaluate(() => window.__ws_sw?.waiting != null), 'the new worker waiting');
    await Promise.all([page.waitForNavigation({ timeout }), page.evaluate(() => { void window.__ws_sw?.adopt(); })]);
    await booted(page);
    const newBuild = await page.evaluate(() => window.__ws_sw?.version().then(value => value?.build));
    const kept = await contentKeys(page);
    result.update = { oldBuild, newBuild, cdnPartReads: parts('update').length, cdnReads: log.filter(row => row.phase === 'update' && row.origin === 'content').length,
      contentCache: kept.length, lost: held.filter(key => !kept.includes(key)).length };
    if (newBuild === oldBuild || typeof newBuild !== 'string') failures.push(`update: the new build was not adopted (${String(oldBuild)} → ${String(newBuild)})`);
    if (parts('update').length > 0) failures.push(`update: the new build fetched ${parts('update').length} parts from the CDN: ${parts('update').slice(0, 5).map(row => row.path).join(', ')}`);
    if (held.some(key => !kept.includes(key))) failures.push('update: ws-content-v1 lost entries through the update');

    // 3. Clear downloads, the real module
    phase = 'clear';
    const report = await page.evaluate(async origin => { const clear = await import(`${origin}/__pz10/clear.js`); return clear.clearDownloads(); }, pageOrigin);
    const left = await page.evaluate(() => caches.keys());
    const contentClear = log.some(row => row.phase === 'clear' && row.origin === 'content' && row.path === '/clear-cache.json');
    result.clear = { report, cachesLeft: left, contentClear };
    if (left.length > 0) failures.push(`clear: caches.keys() is ${JSON.stringify(left)}`);
    if (!contentClear) failures.push('clear: the content origin\'s /clear-cache.json was never fetched');

    // 4. the next load reads every CDN file from the network
    phase = 'cold';
    await page.goto(address, { waitUntil: 'load', timeout }); await booted(page);
    const timings = await page.evaluate(origin => performance.getEntriesByType('resource').filter(entry => entry.name.startsWith(origin))
      .map(entry => ({ name: entry.name, transferSize: /** @type {PerformanceResourceTiming} */ (entry).transferSize })), contentOrigin);
    const cached = timings.filter(entry => entry.transferSize === 0);
    result.cold = { cdnEntries: timings.length, fromCache: cached.length, cdnReads: log.filter(row => row.phase === 'cold' && row.origin === 'content').length, controlled: await page.evaluate(() => navigator.serviceWorker.controller !== null) };
    if (timings.length === 0) failures.push('cold: no CDN file was read');
    if (cached.length > 0) failures.push(`cold: ${cached.length} CDN files came from a cache: ${cached.slice(0, 5).map(entry => entry.name).join(', ')}`);
  } catch (error) {
    failures.push(`${phase}: ${String(error).split('\n')[0]}`);
  }
  result.errors = errors.slice(0, 8);
  result.missing = log.filter(row => row.status === 404).map(row => `${row.phase} ${row.origin} ${row.path}`).slice(0, 20);

  await context.close();
} finally {
  await browser.close(); pageServer.close(); contentServer.close();
  rmSync(scratch, { recursive: true, force: true });
}
console.log(JSON.stringify({ ...result, failures }, null, 2));
if (failures.length > 0) { console.error(`content-sw-proof: FAIL\n  ${failures.join('\n  ')}`); process.exit(1); }
console.error('content-sw-proof: pass');
