import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { agentUserAgent } from './agent-marker.mjs';
import { mutedLaunch, silenced } from './browser-silence.mjs';
import markers from '../src/shared/engine/app/actorMarkers.json' with { type: 'json' };

const browsers = new WeakSet();
const engines = new WeakSet();

/** @template {import('playwright').BrowserContextOptions} Options @param {Options} [options] */
function markedContext(options) {
  const headers = options?.extraHTTPHeaders;
  return {
    ...options,
    ...(headers === undefined ? {} : {
      extraHTTPHeaders: Object.fromEntries(Object.entries(headers).filter(([key]) => key.toLowerCase() !== markers.header)),
    }),
    ...(options?.userAgent === undefined ? {} : { userAgent: agentUserAgent(options.userAgent) }),
  };
}

/** A persistent context has no browser to read a default from first, so only its pages' navigator carries the marker.
 * The app reads this suffix and carries its actor marker to the room.
 * @template {import('playwright').BrowserContext | import('playwright').Page} Target
 * @param {Target} target @param {string | undefined} userAgent @returns {Promise<Target>}
 */
async function markDefaultUA(target, userAgent) {
  if (userAgent === undefined) {
    await target.addInitScript((suffix) => {
      const base = navigator.userAgent;
      Object.defineProperty(navigator, 'userAgent', { configurable: true, value: `${base} ${suffix}` });
    }, agentUserAgent(''));
  }
  return target;
}

/** @type {WeakMap<object, Promise<string>>} */
const defaults = new WeakMap();

/** The engine's own default UA for this browser, read once from a blank page of a throwaway context.
 * @param {object} browser @param {(options?: import('playwright').BrowserContextOptions) => Promise<import('playwright').BrowserContext>} context */
function defaultUserAgent(browser, context) {
  let found = defaults.get(browser);
  if (found === undefined) {
    found = (async () => {
      const probe = await context();
      try { return await (await probe.newPage()).evaluate(() => navigator.userAgent); } finally { await probe.close(); }
    })();
    defaults.set(browser, found);
  }
  return found;
}

/** A context with no device UA takes the engine's default UA, so the marker reaches the network as well as the page
 * (METRICS MT16: Cloudflare saw those requests as plain HeadlessChrome).
 * @param {import('playwright').Browser} browser */
function markedBrowser(browser) {
  if (browsers.has(browser)) return browser;
  browsers.add(browser);
  const context = browser.newContext.bind(browser), page = browser.newPage.bind(browser);
  /** @param {import('playwright').BrowserContextOptions | undefined} options */
  const device = async options => options?.userAgent === undefined ? { ...options, userAgent: await defaultUserAgent(browser, context) } : options;
  // Every page an agent opens is silent too (meta QA-FEEDBACK-2026-11-24 row 49): browser-silence.mjs.
  browser.newContext = async options => silenced(await context(markedContext(await device(options))));
  browser.newPage = async options => silenced(await page(markedContext(await device(options))));
  return browser;
}

/** Chromium's own default UA for one build and mode, read once from a throwaway launch and kept beside the other build
 * caches. The probe keeps the caller's args, so it carries the keychain and mute switches too.
 * @param {(options?: object) => Promise<import('playwright').Browser>} open
 * @param {import('playwright').BrowserType} engine @param {import('playwright').LaunchOptions | undefined} options */
async function chromiumDefaultUA(open, engine, options) {
  const headless = options?.headless !== false, channel = options?.channel ?? '';
  const executable = options?.executablePath ?? engine.executablePath();
  let file;
  try {
    // 'cdp': files a page probe wrote may hold a context default's UA (below), so they are never read again.
    const key = createHash('sha256').update(['cdp', executable, String(statSync(executable).mtimeMs), String(headless), channel].join('\n')).digest('hex');
    file = join(homedir(), '.cache/wildshard/browser-ua', `${key.slice(0, 16)}.txt`);
    const kept = readFileSync(file, 'utf8').trim();
    if (kept !== '') return kept;
  } catch { /* first launch of this build, or a channel with no file of its own */ }
  const probe = await open({ headless, args: options?.args ?? [],
    ...options?.executablePath === undefined ? {} : { executablePath: options.executablePath }, ...channel === '' ? {} : { channel } });
  // The browser's own UA, never a page's: a page takes its context's defaults, and under Playwright Test those are the
  // project's `use` (engine red 44944859967: src/e2e's Desktop Chrome UA was kept as this build's default, and every
  // later launch in that job sent Windows Chrome as its network UA).
  let ua;
  try { ua = /** @type {{userAgent:string}} */ (await (await probe.newBrowserCDPSession()).send('Browser.getVersion')).userAgent; }
  finally { await probe.close(); }
  if (file !== undefined) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `${ua}\n`); }
  return ua;
}

/** Chromium fetches a service worker's script with the browser's own UA, which no context UA reaches (METRICS MT16:
 * Cloudflare counted each `/sw.js` of a marked proof as plain HeadlessChrome). A Chromium we start gets its default UA,
 * marked, as the `--user-agent` switch, unless the caller set one.
 * @template {import('playwright').LaunchOptions} Options @param {(options?: object) => Promise<import('playwright').Browser>} open
 * @param {import('playwright').BrowserType} engine @param {Options | undefined} options @returns {Promise<Options | undefined>} */
async function markedStart(open, engine, options) {
  const args = options?.args ?? [];
  if (args.some(arg => arg.startsWith('--user-agent='))) return options;
  const ua = await chromiumDefaultUA(open, engine, options);
  return /** @type {Options} */ ({ ...options, args: [...args, `--user-agent=${agentUserAgent(ua)}`] });
}

/** @param {object} playwright */
export function installBrowserActorMarker(playwright) {
  for (const name of ['chromium', 'webkit', 'firefox']) {
    const engine = /** @type {import('playwright').BrowserType|undefined} */ (Reflect.get(playwright, name));
    if (engine === undefined || engines.has(engine)) continue;
    engines.add(engine);
    const own = name === 'chromium' && typeof engine.launch === 'function';
    /** @type {(options?: object) => Promise<import('playwright').Browser>} */
    const start = own ? engine.launch.bind(engine) : () => Promise.reject(new Error('no launch'));
    for (const method of ['launch', 'connect', 'connectOverCDP']) {
      const open = Reflect.get(engine, method);
      if (typeof open !== 'function') continue;
      const started = own && method === 'launch';
      /** @param {...unknown} args */
      const launch = async (...args) => markedBrowser(await Reflect.apply(open, engine,
        started ? [await markedStart(start, engine, mutedLaunch(/** @type {import('playwright').LaunchOptions | undefined} */ (args[0])))] : args));
      Reflect.set(engine, method, launch);
    }
    if (typeof engine.launchPersistentContext === 'function') {
      const persistent = engine.launchPersistentContext.bind(engine);
      engine.launchPersistentContext = async (dir, options) => silenced(await markDefaultUA(await persistent(dir, markedContext(
        own ? options?.userAgent === undefined ? await markedStart(start, engine, mutedLaunch(options)) : mutedLaunch(options) : options)),
      options?.userAgent));
    }
  }
}
