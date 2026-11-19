// meta IPHONE13-DRIFTWOOD DW1 (mini-driftwood13, 2026-11-19): desktop WebKit as the iPhone 13's proxy, behind the same driver
// shape as the WebDriver and inspector drivers (safari.mjs `Safari`): navigate, evaluate a function body that reads
// `arguments` and `return`s, evaluateAsync with the done callback last, click an element an evaluate returned. Headless
// Playwright WebKit with the iPhone 13's viewport, touch and user agent; the bench seeds phone Low as it does on the phone.
// The scripts are wrapped as the inspector driver wraps them (a DOM element comes back as `{__wsElement: n}`), and `click`
// taps the element's centre.
import { createRequire } from 'node:module';
import { admittedPlaywright } from '../../browser-machine-loader.mjs';
import { asyncExpression, syncExpression } from './inspector.mjs';

const require = createRequire(import.meta.url);
const { webkit, devices } = await admittedPlaywright(require('playwright'));

/** Start headless WebKit as an iPhone 13 and return a Safari-shaped driver over one page.
 * @param {{ headless?: boolean }} [options] */
export async function startWebKit({ headless = true } = {}) {
  const browser = await webkit.launch({ headless });
  const context = await browser.newContext({ ...devices['iPhone 13'], bypassCSP: true, serviceWorkers: 'allow' });
  let page = await context.newPage();
  const driver = {
    sessionId: 'webkit',
    getUrl: () => Promise.resolve(page.url()),
    navigate: async (/** @type {string} */ url) => { await page.goto(url, { waitUntil: 'commit', timeout: 180_000 }); },
    reload: async () => { await page.reload({ waitUntil: 'commit', timeout: 180_000 }); },
    async freshTab() {
      const old = page;
      page = await context.newPage();
      await old.close().catch(() => undefined);
    },
    /** @param {string} script @param {unknown[]} [args] */
    evaluate: (script, args = []) => page.evaluate(syncExpression(script, args)),
    /** @param {string} script @param {unknown[]} args @param {number} timeoutMs */
    async evaluateAsync(script, args, timeoutMs) {
      let timer;
      const limit = new Promise((_resolve, reject) => { timer = setTimeout(() => { reject(new Error(`script timeout ${String(timeoutMs)} ms`)); }, timeoutMs + 5_000); });
      try { return await Promise.race([page.evaluate(asyncExpression(script, args)), limit]); } finally { clearTimeout(timer); }
    },
    /** @param {{__wsElement: number}} element */
    async click(element) {
      const box = await page.evaluate((/** @type {number} */ index) => {
        const el = /** @type {any} */ (window).__wsInspectorElements?.[index];
        if (!el?.isConnected) return null;
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }, element.__wsElement);
      if (box === null) return;
      await page.touchscreen.tap(box.x, box.y);
    },
    /** A screenshot of the page (JPEG). @param {string} path */
    screenshot: async (path) => { await page.screenshot({ path, type: 'jpeg', quality: 80 }); },
    close: () => Promise.resolve(),
    stop: async () => { await browser.close().catch(() => undefined); },
  };
  return driver;
}
