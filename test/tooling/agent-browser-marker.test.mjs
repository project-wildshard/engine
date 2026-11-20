import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { test } from 'vitest';
import { agentHeaders, agentUrl, agentUserAgent } from '../../scripts/agent-marker.mjs';
import { installBrowserActorMarker } from '../../scripts/browser-actor-marker.mjs';
import { chromium, devices } from '../../scripts/browser-playwright.mjs';

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
  const instance = { chromium: engine };
  installBrowserActorMarker(instance);
  installBrowserActorMarker(instance);
  const options = { userAgent: 'Phone UA', extraHTTPHeaders: { 'X-Proof': 'yes' }, isMobile: true };
  const expected = { ...options, userAgent: agentUserAgent(options.userAgent), extraHTTPHeaders: { 'x-proof': 'yes', ...agentHeaders() } };
  for (const launch of [engine.launch, engine.connect, engine.connectOverCDP]) {
    const opened = await launch();
    assert.deepEqual(await opened.newContext(options), expected);
    assert.deepEqual(await opened.newPage(options), expected);
  }
  assert.deepEqual(await engine.launchPersistentContext('profile', options), expected);
});

test.skipIf(!existsSync(chromium.executablePath()))('a wrapped iPhone context sends the marker to an owned page', async () => {
  const server = createServer((request, response) => response.end(JSON.stringify(request.headers)));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic', '--mute-audio'] });
    try {
      const phone = devices['iPhone 13'];
      assert.ok(phone);
      const page = await browser.newPage(phone);
      const reply = await page.goto(`http://127.0.0.1:${address.port}/`);
      const headers = await reply?.json();
      assert.equal(headers?.['x-wildshard-agent'], agentHeaders()['x-wildshard-agent']);
      assert.equal(headers?.['user-agent'], agentUserAgent(phone.userAgent));
      assert.equal(await page.evaluate(() => navigator.userAgent), agentUserAgent(phone.userAgent));
    } finally { await browser.close(); }
  } finally { await new Promise(resolve => { server.close(resolve); }); }
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
