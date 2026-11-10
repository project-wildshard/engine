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
    document.addEventListener('mousedown', event => { const t = /** @type {Element | null} */ (event.target); w.__proof.downs.push(t === null ? 'null' : `${t.tagName}.${t.getAttribute('class') ?? ''}`.slice(0, 60)); }, true);
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
    screen: (() => { const stack = document.querySelector('.ws-title-stack'); return stack instanceof HTMLElement ? stack.dataset.screen ?? null : null; })(),
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
  const close = page.locator('.ws-gmenu.show .ws-gmenu-close').first();
  await close.waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(800); // the sheet's slide-in: tap CLOSE where it rests
  await page.screenshot({ path: join(out, `${engine}-2-settings-over-load.png`) });
  const closeBox = await close.boundingBox();
  if (closeBox === null) throw new Error('Settings has no CLOSE on screen');
  await page.touchscreen.tap(closeBox.x + closeBox.width / 2, closeBox.y + closeBox.height / 2);
  // the panel closes by dropping its .show (it fades, so the button stays in the layout)
  await page.waitForFunction(() => [...document.querySelectorAll('.ws-gmenu-close')].every(button => button.closest('.show') === null), null, { timeout: 15000 })
    .catch(async (/** @type {unknown} */ error) => {
      await page.screenshot({ path: join(out, `${engine}-x-settings-stuck.png`) });
      const open = await page.evaluate(() => [...document.querySelectorAll('.ws-gmenu-close')].map(b => ({ text: b.textContent, shown: b.closest('.show')?.className ?? null, box: b.getBoundingClientRect().toJSON() })));
      throw new Error(`Settings did not close: ${JSON.stringify({ tapped: closeBox, open })}`, { cause: error });
    });
  record('settings over the load', { opened: true, closed: true, stillLoading: (await state()).load });
  await page.waitForTimeout(800); // the panel's fade
  // a loading page's main thread is busy: give the tap and the leave their time, and hold the result until it is read
  const navigated = (async () => {
    try { await page.waitForURL(url => url.pathname === '/' && url.search === '', { timeout: 120000, waitUntil: 'commit' }); return null; }
    catch (error) { return error; }
  })();
  const exitAt = await page.evaluate(() => { const b = document.querySelector('.ws-load [data-load-menu="exit"]')?.getBoundingClientRect(); const e = b && document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return e ? `${e.tagName}.${e.getAttribute('class') ?? ''}${e.closest('[data-load-menu]') === null ? '' : ' (a loading menu button)'}` : null; });
  await tap('.ws-load [data-load-menu="exit"]');
  const left = await navigated;
  if (left !== null) { await page.screenshot({ path: join(out, `${engine}-x-exit-failed.png`) }); throw new Error(`EXIT TO TITLE did not leave (under the finger: ${String(exitAt)}; ${JSON.stringify(await state())})`, { cause: left }); }
  await page.waitForSelector('.ws-main:not(.hide) .ws-main-select');
  await page.waitForTimeout(1500);
  const titled = await state();
  record('exit mid-load', { from: loading.load, to: titled.path, worldLeft: titled.world, errors: [...errors] });
  must(!titled.world, 'a world is running under the title after the exit');
  await page.screenshot({ path: join(out, `${engine}-3-title-after-exit.png`) });

  // 2. SHARD SELECT opens the deck and loads nothing
  await page.waitForTimeout(1000);
  // the card's lower quarter, where the deck puts ENTER WORLD at 402 px, and the click iOS sends for the same touch after
  // the swap, late as on a busy page (the old 500 ms window let it through)
  const card = await page.locator('.ws-main-select').boundingBox();
  if (card === null) throw new Error('SHARD SELECT is not on screen');
  const at = { x: card.x + card.width / 2, y: card.y + card.height * 0.85 };
  await page.touchscreen.tap(at.x, at.y);
  await page.waitForTimeout(700);
  const under = await page.evaluate(p => { const e = document.elementFromPoint(p.x, p.y); e?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: p.x, clientY: p.y })); return e?.closest('button')?.className ?? e?.tagName ?? null; }, at);
  await page.waitForTimeout(3000);
  const deck = await state();
  record('shard select', { screen: deck.screen, load: deck.load, world: deck.world, lateClickOn: under });
  must(deck.screen === 'select' && deck.load === null && !deck.world && deck.path === '/', `SHARD SELECT did more than open the deck: ${JSON.stringify(deck)}`);
  await page.screenshot({ path: join(out, `${engine}-4-deck.png`) });

  // 3. pick Nine Dragon in the deck and ENTER WORLD; it loads and becomes playable
  const index = await page.evaluate(() => [...document.querySelectorAll('.ws-menu-card')].findIndex(c => /nine dragon/iu.test(c.textContent ?? '')));
  must(index >= 0, 'no Nine Dragon card in the deck');
  await page.evaluate(i => { const dot = document.querySelector(`.ws-menu-dots i[data-i="${String(i)}"]`); if (dot instanceof HTMLElement) dot.click(); }, index);
  await page.waitForTimeout(800);
  await tap('.ws-menu-play');
  await page.waitForFunction(() => /nine dragon/iu.test(document.querySelector('.ws-load b[data-el="slug"]')?.textContent ?? '') || Boolean(/** @type {any} */ (window).__wildshard?.world?.game));
  await page.screenshot({ path: join(out, `${engine}-5-loading-nine-dragon.png`) });
  // playable: the world is up and its loading card is gone or faded (a cold page keeps its hidden shell card)
  await page.waitForFunction(() => { const shell = document.querySelector('.ws-load'); return Boolean(/** @type {any} */ (window).__wildshard?.world?.game) && (shell === null || getComputedStyle(shell).opacity === '0' || getComputedStyle(shell).display === 'none'); }, null, { timeout: 480000, polling: 1000 });
  const played = await page.evaluate(() => ({ path: `${location.pathname}${location.search}`, level: /** @type {any} */ (window).__wildshard?.world?.level?.id ?? /** @type {any} */ (window).__wildshard?.requireWorld?.()?.chunk?.slug ?? null }));
  record('nine dragon', { ...played, errors: [...errors] });
  must(/nine-dragon/iu.test(`${played.path} ${String(played.level)}`), `the world that loaded is not Nine Dragon: ${JSON.stringify(played)}`);
  await page.screenshot({ path: join(out, `${engine}-6-nine-dragon.png`) });
  must(errors.length === 0, `page errors: ${errors.join('; ')}`);
  await context.close();
} finally {
  writeFileSync(join(out, `${engine}-title-exit-proof.json`), `${JSON.stringify({ base, engine, steps }, null, 2)}\n`);
  await browser.close();
}
