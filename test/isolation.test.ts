// PAGE-SIZE PZ12 (J274, preview first): an isolated channel's page origin sends COOP and COEP on every path, and the
// service worker's baked document carries the same two, read from that rule.
// oxlint-disable-next-line import/no-nodejs-modules -- The fixture document is the repository's own page.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { documentIsolation, isolated, withIsolationRule } from '../scripts/app-build/isolation.mjs';
import { serviceWorkerCore } from '../scripts/app-build/serviceWorker';

const HEADERS = '/*\n  Cache-Control: public, max-age=0, must-revalidate\n\n/b/*\n  ! Cache-Control\n  Cache-Control: public, max-age=31536000, immutable\n';

test('preview gets one isolation rule; staging, production and a plain build get none', () => {
  expect([isolated('preview'), isolated('staging'), isolated('production'), isolated(undefined)]).toEqual([true, false, false, false]);
  const preview = withIsolationRule(HEADERS, 'preview');
  expect(withIsolationRule(preview, 'preview')).toBe(preview);
  expect(documentIsolation(preview)).toEqual({ 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' });
  for (const channel of ['staging', 'production', undefined]) expect(withIsolationRule(HEADERS, channel)).toBe(HEADERS);
  expect(documentIsolation(HEADERS)).toEqual({});
  // a header under another path's rule is not the document's
  expect(documentIsolation('/b/*\n  Cross-Origin-Embedder-Policy: require-corp\n')).toEqual({});
});

test('the worker answers a navigation with the rule\'s headers, and an isolation change is a new worker', async () => {
  const html = readFileSync('index.html', 'utf8'), bundle = { 'index.html': { type: 'asset' as const, source: new TextEncoder().encode(html) } };
  const headers = documentIsolation(withIsolationRule(HEADERS, 'preview'));
  const plain = await serviceWorkerCore(bundle, process.cwd(), 'iso'), isolatedCore = await serviceWorkerCore(bundle, process.cwd(), 'iso', undefined, undefined, headers);
  expect(plain.core).not.toContain('__DOCUMENT_HEADERS__');
  expect(isolatedCore.core).toContain(JSON.stringify(JSON.stringify(headers)));
  expect(plain.core).toContain(JSON.stringify('{}'));
  expect(isolatedCore.build).not.toBe(plain.build);
});
