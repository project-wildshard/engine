#!/usr/bin/env node
// P1-E5.2: the standalone target in a real module Web Worker, from built output. The proof page imports the emitted shell
// from its build's folder (--dist reads a finished build; without it, only the shell is emitted, for a quick run) and plays:
// the server ticks on the worker's own 60 Hz clock, the page decodes its 30 Hz frames and checks them against the worker's
// exact creature state, then a save made in the worker survives a real reload. E5.4's pointer half (J54, J57): the pointer
// then moves to a new build, the stale tab's `hello` is refused, and the tab reloads into that build with its save.
//
//   python3 scripts/heavy-lane.py build -- scripts/browser-lane.sh node scripts/standalone-smoke.mjs [--dist=dist] [--slug=sunscar-dunes] [--browser=chromium|webkit] [--seconds=10] [--product=<an unpacked tarball>]
import { createReadStream, existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve as resolveFile, sep } from 'node:path';
import { devices, chromium, webkit } from 'playwright';
import { build } from 'vite';
import { rapierAlias } from '../vite/rapier.ts';
import { codeDirectory, stampBuildHtml } from './app-build/buildIdentity.mjs';
import { standaloneDirectory, writeStandaloneOutput } from './app-build/standaloneOutput.mjs';
import { readBuiltShardfile } from './built-product.mjs';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { documentIsolation } from './app-build/isolation.mjs';

const ROOT = resolveFile(import.meta.dirname, '..'), OUT = join(ROOT, 'tmp', 'standalone-smoke'), EMITTED = join(OUT, 'emitted');
const option = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const slug = option('slug', 'sunscar-dunes'), engine = option('browser', 'chromium'), seconds = Number(option('seconds', '10')), dist = option('dist', '');

rmSync(OUT, { recursive: true, force: true });
await build({ configFile: false, root: join(ROOT, 'test/standalone'), logLevel: 'warn', publicDir: false, resolve: { alias: rapierAlias }, assetsInclude: ['**/*.bin', '**/*.wasm'],
  define: { __TITLE_ASSET_URLS__: '{}', __BUILD_ID__: '"proof"' }, worker: { format: 'es' }, build: { outDir: OUT, emptyOutDir: true, target: 'es2022', minify: false, sourcemap: false } });

// The first build is the output under test. The second is the same bytes in a new folder: only the pointer has to move.
const firstBuild = dist === '' ? 'smoke-first' : JSON.parse(readFileSync(join(resolveFile(dist), 'version.json'), 'utf8')).build, nextBuild = `${firstBuild}-next`;
const output = dist === '' ? EMITTED : resolveFile(dist);
if (dist === '') await writeStandaloneOutput(EMITTED, firstBuild, ROOT);
if (!existsSync(join(output, standaloneDirectory(firstBuild), 'shell.js'))) throw new Error(`${output} has no emitted standalone shell: build it with scripts/build-app.mjs`);
let pointer = firstBuild;
const html = readFileSync(join(OUT, 'index.html'), 'utf8');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm' };
const unpacked = option('product', ''), product = unpacked !== '' ? resolveFile(unpacked) : dist === '' ? readBuiltShardfile(ROOT, slug) : '', physics = join(ROOT, 'public/assets/physics');
const resolvePath = path => {
  const inside = (root, tail) => { const file = resolveFile(root, `.${tail}`); return file === root || file.startsWith(root + sep) ? file : null; };
  // C2: a build's worker reads its server packs. The product's folder is there only for a run with no build, or a tarball's.
  if (path.startsWith(`/shards/${slug}/`) && (dist === '' || unpacked !== '')) return inside(resolveFile(product), path.slice(`/shards/${slug}`.length));
  if (path.startsWith('/assets/spawn/')) return inside(output, path.replace(`server-${nextBuild}.json`, `server-${firstBuild}.json`)); // C2: a server pack and its book, where a build wrote them
  if (path.startsWith('/assets/physics/')) return inside(physics, path.slice('/assets/physics'.length));
  for (const id of [firstBuild, nextBuild]) if (path.startsWith(`/${codeDirectory(id)}/`)) return inside(join(output, codeDirectory(firstBuild)), path.slice(`/${codeDirectory(id)}`.length));
  return inside(OUT, path);
};
const declaredCreatures = join(unpacked !== '' || dist === '' ? resolveFile(product) : join(output, 'shardfiles', slug), 'sections/actors/creatures.json');
const declaresCreatures = !existsSync(declaredCreatures) || JSON.parse(readFileSync(declaredCreatures, 'utf8')).creatures?.spawns?.length !== 0;
// PZ12 (J274): the build's own isolation (its `_headers` `/*` rule, dist/ only), on every answer, as its host sends it
const isolation = dist === '' || !existsSync(join(output, '_headers')) ? {} : documentIsolation(readFileSync(join(output, '_headers'), 'utf8'));
const isolatedBuild = isolation['cross-origin-embedder-policy'] === 'require-corp' && isolation['cross-origin-opener-policy'] === 'same-origin';
const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  // The uncached pointer (J57): only these two responses say which build is live.
  if (path === '/') { response.writeHead(200, { ...isolation, 'content-type': 'text/html', 'cache-control': 'no-store' }).end(stampBuildHtml(html, pointer)); return; }
  if (path === '/version.json') { response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ build: pointer })); return; }
  // WebKit asks for the page's service worker over the pointer's reload, and a build has one. This smoke's has nothing to cache.
  if (path === '/sw.js') { response.writeHead(200, { 'content-type': 'text/javascript' }).end(); return; }
  const file = resolvePath(path);
  if (file === null || !existsSync(file) || !statSync(file).isFile()) { response.writeHead(404).end(); return; }
  // J59 Q8: the loopback needs no SharedArrayBuffer; an isolated channel's build (PZ12) sends its COOP / COEP on every file
  response.writeHead(200, { ...isolation, 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', ...file.endsWith('.pack.br') ? { 'content-encoding': 'br' } : {} });
  createReadStream(file).pipe(response);
});
await new Promise(resolve => { server.listen(0, '127.0.0.1', resolve); });
const address = server.address(), origin = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}/`;

const browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true, args: engine === 'webkit' ? [] : [...KEYCHAIN_ARGS, '--mute-audio'] });
const failures = [];
const check = (name, passed, detail) => { if (!passed) failures.push(`${name}: ${JSON.stringify(detail)}`); };
try {
  const context = await browser.newContext({ ...devices['iPhone 16 Pro'], ...(engine === 'webkit' ? {} : { isMobile: false, defaultBrowserType: 'chromium' }) });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => { errors.push(String(error)); });
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(origin);
  const first = await page.evaluate(name => window.standaloneProof.boot(name), slug);
  const report = await page.evaluate(run => window.standaloneProof.play(run), seconds);
  const saved = await page.evaluate(() => window.standaloneProof.save());
  const stored = await page.evaluate(name => window.standaloneProof.stored(name), slug);
  await page.reload();
  const second = await page.evaluate(name => window.standaloneProof.boot(name), slug);
  const resumed = await page.evaluate(() => window.standaloneProof.play(2));
  const stale = await page.evaluate(() => window.__WS_BUILD_ID__);
  pointer = nextBuild; // the deploy: this tab keeps running the first build
  const reloaded = page.waitForEvent('load');
  const refusal = await page.evaluate(([name, target]) => window.standaloneProof.refused(name, target), [slug, nextBuild]).catch(() => 'navigated');
  await reloaded;
  const moved = await page.evaluate(() => ({ build: window.__WS_BUILD_ID__, closed: sessionStorage.getItem('proof.closed') }));
  const third = await page.evaluate(name => window.standaloneProof.boot(name), slug);
  const onward = await page.evaluate(() => window.standaloneProof.play(2));
  check('fresh boot', first.tick === 0 && !first.restored, first);
  // Headless WebKit wakes a worker's 16.7 ms timer only every ~100 ms here, with no game code loaded (Node's timers on the
  // same machine hold 17 ms), so the 3-step catch-up cap (§6.3.2) lands it at 30–40 ticks/s. Safari's rate is E5.4's gate.
  const floor = engine === 'webkit' ? 25 : 50;
  check('server tick rate near 60 Hz', report.ticksPerSecond > floor && report.ticksPerSecond < 62, report.ticksPerSecond);
  check('frame rate near 30 Hz', report.framesPerSecond > floor / 2 && report.framesPerSecond < 31, report.framesPerSecond);
  check('frames all decoded', report.dropped === 0, report.dropped);
  // A shard that declares no creature has no row to walk to (Nine's spawns are empty): the check holds for every shard that declares one.
  check('rows checked against the worker', report.probes >= seconds * 2 && (report.matched > 0 || !declaresCreatures), report);
  check('rows within one quantisation step', report.worstError <= report.step, { worst: report.worstError, step: report.step });
  check(isolatedBuild ? 'cross-origin isolated, as its channel (PZ12)' : 'no cross-origin isolation', report.crossOriginIsolated === isolatedBuild, report.crossOriginIsolated);
  check('commands reached the worker', report.positionMoved > 5, report.positionMoved);
  check('save durable', saved.ok && stored > 0, { saved, stored });
  check('save survives the reload', second.restored && second.tick === saved.tick, { second, saved });
  check('resumed server keeps ticking', resumed.tick > saved.tick + 60, resumed.tick);
  check('the document named the first build', stale === firstBuild, stale);
  check('hello refused the stale build with reload', moved.closed === 'reload', { refusal, moved });
  check('the stale tab reloaded into the new build', moved.build === nextBuild, moved);
  check('the save survives the new build', third.restored && third.tick >= saved.tick, { third, saved });
  check('the new build keeps ticking', onward.tick > third.tick + 60, onward.tick);
  check('page stayed clean', errors.length === 0, errors.slice(0, 5));
  console.log(JSON.stringify({ gate: 'standalone-smoke', slug, engine, pass: failures.length === 0, report, saved, stored, second, resumedTick: resumed.tick, moved, third, onwardTick: onward.tick, failures }, null, 1));
} finally {
  await browser.close();
  server.close();
  rmSync(OUT, { recursive: true, force: true });
}
process.exitCode = failures.length === 0 ? 0 : 1;
