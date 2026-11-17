// The retained SM5 Chromium profile resumed a world with a restart notice, so waiting only for the title never progressed.
// WS_SMOKE_BROWSER=1 scripts/browser-lane.sh pnpm exec vitest run test/staging-smoke-recovery.test.ts
import { expect, test } from 'vitest';
import { oldProfileTitle, SEL } from '../scripts/staging-smoke/scenarios.mjs';
import { KEYCHAIN_ARGS } from '../scripts/chromium-keychain.mjs';

test.skipIf(process.env['WS_SMOKE_BROWSER'] !== '1')('an old recovery reaches title through its notice, pause and exit controls', async () => {
  const { chromium } = await import('../scripts/browser-playwright.mjs');
  const browser = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--use-angle=metal'] });
  try {
    const page = await browser.newPage({ viewport: { width: 402, height: 874 }, hasTouch: true });
    await page.setContent(`<button class="ws-main-select" hidden>Zone Select</button>
      <button class="ws-touch-pause">Pause</button><div id="wsdrop"><button class="dismiss">Dismiss</button></div>
      <div class="ws-gmenu" hidden><button class="ws-gmenu-exit">Exit to Main Menu</button></div>
      <script>
      window.steps=[];
      document.querySelector('.dismiss').onclick=()=>{window.steps.push('dismiss');document.querySelector('#wsdrop').remove()};
      document.querySelector('.ws-touch-pause').onclick=()=>{if(document.querySelector('#wsdrop'))throw Error('notice blocks pause');window.steps.push('pause');document.querySelector('.ws-gmenu').hidden=false;document.querySelector('.ws-gmenu').classList.add('show')};
      document.querySelector('.ws-gmenu-exit').onclick=()=>{window.steps.push('exit');document.querySelector('.ws-gmenu').hidden=true;document.querySelector('.ws-touch-pause').hidden=true;document.querySelector('.ws-main-select').hidden=false};
      </script>`);
    let drops = 0, recoveries = 0;
    await oldProfileTitle(page, { onDrop: () => { drops++; }, onRecovery: async () => { recoveries++; } });
    expect(await page.evaluate(() => Reflect.get(window, 'steps'))).toEqual(['dismiss', 'pause', 'exit']);
    expect(drops).toBe(1); expect(recoveries).toBe(1);
    expect(await page.locator('.ws-main-select').isVisible()).toBe(true);
    await oldProfileTitle(page, { onDrop: () => { drops++; }, onRecovery: async () => { recoveries++; } });
    expect(drops).toBe(1); expect(recoveries).toBe(1);
    await page.setContent(`<main inert><button class="ws-main-select">Zone Select</button></main>
      <div class="ws-title-stack" data-screen="select"><button class="ws-menu-back" onclick="document.querySelector('main').inert=false;this.parentElement.hidden=true">Back</button></div>`);
    await oldProfileTitle(page);
    expect(await page.locator('.ws-main-select').evaluate(element => element.closest('[inert]') === null)).toBe(true);
    await page.setContent(`<button class="ws-main-settings ws-main-signin" onclick="window.picked='signin'">Sign in</button>
      <button class="ws-main-settings" onclick="window.picked='settings'">Settings</button>`);
    await page.locator(SEL.settings).tap();
    expect(await page.evaluate(() => Reflect.get(window, 'picked'))).toBe('settings');
    // A resumed HUD may be laid out underneath a loading card, then return to title without a usable Pause.
    await page.setContent(`<button class="ws-main-select" hidden>Zone Select</button>
      <button class="ws-touch-pause" onclick="window.pauseTapped=true">Pause</button>
      <div class="ws-load" style="position:fixed;inset:0;z-index:100;background:black">Loading</div>`);
    page.setDefaultTimeout(2000);
    let loadingRecoveries = 0;
    const title = oldProfileTitle(page, { onRecovery: async () => { loadingRecoveries++; } });
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      document.querySelector('.ws-load')?.remove();
      document.querySelector<HTMLElement>('.ws-touch-pause')!.hidden = true;
      document.querySelector<HTMLElement>('.ws-main-select')!.hidden = false;
    });
    await title;
    expect(await page.evaluate(() => Reflect.get(window, 'pauseTapped'))).toBeUndefined();
    expect(loadingRecoveries).toBe(0);
    expect(await page.locator('.ws-main-select').isVisible()).toBe(true);
  } finally { await browser.close(); }
}, 600_000);
