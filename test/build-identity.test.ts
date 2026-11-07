// oxlint-disable-next-line import/no-nodejs-modules -- The fixture owns only its temporary build output under ./tmp.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the fixture's declared document entries.
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { BUILD_ID_EXPRESSION, stampBuildDocuments, stampBuildHtml } from '../scripts/app-build/buildIdentity.mjs';

test('deploy identities change the document while its module URLs and runtime expression stay stable', () => {
  const html = '<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/assets/main-aaaaaaaa.js"></script></head></html>';
  const before = stampBuildHtml(html, 'before-123'), after = stampBuildHtml(html, 'after-456');
  expect(before).toContain('<head><script>globalThis.__WS_BUILD_ID__="before-123";</script>');
  expect(after).toContain('<head><script>globalThis.__WS_BUILD_ID__="after-456";</script>');
  expect(before.slice(before.indexOf('<meta'))).toBe(after.slice(after.indexOf('<meta')));
  expect(BUILD_ID_EXPRESSION).toBe('(globalThis.__WS_BUILD_ID__ ?? "")');
  for (const build of ['', '</script>', '"unsafe']) expect(() => stampBuildHtml(html, build)).toThrow('Invalid document build identity');
  expect(() => stampBuildHtml(before, 'other')).toThrow('Duplicate document build identity');
  expect(() => stampBuildHtml('<html></html>', 'valid')).toThrow('Missing or ambiguous document head');
  expect(() => stampBuildHtml('<head></head><head></head>', 'valid')).toThrow('Missing or ambiguous document head');
});

test('the post-bundle stamp covers web and native document entries without modifying code', () => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/build-identity-'));
  const html = '<html><head></head><body></body></html>';
  try {
    writeFileSync(join(root, 'version.json'), JSON.stringify({ build: 'deploy-123' }));
    writeFileSync(join(root, 'index.html'), html);
    stampBuildDocuments(root); // native: no Vite manifest
    expect(readFileSync(join(root, 'index.html'), 'utf8')).toContain('"deploy-123"');
    mkdirSync(join(root, '.vite')); mkdirSync(join(root, 'calibration')); mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, '.vite/manifest.json'), JSON.stringify({ 'index.html': { isEntry: true }, 'calibration/index.html': { isEntry: true }, 'src/lazy.ts': { isEntry: true } }));
    writeFileSync(join(root, 'index.html'), html); writeFileSync(join(root, 'calibration/index.html'), html);
    writeFileSync(join(root, 'assets/main-aaaaaaaa.js'), 'window.actualBuild=globalThis.__WS_BUILD_ID__;');
    stampBuildDocuments(root);
    expect(readFileSync(join(root, 'calibration/index.html'), 'utf8')).toContain('"deploy-123"');
    expect(readFileSync(join(root, 'assets/main-aaaaaaaa.js'), 'utf8')).toBe('window.actualBuild=globalThis.__WS_BUILD_ID__;');
    writeFileSync(join(root, '.vite/manifest.json'), JSON.stringify({ '../outside.html': { isEntry: true } }));
    expect(() => stampBuildDocuments(root)).toThrow('Document entry escapes build');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the bundled first-paint document never waits for an extracted stylesheet', () => {
  const html = '<html><head><link rel="stylesheet" crossorigin href="/assets/app-123.css"></head><body><script data-loading-first-paint></script></body></html>';
  const result = stampBuildHtml(html, 'new-build');
  expect(result).toContain('href="/assets/app-123.css" media="print" onload="this.media=\'all\'"');
  expect(stampBuildHtml(html.replace('data-loading-first-paint', ''), 'new-build')).not.toContain('media="print"');
});

test('changing exact admission receipts changes the document, not its executable module identities', () => {
  const html = '<html><head><script type="module" src="/assets/main-aaaaaaaa.js"></script></head></html>';
  const first = stampBuildHtml(html, 'before', {validator: 'a'.repeat(64), verdicts: [{indexHash: 'b'.repeat(64)}]});
  const second = stampBuildHtml(html, 'after', {validator: 'c'.repeat(64), verdicts: [{indexHash: 'd'.repeat(64)}]});
  expect(first).toContain(`globalThis.__WS_SHARDFILE_VALIDATOR__="${'a'.repeat(64)}"`);
  expect(second).toContain(`globalThis.__WS_SHARDFILE_VERDICTS__=[{"indexHash":"${'d'.repeat(64)}"}]`);
  expect(first.slice(first.indexOf('<script type="module"'))).toBe(second.slice(second.indexOf('<script type="module"')));
  expect(() => stampBuildHtml(html, 'valid', {validator: 'not-a-digest', verdicts: []})).toThrow('Invalid document admission facts');
  const escaped = stampBuildHtml(html, 'valid', {validator: 'a'.repeat(64), verdicts: [{value: '</script><script>unsafe'}]});
  expect(escaped.match(/<\/script>/gu)).toHaveLength(2);
  expect(escaped).toContain(String.raw`\u003c/script>`);
});
