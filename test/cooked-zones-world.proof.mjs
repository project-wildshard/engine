// Run explicitly through src/scripts/browser-lane.sh; never a commit or push hook (it needs a zoneless world build and real browsers).
//   WS_PV16_DIST=<dist> WS_PV16_COOKED=<bucket dir> WS_PV16_KEY=<key.json> WS_PV16_WORK=tmp/<lane>/world \
//     src/scripts/browser-lane.sh --max 30 node --test test/cooked-zones-world.proof.mjs
// Fix preview PV16 (meta docs/plans/MULTI-REPO-SAGA/2026-11-26-opus-fix-preview-PLAN.md): a staging or production page built with
// its own zone table (no zone file, PV3) joins a world (the online rig: the dedicated server built from this checkout, a release
// file signed on 127.0.0.1) and enters Driftwood with every zone byte from the cooked bucket, at 402x874 in headless Chromium and
// WebKit with sound off. The dist is built in world mode with the rig's release URL and key (`WILDSHARD_RELEASE_URL`
// http://127.0.0.1:<rig port + 3>/release.json, `WILDSHARD_RELEASE_KEY` the key's public half) and `WS_ZONE_TABLE`. Any zone file
// read from the page origin fails the run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReadStream, readFileSync, realpathSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { chromium, webkit } from '../src/scripts/browser-playwright.mjs';
import { KEYCHAIN_ARGS } from '../src/scripts/.kit/chromium-keychain.mjs';
import { PLAY_FLAGS, intoWorld, openRig } from '../src/scripts/online-rig.mjs';
import { saveFixture } from '../src/scripts/debug-settings.mjs';
import { enterZone } from '../src/scripts/zone-entry.mjs';
import { bootObservation } from '../src/scripts/parity/boot-smoke.mjs';
import { isZoneFile, roadServerParts } from '../src/scripts/app-build/zoneless.mjs';
import { shardNames } from '../src/scripts/page-size.mjs';

const DIST = resolve(process.env['WS_PV16_DIST'] ?? 'dist'), COOKED = resolve(process.env['WS_PV16_COOKED'] ?? 'tmp/cooked');
const KEY = resolve(process.env['WS_PV16_KEY'] ?? 'tmp/world-key.json'), WORK = resolve(process.env['WS_PV16_WORK'] ?? 'tmp/pv16-world');
const ZONE = process.env['WS_PV16_ZONE'] ?? 'driftwood-isle';
const BROWSERS = (process.env['WS_PV16_BROWSERS'] ?? 'chromium,webkit').split(',');
const table = JSON.parse(readFileSync(join(DIST, 'zone-table.json'), 'utf8'));
const origin = new URL(table.origin ?? 'https://cooked.wildshard.io/');
/** Sound off and no keychain dialog (Jake, 2026-11-13 and 11-24): KEYCHAIN_ARGS carries the mute flag. */
const CHROMIUM_ARGS = [...KEYCHAIN_ARGS, '--use-angle=metal'];
const PHONE = { viewport: { width: 402, height: 874 }, screen: { width: 402, height: 874 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true };
/** @type {Readonly<Record<string, string>>} */
const TYPES = { '.json': 'application/json', '.br': 'application/octet-stream', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.ktx2': 'image/ktx2', '.wasm': 'application/wasm' };

/** The bucket: GET and HEAD of a key, CORS for any page; nothing outside the folder. */
function bucket() {
  const root = realpathSync(COOKED);
  return createServer((request, response) => {
    const headers = { 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin', 'access-control-allow-headers': '*' };
    if (request.method === 'OPTIONS') { response.writeHead(204, headers).end(); return; }
    const key = decodeURIComponent(new URL(request.url ?? '/', origin).pathname.slice(1)), file = join(root, key);
    let size = -1;
    if (file.startsWith(`${root}${sep}`)) try { size = statSync(file).size; } catch { /* a 404 */ }
    if (size < 0) { response.writeHead(404, headers).end(); return; }
    response.writeHead(200, { ...headers, 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-length': String(size), ...(file.endsWith('.pack.br') ? { 'content-encoding': 'br' } : {}) });
    if (request.method === 'HEAD') response.end(); else createReadStream(file).pipe(response);
  });
}

test(`a world page enters ${ZONE} from the cook, at 402x874`, { timeout: 900_000 }, async () => {
  const server = bucket();
  await new Promise(done => { server.listen(Number(origin.port), origin.hostname, () => { done(null); }); });
  const rig = await openRig({ dist: DIST, work: WORK, keyFile: KEY, saves: 'memory', shard: ZONE });
  const shards = shardNames(DIST), road = roadServerParts(DIST), page = new URL(rig.base);
  try {
    for (const name of BROWSERS) {
      const browser = name === 'webkit' ? await webkit.launch() : await chromium.launch({ args: CHROMIUM_ARGS });
      try {
        /** @type {string[]} */ const fromPage = [];
        let cooked = 0;
        // online-rig.mjs enterPage's steps, with every read watched from the first
        const context = await browser.newContext(PHONE), tab = await context.newPage(), errors = /** @type {string[]} */ ([]);
        context.on('request', request => {
          const url = new URL(request.url());
          if (url.origin === origin.origin) cooked += 1;
          else if (url.origin === page.origin && isZoneFile(url.pathname.slice(1), shards, road)) fromPage.push(url.pathname);
        });
        tab.on('pageerror', error => { errors.push(error.message.slice(0, 240)); });
        if (name === 'chromium') await context.grantPermissions(['local-network-access'], { origin: page.origin });
        await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
        await enterZone(tab, { zone: ZONE, base: rig.base, flags: PLAY_FLAGS });
        await tab.locator('#ws-name-box input').waitFor({ timeout: 150_000 });
        await tab.locator('#ws-name-box input').fill('Jake');
        await tab.locator('#ws-name-box button[type=submit]').click();
        await intoWorld(tab);
        const entered = { page: tab, context, errors };
        const seen = await entered.page.evaluate(bootObservation);
        assert.ok(seen.shard.replace(/^_/u, '') === ZONE || seen.grid?.inside === ZONE, `${name}: in ${ZONE}: ${JSON.stringify({ ...seen, states: undefined, titlePreparation: undefined }).slice(0, 600)}`);
        console.log(`[pv16] ${name}: in ${ZONE} on the world; ${String(cooked)} cooked reads, ${String(fromPage.length)} zone reads from the page${fromPage.length === 0 ? '' : ` (${fromPage.slice(0, 6).join(', ')})`}; errors ${entered.errors.slice(0, 3).join(' | ')}`);
        assert.deepEqual(fromPage, [], `${name}: zone files read from the page origin`);
        await entered.context.close();
      } finally { await browser.close(); }
    }
  } finally {
    await rig.close();
    await new Promise(done => { server.close(() => { done(null); }); });
  }
});
