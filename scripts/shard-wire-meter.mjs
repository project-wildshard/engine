#!/usr/bin/env node
// SHARD-SIZE: what a player really downloads, measured on the socket. A counting HTTP proxy sits between a fresh Chromium
// profile and a served build (or production), so page, worker and service-worker traffic all count, on the bytes actually
// sent. It enters one shard as a player does, with Hold at loading screen on, and stops when the network has gone quiet.
// budgets/shard-size-baseline.json's numbers came from this; its `method` says how to redo them from the baseline commit.
//
//   node scripts/shard-wire-meter.mjs --root <built checkout> --shard <slug> --tier phone|desktop --out <file.json>
//     [--flow select|grid] [--upstream https://play.wildshard.io] [--settle ms] [--timeout ms] [--shot file.jpg]
//     [--last <slug>]   a returning player whose last pick was <slug>, with nothing stored yet
//     [--dwell ms]      time on the title before the tap
//     [--card n]        enter the deck's nth card instead of --shard's benchmark card (PAGE-SIZE PZ7 meters every card)
// byClass splits S1 shardfiles into `S1-packs` (blobs/pack/) and `S1-loose` (the other blobs) for PZ7. The browser
// profile lives in the root's tmp/wire-meter, never the system temp folder.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';

const { values: o } = parseArgs({ options: { root: { type: 'string' }, shard: { type: 'string' }, card: { type: 'string' }, tier: { type: 'string', default: 'phone' }, flow: { type: 'string', default: 'select' },
  out: { type: 'string' }, upstream: { type: 'string' }, settle: { type: 'string', default: '20000' }, timeout: { type: 'string', default: '420000' }, shot: { type: 'string' }, last: { type: 'string' }, dwell: { type: 'string', default: '3000' } } });
const require = createRequire(join(o.root, 'package.json'));
const { chromium, devices } = require('playwright');
const { developerSettings, saveFixture } = await import(pathToFileURL(join(o.root, 'scripts/debug-settings.mjs')).href);

const free = () => new Promise(resolve => { const s = http.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
let server, upstream = o.upstream;
if (upstream === undefined) {
  const port = await free();
  server = spawn('node', ['scripts/preview-server.mjs', '--port', String(port), '--root', o.root], { cwd: o.root, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => { server.stdout.on('data', d => { if (String(d).includes(`:${port}/`)) resolve(); }); server.once('exit', c => reject(new Error(`preview exited ${c}`))); });
  upstream = `http://127.0.0.1:${port}`;
}
const up = new URL(upstream), client = up.protocol === 'https:' ? https : http;
const agent = new client.Agent({ keepAlive: true, maxSockets: 32 });
const rows = []; let lastAt = Date.now(), inflight = 0, stage = 'title';
const proxy = http.createServer((req, res) => {
  const headers = { ...req.headers, host: up.host }; delete headers.origin; delete headers.referer;
  const row = { url: req.url, stage, at: Date.now(), status: 0, encoding: '', wire: 0, raw: null, type: '' };
  rows.push(row); inflight++; lastAt = Date.now();
  const forward = client.request({ hostname: up.hostname, port: up.port, path: req.url, method: req.method, headers, agent }, answer => {
    row.status = answer.statusCode; row.encoding = answer.headers['content-encoding'] ?? ''; row.type = answer.headers['content-type'] ?? '';
    const cleaned = { ...answer.headers }; res.writeHead(answer.statusCode, cleaned);
    answer.on('data', chunk => { row.wire += chunk.length; lastAt = Date.now(); res.write(chunk); });
    answer.on('end', () => { res.end(); inflight--; lastAt = Date.now(); });
    answer.on('error', () => { res.destroy(); inflight--; });
  });
  forward.on('error', () => { res.destroy(); inflight--; });
  req.pipe(forward);
});
const port = await free();
await new Promise(resolve => { proxy.listen(port, '127.0.0.1', resolve); });
const url = `http://127.0.0.1:${port}/`;

mkdirSync(join(o.root, 'tmp/wire-meter'), { recursive: true });
const profile = mkdtempSync(join(o.root, 'tmp/wire-meter/profile-'));
const context = await chromium.launchPersistentContext(profile, { headless: true, args: [...KEYCHAIN_ARGS, ...process.platform === 'darwin' ? ['--use-angle=metal'] : [], '--ignore-gpu-blocklist', '--mute-audio'],
  ...(o.tier === 'phone' ? devices['iPhone 16 Pro'] : { viewport: { width: 1440, height: 900 } }) });
await developerSettings(context, { volume: 0, music: 0, tier: o.tier, holdLoading: true });
// The slot's first version held the bare slug; the game migrates it, so this needs no knowledge of the current shape.
if (o.last !== undefined) await saveFixture(context, { scope: 'device', key: 'titlePrefetch', data: o.last });
const page = context.pages()[0] ?? await context.newPage();
const errors = [], timeout = Number(o.timeout);
page.on('pageerror', e => errors.push(e.message.slice(0, 200)));
const result = { shard: o.shard, tier: o.tier, url: upstream, build: null, fact: null, bar: null, stoppedOn: null };
const summary = () => {
  const sum = list => list.reduce((n, r) => n + r.wire, 0), byStage = {}, byClass = {};
  const klass = u => u.startsWith('/assets/spawn/parts/') ? 'spawn-parts' : /\/shardfiles\/[^/]+\/blobs\/pack\//.test(u) ? 'S1-packs'
    : /\/shardfiles\/[^/]+\/blobs\//.test(u) ? 'S1-loose' : /\/shardfiles\//.test(u) ? 'shardfiles' : /\/assets\/packs\//.test(u) ? 'legacy-packs'
    : u.startsWith('/assets/spawn/') ? 'manifests' : u.startsWith('/b/') || /\.(?:js|mjs|css|html)(?:\?|$)/.test(u) || u === '/' ? 'app' : /\/assets\//.test(u) ? 'assets' : 'other';
  for (const r of rows) { byStage[r.stage] = (byStage[r.stage] ?? 0) + r.wire; const k = klass(r.url); byClass[k] = (byClass[k] ?? 0) + r.wire; }
  return { requests: rows.length, wireBytes: sum(rows), byStage, byClass };
};
try {
  await page.goto(url, { waitUntil: 'commit', timeout });
  result.build = await page.evaluate(() => fetch('/version.json').then(r => r.json()).then(v => v.build ?? v.sha ?? null)).catch(() => null);
  await page.locator('.ws-main-select').waitFor({ timeout });
  await page.waitForTimeout(Number(o.dwell));
  // a first visit names its player before the deck or the grid opens
  const named = async () => {
    if (await page.locator('#ws-name-box input').waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)) {
      await page.locator('#ws-name-box input').fill('wiremeter'); await page.locator('#ws-name-box button[type=submit]').click();
    }
  };
  if (o.flow === 'grid') { stage = 'entry'; await page.locator('.ws-main-grid').click({ timeout }); await named(); }
  else {
  await page.locator('.ws-main-select').click({ timeout });
  await named();
  await page.locator('.ws-menu-card').first().waitFor({ timeout });
  const titles = await page.locator('.ws-menu-card b').allTextContents();
  let index;
  if (o.card !== undefined) index = Number(o.card);
  else { const { loadingCardIndex } = await import(pathToFileURL(join(o.root, 'scripts/loading-benchmark/catalogue.mjs')).href); index = loadingCardIndex(titles, o.shard); }
  result.card = { index, title: titles[index] ?? null, of: titles.length };
  // the dots are positional (no data-i on them since the deck redesign); the card keeps its data-i
  await page.locator('.ws-menu-dots i').nth(index).click();
  await page.locator(`.ws-menu-card.selected[data-i="${index}"]`).waitFor({ timeout });
  stage = 'entry';
  const explicit = page.locator('.ws-menu-shardfile');
  await (await explicit.isVisible() ? explicit : page.locator('.ws-menu-play')).click({ timeout });
  }
  const started = Date.now(), settle = Number(o.settle);
  for (;;) {
    await page.waitForTimeout(1000);
    const facts = await page.evaluate(() => ({ fact: document.querySelector('[data-el="dlFact"]')?.textContent ?? null,
      bar: document.querySelector('[data-el="dlPct"],[data-el="pct"]')?.textContent ?? null })).catch(() => ({}));
    if (facts.fact) result.fact = facts.fact; if (facts.bar) result.bar = facts.bar;
    const idle = inflight === 0 && Date.now() - lastAt >= settle;
    if (idle) { result.stoppedOn = 'network idle'; break; }
    if (Date.now() - started > timeout) { result.stoppedOn = 'timeout'; break; }
  }
  if (o.shot) await page.screenshot({ path: o.shot, type: 'jpeg', quality: 70, timeout: 10000 }).catch((/** @type {unknown} */ error) => { errors.push(String(error).slice(0, 200)); });
} catch (error) { result.stoppedOn = `error: ${String(error).slice(0, 300)}`; }
Object.assign(result, summary(), { errors: errors.slice(0, 5), rows: rows.map(r => ({ u: r.url.slice(0, 120), s: r.stage, c: r.status, e: r.encoding, w: r.wire })) });
writeFileSync(o.out, JSON.stringify(result));
const { rows: _, ...print } = result; console.log(JSON.stringify(print));
await context.close().catch((/** @type {unknown} */ error) => { console.warn(String(error)); }); proxy.close(); proxy.closeAllConnections?.(); server?.kill('SIGTERM'); rmSync(profile, { recursive: true, force: true }); process.exit(0);
