// Meta IPHONE13-DRIFTWOOD DW12 (mini-dw12e): the game's document says `Cross-Origin-Opener-Policy: same-origin`, and
// nothing else on the origin does. On the iPhone 13 a second Driftwood boot in the WebContent that held the first one is
// jetsammed (the warm return: robots.txt, then /slug/driftwood-isle again, same tab). WebKit gives a navigation a new
// WebContent when the opener policy changes between documents, so a COOP-less page in between and a COOP game page
// make each boot start in a clean process. A reload of the game page keeps its process (same policy both sides).
// oxlint-disable-next-line import/no-nodejs-modules -- The fixture build and its owned ./tmp directory.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the preview server's raw response headers.
import { request, type IncomingHttpHeaders } from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- Paths for the owned fixture build.
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { DOCUMENT_OPENER, documentHeaders, isDocumentRoute, LEAVE_PAGE, withIsolationRule } from '../src/scripts/app-build/isolation.mjs';
import { previewServer } from './fixtures/preview-server';

const HEADERS = '/*\n  Cache-Control: public, max-age=0, must-revalidate\n';

function head(url: URL, accept: string): Promise<{ status: number; headers: IncomingHttpHeaders }> {
  return new Promise((done, fail) => {
    const call = request(url, { method: 'GET', headers: { accept } }, response => {
      response.resume();
      response.on('end', () => { done({ status: response.statusCode ?? 0, headers: response.headers }); });
    });
    call.on('error', fail);
    call.end();
  });
}

test('the game routes are the document routes; robots.txt, assets and the doctor are not', () => {
  expect(DOCUMENT_OPENER).toBe('same-origin');
  for (const path of ['/', '/index.html', '/slug/driftwood-isle', '/slug/driftwood-isle/']) expect(isDocumentRoute(path), path).toBe(true);
  for (const path of ['/robots.txt', '/version.json', '/b/04e1/main-Ab_3.js', '/doctor/', '/slug/', '/slug/a/b']) expect(isDocumentRoute(path), path).toBe(false);
});

test('the service worker names the same routes as the page hosts', () => {
  const route = (file: string): string | undefined => /const DOCUMENT_ROUTE = (?<re>\/.+\/u);/u.exec(readFileSync(file, 'utf8'))?.groups?.['re'];
  expect(route('src/client/engine/pwa/sw.js')).toBeDefined();
  expect(route('src/client/engine/pwa/sw.js')).toBe(route('src/scripts/app-build/isolation.mjs'));
});

test('the service worker\'s baked document carries the opener policy on every channel, COEP only when isolated', () => {
  expect(documentHeaders(HEADERS)).toEqual({ 'cross-origin-opener-policy': 'same-origin' });
  expect(documentHeaders(withIsolationRule(HEADERS, 'preview')))
    .toEqual({ 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' });
});

test('the preview server (dev world, serve-local) sends COOP on the game document only', async () => {
  mkdirSync(resolve('tmp'), { recursive: true });
  const root = mkdtempSync(resolve('tmp/document-opener-'));
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'dist/index.html'), '<!doctype html><title>game</title>');
  writeFileSync(join(root, 'dist/version.json'), '{}');
  writeFileSync(join(root, 'dist/_headers'), HEADERS);
  const server = await previewServer(root);
  try {
    const html = 'text/html,application/xhtml+xml';
    for (const path of ['/', '/index.html', '/slug/driftwood-isle']) {
      const page = await head(new URL(path, server.base), html);
      expect([page.status, page.headers['content-type'], page.headers['cross-origin-opener-policy'], page.headers['cache-control']], path)
        .toEqual([200, 'text/html', 'same-origin', 'no-store']);
    }
    // the warm return's stop between boots: the SPA fallback answers it with the page's bytes, but not its policy
    const robots = await head(new URL('/robots.txt', server.base), html);
    expect([robots.status, robots.headers['cross-origin-opener-policy']]).toEqual([200, undefined]);
    // the leave page between two game documents: its own bytes, no COOP, never stored
    const leave = await head(new URL('/leave?to=%2Fslug%2Fdriftwood-isle', server.base), html);
    expect([leave.status, leave.headers['cross-origin-opener-policy'], leave.headers['cache-control']]).toEqual([200, undefined, 'no-store']);
    const json = await head(new URL('/version.json', server.base), '*/*');
    expect([json.status, json.headers['cross-origin-opener-policy']]).toEqual([200, undefined]);
  } finally {
    await server.close(); rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
}, 20_000);

test('the page Worker and the service worker hold the leave page\'s bytes', () => {
  const held = (file: string): string | undefined => /const LEAVE_PAGE = '(?<page>[^']+)'/u.exec(readFileSync(file, 'utf8'))?.groups?.['page'];
  expect(held('pages/worker.ts')).toBe(LEAVE_PAGE);
  expect(held('src/client/engine/pwa/sw.js')).toBe(LEAVE_PAGE);
  // and the game page's leave door runs the same script, for a server that answers /leave with the game page
  const script = /<script>(?<code>.*)<\/script>/u.exec(LEAVE_PAGE)?.groups?.['code'] ?? 'missing';
  expect(readFileSync('index.html', 'utf8')).toContain(`if (location.pathname === '/leave' && document.documentElement.dataset.secureDoor !== 'moving') ${script}`);
});
