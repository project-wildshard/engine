#!/usr/bin/env node
import { debugSettings, saveFixture } from './debug-settings.mjs';
// E271/E272: exercise the real scene on desktop and mobile; no facade multi-draw anywhere.
// See docs/audits/nine-dragon-mobile-multidraw.md. This guards routing, not native phone memory.
import { chromium } from "./browser-playwright.mjs";
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { enterZone } from './zone-entry.mjs';

const base = (process.argv.find((arg) => arg.startsWith('--url='))?.slice(6) ?? 'http://127.0.0.1:4184').replace(/\/$/, '');
const mobileUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1';
const browser = await chromium.launch({ channel: 'chromium', args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal'] });
try {
  for (const profile of [{ name: 'desktop', tier: 'desktop' }, { name: 'phone-tier', tier: 'phone' }, { name: 'iphone-desktop-quality', tier: 'desktop', userAgent: mobileUA }]) {
    const context = await browser.newContext({ viewport: { width: 402, height: 654 }, deviceScaleFactor: 2,
      isMobile: true, hasTouch: true, serviceWorkers: 'block', userAgent: profile.userAgent });
    try {
      // The retired stored Auto setting must be ignored on every platform.
      await debugSettings(context, { nineFacade: 'auto' });
      await saveFixture(context, { scope: 'device', key: 'devMode', data: true }); // developer mode, as the facade checks ran it
      await context.route('**/api/errors', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
      await context.route(/https:\/\/[^/]+\.ingest\.[^/]+\/api\//, (route) => route.fulfill({ status: 200, body: '{}' }));
      const page = await context.newPage();
      const errors = [];
      let navigations = 0;
      page.on('pageerror', (error) => { errors.push(error.message); });
      // CP16 (J522): count documents, not URL changes; the grid page tidies its address in place (a same-document navigation)
      page.on('domcontentloaded', () => { navigations++; });
      // CHUNK-PARAM CP16 (J522): Nine enters alone, a one-cell world, straight into play (no zone in the URL, no Explore hub)
      await enterZone(page, { zone: 'nine-dragon-stack', base, flags: `tier=${profile.tier}&touch=1&nolock=1&mute=1&sw=0&skipintro=1`, alone: true, waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => Boolean(document.querySelector('#wserr')) || (Boolean(window.__wildshard?.world?.hud.entered) &&
        (window.__wildshard?.world?.game.renderer.info.render.calls ?? 0) > 0 && Boolean(window.__wildshard?.world?.game.scene.getObjectByName('facade'))), null, { timeout: 180_000 });
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
