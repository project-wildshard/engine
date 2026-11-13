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
import worker, { type Env } from '../pages/worker.ts';


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
    expect(config.assets).toMatchObject({ directory: '../dist', binding: 'ASSETS', not_found_handling: 'none', run_worker_first: ['/', '/index.html', '/slug/*', '/assets/spawn/parts/*', '/assets/spawn/server/*'] });
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
    for (const file of ['wrangler.jsonc', 'worker.ts', 'slug-meta.ts']) copyFileSync(resolve('pages', file), join(root, 'pages', file));
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

test('?doctor on the page goes 307 to the doctor without the service worker, as the old host did', async () => {
  // Play's answers, 11-11: the query stays as written, any sw goes, sw=0 comes last.
  const want: Record<string, string> = { '/?doctor': '/doctor/?doctor&sw=0', '/?doctor=1': '/doctor/?doctor=1&sw=0',
    '/index.html?doctor': '/doctor/?doctor&sw=0', '/?x=1&doctor': '/doctor/?x=1&doctor&sw=0', '/?doctor&sw=1': '/doctor/?doctor&sw=0' };
  for (const path of Object.keys(want)) {
    const seen: string[] = [];
    const response = await worker.fetch(new Request(`https://play.wildshard.io${path}`), assets(seen));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(want[path]);
    expect(seen).toEqual([]);
  }
});

test('the page comes from the assets with no-store, /index.html as /', async () => {
  for (const path of ['/', '/index.html', '/?shard=pine']) {
    const seen: string[] = [];
    const response = await worker.fetch(new Request(`https://play.wildshard.io${path}`), assets(seen));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8'); // OV6: what the old host sent; the edge's assets drop the charset
    expect(response.headers.get('etag')).toBe('"page"');
    expect(await response.text()).toBe('<!doctype html>');
    expect(seen).toEqual(['/']);
  }
});

// AUDIO AU4 (J299): the miss keeps the assets' status and body, but never their long cache: it leaves no-store.
test('a missing file reaches the Worker and goes back as the assets\' 404 with no-store, ?doctor or not', async () => {
  for (const path of ['/b/gone/main-x.js', '/b/gone/main-x.js?doctor', '/doctor']) {
    const seen: string[] = [];
    const env: Env = { ASSETS: { fetch: request => {
      seen.push(new URL(request.url).pathname);
      return Promise.resolve(new Response('gone', { status: 404, headers: { 'cache-control': 'public, max-age=31536000, immutable' } }));
    } } };
    const response = await worker.fetch(new Request(`https://play.wildshard.io${path}`), env);
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('gone');
    expect(seen).toEqual([new URL(path, 'https://x').pathname]);
  }
});

// OV2: `_headers` can't send a stored .pack.br as is (the runtime brotlis it again), so the Worker adds the encoding.
test('a spawn part keeps the assets\' headers and gains Content-Encoding: br; anything else under spawn is untouched', async () => {
  const stored = new Uint8Array([11, 22, 33]);
  const env = (status: number): Env => ({ ASSETS: { fetch: () => Promise.resolve(new Response(status === 200 ? stored : null,
    { status, headers: { 'content-type': 'application/octet-stream', 'cache-control': 'public, max-age=31536000, immutable', etag: '"p"' } })) } });
  for (const path of ['/assets/spawn/parts/0123456789abcdef.pack.br', '/assets/spawn/server/0123456789abcdef.pack.br']) {
    const response = await worker.fetch(new Request(`https://play.wildshard.io${path}`), env(200));
    expect([response.status, response.headers.get('content-encoding'), response.headers.get('cache-control'), response.headers.get('etag')])
      .toEqual([200, 'br', 'public, max-age=31536000, immutable', '"p"']);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(stored);
    for (const status of [304, 404]) {
      const other = await worker.fetch(new Request(`https://play.wildshard.io${path}`), env(status));
      // AU4: a 304 keeps the part's long cache; a 404 leaves no-store.
      expect([other.status, other.headers.get('content-encoding'), other.headers.get('cache-control')])
        .toEqual([status, null, status === 304 ? 'public, max-age=31536000, immutable' : 'no-store']);
    }
  }
  for (const path of ['/assets/spawn/parts/readme.txt', '/assets/spawn/server/0123.json']) {
    const response = await worker.fetch(new Request(`https://play.wildshard.io${path}`), env(200));
    expect(response.headers.get('content-encoding'), path).toBeNull();
  }
});

// SA37: every host serves the page for /slug/<slug>, with the link-preview tags from the catalogue the page carries; a slug
// that names no shard (as the client's slug page reads the same rows) is a 404.
const ROWS = [
  { slug: 'driftwood-isle', name: 'Driftwood Isle', biome: 'Castaway island & reef', card: { thumb: '/shardfiles/driftwood-isle/t.jpg', portrait: '/shardfiles/driftwood-isle/p.jpg', landscape: '/shardfiles/driftwood-isle/blobs/image/land.jpg' } },
  { slug: 'sky-reach', name: 'Far "Reach"', biome: '', card: { thumb: 'x', portrait: 'x', landscape: 'https://packs.wildshard.io/shardfiles/sky-reach/l.jpg' } },
  { slug: '_template', name: 'Template shard', biome: 'Template.', card: { thumb: 'x', portrait: 'x', landscape: '/shardfiles/_template/l.jpg' } },
]
// late-shard: a catalogue head with a placement and no title row (the client's withCatalogueHeads card); auto-placed: SA30's grid
// cell with no placement, which the client reads as unlisted, so a 404 here too
const CATALOGUE = { placements: [{ slug: '_template' }, { slug: 'late-shard' }], grid: { cells: [{ slug: 'auto-placed' }] }, shards: [{ slug: 'late-shard', name: 'Late Shard' }, { slug: 'auto-placed', name: 'Auto Placed' }, { slug: 'off-grid', name: 'Off Grid' }] }
const json = (id: string, value: unknown): string => `<script type="application/json" id="${id}">${JSON.stringify(value).replaceAll('<', String.raw`\u003c`)}</script>`
const HTML = `<!doctype html><html><head><meta charset="UTF-8" /><title>Project Wildshard</title><link rel="apple-touch-icon" href="/icons/staging/apple-touch-icon.png">${json('ws-catalogue', CATALOGUE)}${json('ws-title-rows', ROWS)}</head><body></body></html>`
const site = (seen: string[], html = HTML): Env['ASSETS'] => ({ fetch: request => {
  const path = new URL(request.url).pathname
  seen.push(path)
  return Promise.resolve(path === '/' ? new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }) : new Response('gone', { status: 404 }))
} })
const og = (html: string): Record<string, string> => Object.fromEntries([...html.matchAll(/<meta property="og:(\w+)" content="([^"]*)">/gu)].map(([, key = '', value = '']) => [key, value]))

test('no host gates /slug: the config sets no vars', () => {
  for (const channel of ENVS) expect(read(channel).vars).toEqual({})
})

test('every host serves /slug/<slug> as the page, with og:title, og:description and og:image from the catalogue', async () => {
  for (const host of ['play.wildshard.io', 'staging.wildshard.io', 'preview.wildshard.io']) {
    for (const path of ['/slug/driftwood-isle', '/slug/driftwood-isle/', '/slug/driftwood-isle?x=1']) {
      const seen: string[] = []
      const response = await worker.fetch(new Request(`https://${host}${path}`), { ASSETS: site(seen) })
      const html = await response.text()
      expect([response.status, response.headers.get('cache-control'), response.headers.get('content-type')]).toEqual([200, 'no-store', 'text/html; charset=utf-8'])
      expect(seen).toEqual(['/'])
      expect(og(html)).toEqual({ type: 'website', site_name: 'Wildshard', title: 'Driftwood Isle', description: 'Castaway island &amp; reef. Play it in your browser on Wildshard.',
        image: `https://${host}/shardfiles/driftwood-isle/blobs/image/land.jpg`, url: `https://${host}/slug/driftwood-isle` })
      expect(html).toContain('<meta name="twitter:card" content="summary_large_image">')
      expect(html).toContain('<title>Driftwood Isle · Wildshard</title>')
      // the tags sit in the head, before the page's own scripts
      expect(html.indexOf('og:title')).toBeLessThan(html.indexOf('ws-title-rows'))
    }
  }
})

test('og:image is absolute: an R2 card stays as written, and a content base moves page art onto it', async () => {
  const sky = await (await worker.fetch(new Request('https://play.wildshard.io/slug/sky-reach'), { ASSETS: site([]) })).text()
  expect(og(sky)).toMatchObject({ title: 'Far &quot;Reach&quot;', image: 'https://packs.wildshard.io/shardfiles/sky-reach/l.jpg', description: 'A shard on the Wildshard grid. Tap to play in your browser.' })
  const based = HTML.replace('</head>', `${json('boot-module-files', { contentBase: 'https://packs.wildshard.io/content/abc/' })}</head>`)
  const drift = await (await worker.fetch(new Request('https://play.wildshard.io/slug/driftwood-isle'), { ASSETS: site([], based) })).text()
  expect(og(drift)['image']).toBe('https://packs.wildshard.io/content/abc/shardfiles/driftwood-isle/blobs/image/land.jpg')
  const template = await (await worker.fetch(new Request('https://play.wildshard.io/slug/_template'), { ASSETS: site([]) })).text()
  expect(og(template)).toMatchObject({ title: 'Template shard', description: 'Template. Play it in your browser on Wildshard.' })
})

test('a shard the catalogue added after the build unfurls with its catalogue name and the site icon', async () => {
  const response = await worker.fetch(new Request('https://staging.wildshard.io/slug/late-shard'), { ASSETS: site([]) })
  expect(response.status).toBe(200)
  expect(og(await response.text())).toMatchObject({ title: 'Late Shard', image: 'https://staging.wildshard.io/icons/staging/apple-touch-icon.png' })
})

test('HEAD and a conditional request see the same answer as GET', async () => {
  const head = await worker.fetch(new Request('https://play.wildshard.io/slug/driftwood-isle', { method: 'HEAD' }), { ASSETS: site([]) })
  expect([head.status, head.headers.get('content-type'), head.headers.get('etag')]).toEqual([200, 'text/html; charset=utf-8', null])
  expect((await worker.fetch(new Request('https://play.wildshard.io/slug/no-such-shard', { method: 'HEAD' }), { ASSETS: site([]) })).status).toBe(404)
  const seen: Request[] = []
  const conditional: Env['ASSETS'] = { fetch: request => { seen.push(request); return request.headers.has('if-none-match') ? Promise.resolve(new Response(null, { status: 304 })) : site([]).fetch(request) } }
  expect((await worker.fetch(new Request('https://play.wildshard.io/slug/no-such-shard', { headers: { 'if-none-match': '"x"' } }), { ASSETS: conditional })).status).toBe(404)
  expect(seen.map(request => request.method)).toEqual(['GET'])
})

test('an unknown slug answers 404 with no-store from the Worker; other paths are left to the assets', async () => {
  // off-grid: a catalogue head nothing holds; auto-placed: SA30's grid cell with no placement; template: `_template`'s bare slug
  for (const path of ['/slug/no-such-shard', '/slug/off-grid', '/slug/auto-placed', '/slug/template', '/slug/Driftwood-Isle']) {
    const response = await worker.fetch(new Request(`https://play.wildshard.io${path}`), { ASSETS: site([]) })
    expect([response.status, response.headers.get('cache-control')], path).toEqual([404, 'no-store'])
    expect(await response.text()).not.toContain('<html')
  }
  for (const path of ['/slug/', '/slug/a/b', '/slugs/driftwood-isle']) {
    const seen: string[] = []
    expect((await worker.fetch(new Request(`https://play.wildshard.io${path}`), { ASSETS: site(seen) })).status, path).toBe(404)
    expect(seen, path).toEqual([path])
  }
})

test('?doctor on a slug link still goes to the doctor', async () => {
  const response = await worker.fetch(new Request('https://play.wildshard.io/slug/driftwood-isle?doctor'), { ASSETS: site([]) })
  expect([response.status, response.headers.get('location')]).toEqual([307, '/doctor/?doctor&sw=0'])
})
