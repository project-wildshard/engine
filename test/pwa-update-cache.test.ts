// oxlint-disable-next-line import/no-nodejs-modules -- The preview fixture writes and removes only its owned ./tmp directory.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Paths for the owned static HTTP fixture.
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { serviceWorkerCore, workerScripts } from '../scripts/app-build/serviceWorker';
import { previewServer } from './fixtures/preview-server';

test('worker bootstrap names exact core bytes and changes for same-length edits', () => {
  const first = workerScripts('self.version = "first";'), next = workerScripts('self.version = "other";');
  expect(first.fileName).toMatch(/^sw-core\/[a-f0-9]{64}\.js$/u);
  expect(first.bootstrap).toBe(`importScripts("/${first.fileName}");\n`);
  expect(new TextEncoder().encode(first.bootstrap).length).toBeLessThan(1024);
  expect(next.fileName).not.toBe(first.fileName);
  expect(next.bootstrap).not.toBe(first.bootstrap);
  expect(workerScripts('self.version = "first";')).toEqual(first);
});

test('the plain emitter stamps the real worker without a boot bank or code-pack input', () => {
  const document = { type: 'asset' as const, source: new TextEncoder().encode('<html><head></head></html>') };
  const bundle = { 'index.html': document, 'assets/app-aaaaaaaa.js': { type: 'chunk' as const, code: 'export const value=1;' } };
  const first = serviceWorkerCore(bundle, process.cwd(), 'fixture');
  const next = serviceWorkerCore({ ...bundle, 'assets/app-aaaaaaaa.js': { type: 'chunk', code: 'export const value=2;' } }, process.cwd(), 'fixture');
  expect(first.hashed).toEqual(['/assets/app-aaaaaaaa.js']);
  expect(first.assets).toBe('ws-assets-v1'); expect(first.build).toMatch(/^fixture-[a-f0-9]{10}$/u);
  expect(first.core).not.toContain('import { workerScope'); expect(first.core).not.toContain('__BUILD_ID__');
  expect(first.core).not.toContain('__SHELL_FILES__'); expect(first.core).not.toContain('__FILES__');
  expect(first.core).not.toContain('__DOCUMENT__');
  expect(first.core).toContain(`const DOCUMENT = ${JSON.stringify(new TextDecoder().decode(document.source))};`);
  expect(first.core).not.toContain('PREPARE_CODE_PACK'); expect(first.core).not.toContain('server-timing');
  expect(next.build).not.toBe(first.build); expect(workerScripts(next.core).fileName).not.toBe(workerScripts(first.core).fileName);
});

test('a build precaches its server book, and a new book is a new worker', () => {
  const bundle = { 'index.html': { type: 'asset' as const, source: new TextEncoder().encode('<html><head></head></html>') } };
  const url = '/assets/spawn/server-fixture.json', bytes = new TextEncoder().encode('{"book":"server"}');
  const none = serviceWorkerCore(bundle, process.cwd(), 'fixture'), first = serviceWorkerCore(bundle, process.cwd(), 'fixture', { url, bytes });
  expect(none.core).not.toContain(url); expect(first.core).toContain(url);
  expect(first.hashed).not.toContain(url);
  expect(serviceWorkerCore(bundle, process.cwd(), 'fixture', { url, bytes: new TextEncoder().encode('{}') }).build).not.toBe(first.build);
});

test('document bytes remain data even when they contain worker marker text', () => {
  const html = `<!doctype html><html><body>π 😀 '__FILES__' '__BUILD_ID__' '__DOCUMENT__'</body></html>`;
  const {core} = serviceWorkerCore({'index.html': {type: 'asset', source: new TextEncoder().encode(html)}}, process.cwd(), 'fixture');
  const literal = /^const DOCUMENT = (.+);$/mu.exec(core)?.[1];
  if (literal === undefined) throw new Error('Missing document literal');
  expect(JSON.parse(literal)).toBe(html);
  // No bundle file here, so the only rows left are the deck portraits a worker fetches after control.
  expect(/^const FILES = JSON\.parse\("\[(.*)\]"\);$/mu.exec(core)?.[1]?.split(',').every(row => row.includes('-portrait-'))).toBe(true);
});

test('worker updates revalidate unchanged bytes and fetch a changed script in full', async () => {
  mkdirSync(resolve('tmp'), { recursive: true });
  const root = mkdtempSync(resolve('tmp/pwa-update-'));
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'vercel.json'), readFileSync('vercel.json'));
  const file = join(root, 'dist/sw.js'), original = 'self.version = "first";';
  writeFileSync(file, original);
  const scripts = workerScripts(original);
  mkdirSync(join(root, 'dist/sw-core'));
  writeFileSync(join(root, 'dist', scripts.fileName), original);
  const server = await previewServer(root);
  try {
    const { base } = server;
    const url = new URL('sw.js', base), first = await fetch(url);
    const core = await fetch(new URL(scripts.fileName, base));
    expect(core.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(core.headers.get('vary')?.toLowerCase() ?? '').not.toContain('origin');
    expect(await core.text()).toBe(original);
    expect(first.status).toBe(200); expect(first.headers.get('cache-control')).toBe('no-cache');
    expect(await first.text()).toBe(original);
    const firstTag = first.headers.get('etag');
    if (firstTag === null) throw new Error('Worker has no revalidation tag');
    for (const origin of [undefined, 'http://localhost:4312']) {
      const headers: Record<string, string> = origin === undefined ? {} : { origin };
      const copy = await fetch(url, { headers });
      expect(copy.headers.get('vary')?.toLowerCase() ?? '').not.toContain('origin');
      expect(copy.headers.get('access-control-allow-origin')).toBe('*');
      expect(copy.headers.get('etag')).toBe(firstTag);
      expect(await copy.text()).toBe(original);
      const unchanged = await fetch(url, { headers: { ...headers, 'if-none-match': firstTag } });
      expect(unchanged.status).toBe(304); expect((await unchanged.arrayBuffer()).byteLength).toBe(0);
    }
    const changed = 'self.version = "other";';
    expect(changed.length).toBe(original.length);
    writeFileSync(file, changed);
    const update = await fetch(url, { headers: { 'if-none-match': firstTag } });
    expect(update.status).toBe(200); expect(update.headers.get('cache-control')).toBe('no-cache');
    expect(await update.text()).toBe(changed); expect(update.headers.get('etag')).not.toBe(firstTag);
    const nextTag = update.headers.get('etag');
    if (nextTag === null) throw new Error('Changed worker has no revalidation tag');
    const rechecked = await fetch(url, { headers: { 'if-none-match': nextTag } });
    expect(rechecked.status).toBe(304); expect((await rechecked.arrayBuffer()).byteLength).toBe(0);
  } finally {
    server.close(); rmSync(root, { recursive: true, force: true });
  }
}, 20_000);
