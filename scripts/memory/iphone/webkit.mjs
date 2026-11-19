// meta IPHONE13-DRIFTWOOD DW1 (mini-driftwood13, 2026-11-19): desktop WebKit as the iPhone 13's proxy, behind the same driver
// shape as the WebDriver and inspector drivers (safari.mjs `Safari`): navigate, evaluate a function body that reads
// `arguments` and `return`s, evaluateAsync with the done callback last, click an element an evaluate returned. Headless
// Playwright WebKit with the iPhone 13's viewport, touch and user agent; the bench seeds phone Low as it does on the phone.
// A DOM element in an evaluate's answer comes back as `{__el: n}` (kept in the page) and `click` taps its centre.
import { createRequire } from 'node:module';
import { admittedPlaywright } from '../../browser-machine-loader.mjs';

const require = createRequire(import.meta.url);
const { webkit, devices } = await admittedPlaywright(require('playwright'));

/** The page-side runner: one function body, its arguments, and (async) a done callback appended last.
 * @param {[string, unknown[], boolean]} input */
async function runBody([source, args, callback]) {
  const store = /** @type {any} */ (window).__pwEls ??= [];
  /** @param {unknown} value @returns {unknown} */
  const encode = (value) => {
    if (value instanceof Element) { store.push(value); return { __el: store.length - 1 }; }
    if (Array.isArray(value)) return value.map(encode);
    if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
      return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, encode(inner)]));
    }
    return value;
  };
  // eslint-disable-next-line no-new-func -- the drivers' contract is a WebDriver-style script body
  const body = new Function(source);
  if (!callback) return encode(await body.apply(null, args));
  return encode(await new Promise((resolve, reject) => {
    try { body.apply(null, [...args, resolve]); } catch (error) { reject(error); }
  }));
}

/** Start headless WebKit as an iPhone 13 and return a Safari-shaped driver over one page.
 * @param {{ headless?: boolean }} [options] */
export async function startWebKit({ headless = true } = {}) {
  const browser = await webkit.launch({ headless });
  const context = await browser.newContext({ ...devices['iPhone 13'], bypassCSP: true, serviceWorkers: 'allow' });
  let page = await context.newPage();
  const driver = {
    sessionId: 'webkit',
    getUrl: async () => page.url(),
    navigate: async (/** @type {string} */ url) => { await page.goto(url, { waitUntil: 'commit', timeout: 180_000 }); },
    reload: async () => { await page.reload({ waitUntil: 'commit', timeout: 180_000 }); },
    async freshTab() {
      const old = page;
      page = await context.newPage();
      await old.close().catch(() => undefined);
    },
    /** @param {string} script @param {unknown[]} [args] */
    evaluate: (script, args = []) => page.evaluate(runBody, [script, args, false]),
    /** @param {string} script @param {unknown[]} args @param {number} timeoutMs */
    async evaluateAsync(script, args, timeoutMs) {
      let timer;
      const limit = new Promise((_resolve, reject) => { timer = setTimeout(() => { reject(new Error(`script timeout ${String(timeoutMs)} ms`)); }, timeoutMs + 5_000); });
      try { return await Promise.race([page.evaluate(runBody, [script, args, true]), limit]); } finally { clearTimeout(timer); }
    },
    /** @param {{__el: number}} element */
    async click(element) {
      const box = await page.evaluate((index) => {
        const el = /** @type {any} */ (window).__pwEls?.[index];
        if (!el?.isConnected) return null;
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }, element.__el);
      if (box === null) return;
      await page.touchscreen.tap(box.x, box.y);
    },
    /** A screenshot of the page (JPEG). @param {string} path */
    screenshot: async (path) => { await page.screenshot({ path, type: 'jpeg', quality: 80 }); },
    close: async () => undefined,
    stop: async () => { await browser.close().catch(() => undefined); },
  };
  return driver;
}
