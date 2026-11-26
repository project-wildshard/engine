#!/usr/bin/env node
// TEST-COVERAGE EG-32 `upgrade-two-builds` (meta docs/plans/test-coverage/MACBOOK-WAITS.md MW4, BUG-15, J174): an old tab
// meets a new build and its new cook on the same origin, refuses cleanly and reloads into the new build. BUG-15's stale
// tab hit `Build must publish source residency` and hung for over 100 s.
//
// Two finished builds, each served by src/scripts/serve-build.sh (e.g. `--rev v0.1.29` and `--rev v0.1.31`), sit behind one
// switching proxy, so the old tab's origin, service worker, caches and saves carry across the deploy as on staging:
//   1. the old build serves the title; the tab opens SHARD SELECT and picks the shard (the old cook's catalogue);
//   2. the proxy switches to the new build (the deploy);
//   3. the tab presses ENTER WORLD with its old code, so it asks the new build and new cook for the world.
// Pass: within --limit seconds (default 100) the page loads a document from the new build and that page reaches its
// title or the world's control, BUG-15's words never show, and the old page never reaches control on the new cook
// without reloading (a quiet mix of builds). Exit 0 on pass, 1 on a refusal that hangs, 2 on usage.
//   src/scripts/browser-lane.sh node src/scripts/loading-flow/upgrade-two-builds.mjs --old <url> --new <url> [--shard Nine]
//     [--limit 100] [--json <out.json>]
import http from 'node:http';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { chromium } from "../browser-playwright.mjs";
import { KEYCHAIN_ARGS } from '../.kit/chromium-keychain.mjs';
import { NAME_ASKED, developerSettings, saveFixture, hideDeveloperOverlays } from '../debug-settings.mjs';

const { values } = parseArgs({ options: { old: { type: 'string' }, new: { type: 'string' }, shard: { type: 'string', default: 'Nine' },
  limit: { type: 'string', default: '100' }, json: { type: 'string' } } });
if (values.old === undefined || values.new === undefined) {
  console.error('usage: upgrade-two-builds.mjs --old <url> --new <url> [--shard <card title regex>] [--limit 100] [--json <file>]'); process.exit(2);
}
const builds = { old: new URL(values.old), new: new URL(values.new) }, shard = new RegExp(values.shard ?? 'Nine', 'iu');
const limitMs = Number(values.limit) * 1000;
/** @param {number} ms */
const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });

/** @type {'old' | 'new'} */
let side = 'old';
const started = Date.now();
/** @type {{at: number, side: string, method: string, url: string, status: number, type: string}[]} */
const served = [];
const proxy = http.createServer((request, response) => {
  const from = side, target = builds[from];
  const upstream = http.request({ host: target.hostname, port: target.port, path: request.url, method: request.method,
    headers: { ...request.headers, host: target.host } }, answer => {
    served.push({ at: Date.now() - started, side: from, method: request.method ?? 'GET', url: request.url ?? '', status: answer.statusCode ?? 0,
      type: answer.headers['content-type'] ?? '' });
    response.writeHead(answer.statusCode ?? 502, answer.headers); answer.pipe(response);
  });
  upstream.on('error', error => { response.writeHead(502); response.end(String(error)); });
  request.pipe(upstream);
});
await new Promise(resolve => { proxy.listen(0, '127.0.0.1', () => { resolve(undefined); }); });
const address = proxy.address();
if (address === null || typeof address === 'string') throw new Error('proxy has no port');
const origin = `http://127.0.0.1:${address.port}`;
/** @param {'old' | 'new'} which */
const buildOf = async which => /** @type {{build?: string, clientVersion?: string}} */ (await (await fetch(new URL('/version.json', builds[which]))).json());
const [oldVersion, newVersion] = await Promise.all([buildOf('old'), buildOf('new')]);
console.log(`upgrade-two-builds: old ${oldVersion.build} (${oldVersion.clientVersion ?? 'no clientVersion'}) -> new ${newVersion.build} (${newVersion.clientVersion ?? '?'}) at ${origin}`);

const browser = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
/** @type {Record<string, unknown>} */
const report = { old: oldVersion, new: newVersion, shard: values.shard };
let failure = '';
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await developerSettings(context, { tier: 'desktop', volume: 0 });
  await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
  await saveFixture(context, NAME_ASKED);
  await context.addInitScript(hideDeveloperOverlays);
  const page = await context.newPage();
  /** @type {{at: number, url: string}[]} */
  const navigations = [];
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push({ at: Date.now() - started, url: frame.url() }); });
  /** @type {string[]} */
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text().slice(0, 300)); });
  page.on('pageerror', error => { errors.push(`pageerror: ${String(error).slice(0, 300)}`); });
  /** @param {string} expression @param {number} ms */
  const until = async (expression, ms) => { try { await page.waitForFunction(expression, null, { timeout: ms, polling: 250 }); return true; } catch { return false; } };
  /** @param {string} selector */
  const tap = selector => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);
  const title = `!!document.querySelector('.ws-main-select')?.getClientRects().length`;
  const control = `(() => { const w = window.__wildshard?.world, l = document.querySelector('.ws-load');
    const shown = !!l && l.isConnected && l.getClientRects().length > 0 && getComputedStyle(l).display !== 'none' && Number(getComputedStyle(l).opacity) > .05;
    try { return !!w?.hud.entered && !w.hud.paused && w.game.frameGate() && !shown; } catch { return false; } })()`;
  const BUG15 = 'Build must publish source residency';

  // 1. the old build: title, SHARD SELECT, the card
  await page.goto(`${origin}/`);
  if (!await until(title, 120_000)) throw new Error('old build: title never ready');
  await sleep(2000);
  await tap('.ws-main-select');
  if (!await until(`!!document.querySelector('.ws-menu-card')?.getClientRects().length`, 30_000)) throw new Error('old build: shard select never ready');
  await sleep(800);
  const titles = await page.evaluate(`[...document.querySelectorAll('.ws-menu-card')].map(c => (c.querySelector('b')?.textContent ?? c.textContent ?? '').trim().slice(0, 40))`);
  const card = titles.findIndex((/** @type {string} */ name) => shard.test(name));
  if (card === -1) throw new Error(`old build: no card matches ${shard} in ${JSON.stringify(titles)}`);
  await tap(`.ws-menu-dots i[data-i="${card}"]`);
  if (!await until(`document.querySelector('.ws-menu-card.selected')?.dataset.i === '${card}' && !document.querySelector('.ws-menu-play')?.disabled`, 15_000)) {
    throw new Error(`old build: ${titles[card]} never selectable`);
  }
  await sleep(800);
  const oldDocuments = navigations.length;

  // 2. the deploy
  side = 'new';
  const deployAt = Date.now() - started;
  console.log(`deploy at ${(deployAt / 1000).toFixed(1)} s: the proxy now serves the new build`);

  // 3. the old code enters the world against the new build and cook
  await page.evaluate(`setTimeout(() => document.querySelector('.ws-menu-play').click(), 0)`);
  const deadline = Date.now() + limitMs;
  /** @type {number | undefined} */
  let reloadedAt;
  /** @type {number | undefined} */
  let titleSince;
  let outcome = '';
  while (Date.now() < deadline) {
    const newDocument = served.some(row => row.side === 'new' && row.method === 'GET' && row.type.startsWith('text/html') && !row.url.startsWith('/b/'));
    const reloaded = navigations.length > oldDocuments && newDocument;
    if (reloaded && reloadedAt === undefined) reloadedAt = navigations[navigations.length - 1]?.at;
    const text = await page.evaluate('document.body?.innerText ?? ""').catch(() => '');
    if (typeof text === 'string' && text.includes(BUG15)) { outcome = 'bug15'; break; }
    const inWorld = await page.evaluate(control).catch(() => false), atTitle = await page.evaluate(title).catch(() => false);
    if (inWorld === true && !reloaded) { outcome = 'mixed'; break; }
    if (reloaded && inWorld === true) { outcome = 'reloaded-world'; break; }
    // the title counts once it has held 10 s with no further navigation (a world page may still be loading behind it)
    const lastNavigation = navigations[navigations.length - 1]?.at ?? 0;
    if (reloaded && atTitle === true) { titleSince ??= Date.now() - started; if (Date.now() - started - Math.max(titleSince, lastNavigation) >= 10_000) { outcome = 'reloaded-title'; break; } }
    else titleSince = undefined;
    await sleep(500);
  }
  const endAt = Date.now() - started;
  const visible = String(await page.evaluate('document.body?.innerText ?? ""').catch(() => '')).replaceAll(/\s+/gu, ' ').slice(0, 400);
  Object.assign(report, { outcome: outcome || 'hung', deployAt, reloadedAt, endAt, settleMs: endAt - deployAt, navigations,
    errors: errors.slice(0, 20), visible,
    servedAfterDeploy: served.filter(row => row.at >= deployAt).slice(0, 60).map(row => `${row.side} ${row.status} ${row.url.slice(0, 100)}`) });
  console.log(`outcome ${report.outcome}: deploy +${(deployAt / 1000).toFixed(1)} s, reload ${reloadedAt === undefined ? 'none' : `+${((reloadedAt - deployAt) / 1000).toFixed(1)} s`}, settled +${((endAt - deployAt) / 1000).toFixed(1)} s after the deploy`);
  console.log(`navigations: ${navigations.map(row => `+${((row.at - deployAt) / 1000).toFixed(1)} s ${row.url}`).join(' · ')}`);
  if (outcome === 'bug15') failure = `BUG-15: the old tab shows "${BUG15}"`;
  else if (outcome === 'mixed') failure = 'the old page reached control on the new build without reloading';
  else if (outcome === '') failure = `the old tab neither reloaded into the new build nor settled within ${limitMs / 1000} s; it shows: ${visible}`;
  if (failure !== '') { console.log(`errors: ${errors.slice(0, 8).join(' | ')}`); console.log(`served after the deploy: ${/** @type {string[]} */ (report.servedAfterDeploy).slice(0, 20).join(' | ')}`); }
} catch (error) {
  failure = String(error); report.outcome = 'error';
} finally {
  await browser.close();
  proxy.close();
  if (values.json !== undefined) writeFileSync(values.json, `${JSON.stringify({ ...report, failure }, null, 1)}\n`);
}
if (failure !== '') { console.log(`FAIL ${failure}`); process.exit(1); }
console.log('PASS the old tab refused the new build cleanly and reloaded into it');
