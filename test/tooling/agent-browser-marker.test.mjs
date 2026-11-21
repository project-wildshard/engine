import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { test } from 'vitest';
import { agentHeaders, agentUrl, agentUserAgent } from '../../scripts/agent-marker.mjs';
import { installBrowserActorMarker } from '../../scripts/browser-actor-marker.mjs';
import { chromium, devices } from '../../scripts/browser-playwright.mjs';
import { KEYCHAIN_ARGS } from '../../scripts/chromium-keychain.mjs';

test('agent URL and user agent markers preserve existing context', () => {
  const initial = 'https://staging.wildshard.io/?tier=phone#start';
  const marked = new URL(agentUrl(initial));
  assert.equal(marked.searchParams.get('agent'), agentHeaders()['x-wildshard-agent']);
  assert.equal(marked.searchParams.get('tier'), 'phone');
  assert.equal(marked.hash, '#start');
  assert.equal(agentUrl(marked.href), marked.href);
  assert.equal(agentUrl('about:blank'), 'about:blank');
  assert.match(agentUserAgent('iPhone Safari'), /^iPhone Safari WildshardAgent\/1(?:\s|$)/u);
  assert.equal(agentUserAgent(agentUserAgent('iPhone Safari')), agentUserAgent('iPhone Safari'));
});

test('launch, attach and persistent contexts are marked exactly once', async () => {
  const attempt = /** @param {import('playwright').BrowserContextOptions} options */ (options) => Promise.resolve(options);
  const browser = { newContext: attempt, newPage: attempt };
  const attach = async () => browser;
  const engine = {
    launch: attach,
    connect: attach,
    connectOverCDP: attach,
    /** @param {string} _dir @param {import('playwright').BrowserContextOptions} options */
    launchPersistentContext: (_dir, options) => attempt(options),
  };
  // A WebKit stand-in: a Chromium start also reads its build's default UA, which the real-Chromium tests below cover.
  const instance = { webkit: engine };
  installBrowserActorMarker(instance);
  installBrowserActorMarker(instance);
  const options = { userAgent: 'Phone UA', extraHTTPHeaders: { 'X-Proof': 'yes', 'X-Wildshard-Agent': 'old' }, isMobile: true };
  const expected = { ...options, userAgent: agentUserAgent(options.userAgent), extraHTTPHeaders: { 'X-Proof': 'yes' } };
  for (const launch of [engine.launch, engine.connect, engine.connectOverCDP]) {
    const opened = await launch();
    assert.deepEqual(await opened.newContext(options), expected);
    assert.deepEqual(await opened.newPage(options), expected);
  }
  const { launchPersistentContext } = engine;
  assert.deepEqual(await launchPersistentContext('profile', options), expected);
});

// The hosted share can have full Chromium without the separate headless shell.
const executablePath = chromium.executablePath();
/** @param {import('node:http').RequestListener} handle */
async function origin(handle) {
  const server = createServer(handle);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { url: `http://127.0.0.1:${address.port}/`, close: () => new Promise(resolve => { server.close(resolve); }) };
}

test.skipIf(!existsSync(executablePath))('phone and default pages keep their marker without a cross-origin preflight', async () => {
  const own = await origin((request, response) => response.end(JSON.stringify(request.headers)));
  /** @type {Array<string | undefined>} */
  const methods = [];
  const content = await origin((request, response) => {
    methods.push(request.method);
    if (request.method === 'OPTIONS') { response.writeHead(403).end(); return; }
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.end(JSON.stringify(request.headers));
  });
  try {
    const browser = await chromium.launch({ executablePath, headless: true, args: [...KEYCHAIN_ARGS] });
    try {
      const phone = devices['iPhone 13'];
      assert.ok(phone);
      const page = await browser.newPage(phone);
      const reply = await page.goto(own.url);
      const headers = await reply?.json();
      assert.equal(headers?.['x-wildshard-agent'], undefined);
      assert.equal(headers?.['user-agent'], agentUserAgent(phone.userAgent));
      assert.equal(await page.evaluate(() => navigator.userAgent), agentUserAgent(phone.userAgent));

      const context = await browser.newContext();
      const plainPage = await context.newPage();
      const plainReply = await plainPage.goto(own.url);
      const plainHeaders = await plainReply?.json();
      assert.equal(plainHeaders?.['x-wildshard-agent'], undefined);
      // METRICS MT16: a context with no device UA marks its network UA too, or Cloudflare counts its requests unmarked.
      assert.match(String(plainHeaders?.['user-agent']), /HeadlessChrome\/.* WildshardAgent\/1\b/u);
      assert.equal(await plainPage.evaluate(() => navigator.userAgent), plainHeaders?.['user-agent']);
      for (const tab of [page, plainPage]) {
        const cross = await tab.evaluate(async url => (await fetch(url)).json(), content.url);
        assert.equal(cross['x-wildshard-agent'], undefined);
      }
      assert.deepEqual(methods, ['GET', 'GET']);
    } finally { await browser.close(); }
  } finally { await Promise.all([own.close(), content.close()]); }
});

test.skipIf(!existsSync(executablePath))('a service worker script carries the marker in Chromium (METRICS MT16)', async () => {
  /** @type {Record<string, string | undefined>} */
  const seen = {};
  const own = await origin((request, response) => {
    seen[request.url ?? ''] = request.headers['user-agent'];
    if (request.url === '/sw.js') { response.setHeader('content-type', 'text/javascript'); response.end("self.addEventListener('install', e => e.waitUntil(fetch('/from-sw')));"); return; }
    response.setHeader('content-type', 'text/html'); response.end("<script>navigator.serviceWorker.register('/sw.js')</script>");
  });
  try {
    const browser = await chromium.launch({ executablePath, headless: true, args: [...KEYCHAIN_ARGS] });
    try {
      const page = await (await browser.newContext()).newPage();
      await page.goto(own.url);
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null || navigator.serviceWorker.ready.then(() => true));
      for (let tries = 0; tries < 50 && seen['/from-sw'] === undefined; tries++) await page.waitForTimeout(100);
      for (const path of ['/', '/sw.js', '/from-sw']) assert.match(String(seen[path]), /WildshardAgent\/1\b/u, path);
    } finally { await browser.close(); }
  } finally { await own.close(); }
});

test('native game URL launchers import the agent marker', () => {
  const scripts = execFileSync('git', ['ls-files', 'scripts'], { encoding: 'utf8' }).trim().split('\n');
  for (const script of scripts) {
    if (!/\.(?:mjs|py|sh)$/u.test(script) || /(?:test_|\.test\.)/u.test(script)) continue;
    // This opens a private frame challenge on loopback. Its server checks the exact URL.
    if (script === 'scripts/sim-safari-ready.py') continue;
    const source = readFileSync(script, 'utf8');
    if (/['"]openurl['"]|am start [^\n]*android.intent.action.VIEW/u.test(source)) {
      assert.ok(/\b(?:agentUrl|agent_url)\(/u.test(source), `${script} opens a browser without the agent marker`);
    }
  }
});
