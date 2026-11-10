#!/usr/bin/env node
// QA 28 / QA 30 (Jake, 2026-11-10) in a real headless browser, against a served build (scripts/serve-build.sh):
//  1. a shard's loading card has SETTINGS and EXIT TO TITLE; EXIT mid-load leaves the half-loaded world for the title;
//  2. on that title, SHARD SELECT opens the deck and nothing loads (Jake: "pressing shard select loads me instantly into
//     driftwood"), with and without a world left loaded under the title;
//  3. from the deck, another shard (Nine Dragon) loads and becomes playable.
//   scripts/browser-lane.sh node scripts/title-exit-proof.mjs <base url> <out dir> [--engine=chromium|webkit]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, devices, webkit } from 'playwright';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';

const [base = '', out = ''] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const engine = process.argv.find(arg => arg.startsWith('--engine='))?.slice(9) ?? 'chromium';
if (base === '' || out === '') throw new Error('usage: title-exit-proof.mjs <base url> <out dir> [--engine=chromium|webkit]');
mkdirSync(out, { recursive: true });
/** @type {Record<string, unknown>[]} */
const steps = [];
/** @param {string} name @param {Record<string, unknown>} facts */
const record = (name, facts) => { steps.push({ name, ...facts }); console.log(`${name}: ${JSON.stringify(facts)}`); };
/** @param {boolean} ok @param {string} why */
const must = (ok, why) => { if (!ok) throw new Error(why); };

const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch({ args: [...KEYCHAIN_ARGS, '--use-angle=metal', '--ignore-gpu-blocklist'] });
try {
  const context = await browser.newContext({ ...devices['iPhone 15 Pro'] });
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  await context.route('**/api/errors', route => route.fulfill({ status: 204, body: '' }));
  // what the page saw: every mousedown target (a tap's compatibility event) and every load the title started
  await context.addInitScript(() => {
    const w = /** @type {any} */ (window);
    w.__proof = { downs: [] };
    document.addEventListener('mousedown', event => { const t = /** @type {Element | null} */ (event.target); w.__proof.downs.push(t === null ? 'null' : `${t.tagName}.${String(t.getAttribute('class') ?? '')}`.slice(0, 60)); }, true);
  });
  const page = await context.newPage();
  page.setDefaultTimeout(240000);
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); });
  /** a real finger: touch at the element's centre, whatever is on top there gets it */
  const tap = async (/** @type {string} */ selector) => {
    const box = await page.locator(selector).first().boundingBox();
    if (box === null) throw new Error(`${selector} is not on screen`);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  };
  const state = () => page.evaluate(() => ({
    path: `${location.pathname}${location.search}`,
    screen: document.querySelector('.ws-title-stack')?.getAttribute('data-screen') ?? null,
    load: document.querySelector('.ws-load b[data-el="slug"]')?.textContent ?? null,
    world: Boolean(/** @type {any} */ (window).__wildshard?.world?.game),
    downs: /** @type {any} */ (window).__proof?.downs ?? [],
  }));

  // 1. Driftwood starts loading; EXIT TO TITLE before it is ready
  await page.goto(`${base}?chunk=driftwood-isle`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ws-load [data-load-menu="exit"]');
  await page.waitForSelector('.ws-load [data-load-menu="settings"]');
  await page.waitForTimeout(1500);
  const loading = await state();
  must(loading.load !== null && /driftwood/iu.test(loading.load), `the card is not loading Driftwood: ${JSON.stringify(loading)}`);
  must(!loading.world, 'Driftwood finished before the exit could be tested mid-load');
  await page.screenshot({ path: join(out, `${engine}-1-loading-driftwood.png`) });
  await tap('.ws-load [data-load-menu="settings"]');
  await page.waitForSelector('.ws-gmenu.show, .ws-boot-settings.show, [class*="settings"].show', { timeout: 10000 }).catch(() => undefined);
  await page.screenshot({ path: join(out, `${engine}-2-settings-over-load.png`) });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const navigated = page.waitForURL(url => url.pathname === '/' && url.search === '', { timeout: 30000 });
  await tap('.ws-load [data-load-menu="exit"]');
  await navigated;
  await page.waitForSelector('.ws-main:not(.hide) .ws-main-select');
  await page.waitForFunction(() => document.querySelector('.ws-load') === null, null, { timeout: 120000 });
  const titled = await state();
  record('exit mid-load', { from: loading.load, to: titled.path, worldLeft: titled.world, errors: [...errors] });
  must(!titled.world, 'a world is running under the title after the exit');
  await page.screenshot({ path: join(out, `${engine}-3-title-after-exit.png`) });

  // 2. SHARD SELECT opens the deck and loads nothing
  await page.waitForTimeout(1000);
  await tap('.ws-main-select');
  await page.waitForTimeout(3000);
  const deck = await state();
  record('shard select', { screen: deck.screen, load: deck.load, world: deck.world, downs: deck.downs.slice(-3) });
  must(deck.screen === 'select' && deck.load === null && !deck.world && deck.path === '/', `SHARD SELECT did more than open the deck: ${JSON.stringify(deck)}`);
  await page.screenshot({ path: join(out, `${engine}-4-deck.png`) });

  // 3. pick Nine Dragon in the deck and ENTER WORLD; it loads and becomes playable
  const index = await page.evaluate(() => [...document.querySelectorAll('.ws-menu-card')].findIndex(card => /nine dragon/iu.test(card.textContent ?? '')));
  must(index >= 0, 'no Nine Dragon card in the deck');
  await page.evaluate(i => { /** @type {HTMLElement | null} */ (document.querySelector(`.ws-menu-dots i[data-i="${String(i)}"]`))?.click(); }, index);
  await page.waitForTimeout(800);
  await tap('.ws-menu-play');
  await page.waitForFunction(() => /nine dragon/iu.test(document.querySelector('.ws-load b[data-el="slug"]')?.textContent ?? '') || Boolean(/** @type {any} */ (window).__wildshard?.world?.game));
  await page.screenshot({ path: join(out, `${engine}-5-loading-nine-dragon.png`) });
  await page.waitForFunction(() => document.querySelector('.ws-load') === null && Boolean(/** @type {any} */ (window).__wildshard?.world?.game), null, { timeout: 480000, polling: 1000 });
  const played = await page.evaluate(() => ({ path: `${location.pathname}${location.search}`, level: /** @type {any} */ (window).__wildshard?.world?.level?.id ?? /** @type {any} */ (window).__wildshard?.requireWorld?.()?.chunk?.slug ?? null }));
  record('nine dragon', { ...played, errors: [...errors] });
  await page.screenshot({ path: join(out, `${engine}-6-nine-dragon.png`) });
  must(errors.length === 0, `page errors: ${errors.join('; ')}`);
  await context.close();
} finally {
  writeFileSync(join(out, `${engine}-title-exit-proof.json`), `${JSON.stringify({ base, engine, steps }, null, 2)}\n`);
  await browser.close();
}
