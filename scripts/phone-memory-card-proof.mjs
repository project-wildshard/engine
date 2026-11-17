// Run against a loopback engine preview with Pine Hollow in the catalogue:
// scripts/browser-lane.sh node scripts/phone-memory-card-proof.mjs <preview-url> <screenshot.png>
import assert from 'node:assert/strict';
import { chromium } from './browser-playwright.mjs';
import { bootPageURL } from './boot-memory-peak.mjs';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { debugSettings, saveFixture } from './debug-settings.mjs';

const [preview, screenshot] = process.argv.slice(2);
assert.ok(preview && screenshot, 'Supply the loopback preview URL and screenshot path');
const origin = new URL(preview).origin;
assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/u);
const slug = 'pine-hollow';
const version = await (await fetch(new URL('/version.json', origin))).json();
assert.equal(version.preparationOnly, false);
const mobileScreen = { width: 402, height: 874 };
const browser = await chromium.launch({
  headless: true,
  args: [...KEYCHAIN_ARGS, ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])],
});

try {
  for (const overBudget of [true, false]) {
    const context = await browser.newContext({
      viewport: mobileScreen, screen: mobileScreen, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'block',
    });
    try {
      await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
      await saveFixture(context, { scope: 'device', key: 'devMode', data: false });
      await debugSettings(context, { tier: 'phone', volume: 0 });
      await context.route('**/api/errors', route => route.fulfill({ status: 204 }));
      let reads = 0;
      if (overBudget) {
        await context.route(new RegExp(`/shardfiles/${slug}/discovery\\.json(?:\\?|$)`, 'u'), async route => {
          const response = await route.fetch();
          const discovery = await response.json();
          assert.ok(response.ok() && discovery.rows.runtimeCost);
          discovery.rows.runtimeCost.webContentMB = 2200;
          reads++;
          await route.fulfill({ response, json: discovery });
        });
      }
      const page = await context.newPage();
      page.setDefaultTimeout(90_000);
      await page.addInitScript(() => {
        document.addEventListener('ws:control-ready', () => { document.documentElement.dataset.memoryProofControl = 'true'; });
      });
      await page.goto(bootPageURL(origin, slug), { waitUntil: 'domcontentloaded' });
      const card = page.locator('#wserr');
      const control = page.locator('html[data-memory-proof-control=true]');
      if (overBudget) {
        const explanation = card.locator('.what');
        await explanation.waitFor({ state: 'visible' });
        assert.ok(reads > 0);
        assert.equal(await card.locator('h1').textContent(), 'This world needs more memory');
        const message = await explanation.textContent();
        assert.ok(message);
        assert.match(message, /^This world needs about \d+\.\d{2} GB of memory and a phone has 1\.50 GB to give it\. Pick another world, or play it on a computer\.$/u);
        assert.ok(Number(/about (\d+\.\d{2}) GB/u.exec(message)?.[1]) > 1.5);
        assert.equal(await control.count(), 0);
        assert.equal(await card.locator('.here').isVisible(), false);
        const title = card.getByRole('button', { name: 'Title screen' });
        assert.equal(await title.isVisible(), true);
        await page.screenshot({ path: screenshot, scale: 'css' });
        console.log(`${version.build} ${slug} refused at admission: ${message}`);
        await title.click();
        await page.waitForURL(url => url.pathname === '/' && url.search === '');
      } else {
        await control.or(card).first().waitFor({ state: 'attached' });
        if (await card.count() > 0) assert.fail(await card.locator('.msg').textContent() ?? 'Unexpected refusal');
        await page.locator('.ws-load').waitFor({ state: 'hidden' });
        console.log(`${version.build} ${slug} control reached play with the original discovery.`);
      }
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
