import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Real owned preview processes and fixture files.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths stay in the managed test scratch root.
import { join, resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The child loads only the owned recording preload.
import { pathToFileURL } from 'node:url';
import { previewReady, serve } from '../../scripts/parity/serve.mjs';

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
