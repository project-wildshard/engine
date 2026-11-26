// Run against a loopback engine preview with Brasscap Mesa in the catalogue:
// scripts/browser-lane.sh node scripts/phone-memory-card-proof.mjs <preview-url> <screenshot.png>
import assert from 'node:assert/strict';
import { chromium } from './browser-playwright.mjs';
import { bootPage } from './boot-memory-peak.mjs';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { debugSettings, saveFixture } from './debug-settings.mjs';

const [preview, screenshot] = process.argv.slice(2);
assert.ok(preview && screenshot, 'Supply the loopback preview URL and screenshot path');
const origin = new URL(preview).origin;
assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/u);
const version = await (await fetch(new URL('/version.json', origin))).json();
assert.equal(version.preparationOnly, false);
const slug = 'brasscap-mesa';
const mobileScreen = { width: 402, height: 874 };
const browser = await chromium.launch({
  headless: true,
  args: [...KEYCHAIN_ARGS, ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])],
});

try {
  for (const overBudget of [false, true]) {
    const context = await browser.newContext({
      viewport: mobileScreen, screen: mobileScreen, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'block',
    });
    try {
      await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
      await saveFixture(context, { scope: 'device', key: 'devMode', data: false });
      await saveFixture(context, { scope: 'device', key: 'graphics', data: 'low' });
      await debugSettings(context, { tier: 'phone', volume: 0 });
      await context.route('**/api/errors', route => route.fulfill({ status: 204 }));
      let changed = false;
      if (overBudget) {
        // The document carries the verified cook estimates. Keep the shard and spawn-pack bytes intact.
        const table = /(globalThis\.__WS_SHARDFILE_VERDICTS__=)(\[[^;]*?\]);/u;
        await context.route(url => url.origin === origin && url.pathname === '/' && url.searchParams.get('chunk') === slug, async route => {
          const response = await route.fetch(), html = await response.text();
          const body = html.replace(table, (_stamp, prefix, json) => {
            const verdicts = /** @type {{path:string,worst:{playing:number,loading:number}}[]} */ (JSON.parse(json));
            const verdict = verdicts.find(row => row.path === `/shardfiles/${slug}/shard.json`);
            assert.ok(verdict && verdict.worst.loading < 1.5e9 && verdict.worst.playing < 1.5e9);
            verdict.worst.loading = 1.6e9;
            changed = true;
            const encoded = JSON.stringify(verdicts).replaceAll('<', String.raw`\u003c`);
            return `${prefix}${encoded};`;
          });
          assert.ok(response.ok() && changed, 'Expected the server to stamp Brasscap’s cook estimate');
          await route.fulfill({ response, body });
        });
      }
      const page = await context.newPage();
      page.setDefaultTimeout(90_000);
      await page.addInitScript(() => {
        document.addEventListener('ws:control-ready', () => { document.documentElement.dataset.memoryProofControl = 'true'; });
      });
      await bootPage(page, origin, slug);
      const card = page.getByRole('dialog', { name: 'This world may crash this phone' });
      const error = page.locator('#wserr');
      const control = page.locator('html[data-memory-proof-control=true]');
      if (overBudget) {
        await card.waitFor({ state: 'visible' });
        assert.ok(changed);
        assert.equal(await control.count(), 0);
        assert.equal(await error.count(), 0);
        await page.screenshot({ path: screenshot, scale: 'css' });
        await card.getByRole('button', { name: 'Play anyway', exact: true }).click();
        await card.waitFor({ state: 'detached' });
      }
      await control.or(error).or(card).first().waitFor({ state: 'attached' });
      if (await error.count() > 0) {
        const loading = await page.locator('.ws-load').evaluate(node => ({
          step: node.dataset.step,
          waiting: node.dataset.waiting,
          rows: [...node.querySelectorAll('.ws-load-log li')].slice(-8).map(row => row.textContent),
        }));
        assert.fail(`${await error.locator('.msg').textContent() ?? 'Unexpected boot error'} — ${JSON.stringify(loading)}`);
      }
      assert.equal(await card.count(), 0);
      assert.equal(await control.count(), 1);
      await page.locator('.ws-load').waitFor({ state: 'hidden' });
      console.log(`${version.build} ${slug}: ${overBudget ? 'Play anyway reached control after the warning' : 'original cook estimate reached control without a warning'}`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
