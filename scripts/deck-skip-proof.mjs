#!/usr/bin/env node
// Jake, 2026-11-12 09:03 Cancún, iPhone Safari on preview.wildshard.io v0.1.11: "That shard select insta loads driftwood bug is
// still here". One tap on SHARD SELECT showed "LOADING DRIFTWOOD ISLE" with no deck: MOBILE-GRAPHICS MG5's first-play skip
// entered deck card 0 on every tap until the in-world toggle's DONE marked the device. This drives a real title on a phone
// (402×874, touch) in headless WebKit and Chromium, a fresh device and a return visit each: tap SHARD SELECT, then read whether
// the deck opened or the loading card took over. Pass = the deck, no loading card, the page not navigated.
//   scripts/browser-lane.sh node scripts/deck-skip-proof.mjs --base <url> --out <dir> [--browsers webkit,chromium] [--expect deck|skip]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, webkit } from 'playwright';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';

const { values } = parseArgs({ options: { base: { type: 'string' }, out: { type: 'string' }, browsers: { type: 'string' }, expect: { type: 'string' } } });
if (values.base === undefined || values.out === undefined) { console.error('usage: deck-skip-proof.mjs --base <url> --out <dir>'); process.exit(2); }
const base = values.base.replace(/\/$/u, ''), out = values.out, expectDeck = (values.expect ?? 'deck') === 'deck';
mkdirSync(out, { recursive: true });
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const engines = { webkit, chromium };
/** @type {{ browser: string, visit: string, screen: string | undefined, loading: boolean, url: string, entered: boolean, after: string, ok: boolean }[]} */
const rows = [];
for (const name of (values.browsers ?? 'webkit,chromium').split(',')) {
  const engine = engines[/** @type {'webkit' | 'chromium'} */ (name)];
  if (engine === undefined) throw new Error(`No browser ${name}`);
  const browser = await engine.launch({ headless: true, ...name === 'chromium' ? { args: [...KEYCHAIN_ARGS, '--mute-audio'] } : {} });
  try {
    for (const visit of ['fresh', 'return']) {
      const context = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, userAgent: IPHONE });
      try {
        // a device that already answered the Name box (MP2.4), so the tap goes straight to its outcome
        await saveFixture(context, { scope: 'device', key: 'nameAsked', data: true });
        if (visit === 'return') await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
        const page = await context.newPage();
        await page.goto(`${base}/?mute=1`, { waitUntil: 'load' });
        await page.locator('.ws-main-select').waitFor({ state: 'visible', timeout: 60_000 });
        const before = page.url();
        await page.locator('.ws-main-select').tap();
        await page.waitForTimeout(1500);
        const state = await page.evaluate(() => {
          const load = document.querySelector('.ws-load[data-navigation]');
          const shown = load instanceof HTMLElement && !load.classList.contains('hide') && getComputedStyle(load).display !== 'none';
          const stack = document.querySelector('.ws-title-stack');
          return { screen: stack instanceof HTMLElement ? stack.dataset.screen : undefined, loading: shown, text: load?.textContent?.replaceAll(/\s+/gu, ' ').trim().slice(0, 120) ?? '' };
        }).catch(() => ({ screen: undefined, loading: true, text: 'page navigated away' }));
        const url = page.url();
        const deck = state.screen === 'select' && !state.loading && url === before;
        await page.screenshot({ path: join(out, `${name}-${visit}.png`) }).catch(() => undefined);
        // then the card: ENTER WORLD on the deck's selected card (Driftwood, card 0) is what starts a load
        let entered = false;
        if (deck) {
          await page.locator('.ws-menu-play').tap();
          entered = await page.waitForURL(/chunk=/u, { timeout: 15_000 }).then(() => true).catch(() => false);
        }
        const ok = deck === expectDeck && (!deck || entered);
        rows.push({ browser: name, visit, screen: state.screen, loading: state.loading, url, entered, after: page.url(), ok });
        console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${visit}: screen=${String(state.screen)} loading=${String(state.loading)} ${state.text} url=${url}; ENTER WORLD → ${entered ? page.url() : 'not tapped'}`);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
writeFileSync(join(out, 'deck-skip.json'), `${JSON.stringify({ base, expect: expectDeck ? 'deck' : 'skip', rows }, null, 2)}\n`);
process.exit(rows.every(row => row.ok) ? 0 : 1);
