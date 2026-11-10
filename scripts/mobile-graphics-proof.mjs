#!/usr/bin/env node
// mobile-graphics-proof — MOBILE-GRAPHICS MG3-MG6 on a served build, in headless WebKit at 390×844 (an iPhone), Low Power Mode
// on and off. Low Power is played, not stubbed in code: the "on" page's requestAnimationFrame runs at 30 Hz, which is what iOS
// does in Low Power Mode and what boot/lowPower.ts reads on the idle title. Each run starts on a fresh device (empty storage):
//   MG4  the title says Low Power Mode is on (and nothing when off), clear of SHARD SELECT
//   MG3  Settings ▸ Graphics reads Low and refuses High with the reason when on; both picks hold when off
//   MG5  the first PLAY enters Driftwood and shows the first-play card; its toggle moves the drawing buffer between 1× and 2×
//        live (off), or keeps 1× and says why (on); DONE, then a reload and PLAY opens SHARD SELECT, and no card again
//   MG6  Settings ▸ First-time setup ▸ Replay, then PLAY enters Driftwood with the card again
//
//   scripts/serve-build.sh        # prints the URL
//   scripts/browser-lane.sh node scripts/mobile-graphics-proof.mjs --base=http://127.0.0.1:4401/ [--out=<dir>] [--power=on,off]
// Headless only; our own local build only. Exit 1 when a step fails.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { devices, webkit } from 'playwright';

/** @param {string} key @param {string} fallback */
const arg = (key, fallback) => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const base = arg('base', '');
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//u.test(base)) throw new Error('Requires --base=<a local served build> (scripts/serve-build.sh)');
const out = resolve(arg('out', 'tmp/mobile-graphics-proof')), powers = arg('power', 'on,off').split(',');
mkdirSync(out, { recursive: true });

/** iOS in Low Power Mode: animation frames at 30 Hz. One 30 Hz clock delivers every callback queued for it, as a capped display
 *  does, so no loop starves another */
const LOW_POWER_RAF = `(() => {
  const raf = window.requestAnimationFrame.bind(window), queue = new Map(); let next = 1, last = 0, pumping = false;
  const pump = now => {
    if (now - last >= 32) { last = now; const due = [...queue.values()]; queue.clear(); for (const fn of due) fn(now); }
    if (queue.size > 0) raf(pump); else pumping = false;
  };
  window.requestAnimationFrame = fn => { const id = next++; queue.set(id, fn); if (!pumping) { pumping = true; raf(pump); } return id; };
  window.cancelAnimationFrame = id => { queue.delete(id); };
})();`;

/** @type {string[]} */ const failures = [];
/** @param {boolean} ok @param {string} what */
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failures.push(what); };

const browser = await webkit.launch();
try {
  for (const power of powers) {
    const on = power === 'on', context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } });
    if (on) await context.addInitScript({ content: LOW_POWER_RAF });
    const page = await context.newPage(), shot = (/** @type {string} */ name) => page.screenshot({ path: join(out, `${power}-${name}.png`) });
    /** @type {string[]} */ const errors = [];
    page.on('pageerror', error => { errors.push(error.message.slice(0, 160)); });
    const title = async () => {
      await page.goto(new URL('/?mute=1&nolock=1&sw=0', base).href, { waitUntil: 'load' });
      await page.locator('.ws-main-select').waitFor({ timeout: 120_000 });
    };
    const ratio = () => page.evaluate(() => { const c = document.querySelector('canvas'); return c === null ? 0 : Math.round(c.width / innerWidth * 100) / 100; });
    const settings = async (/** @type {(dialog: import('playwright').Locator) => Promise<void>} */ inside) => {
      await page.locator('.ws-main-settings').first().click();
      const sheet = page.locator('.ws-gmenu').last(); await sheet.waitFor({ timeout: 10_000 });
      await inside(sheet);
      await page.locator('.ws-gmenu-close').last().click(); await page.waitForTimeout(400);
    };
    try {
      // MG4
      await title(); await page.waitForTimeout(5000); // the idle title reads its cadence after two seconds on screen
      const banner = page.locator('.ws-main-power');
      const shown = await banner.isVisible();
      check(shown === on, `${power}: the title's Low Power line is ${on ? 'shown' : 'absent'} (MG4)`);
      if (shown) {
        const [b, play] = await Promise.all([banner.boundingBox(), page.locator('.ws-main-select').boundingBox()]);
        check(b !== null && play !== null && (b.y + b.height <= play.y || b.y >= play.y + play.height), `${power}: the Low Power line is clear of SHARD SELECT (MG4)`);
      }
      await shot('1-title');
      // MG3
      await settings(async sheet => {
        const row = sheet.locator('.ws-gmenu-seg:has(.ws-gmenu-segbtn[data-v="high"])').first();
        await row.locator('[data-v="high"]').click(); await page.waitForTimeout(200);
        const active = await row.locator('.active').getAttribute('data-v');
        const note = await sheet.getByText('Low Power Mode is on. Turn it off').isVisible();
        check(on ? active === 'low' && note : active === 'high' && !note, `${power}: Settings ▸ Graphics ${on ? 'refuses High with the reason' : 'takes High'} (MG3)`);
        await row.locator('[data-v="low"]').click(); await page.waitForTimeout(200);
        check(await row.locator('.active').getAttribute('data-v') === 'low', `${power}: Settings ▸ Graphics takes Low (MG3)`);
        await shot('2-settings');
      });
      // MG5: the first PLAY
      await page.locator('.ws-main-select').click();
      await page.locator('.ws-firstplay').waitFor({ timeout: 240_000 });
      const shard = await page.evaluate(() => /** @type {any} */ (window).__wildshard?.world?.chunk?.slug ?? /** @type {any} */ (window).__wildshard?.world?.chunk?.id ?? null);
      check(shard === 'driftwood-isle', `${power}: the first PLAY enters Driftwood (${String(shard)}) with the first-play card (MG5)`);
      await page.waitForTimeout(1500);
      const card = page.locator('.ws-firstplay');
      await card.locator('[data-v="low"]').click(); await page.waitForTimeout(900);
      const low = await ratio();
      await card.locator('[data-v="high"]').click(); await page.waitForTimeout(900);
      const high = await ratio(), refused = await card.locator('.ws-firstplay-note[data-tone="refused"]').isVisible();
      check(low === 1, `${power}: Low draws at 1× (${String(low)}) (MG5)`);
      check(on ? high === 1 && refused : high === 2, `${power}: High ${on ? 'stays at 1× and says why' : 'draws at 2×'} (${String(high)}) (MG5)`);
      await shot('3-first-play');
      await card.locator('.ws-firstplay-done').click(); await page.waitForTimeout(300);
      check(!await card.isVisible(), `${power}: DONE closes the card (MG5)`);
      // later plays: SHARD SELECT, no card
      await title(); await page.locator('.ws-main-select').click(); await page.waitForTimeout(1500);
      check(await page.locator('.ws-menu-carousel:not(.hide)').isVisible(), `${power}: the next PLAY opens SHARD SELECT (MG5)`);
      await shot('4-later-play');
      // MG6
      await title();
      await settings(async sheet => { await sheet.getByRole('button', { name: 'Replay' }).click(); await page.waitForTimeout(200); });
      await page.locator('.ws-main-select').click();
      await page.locator('.ws-firstplay').waitFor({ timeout: 240_000 });
      check(true, `${power}: Settings ▸ Replay, then PLAY shows the first-play card again (MG6)`);
      await shot('5-replay');
      check(errors.length === 0, `${power}: no page errors${errors.length === 0 ? '' : ` (${errors.join(' | ')})`}`);
    } catch (error) {
      check(false, `${power}: ${String(error instanceof Error ? error.message : error).split('\n')[0]}`);
      await shot('x-failed').catch(() => undefined);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
console.log(`screenshots in ${out}`);
if (failures.length > 0) process.exitCode = 1;
