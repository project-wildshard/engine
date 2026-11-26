// Meta MMO-FAILURE-MODES FM12 (J373): the real failure screens on the deployed staging build, end to end. J205: staging only,
// never an agent socket on production; prod is read-only. Headless, muted, rAF capped at 60 fps.
//
//   scripts/browser-lane.sh node scripts/fm12-staging-proof.mjs [--out <dir>]
//
// 1. The signed staging release verifies with the release key, names channel staging, and its engineBuild is the page's
//    /version.json build and the running page's __WS_BUILD_ID__.
// 2. Two pages join the staging world as two players, see each other and chat.
// 3. Download retry (mode 33): page B's first pack reads are 503 at the page boundary for 6 s; its packs-5xx line shows, then the
//    world loads from the real packs.
// 4. Restart (mode 9): page A's live socket gets the restarting server's own close (4005) at the page boundary, and every dial for
//    4 s gets the same; the restart banner shows, then the link comes back to the real staging door and chat crosses again.
// 5. Offline (mode 2): page A goes offline (Playwright setOffline); the offline-play card shows, then it rejoins and chat crosses.
// 6. failure.screen: every POST the pages send to the API's telemetry ingest that carries a failure.screen episode, with its status.
// The receipt is <out>/receipt.json; shots are <out>/*.png. Exit 0: all pass; 1: a screen or recovery failed.
import { agentFetch as fetch } from './agent-requests.mjs';
import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from './browser-playwright.mjs';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';
import { capFrames } from './journey-proof.mjs';
import { CHANNELS, RELEASE_PUBLIC_KEY } from './page-release/flow.mjs';
import { chatLinePattern, guardStagingSockets, playerNameSource } from './staging-proof-lines.mjs';
import { enterZone } from './zone-entry.mjs';

const outFlag = process.argv.indexOf('--out');
const out = resolve(outFlag === -1 ? `tmp/${process.env.WS_LANE_NAME ?? 'fm12'}/staging` : process.argv[outFlag + 1] ?? 'tmp/fm12/staging');
mkdirSync(out, { recursive: true });
const base = CHANNELS.staging.origin, releaseURL = CHANNELS.staging.release;
assert.equal(base, 'https://staging.wildshard.io', 'J205: staging only');
/** @type {Record<string, unknown>} */
const receipt = { schema: 'fm12-staging-proof/1', at: new Date().toISOString(), base, steps: [] };
const steps = /** @type {{step:string,outcome:'pass'|'fail',ms?:number,seen?:string[],note?:string}[]} */ (receipt.steps);
const step = (/** @type {typeof steps[number]} */ row) => { steps.push(row); console.log(`${row.outcome.padEnd(5)} ${row.step}${row.ms === undefined ? '' : ` ${String(row.ms)} ms`}${row.note === undefined ? '' : `: ${row.note}`}`); };

// 1. the signed release and the deployed build
const signed = await (await fetch(releaseURL, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000) })).json();
assert.ok(verify(null, Buffer.from(signed.body), createPublicKey({ key: Buffer.from(RELEASE_PUBLIC_KEY, 'hex'), format: 'der', type: 'spki' }), Buffer.from(signed.signature, 'hex')), 'the staging release signature');
const release = JSON.parse(signed.body);
assert.equal(release.channel, 'staging');
const version = await (await fetch(`${base}/version.json`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) })).json();
assert.equal(version.build, release.engineBuild, 'the page build is the signed release build');
const build = String(release.engineBuild), socket = String(release.socket).replace(/\/$/u, '');
Object.assign(receipt, { build, clientVersion: version.clientVersion, describe: version.describe, serial: release.serial, saveEpoch: release.saveEpoch, socket });
step({ step: 'signed staging release verifies; version.json build matches', outcome: 'pass', note: `${String(version.describe)} ${build.slice(0, 10)} serial ${String(release.serial)}` });

const browser = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])] });
/** @type {{url:string,status:number|null,episodes:number}[]} */
const telemetry = [];
/** the socket boundary for page A: pass through, or answer each dial with the restarting server's close */
let refuseUntil = 0;
/** @type {import('playwright').WebSocketRoute[]} */
const liveRoutes = [];
let packsFailUntil = 0, packsArmed = false;
/** @type {import('playwright').Page[]} */
const opened = [];
const visible = (/** @type {import('playwright').Page} */ page) => page.evaluate(() => [...document.querySelectorAll('[data-failmode]')]
  .filter(node => node instanceof HTMLElement && !node.hidden && getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden' && node.getClientRects().length > 0)
  .map(node => (node instanceof HTMLElement ? node.dataset.failmode : undefined) ?? ''));
/** waits for a visible `[data-failmode~=id]`; every id seen meanwhile */
const waitScreen = async (/** @type {import('playwright').Page} */ page, /** @type {RegExp} */ id, /** @type {number} */ timeout) => {
  const seen = new Set(), started = Date.now();
  while (Date.now() - started < timeout) {
    const now = await visible(page).catch(() => []);
    for (const ids of now) seen.add(ids);
    if (now.some(ids => id.test(ids))) return { ms: Date.now() - started, seen: [...seen] };
    await page.waitForTimeout(100);
  }
  return { ms: null, seen: [...seen] };
};
const frames = (/** @type {import('playwright').Page} */ page) => page.evaluate(() => window.__workerClient?.().frames ?? 0);
/** the link is live again: frames advance and no banner or card is up */
const recovered = async (/** @type {import('playwright').Page} */ page, /** @type {number} */ timeout) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const before = await frames(page); await page.waitForTimeout(1000);
    const ids = await visible(page).catch(() => ['?']);
    if (await frames(page) > before && !ids.some(row => /\b(?:drop|restart|half-open|reset|resuming|lost|offline-play)\b/u.test(row))) return Date.now() - started;
  }
  return null;
};
try {
  const enter = async (/** @type {string} */ name, /** @type {boolean} */ routed, /** @type {boolean} */ packs) => {
    const context = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
    await context.addInitScript(guardStagingSockets, socket);
    await context.addInitScript(capFrames);
    await saveFixture(context, { scope: 'global', key: 'settings', data: { music: false, sfx: false, volume: 0 }, merge: true });
    if (routed) await context.routeWebSocket(url => new URL(url).origin === socket, ws => {
      if (Date.now() < refuseUntil) { void ws.close({ code: 4005, reason: 'restart' }); return; }
      ws.connectToServer(); liveRoutes.push(ws);
    });
    if (packs) await context.route(url => url.origin === 'https://packs.wildshard.io' && url.pathname.startsWith('/content/'), route => {
      if (!packsArmed) return route.fallback();
      if (packsFailUntil === 0) packsFailUntil = Date.now() + 6000;
      if (Date.now() < packsFailUntil) return route.fulfill({ status: 503, body: 'fm12 injected 503 at the page boundary' });
      return route.fallback();
    });
    const page = await context.newPage(); opened.push(page);
    page.on('pageerror', error => { console.log(`page error ${name}: ${error.message.slice(0, 200)}`); });
    page.on('request', request => {
      if (request.method() !== 'POST' || !/\/api\/telemetry\b/u.test(request.url())) return;
      const body = request.postData() ?? '';
      if (!body.includes('failure.screen')) return;
      const row = { url: new URL(request.url()).origin + new URL(request.url()).pathname, status: /** @type {number|null} */ (null), episodes: body.split('failure.screen').length - 1 };
      telemetry.push(row);
      void request.response().then(response => { row.status = response?.status() ?? null; return row.status; }, () => undefined);
    });
    await enterZone(page, { zone: 'driftwood-isle', base, flags: 'mute=1&nolock=1&skipintro=1', timeout: 90_000 });
    return { page, context };
  };
  /** the Name box (when it asks; `armed` runs just before the submit) into the world */
  const named = async (/** @type {import('playwright').Page} */ page, /** @type {string} */ name, armed = () => undefined) => {
    await page.locator('#ws-name-box input').waitFor({ timeout: 90_000 });
    await page.locator('#ws-name-box input').fill(name); armed(); await page.locator('#ws-name-box button[type=submit]').click();
  };
  const play = async (/** @type {import('playwright').Page} */ page) => {
    await page.waitForFunction(() => typeof window.__workerClient === 'function' && window.__wildshard?.world?.player !== undefined, undefined, { timeout: 150_000 });
    await page.evaluate(() => { window.__wildshard?.world?.hud.enterNow(); });
    await page.waitForFunction(() => (window.__workerClient?.().frames ?? 0) > 30, undefined, { timeout: 60_000 });
    if (await page.evaluate(() => window.__wildshard?.world?.game.app.clock.paused === true)) await page.getByRole('button', { name: /^resume$/iu }).click();
    assert.equal(await page.evaluate(() => Reflect.get(globalThis, '__WS_BUILD_ID__')), build, 'the running page is the signed build');
  };
  const tag = Date.now().toString(36).slice(-4), aName = `Agent fm ${tag} A`, bName = `Agent fm ${tag} B`;
  const chat = async (/** @type {import('playwright').Page} */ from, /** @type {string} */ fromName, /** @type {import('playwright').Page[]} */ to, /** @type {string} */ text) => {
    await from.locator('#ws-chat input').fill(text); await from.locator('#ws-chat input').press('Enter');
    for (const page of to) await page.locator('#ws-chat', { hasText: chatLinePattern(fromName, text) }).waitFor({ timeout: 20_000 });
  };

  // 2 and 3: A joins; B loads through the pack fault and joins
  const a = await enter(aName, true, false); await named(a.page, aName); await play(a.page);
  const b = await enter(bName, false, true);
  await named(b.page, bName, () => { packsArmed = true; });
  // the loading card's paused line (33/34), or, its budgeted retries spent inside the outage, the download-failed card (36)
  const download = await waitScreen(b.page, /\b(?:packs-5xx|book-5xx|download-failed)\b/u, 40_000);
  await b.page.screenshot({ path: join(out, 'download-retry.png') });
  await b.page.waitForTimeout(Math.max(0, packsFailUntil - Date.now()) + 500);
  const failed = b.page.locator('[data-failmode~="download-failed"] button', { hasText: /try again/iu }).first();
  const retried = await failed.isVisible().catch(() => false) ? await failed.click({ timeout: 5000 }).then(() => true, () => false) : false;
  await play(b.page);
  const cleared = await b.page.locator('[data-failmode~="download-failed"]:visible').waitFor({ state: 'hidden', timeout: 30_000 }).then(() => true, () => false);
  step({ step: 'download retry (33/36): a download failure shows, then the world loads', outcome: download.ms !== null && cleared ? 'pass' : 'fail', ms: download.ms ?? undefined, seen: download.seen, note: `503s on every /content/ read for 6 s from the first world read${packsFailUntil === 0 ? ' (none matched)' : ''}; ${retried ? 'Try again pressed after the heal' : 'recovered by itself'}; card cleared: ${String(cleared)}` });
  for (const [page, other] of [[a.page, bName], [b.page, aName]]) await /** @type {import('playwright').Page} */ (page).waitForFunction(source => window.__onlinePlayers?.().some(row => new RegExp(source, 'u').test(row.name) && row.modelled), playerNameSource(/** @type {string} */ (other)), { timeout: 30_000 });
  await chat(b.page, bName, [a.page, b.page], `fm12 join ${build.slice(0, 7)}`);
  step({ step: 'two players see each other and chat on staging', outcome: 'pass' });

  // 4. restart: the server's close code at A's boundary, then 4 s of refused dials
  refuseUntil = Date.now() + 4000;
  for (const ws of liveRoutes.splice(0)) void ws.close({ code: 4005, reason: 'restart' });
  const restart = await waitScreen(a.page, /\brestart\b/u, 10_000);
  await a.page.screenshot({ path: join(out, 'restart.png') });
  const restartBack = await recovered(a.page, 60_000);
  if (restartBack !== null) await chat(a.page, aName, [a.page, b.page], `fm12 after restart ${tag}`);
  step({ step: 'restart (9): the banner shows, the link comes back and chat crosses', outcome: restart.ms !== null && restartBack !== null ? 'pass' : 'fail', ms: restart.ms ?? undefined, seen: restart.seen, note: `recovered in ${String(restartBack)} ms` });

  // 5. offline
  await a.context.setOffline(true);
  const offline = await waitScreen(a.page, /\boffline-play\b/u, 15_000);
  await a.page.screenshot({ path: join(out, 'offline-play.png') });
  await a.page.waitForTimeout(3000);
  await a.context.setOffline(false);
  const offlineBack = await recovered(a.page, 60_000);
  if (offlineBack !== null) await chat(a.page, aName, [a.page, b.page], `fm12 after offline ${tag}`);
  step({ step: 'offline (2): the card shows, the link comes back and chat crosses', outcome: offline.ms !== null && offlineBack !== null ? 'pass' : 'fail', ms: offline.ms ?? undefined, seen: offline.seen, note: `recovered in ${String(offlineBack)} ms` });

  // 6. failure.screen reaches the ingest: an episode is sent when it ends (recovered), through the page's outbox
  await a.page.waitForTimeout(8000);
  receipt.telemetry = telemetry;
  const accepted = telemetry.filter(row => row.status !== null && row.status >= 200 && row.status < 300);
  step({ step: 'failure.screen episodes reach the API ingest', outcome: accepted.length > 0 ? 'pass' : 'fail', note: `${String(accepted.length)} of ${String(telemetry.length)} POSTs accepted, ${String(accepted.reduce((sum, row) => sum + row.episodes, 0))} episodes` });
  await a.context.close(); await b.context.close();
} catch (error) {
  step({ step: 'harness', outcome: 'fail', note: String(error).slice(0, 600) });
  receipt.pages = await Promise.all(opened.map(async (page, index) => {
    await page.screenshot({ path: join(out, `fault-${String(index)}.png`) }).catch(() => undefined);
    return page.evaluate(() => ({ url: location.href, text: (document.body.textContent ?? '').replaceAll(/\s+/gu, ' ').slice(-1200),
      failmodes: [...document.querySelectorAll('[data-failmode]')].map(node => (node instanceof HTMLElement ? node.dataset.failmode : undefined)) })).catch((/** @type {unknown} */ reading) => ({ reading: String(reading) }));
  }));
  console.log(JSON.stringify(receipt.pages, null, 1).slice(0, 3000));
} finally {
  await browser.close();
}
receipt.exit = steps.every(row => row.outcome === 'pass') ? 0 : 1;
writeFileSync(join(out, 'receipt.json'), JSON.stringify(receipt, null, 1));
console.log(`exit ${String(receipt.exit)} -> ${join(out, 'receipt.json')}`);
process.exitCode = Number(receipt.exit);
