// Run explicitly through src/scripts/browser-lane.sh; never a commit or push hook (it needs a zoneless build and real browsers).
//   WS_PV4_DIST=dist WS_PV4_COOKED=tmp/<lane>/cooked src/scripts/browser-lane.sh --max 30 node --test test/cooked-zones-browser.proof.mjs
// Fix preview PV4 (meta docs/plans/MULTI-REPO-SAGA/2026-11-26-opus-fix-preview-PLAN.md): a page built with a zone table (PV2) and no
// zone file (PV3) enters Driftwood with every zone byte from the cooked bucket, at 402x874 in headless Chromium and WebKit with
// sound off, then reloads offline and enters again. The bucket is a local folder laid out like it (`cooked-build-fixture.mjs`) at the
// origin the table names. Any zone file read from the page origin fails the run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createReadStream, readFileSync, realpathSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { chromium, webkit } from '../src/scripts/browser-playwright.mjs';
import { KEYCHAIN_ARGS } from '../src/scripts/.kit/chromium-keychain.mjs';
import { enterZone } from '../src/scripts/zone-entry.mjs';
import { bootObservation } from '../src/scripts/parity/boot-smoke.mjs';
import { isZoneFile, roadServerParts } from '../src/scripts/app-build/zoneless.mjs';
import { shardNames } from '../src/scripts/page-size.mjs';

const DIST = resolve(process.env['WS_PV4_DIST'] ?? 'dist'), COOKED = resolve(process.env['WS_PV4_COOKED'] ?? 'tmp/cooked');
const ZONE = process.env['WS_PV4_ZONE'] ?? 'driftwood-isle', PAGE_PORT = Number(process.env['WS_PV4_PORT'] ?? 4521);
const BROWSERS = (process.env['WS_PV4_BROWSERS'] ?? 'chromium,webkit').split(',');
const table = JSON.parse(readFileSync(join(DIST, 'zone-table.json'), 'utf8'));
const origin = new URL(table.origin ?? 'https://cooked.wildshard.io/');
/** Sound off and no keychain dialog (Jake, 2026-11-13 and 11-24). */
const CHROMIUM_ARGS = [...KEYCHAIN_ARGS, '--use-angle=metal'];
/** @type {Readonly<Record<string, string>>} */
const TYPES = { '.json': 'application/json', '.br': 'application/octet-stream', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.ktx2': 'image/ktx2', '.wasm': 'application/wasm' };

/** The bucket: GET and HEAD of a key, CORS for any page, CORP for an isolated one; nothing outside the folder. */
function bucket() {
  const root = realpathSync(COOKED);
  return createServer((request, response) => {
    const headers = { 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin', 'access-control-allow-headers': '*' };
    if (request.method === 'OPTIONS') { response.writeHead(204, headers).end(); return; }
    const key = decodeURIComponent(new URL(request.url ?? '/', origin).pathname.slice(1)), file = join(root, key);
    let size = -1;
    if (file.startsWith(`${root}${sep}`)) try { size = statSync(file).size; } catch { /* a 404 */ }
    if (size < 0) { response.writeHead(404, headers).end(); return; }
    response.writeHead(200, { ...headers, 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-length': String(size), ...(file.endsWith('.pack.br') ? {'content-encoding': 'br'} : {}) });
    if (request.method === 'HEAD') response.end(); else createReadStream(file).pipe(response);
  });
}

/** @param {import('node:child_process').ChildProcess} child @param {string} line */
const ready = (child, line) => new Promise((done, fail) => {
  child.stdout?.on('data', chunk => { if (String(chunk).includes(line)) done(null); });
  child.once('exit', code => { fail(new Error(`preview server exited ${String(code)}`)); });
});

test(`${ZONE} enters from the cook and again offline, at 402x874`, { timeout: 900_000 }, async () => {
  const server = bucket();
  await new Promise(done => { server.listen(Number(origin.port), origin.hostname, () => { done(null); }); });
  const page = spawn(process.execPath, ['src/scripts/preview-server.mjs', '--port', String(PAGE_PORT), '--outDir', DIST], { stdio: ['ignore', 'pipe', 'inherit'] });
  const shards = shardNames(DIST), road = roadServerParts(DIST); // the road's server part (PV8) stays in the page
  try {
    await ready(page, `:${String(PAGE_PORT)}/`);
    for (const name of BROWSERS) {
      const browser = name === 'webkit' ? await webkit.launch() : await chromium.launch({ args: CHROMIUM_ARGS });
      try {
        const context = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, hasTouch: true });
        /** @type {string[]} */ const fromPage = [];
        let cooked = 0;
        context.on('request', request => {
          const url = new URL(request.url());
          if (url.origin === origin.origin) cooked++;
          else if (url.port === String(PAGE_PORT) && isZoneFile(url.pathname.slice(1), shards, road)) fromPage.push(url.pathname);
        });
        const pageOrigin = `http://127.0.0.1:${String(PAGE_PORT)}`;
        if (name === 'chromium') await context.grantPermissions(['local-network-access'], {origin: pageOrigin});
        const tab = await context.newPage();
        tab.on('console', message => {
          if (message.type() === 'error' || /\[grid\] cooked zones|cooked zones not read/u.test(message.text()))
            console.log(`[pv4] ${name} console: ${message.text()}`);
        });
        tab.on('requestfailed', request => {
          if (request.url().startsWith(origin.origin)) console.log(`[pv4] ${name} ${request.failure()?.errorText}: ${request.url()}`);
        });
        const enter = async (/** @type {string} */ how) => {
          await enterZone(tab, {zone: ZONE, base: pageOrigin, flags: 'mute=1&nolock=1&skipintro=1&agent=pv4-cooked-zones', waitUntil: 'commit'});
          const deadline = Date.now() + 120_000;
          for (;;) {
            const seen = await tab.evaluate(bootObservation).catch(() => null);
            if (seen?.fatal.length) throw new Error(seen.fatal.join(' | '));
            // on the grid the session's shard stays the road (`platform.grid`); the cell the player stands in names the zone
            if (seen?.ready && (seen.shard.replace(/^_/u, '') === ZONE || seen.grid?.inside === ZONE)) break;
            if (seen?.revealing) await tab.locator('.ws-grid-reveal').dispatchEvent('pointerdown');
            if (Date.now() >= deadline) throw new Error(`no ${how} gameplay: ${seen?.appState ?? 'no world'} ${seen?.shard ?? ''} ${JSON.stringify({ ...seen, states: undefined, titlePreparation: undefined }).slice(0, 900)}`);
            await tab.waitForTimeout(350);
          }
          console.log(`[pv4] ${name} ${how}: in ${ZONE}; ${String(cooked)} cooked reads, ${String(fromPage.length)} zone reads from the page${fromPage.length === 0 ? '' : ` (${fromPage.slice(0, 6).join(', ')})`}`);
        };
        await enter('online');
        await tab.evaluate(async () => { await navigator.serviceWorker.ready; });
        // the first visit installs the worker (a fresh page isn't controlled, so the worker saw none of its reads); the second reads
        // through it, as a returning player's does, and keeps the cooked reads (sw.js cookedRead)
        cooked = 0;
        await enter('warm');
        // a returning player's device holds the build whole: the precache the page asked for at control finished (the worker's book
        // for the build, sw.js precacheGeneration; its id is the page's build plus a digest, so any book but `previous`)
        for (const until = Date.now() + 180_000; ; await tab.waitForTimeout(2000)) {
          const books = await tab.evaluate(async () => (await (await caches.open('ws-preview-builds-v1')).keys()).map(key => new URL(key.url).pathname)
            .filter(path => path.startsWith('/__ws_build__/') && path !== '/__ws_build__/previous'));
          if (books.length > 0) break;
          assert.ok(Date.now() < until, `${name}: the worker's precache never finished`);
        }
        await context.setOffline(true);
        cooked = 0;
        await enter('offline');
        assert.deepEqual(fromPage, [], `${name}: zone files read from the page origin`);
        await context.close();
      } finally { await browser.close(); }
    }
  } finally {
    page.kill('SIGTERM');
    await new Promise(done => { server.close(() => { done(null); }); });
  }
});
