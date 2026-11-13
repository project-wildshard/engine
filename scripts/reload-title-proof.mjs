#!/usr/bin/env node
// QA-FEEDBACK 2026-11-12 row 35 (Jake, 20:04: "I expected reload to go back to main menu"): a headless proof on a built app.
//   1. a fresh open of a shard URL opens the shard (its loading card, not the title);
//   2. the player's own reload (page.reload(), the browser's reload button) lands on the title with no drop modal and no
//      title-drop report;
//   3. the engine's chunk recovery (a stale `main` chunk, a newer /version.json) reloads by itself and resumes the shard.
// Headless Chromium at 402×874 (Jake's iPhone 17 Pro), GPU flags kept. It stops the server and the browser it starts.
//   node scripts/reload-title-proof.mjs --dist=<built app> --out=<captures dir> [--shard=_template] [--port=18931]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { chromium } from 'playwright';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';

/** @param {string} name */
const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const dist = absolute(option('dist') ?? 'dist'), out = absolute(option('out') ?? 'tmp/reloadtitle/shots'), shard = option('shard') ?? '_template';
const port = Number(option('port') ?? '18931'), base = `http://127.0.0.1:${String(port)}`;
mkdirSync(out, { recursive: true });
/** @param {number} ms */
const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });
const failures = /** @type {string[]} */ ([]), log = /** @type {string[]} */ ([]);
/** @param {boolean} ok @param {string} what */
const check = (ok, what) => { const line = `${ok ? 'ok  ' : 'FAIL'} ${what}`; console.log(line); log.push(line); if (!ok) failures.push(what); };

const server = spawn(process.execPath, ['scripts/preview-server.mjs', '--outDir', dist, '--port', String(port)], { stdio: ['ignore', 'ignore', 'inherit'] });
const browser = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--use-angle=metal', '--mute-audio'] });
try {
  for (let tries = 0; tries < 100 && !(await fetch(`${base}/version.json`).then(found => found.ok).catch(() => false)); tries++) await sleep(100);
  const iphone = { viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1' };
  /** a tab, with its console and any title-drop report it sends */
  const tab = async () => {
    const context = await browser.newContext(iphone), page = await context.newPage(), consoleLines = /** @type {string[]} */ ([]), reports = /** @type {string[]} */ ([]);
    page.on('console', message => { consoleLines.push(message.text()); });
    page.on('request', request => { const body = request.postData() ?? ''; if (body.includes('title-drop')) reports.push(request.url()); });
    return { context, page, consoleLines, reports };
  };
  const titleShown = '#hud.intro .ws-main:not(.hide), #hud.intro .ws-menu:not(.hide)';
  /** @param {import('playwright').Page} page */
  const onTitle = page => page.evaluate(() => document.documentElement.classList.contains('title-first'));
  /** @param {import('playwright').Page} page */
  const loadingShard = page => page.waitForFunction(() => document.querySelector('.ws-load:not(.hide)') !== null && !document.documentElement.classList.contains('title-first'), null, { timeout: 60_000 }).then(() => true, () => false);

  // 1 + 2: a fresh open loads the shard; the player's reload goes to the title, quietly
  {
    const { context, page, consoleLines, reports } = await tab();
    await page.goto(`${base}/?chunk=${shard}&sw=0`);
    check(await loadingShard(page), `a fresh open of /?chunk=${shard} shows its loading card`);
    await sleep(1500);
    await page.screenshot({ path: join(out, '1-fresh-open-loading.png') });
    await page.reload();
    const title = await page.waitForSelector(titleShown, { timeout: 60_000 }).then(() => true, () => false);
    await sleep(3000); // the drop modal and its report are async: give them time to appear if they would
    check(title && await onTitle(page), 'the player reload lands on the title');
    check(await page.locator('#wsdrop').count() === 0, 'no drop modal after the player reload');
    check(reports.length === 0, 'no title-drop report after the player reload');
    check(new URL(page.url()).search === '', `the address is the bare title (${page.url()})`);
    check(consoleLines.some(line => line.includes('[lastEnd] the previous page: player reload')), 'lastEnd names it a player reload');
    await page.screenshot({ path: join(out, '2-player-reload-title.png') });
    await context.close();
  }

  // 3: the engine's chunk recovery reloads by itself and resumes the shard. A stale chunk failure is raised the way a lazy import
  // rejects (an unhandled "Failed to fetch dynamically imported module" for one of this build's own chunks) while the shard loads;
  // /version.json names a newer build, so browserChunkRecovery runs its real path: discover, claim, markReload, location.reload.
  {
    const { context, page, consoleLines } = await tab();
    let documents = 0, versions = 0;
    page.on('domcontentloaded', () => { documents++; });
    await page.route(/\/version\.json(?:\?.*)?$/u, route => { versions++; void route.fulfill({ contentType: 'application/json', body: JSON.stringify({ build: 'proof-newer-build', saveEpoch: 1 }) }); });
    await page.goto(`${base}/?chunk=${shard}&sw=0`);
    check(await loadingShard(page), `the shard is loading before the stale chunk fails`);
    const chunk = await page.evaluate(() => {
      const url = performance.getEntriesByType('resource').map(entry => entry.name).find(name => /\/b\/[\w.-]+\/[^/]+-[\w-]{8}\.js$/u.test(new URL(name).pathname)) ?? '';
      if (url !== '') void Promise.reject(new TypeError(`Failed to fetch dynamically imported module: ${url}`));
      return url;
    });
    check(chunk !== '', `a stale chunk failure was raised (${chunk})`);
    await page.waitForEvent('domcontentloaded', { timeout: 30_000 }).catch(() => undefined); // the recovery's own reload
    check(documents >= 2 && versions >= 1, `chunk recovery reloaded the page by itself (${String(documents)} documents, version.json read ${String(versions)}x)`);
    await page.waitForLoadState('domcontentloaded');
    const nav = await page.evaluate(() => /** @type {PerformanceNavigationTiming | undefined} */ (performance.getEntriesByType('navigation')[0])?.type ?? '');
    check(nav === 'reload', `the recovery was a reload of the page (${nav})`);
    check(await loadingShard(page), `the recovery reload resumes ${shard} (its loading card, not the title)`);
    await sleep(1500);
    check(!await onTitle(page) && await page.locator('#wsdrop').count() === 0, 'no title and no drop modal after the recovery reload');
    check(new URL(page.url()).searchParams.get('chunk') === shard, `the address still names ${shard} (${page.url()})`);
    const said = consoleLines.filter(line => line.includes('[lastEnd]'));
    check(said.some(line => line.includes('the previous page: stale deployment code')), `lastEnd names the engine reload (${said.join(' | ')})`);
    await page.screenshot({ path: join(out, '3-chunk-recovery-resumes.png') });
    await context.close();
  }
} finally {
  await browser.close();
  server.kill();
  writeFileSync(join(out, 'receipt.txt'), `${log.join('\n')}\n${failures.length === 0 ? 'PASS' : `FAIL ${String(failures.length)}`}\n`);
}
if (failures.length > 0) { console.error(`reload-title-proof: ${String(failures.length)} failed`); process.exitCode = 1; }
else console.log('reload-title-proof: pass');
