#!/usr/bin/env node
import { debugSettings, saveFixture } from './debug-settings.mjs';
// E271/E272: exercise the real scene on desktop and mobile; no facade multi-draw anywhere.
// See docs/audits/nine-dragon-mobile-multidraw.md. This guards routing, not native phone memory.
import { chromium } from 'playwright';

const base = (process.argv.find((arg) => arg.startsWith('--url='))?.slice(6) ?? 'http://127.0.0.1:4184').replace(/\/$/, '');
const mobileUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1';
const browser = await chromium.launch({ channel: 'chromium', args: ['--mute-audio', '--use-angle=metal'] });
try {
  for (const profile of [{ name: 'desktop', tier: 'desktop' }, { name: 'phone-tier', tier: 'phone' }, { name: 'iphone-desktop-quality', tier: 'desktop', userAgent: mobileUA }]) {
    const context = await browser.newContext({ viewport: { width: 402, height: 654 }, deviceScaleFactor: 2,
      isMobile: true, hasTouch: true, serviceWorkers: 'block', userAgent: profile.userAgent });
    try {
      // The retired stored Auto setting must be ignored on every platform.
      await debugSettings(context, { nineFacade: 'auto' });
      await saveFixture(context, { scope: 'device', key: 'devMode', data: true }); // developer mode: EXPLORE WORLD is developer-only (E386)
      await context.route('**/api/errors', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
      await context.route(/https:\/\/[^/]+\.ingest\.[^/]+\/api\//, (route) => route.fulfill({ status: 200, body: '{}' }));
      const page = await context.newPage();
      const errors = [];
      let navigations = 0;
      page.on('pageerror', (error) => { errors.push(error.message); });
      page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations++; });
      await page.goto(`${base}/?chunk=nine-dragon-stack&tier=${profile.tier}&touch=1&nolock=1&mute=1&sw=0`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => Boolean(window.__wildshard?.world) || Boolean(document.querySelector('#wserr')), null, { timeout: 90_000 });
      // SF21a's main menu sits over the shard deck: SHARD SELECT opens it, then EXPLORE WORLD
      if (await page.locator('.ws-main:not(.hide) .ws-main-select').count() > 0) await page.locator('.ws-main-select').click({ timeout: 10_000 });
      await page.locator('.ws-menu-explore').click({ timeout: 10_000 });
      await page.locator('.ws-x-card[data-m="world"]').click();
      await page.waitForFunction(() => Boolean(document.querySelector('.ws-x.show[data-mode="world"]')) &&
        (window.__wildshard?.world?.game.renderer.info.render.calls ?? 0) > 0, null, { timeout: 20_000 });
      const state = await page.evaluate(() => {
        const game = window.__wildshard.world.game;
        const facade = game.scene.getObjectByName('facade');
        let batches = 0, instances = 0;
        facade?.traverse((object) => {
          if (object.isBatchedMesh) batches++;
          if (object.isInstancedMesh) instances += object.count;
        });
        return { multiDrawSupported: game.renderer.extensions.has('WEBGL_multi_draw'), batches, instances,
          lanterns: Boolean(game.scene.getObjectByName('lanterns')), lost: game.renderer.getContext().isContextLost(),
          calls: game.renderer.info.render.calls, error: Boolean(document.querySelector('#wserr')) };
      });
      // Require actual extension support, otherwise the fallback would pass even with the mobile guard removed.
      const okay = state.multiDrawSupported && state.batches === 0 && state.instances > 0 && state.lanterns &&
        !state.lost && state.calls > 0 && !state.error && errors.length === 0 && navigations === 1;
      console.log(`${okay ? 'PASS' : 'FAIL'} ${profile.name}: ${JSON.stringify({ ...state, navigations, errors })}`);
      if (!okay) process.exitCode = 1;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
