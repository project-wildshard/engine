import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Real owned preview processes and fixture files.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths stay in the managed test scratch root.
import { join, resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The child loads only the owned recording preload.
import { pathToFileURL } from 'node:url';
import { previewReady, serve } from '../scripts/parity/serve.mjs';

test('parallel shot hosts request port zero and return their actual distinct listeners', async () => {
  const base = resolve(process.env['VITEST_TMP_ROOT'] ?? 'tmp/codex-pagesize', 'preview-ephemeral');
  mkdirSync(base, { recursive: true });
  const work = mkdtempSync(join(base, 'pair-')), requests = join(work, 'requests.log');
  const preload = join(work, 'record.mjs');
  writeFileSync(preload, `import {appendFileSync} from 'node:fs';
if(process.argv[1]?.endsWith('/preview-server.mjs'))appendFileSync(process.env.WS_PREVIEW_REQUESTS,process.argv[process.argv.indexOf('--port')+1]+'\\n');`);
  const previous = { NODE_OPTIONS: process.env['NODE_OPTIONS'], WS_PREVIEW_REQUESTS: process.env['WS_PREVIEW_REQUESTS'] };
  process.env['NODE_OPTIONS'] = `${previous.NODE_OPTIONS ?? ''} --import=${pathToFileURL(preload).href}`;
  process.env['WS_PREVIEW_REQUESTS'] = requests;
  const hosts: Awaited<ReturnType<typeof serve>>[] = [];
  try {
    const starts = await Promise.allSettled(['first', 'second'].map(async name => {
      const root = join(work, name); mkdirSync(join(root, 'dist'), { recursive: true });
      writeFileSync(join(root, 'dist/version.json'), JSON.stringify({ build: name }));
      return serve(root, name, true, { telemetryDir: join(root, 'telemetry') });
    }));
    for (const result of starts) if (result.status === 'fulfilled') hosts.push(result.value);
    expect(starts.every(result => result.status === 'fulfilled')).toBe(true);
    expect(new Set(hosts.map(host => host.url)).size).toBe(2);
    for (const [index, host] of hosts.entries()) {
      expect(Number(new URL(host.url).port)).toBeGreaterThan(0);
      const response = await fetch(`${host.url}/version.json`);
      expect(await response.json()).toEqual({ build: index === 0 ? 'first' : 'second' });
    }
    expect(readFileSync(requests, 'utf8').trim().split('\n').map(Number)).toEqual([0, 0]);
  } finally {
    for (const host of hosts) host.close();
    await Promise.all(hosts.map(host => host.closed));
    for (const host of hosts) expect(await previewReady(`${host.url}/version.json`, 200)).toBe(false);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(work, { recursive: true, force: true });
  }
}, 15_000);

test('the proof preview acknowledges POST error reports when enabled', async () => {
  const base = resolve(process.env['VITEST_TMP_ROOT'] ?? 'tmp/codex-pagesize', 'preview-ephemeral');
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, 'error-report-'));
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'dist/index.html'), 'fixture');
  // serve() waits for /version.json, as every real build has; a missing file is a 404 now, never the page (meta QA 11-22 row 10)
  writeFileSync(join(root, 'dist/version.json'), '{"build":"fixture"}');
  try {
    for (const errorReports of [false, true]) {
      const host = await serve(root, '', true, { errorReports });
      try {
        const post = { method: 'POST', body: '{"system":"boot.slow"}' };
        expect((await fetch(new URL('/api/errors', host.url), post)).status).toBe(errorReports ? 204 : 405);
        expect((await fetch(new URL('/api/other', host.url), post)).status).toBe(405);
      } finally { host.close(); await host.closed; }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 15_000);
