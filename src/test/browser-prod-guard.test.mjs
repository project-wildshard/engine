import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'vitest';
import {
  PROD_ROOMS_BLOCK, guardProdRoutes, prodGuarded, prodNavigationRefusal, prodRoomsUrl, withProdBlock,
} from '../scripts/browser-prod-guard.mjs';
import { installBrowserActorMarker } from '../scripts/browser-actor-marker.mjs';
import { chromium } from '../scripts/browser-playwright.mjs';
import { KEYCHAIN_ARGS } from '../scripts/.kit/chromium-keychain.mjs';

// Meta QA 11-25 row 124 (J205, J209: production is humans only). On 2026-11-26 a lane's marked boots of
// play.wildshard.io clicked ENTER THE MMO and Zone Select (a zone address past the title); this is what stops the next.

test('only prod\'s bare title page passes; staging, preview and local are untouched', () => {
  for (const url of ['https://play.wildshard.io/', 'https://play.wildshard.io/?agent=opus-lane',
    'https://play.wildshard.io/?mute=1&nolock=1&sw=0&agent=opus-lane', 'https://play.wildshard.io/index.html',
    'https://staging.wildshard.io/?zone=nalati-grasslands', 'wss://rooms-staging.wildshard.io/world',
    'https://preview.wildshard.io/slug/nalati', 'http://localhost:5173/?zone=x', 'about:blank', 'not a url']) {
    assert.equal(prodNavigationRefusal(url), undefined, url);
  }
  for (const url of ['https://play.wildshard.io/?zone=nalati-grasslands', 'https://play.wildshard.io/slug/nalati',
    'https://PLAY.wildshard.io./?zone=dunes', 'wss://rooms.wildshard.io/world', 'https://rooms.wildshard.io/zone-select/enter']) {
    assert.match(prodNavigationRefusal(url) ?? '', /humans only \(J205\)/u, url);
  }
  assert.equal(prodRoomsUrl('wss://rooms.wildshard.io/world?agent=x'), true);
  assert.equal(prodRoomsUrl('wss://rooms-staging.wildshard.io/world'), false);
});

test('every Chromium start makes the production rooms host unresolvable, merged into a caller\'s own rule', () => {
  assert.deepEqual(withProdBlock(['--mute-audio']), ['--mute-audio', PROD_ROOMS_BLOCK]);
  assert.deepEqual(withProdBlock(['--host-resolver-rules=MAP a.test 127.0.0.1']),
    ['--host-resolver-rules=MAP a.test 127.0.0.1, MAP rooms.wildshard.io ~NOTFOUND']);
  assert.deepEqual(withProdBlock(withProdBlock([])), [PROD_ROOMS_BLOCK]);
  // agent-browser drives an owned Chrome over CDP, past every Playwright wrapper: its launch carries the switch.
  assert.match(readFileSync('src/scripts/agent-browser-session.mjs', 'utf8'), /args:withProdBlock\(\[\.\.\.KEYCHAIN_ARGS/u);
});

test('a marked page refuses goto past prod\'s title and routes its context before it opens prod', async () => {
  /** @type {string[]} */
  const visited = [];
  /** @type {Array<(url: URL) => boolean>} */
  const routes = [], sockets = [];
  const context = {
    route: async (/** @type {(url: URL) => boolean} */ match) => { routes.push(match); },
    routeWebSocket: async (/** @type {(url: URL) => boolean} */ match) => { sockets.push(match); },
  };
  const page = () => ({ goto: async (/** @type {string} */ url) => { visited.push(url); }, context: () => context });
  const browser = { newContext: async () => ({ pages: () => [], on: () => undefined }), newPage: async () => page() };
  const webkit = { launch: async () => browser };
  installBrowserActorMarker({ webkit });
  const opened = await (await webkit.launch()).newPage({ userAgent: 'Phone UA' });
  await opened.goto('http://localhost:5173/');
  assert.equal(routes.length, 0, 'no routing (it turns the HTTP cache off) until a page opens prod');
  await assert.rejects(opened.goto('https://play.wildshard.io/?zone=nalati-grasslands'), /browser-prod-guard refused/u);
  await assert.rejects(opened.goto('wss://rooms.wildshard.io/world'), /browser-prod-guard refused/u);
  await opened.goto('https://play.wildshard.io/?agent=opus-lane');
  await opened.goto('https://play.wildshard.io/');
  assert.deepEqual(visited, ['http://localhost:5173/', 'https://play.wildshard.io/?agent=opus-lane', 'https://play.wildshard.io/']);
  assert.equal(routes.length, 1, 'routed once');
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0]?.(new URL('wss://rooms.wildshard.io/world')), true);
  assert.equal(sockets[0]?.(new URL('wss://rooms-staging.wildshard.io/world')), false);

  // A context's later pages are guarded too.
  /** @type {Array<(page: unknown) => void>} */
  const listeners = [];
  const later = page();
  prodGuarded({ pages: () => [], on: (/** @type {string} */ _event, /** @type {(page: unknown) => void} */ listen) => { listeners.push(listen); } });
  listeners.forEach(listen => { listen(later); });
  await assert.rejects(later.goto('https://play.wildshard.io/slug/nalati'), /browser-prod-guard refused/u);
});

test('the context route aborts a navigation past the title and every rooms request, and passes the title\'s own files', async () => {
  /** @type {(route: any) => Promise<void>} */
  let handle = async () => undefined;
  await guardProdRoutes({ route: async (_match, own) => { handle = own; } });
  const outcome = async (/** @type {string} */ url, navigation = true) => {
    let done = '';
    await handle({ request: () => ({ url: () => url, isNavigationRequest: () => navigation }),
      abort: async () => { done = 'abort'; }, fallback: async () => { done = 'pass'; } });
    return done;
  };
  const quiet = console.error;
  console.error = () => undefined;
  try {
    assert.equal(await outcome('https://play.wildshard.io/?zone=nalati-grasslands'), 'abort');
    assert.equal(await outcome('https://rooms.wildshard.io/zone-select/enter', false), 'abort');
    assert.equal(await outcome('https://rooms.wildshard.io/zone-select', false), 'abort');
    assert.equal(await outcome('https://play.wildshard.io/assets/index-abc.js?v=1', false), 'pass');
    assert.equal(await outcome('https://play.wildshard.io/?agent=lane'), 'pass');
  } finally { console.error = quiet; }
});

// The hosted share can have full Chromium without the separate headless shell.
const executablePath = chromium.executablePath();
test.skipIf(!existsSync(executablePath))('a marked Chromium can\'t resolve the production rooms host, and staying local needs no network', async () => {
  const browser = await chromium.launch({ executablePath, headless: true, args: [...KEYCHAIN_ARGS] });
  try {
    const page = await browser.newPage();
    // Through the CDP door (agent-browser's), past the page's goto guard: the host itself does not resolve.
    const client = await page.context().newCDPSession(page);
    const { errorText } = /** @type {{ errorText?: string }} */ (await client.send('Page.navigate', { url: 'https://rooms.wildshard.io/health' }));
    assert.equal(errorText, 'net::ERR_NAME_NOT_RESOLVED');
    await assert.rejects(page.goto('https://play.wildshard.io/?zone=nalati-grasslands'), /browser-prod-guard refused/u);
  } finally { await browser.close(); }
});
