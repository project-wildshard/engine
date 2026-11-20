import { agentHeaders, agentUserAgent } from './agent-marker.mjs';

const browsers = new WeakSet();
const engines = new WeakSet();

/** @template {import('playwright').BrowserContextOptions} Options @param {Options} [options] */
function markedContext(options) {
  const headers = Object.fromEntries(Object.entries(options?.extraHTTPHeaders ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    ...options,
    extraHTTPHeaders: { ...headers, ...agentHeaders() },
    ...(options?.userAgent === undefined ? {} : { userAgent: agentUserAgent(options.userAgent) }),
  };
}

/** @param {import('playwright').Browser} browser */
function markedBrowser(browser) {
  if (browsers.has(browser)) return browser;
  browsers.add(browser);
  const context = browser.newContext.bind(browser), page = browser.newPage.bind(browser);
  browser.newContext = options => context(markedContext(options));
  browser.newPage = options => page(markedContext(options));
  return browser;
}

/** @param {object} playwright */
export function installBrowserActorMarker(playwright) {
  for (const name of ['chromium', 'webkit', 'firefox']) {
    const engine = /** @type {import('playwright').BrowserType|undefined} */ (Reflect.get(playwright, name));
    if (engine === undefined || engines.has(engine)) continue;
    engines.add(engine);
    for (const method of ['launch', 'connect', 'connectOverCDP']) {
      const open = Reflect.get(engine, method);
      if (typeof open !== 'function') continue;
      /** @param {...unknown} args */
      const launch = async (...args) => markedBrowser(await Reflect.apply(open, engine, args));
      Reflect.set(engine, method, launch);
    }
    if (typeof engine.launchPersistentContext === 'function') {
      const persistent = engine.launchPersistentContext.bind(engine);
      engine.launchPersistentContext = (dir, options) => persistent(dir, markedContext(options));
    }
  }
}
