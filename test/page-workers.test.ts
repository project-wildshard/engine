// oxlint-disable-next-line import/no-nodejs-modules -- The dry-run fixture writes and removes only its owned ./tmp directory.
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Runs the pinned wrangler binary for its offline --dry-run.
import { execFile } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Paths for the owned fixture.
import { join, resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Promise form of execFile.
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { unstable_readConfig } from 'wrangler';
import worker, { DOCTOR, type Env } from '../pages/worker.ts';

// OFF-VERCEL OV1 (J272): one wrangler.jsonc, three Workers. Production is the top level; staging and preview are envs.
// Production is always named with `--env ''`: without it wrangler warns that more than one environment is defined.
const CONFIG = resolve('pages/wrangler.jsonc');
const WORKERS = { production: 'wildshard-play', staging: 'wildshard-play-staging', preview: 'wildshard-play-preview' } as const;
// The account's other Workers (PACKS-CDN, voice ICE, API-CF, WWW-CF): a channel must never deploy over one of them.
const TAKEN = ['wildshard-packs', 'wildshard-voice-ice', 'wildshard-api', 'wildshard-www'];
const ENVS = Object.keys(WORKERS) as (keyof typeof WORKERS)[];

function read(channel: keyof typeof WORKERS): ReturnType<typeof unstable_readConfig> {
  return unstable_readConfig({ config: CONFIG, ...(channel === 'production' ? {} : { env: channel }) });
}

test('three channel Workers, none named like another Worker on the account', () => {
  const names = ENVS.map(channel => read(channel).name);
  expect(names).toEqual(ENVS.map(channel => WORKERS[channel]));
  expect(new Set(names).size).toBe(3);
  for (const name of names) expect(TAKEN).not.toContain(name);
});

test('every channel serves dist with 404s, version URLs and no workers.dev or custom domain', () => {
  for (const channel of ENVS) {
    const config = read(channel);
    expect(config.main).toBe(resolve('pages/worker.ts'));
    expect(config.assets).toMatchObject({ directory: '../dist', binding: 'ASSETS', not_found_handling: 'none', run_worker_first: ['/', '/index.html'] });
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(true);
    expect(config.routes ?? []).toEqual([]);
    expect(config.route).toBeUndefined();
  }
});

test('wrangler deploy --dry-run passes for all three channels', async () => {
  mkdirSync(resolve('tmp'), { recursive: true });
  const root = mkdtempSync(resolve('tmp/page-workers-'));
  try {
    mkdirSync(join(root, 'pages'));
    mkdirSync(join(root, 'dist'));
    for (const file of ['wrangler.jsonc', 'worker.ts']) copyFileSync(resolve('pages', file), join(root, 'pages', file));
    writeFileSync(join(root, 'dist', 'index.html'), '<!doctype html>');
    const wrangler = resolve('node_modules/.bin/wrangler');
    const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: join(root, 'logs'), CLOUDFLARE_API_TOKEN: '', CI: '1' };
    const runs = await Promise.all(ENVS.map(channel => promisify(execFile)(wrangler,
      ['deploy', '--dry-run', '--env', channel === 'production' ? '' : channel], { cwd: join(root, 'pages'), env })));
    for (const { stdout, stderr } of runs) {
      expect(stdout).toContain('Read 1 file from the assets directory');
      expect(stdout).toContain('env.ASSETS');
      expect(stdout).toContain('--dry-run: exiting now.');
      expect(`${stdout}\n${stderr}`).not.toMatch(/warn|unexpected field/iu);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);

function assets(seen: string[]): Env {
  return { ASSETS: { fetch: request => {
    seen.push(new URL(request.url).pathname);
    return Promise.resolve(new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=0, must-revalidate', etag: '"page"' } }));
  } } };
}

test('?doctor on the page goes 302 to the doctor without the service worker', async () => {
  for (const path of ['/?doctor', '/?doctor=1', '/index.html?doctor', '/?x=1&doctor']) {
    const seen: string[] = [];
    const response = await worker.fetch(new Request(`https://play.wildshard.io${path}`), assets(seen));
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(DOCTOR);
    expect(DOCTOR).toBe('/doctor/?sw=0');
    expect(seen).toEqual([]);
  }
});

test('the page comes from the assets with no-store, /index.html as /', async () => {
  for (const path of ['/', '/index.html', '/?shard=pine']) {
    const seen: string[] = [];
    const response = await worker.fetch(new Request(`https://play.wildshard.io${path}`), assets(seen));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBe('text/html');
    expect(response.headers.get('etag')).toBe('"page"');
    expect(await response.text()).toBe('<!doctype html>');
    expect(seen).toEqual(['/']);
  }
});
