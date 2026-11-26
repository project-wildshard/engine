import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test, vi } from 'vitest';
import { agentHeaders, agentUserAgent } from '../scripts/agent-marker.mjs';
import { markerIssues } from '../scripts/.kit/agent-marker-check.mjs';
import { markedFetch } from '../scripts/agent-fetch.mjs';

test('passes third-party reads through and marks only the game request', async () => {
  const original = vi.fn(async () => new Response(null, { status: 204 }));
  const fetch = markedFetch(original);
  const external = 'https://api.github.com/';
  await fetch(external);
  assert.deepEqual(original.mock.calls[0], [external, undefined]);
  const request = new Request('https://staging.wildshard.io/health', { headers: { 'x-proof': 'caller' } });
  await fetch(request);
  const [, options] = original.mock.calls[1] ?? [];
  assert.ok(options?.headers instanceof Headers);
  assert.equal(options.headers.get('x-proof'), 'caller');
  assert.equal(options.headers.get('x-wildshard-agent'), agentHeaders()['x-wildshard-agent']);
  assert.equal(options.headers.get('user-agent'), agentUserAgent('node'));
});

test('a hand-rolled fetch with agentHeaders() carries the marked UA the hourly audit reads', () => {
  const headers = agentHeaders();
  assert.equal(headers['user-agent'], agentUserAgent('node'));
  assert.match(headers['user-agent'], /^node WildshardAgent\/1\b/u);
});

test('preloaded fetch and WebSocket preserve the handshake and mark an owned endpoint', async () => {
  const server = createServer((request, response) => response.end(JSON.stringify(request.headers)));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const base = `127.0.0.1:${address.port}`;
    const headers = await (await fetch(`http://${base}/`, { headers: { 'user-agent': 'Proof UA' } })).json();
    const marker = agentHeaders()['x-wildshard-agent'];
    assert.equal(headers['x-wildshard-agent'], marker);
    assert.equal(headers['user-agent'], agentUserAgent('Proof UA'));

    const upgraded = once(server, 'upgrade');
    const link = new WebSocket(`ws://${base}/?cell=proof`, 'sample-protocol');
    link.addEventListener('error', () => undefined);
    const [request, socket] = await upgraded;
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    const destination = new URL(request.url, `http://${base}`);
    assert.equal(destination.searchParams.get('cell'), 'proof');
    assert.equal(destination.searchParams.get('agent'), marker);
    assert.equal(request.headers['x-wildshard-agent'], marker);
    assert.equal(request.headers['sec-websocket-protocol'], 'sample-protocol');
  } finally { await new Promise(resolve => { server.close(resolve); }); }
});

test('flags an unmarked hosted read, curl and browser even when their address is named first', () => {
  const address = 'https://staging.wildshard.io/';
  assert.equal(markerIssues(`const origin = '${address}'; await fetch(origin);`, 'scripts/probe.mjs').length, 1);
  assert.equal(markerIssues(`url='${address}'\ncurl -fsS "$url"`, 'scripts/probe.sh').length, 1);
  assert.equal(markerIssues(`const origin = '${address}'; await chromium.launch();`, 'scripts/probe.mjs').length, 1);
  assert.deepEqual(markerIssues(`curl -fsS https://not-wildshard.io/`, 'scripts/probe.sh'), []);
  assert.deepEqual(markerIssues(`import { agentFetch as fetch } from './.kit/agent-requests.mjs';\nawait fetch('${address}');`, 'scripts/probe.mjs'), []);
  assert.deepEqual(markerIssues(`url='${address}'\ncurl -A "$WS_AGENT_UA" -fsS "$url"`, 'scripts/probe.sh'), []);
});

test('accepts browser navigation and refuses a browser-wide agent header', () => {
  const address = 'https://staging.wildshard.io/';
  assert.deepEqual(markerIssues(`import { chromium } from './.kit/browser-playwright.mjs';\nawait chromium.launch();\npage.goto('${address}');`, 'scripts/probe.mjs'), []);
  assert.deepEqual(markerIssues(`await page.goto(agentUrl('${address}'));\nawait chromium.launch();`, 'scripts/probe.mjs'), []);
  assert.deepEqual(markerIssues('browser.newContext({extraHTTPHeaders: {...agentHeaders()}});', 'scripts/probe.mjs'), [
    'keep the actor header out of browser-wide request options',
  ]);
  assert.deepEqual(markerIssues(`await page.evaluate(() => fetch('/version.json'));\nconst url = '${address}';`, 'scripts/probe.mjs'), []);
});
