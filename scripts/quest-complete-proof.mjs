#!/usr/bin/env node
// opus-questfreeze (Jake 2026-11-12, Template on preview: "Whatever quest complete behavior is in template is freezing the camera /
// lagging the game a bunch"). Finishes Template's first quest ("A first adventure": the hut, then the blob) on a served build and
// reads every frame of the "Quest complete" beat: the frame time, whether the beat holds the player (`carried`), and whether the
// camera's yaw still follows the turn the input asks for that frame. Red (exit 1) when a frame ignores the turn, the player is
// held, the caption never shows, or a frame runs over the budget (50 ms desktop, 67 ms phone). Desktop 1440x900 and the phone's
// 402x874 layout, headless, real GPU. Red first on d6f24d8a: 420 frames frozen (the whole 7 s hold) on desktop.
//
//   scripts/browser-lane.sh node scripts/quest-complete-proof.mjs --base=http://127.0.0.1:4400/ [--layout=desktop|phone|both]
import { chromium, devices } from 'playwright';
import { saveFixture } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';

/** @param {string} key @param {string} fallback */
const arg = (key, fallback) => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const base = arg('base', ''), layouts = arg('layout', 'both') === 'both' ? ['desktop', 'phone'] : [arg('layout', 'both')];
if (base === '') throw new Error('Requires --base');
const { defaultBrowserType: _engine, ...iphone } = devices['iPhone 16 Pro'];
/** @type {Record<string, { context: import('playwright').BrowserContextOptions, budget: number }>} */
const shapes = { desktop: { context: { viewport: { width: 1440, height: 900 } }, budget: 50 }, phone: { context: { ...iphone, viewport: { width: 402, height: 874 } }, budget: 67 } };
const browser = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
let failed = 0;
try {
  for (const layout of layouts) {
    const shape = shapes[layout];
    if (shape === undefined) throw new Error(`Unknown layout ${layout}`);
    const context = await browser.newContext(shape.context), page = await context.newPage();
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message.slice(0, 300)); });
    await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
    await saveFixture(context, { scope: 'device', key: 'debug.workerClient', data: 'on' });
    await page.goto(new URL('/?chunk=_template&nolock=1', base).href, { waitUntil: 'load' });
    await page.waitForFunction(() => /** @type {any} */ (window).__wildshard?.world?.player !== undefined, undefined, { timeout: 150_000 });
    await page.waitForFunction(() => typeof /** @type {any} */ (window).__workerClientFlag === 'function', undefined, { timeout: 150_000 });
    await page.evaluate(FLOOR_GRID_ENTER);
    // settle, and spend the first user gesture (the audio unlock builds its AudioContext there) before measuring
    await page.waitForTimeout(6000); await page.keyboard.press('KeyQ'); await page.waitForTimeout(1000);
    await page.evaluate(() => { /** @type {any} */ (window).__workerClientFlag('template.hut'); });
    await page.waitForTimeout(2500);
    /** @typedef {{ t: number, dt: number, carried: boolean, yaw: number, caption: boolean }} Row */
    const rows = await page.evaluate(() => /** @type {Promise<Row[]>} */ (new Promise(resolve => {
      /** @type {any} */
      const w = window, player = w.__wildshard.world.player;
      /** @type {Row[]} */
      const out = [];
      let last = performance.now();
      const t0 = last;
      w.__workerClientFlag('template.blob');
      /** @param {number} now */
      const tick = now => {
        player.yaw += 0.01; // the input's turn this frame; the next frame reads whether it held
        const caption = [...document.querySelectorAll('.ws-quest-reward.show')].length > 0;
        out.push({ t: now - t0, dt: now - last, carried: player.carried, yaw: player.yaw, caption });
        last = now;
        if (now - t0 < 11_000) requestAnimationFrame(tick); else resolve(out);
      };
      requestAnimationFrame(tick);
    })));
    let frozen = 0, held = 0, caption = 0, maxDt = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i], prev = rows[i - 1];
      if (row === undefined || prev === undefined) continue;
      if (Math.abs(row.yaw - prev.yaw) < 0.005) frozen++;
      if (row.carried) held++;
      if (row.caption) caption++;
      maxDt = Math.max(maxDt, row.dt);
    }
    const complete = (await page.evaluate(() => /** @type {string[]} */ (/** @type {any} */ (window).__workerClient().flags))).includes('template.complete');
    const ok = complete && frozen === 0 && held === 0 && caption > 0 && maxDt <= shape.budget && errors.length === 0;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${layout}  ${JSON.stringify({ complete, frames: rows.length, frozen, held, caption, maxMs: Math.round(maxDt), budget: shape.budget, errors: errors.slice(0, 3) })}`);
    await context.close();
  }
} finally { await browser.close(); }
process.exit(failed === 0 ? 0 : 1);
