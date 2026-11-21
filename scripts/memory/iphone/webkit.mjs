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
// DF9 (mini-df9b): the GC census reads WebKit's stderr, which Playwright passes on only as its `pw:browser` debug log, and
// its debug switch is read as Playwright loads: a caller that wants the census sets WS_WEBKIT_GC_LOG=1 before importing
const gcCensus = process.env.WS_WEBKIT_GC_LOG === '1';
if (gcCensus) process.env.DEBUG = [process.env.DEBUG, 'pw:browser'].filter(Boolean).join(',');
/** @type {((line: string) => void) | null} */
let gcSink = null;
if (gcCensus) {
  const write = process.stderr.write.bind(process.stderr);
  // the browser's lines go to the census, not the terminal
  process.stderr.write = /** @type {typeof process.stderr.write} */ ((/** @type {unknown} */ chunk, /** @type {any[]} */ ...rest) => {
    const text = String(chunk);
    if (!text.includes('pw:browser')) return write(/** @type {any} */ (chunk), ...rest);
    for (const line of text.split('\n')) gcSink?.(line);
    return true;
  });
}
const { webkit, devices } = await admittedPlaywright(require('playwright'));

/**
 * One JavaScriptCore collection as JSC_logGC=1 prints it (`[GC<heap>: START M <kb>kb => FullCollection ... p=<pause>ms
 * (max ...), cycle <ms>ms END]`): its start's heap, size and kind and its end's pause and cycle (null where a line has
 * neither). Pure.
 * @param {string} line
 */
export function jscGcLine(line) {
  const start = /\[GC<(0x[0-9a-f]+)>: START M (\d+)kb => (\w+)Collection/u.exec(line);
  const end = /p=([\d.]+)ms \(max [\d.]+\), cycle ([\d.]+)ms END\]/u.exec(line);
  return { heap: start?.[1] ?? null, kb: start === null ? null : Number(start[2]), kind: start === null ? null : start[3] === 'Full' ? 'full' : 'eden',
    pauseMs: end === null ? null : Number(end[1]), cycleMs: end === null ? null : Number(end[2]) };
}

/** Start headless WebKit as an iPhone 13 and return a Safari-shaped driver over one page.
 * DF9 (mini-df9b): with `gcLog`, JavaScriptCore logs every collection (JSC_logGC=1 on the browser's stderr) and the driver
 * has the inspector driver's heapStart/heapStop, read from that log: the desktop proxy's GC census.
 * @param {{ headless?: boolean, gcLog?: boolean }} [options] */
export async function startWebKit({ headless = true, gcLog = false } = {}) {
  /** @type {{ heap: string, kb: number, kind: string, pauseMs: number, cycleMs: number, at: number }[]} */
  const collections = [];
  /** @type {{ heap: string | null, kb: number | null, kind: string | null }} */
  let open = { heap: null, kb: null, kind: null };
  let logging = false;
  if (gcLog && !gcCensus) throw new Error('the GC census needs WS_WEBKIT_GC_LOG=1 before webkit.mjs loads');
  if (gcLog) gcSink = (/** @type {string} */ message) => {
      if (!logging) return;
      const line = jscGcLine(message);
      if (line.kind !== null) open = line;
      if (line.cycleMs !== null && line.pauseMs !== null && open.kind !== null && collections.length < 20_000) {
        collections.push({ heap: open.heap ?? '?', kb: open.kb ?? 0, kind: open.kind, pauseMs: line.pauseMs, cycleMs: line.cycleMs, at: Date.now() });
        open = { heap: null, kb: null, kind: null };
      }
    };
  // the page's WebContent is an XPC service: launchd hands it `__XPC_`-prefixed variables without the prefix
  const browser = await webkit.launch(gcLog ? { headless, env: { ...process.env, __XPC_JSC_logGC: '1' } } : { headless });
  const context = await browser.newContext({ ...devices['iPhone 13'], bypassCSP: true, serviceWorkers: 'allow' });
  // DF9 (mini-df9b): the bench waits for the origin on /robots.txt (safari.mjs); a local dev world answers it with the game's
  // page, whose boot then navigated over the bench's own navigation. The desktop proxy answers it as staging does: text
  await context.route('**/robots.txt', (/** @type {import('playwright').Route} */ route) => route.fulfill({ status: 200, contentType: 'text/plain', body: 'User-agent: *\n' }));
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
    ...(gcLog ? {
      /** The collections from now on (JSC's log). */
      heapStart: () => { collections.length = 0; logging = true; return Promise.resolve(); },
      /** Stop and answer them as the inspector driver does, on the page clock: [type, start ms, end ms] per collection of
       *  the page's own heap (the heap that collected the most memory: workers and the UI process have their own), the
       *  end taken when the line arrived and the start a cycle before it; `all` keeps every heap's rows with pauses. */
      async heapStop() {
        logging = false;
        const origin = Number(await page.evaluate('performance.timeOrigin'));
        /** @type {Map<string, number>} */
        const size = new Map();
        for (const c of collections) size.set(c.heap, (size.get(c.heap) ?? 0) + c.kb);
        const main = [...size].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
        const mine = collections.filter((c) => c.heap === main);
        return { heap: main, anchorMs: 10, all: collections.map((c) => [c.heap, c.kind, c.kb, c.pauseMs, c.cycleMs, Math.round(c.at - origin)]),
          collections: mine.map((c) => [c.kind, Math.round(c.at - origin - c.cycleMs), Math.round(c.at - origin)]),
          pauses: mine.map((c) => c.pauseMs) };
      },
    } : {}),
  };
  return driver;
}
