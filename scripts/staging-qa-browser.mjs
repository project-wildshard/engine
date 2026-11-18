import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';
import { chromium, webkit } from './browser-playwright.mjs';

const VERSION = 'https://staging.wildshard.io/version.json';

/** @param {Buffer|string} certificate */
export function certificateSpki(certificate) {
  const key = new X509Certificate(certificate).publicKey.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(key).digest('base64');
}

/** SB50: context-level TLS options leave the cached Chromium service worker unable to update.
 * Pin only the preview's certificate so Chromium still validates the packs, API and rooms.
 * @param {readonly string[]} args @param {string|undefined} spki */
export function chromiumCandidateArgs(args, spki) {
  if (spki === undefined || !/^[A-Za-z0-9+/]{43}=$/u.test(spki) || Buffer.from(spki, 'base64').toString('base64') !== spki) {
    throw new Error('Candidate Chromium requires the staging preview certificate pin');
  }
  if (args.some(arg => arg.startsWith('--ignore-certificate-errors'))) {
    throw new Error('Candidate Chromium requires scoped certificate trust');
  }
  return [...args, `--ignore-certificate-errors-spki-list=${spki}`];
}

/** @param {string} address */
function requireLoopback(address) {
  const url = new URL(address);
  assert.ok(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port !== '' && url.origin === address,
    'Candidate QA requires an owned loopback transport');
}

/** Bind one owned browser process to the preview before it opens any profiles.
 * @param {{server:string,preview:string,chromiumSPKI:string|undefined}} transport */
export function bindCandidateBrowser({ server, preview, chromiumSPKI }) {
  requireLoopback(server);
  requireLoopback(preview);
  chromiumCandidateArgs([], chromiumSPKI);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, options) => {
    const url = input instanceof Request ? input.url : String(input);
    return originalFetch(url === VERSION ? `${preview}/version.json` : input, options);
  };
  const undo = [chromium, webkit].map(engine => {
    const persistent = engine.launchPersistentContext;
    const launch = engine.launch;
    const isChromium = engine === chromium;
    /** @param {import('playwright').LaunchOptions} options */
    const local = options => {
      assert.equal(options.headless, true, 'Staging QA browsers must be headless');
      const args = isChromium ? chromiumCandidateArgs(options.args ?? [], chromiumSPKI) : options.args;
      return { ...options, ...(args === undefined ? {} : { args }), proxy: { server } };
    };
    engine.launchPersistentContext = function (profile, options) {
      return persistent.call(this, profile, { ...options, ...local(options ?? {}), ignoreHTTPSErrors: !isChromium });
    };
    engine.launch = async function (options) {
      const browser = await launch.call(this, local(options ?? {}));
      const newContext = browser.newContext;
      browser.newContext = options => newContext.call(browser, { ...options, ignoreHTTPSErrors: !isChromium });
      return browser;
    };
    return () => {
      engine.launchPersistentContext = persistent;
      engine.launch = launch;
    };
  });
  return () => {
    globalThis.fetch = originalFetch;
    for (const restore of undo) restore();
  };
}

if (process.env.WS_QA_CANDIDATE_PROXY && process.env.WS_QA_CANDIDATE_HTTP) {
  bindCandidateBrowser({ server: process.env.WS_QA_CANDIDATE_PROXY,
    preview: process.env.WS_QA_CANDIDATE_HTTP, chromiumSPKI: process.env.WS_QA_CHROMIUM_SPKI });
}
