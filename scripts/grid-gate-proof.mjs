#!/usr/bin/env node
// GO4 on the rooms address: the grid page's gate, in a real browser, behind a front door that keeps `/health` private as D7 and
// MS5.1's Caddy do (every plain HTTP request a 404 with no CORS; only the socket upgrade passes). The server runs WORLD_CELLS=grid
// over Driftwood and the template, and the page must still learn the world hosts the grid: Shard select opens the deck, the template
// card enters the grid at its cell, and the page boots past the loading card's `server` step on the world.
//   scripts/browser-lane.sh node scripts/grid-gate-proof.mjs <app dist stamped with http://127.0.0.1:18799/release.json> <work dir> <key.json>
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { join, resolve as absolute } from 'node:path';
import { chromium, devices } from 'playwright';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';
import { openRig, WORLD_PORT } from './online-rig.mjs';

const [dist = '', relativeWork = ''] = process.argv.slice(2), work = relativeWork === '' ? '' : absolute(relativeWork), keyFile = process.argv[4] ?? '';
if (dist === '' || work === '' || keyFile === '') throw new Error('usage: grid-gate-proof.mjs <dist> <work> <key.json>');
const DOOR_PORT = 18795, shots = join(work, 'shots');
mkdirSync(shots, { recursive: true });
/** @type {{ step: string, ok: boolean, detail?: unknown }[]} */
const steps = [];
/** @param {string} step @param {boolean} ok @param {unknown} [detail] */
const note = (step, ok, detail) => { steps.push({ step, ok, ...detail === undefined ? {} : { detail } }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}${detail === undefined ? '' : ` ${JSON.stringify(detail).slice(0, 300)}`}`); };

// The rooms front door: an upgrade goes through to the world, and anything else is a bare 404, `/health` included.
const door = createServer((_request, response) => { response.writeHead(404, { 'content-length': '0' }).end(); });
door.on('upgrade', (request, socket, head) => {
  const upstream = connect(WORLD_PORT, '127.0.0.1', () => {
    const lines = [`${request.method ?? 'GET'} ${request.url ?? '/'} HTTP/1.1`];
    for (let index = 0; index < request.rawHeaders.length; index += 2) lines.push(`${request.rawHeaders[index] ?? ''}: ${request.rawHeaders[index + 1] ?? ''}`);
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`); upstream.write(head); socket.pipe(upstream); upstream.pipe(socket);
  });
  upstream.on('error', () => { socket.destroy(); }); socket.on('error', () => { upstream.destroy(); });
});
await new Promise(resolve => { door.listen(DOOR_PORT, '127.0.0.1', () => { resolve(null); }); });

const rig = await openRig({ dist, work, keyFile, pgBin: 'memory:', pgData: '', shard: 'driftwood-isle', more: ['_template'], cells: 'grid', socket: `ws://127.0.0.1:${String(DOOR_PORT)}/` });
let code = 1, browser = /** @type {import('playwright').Browser | null} */ (null);
try {
  browser = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  let open = null;
  for (let tries = 0; tries < 300 && open === null; tries++) { open = await fetch(`http://127.0.0.1:${String(WORLD_PORT)}/health`).then(found => found.ok ? found.json() : null).catch(() => null); if (open === null) await new Promise(resolve => { setTimeout(resolve, 200); }); }
  note('the world runs the grid (loopback /health, which the page never sees)', open !== null && open.cells > 1, { cells: open?.cells });
  if (open === null) throw new Error(`The world did not start: see ${join(work, 'server.log')}`);
  const shut = await fetch(`http://127.0.0.1:${String(DOOR_PORT)}/health`);
  note('the front door keeps /health private: 404, no CORS', shut.status === 404 && shut.headers.get('access-control-allow-origin') === null, { status: shut.status });

  const { defaultBrowserType: _engine, ...phone } = devices['iPhone 16 Pro'];
  const context = await browser.newContext(phone), page = await context.newPage(), errors = /** @type {string[]} */ ([]), stepsSeen = new Set();
  page.on('pageerror', error => { errors.push(error.message.slice(0, 240)); });
  // MG5: a phone's first PLAY skips the deck by design; a returning device opens it.
  await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
  // The template card is Developer's (its placement is hidden in the public catalogue), as in online-rig's pages.
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  await page.goto(`${rig.base}/?mute=1&nolock=1`, { waitUntil: 'load' });
  await page.locator('.ws-main').waitFor({ state: 'visible', timeout: 120_000 }).catch(async () => { await page.screenshot({ path: join(shots, 'no-title.png') }); });
  await page.locator('.ws-main-select').click({ timeout: 60_000 });
  await page.locator('.ws-menu-card').first().waitFor({ state: 'visible', timeout: 30_000 });
  note('Shard select opens the deck', true);
  const index = await page.evaluate(() => [...document.querySelectorAll('.ws-menu-card')].findIndex(card => /template/iu.test(card.textContent ?? '')));
  note('the deck holds the template card', index >= 0, { index, cards: index >= 0 ? undefined : await page.evaluate(() => [...document.querySelectorAll('.ws-menu-card')].map(card => card.textContent)) });
  if (index < 0) throw new Error('No template card');
  await page.locator(`.ws-menu-card[data-i="${String(index)}"]`).click();
  await page.locator('.ws-menu-play').click();
  // The guest's Name is asked once the page goes online; a page that stayed solo never asks.
  const named = await page.locator('#ws-name-box input').waitFor({ timeout: 150_000 }).then(() => true).catch(() => false);
  note('the grid page goes online and asks a Name', named);
  if (named) { await page.locator('#ws-name-box input').fill('Gate'); await page.locator('#ws-name-box button[type=submit]').click(); }
  const watch = setInterval(() => { void (async () => { const step = await page.evaluate(() => { const card = document.querySelector('.ws-load'); return card instanceof HTMLElement ? card.dataset.step ?? '' : ''; }).catch(() => ''); if (step !== '') stepsSeen.add(step); })(); }, 100);
  const played = await page.waitForFunction(() => typeof window.__workerClient === 'function' && window.__workerClient().frames > 30, undefined, { timeout: 150_000 }).then(() => true).catch(() => false);
  clearInterval(watch);
  const where = await page.evaluate(() => { const state = /** @type {{ inside: string | null, cells: { instance: string, slug: string }[] }} */ (/** @type {{ state: () => unknown }} */ (window.__wildshard.shard.grid).state()); return { url: location.search, level: window.__wildshard.world?.game.level.id, inside: state.inside, slug: state.cells.find(cell => cell.instance === state.inside)?.slug, own: window.__workerClient?.().own }; }).catch((/** @type {unknown} */ error) => ({ error: String(error) }));
  note('the template boots past `server` on the world: frames from the server', played, { steps: [...stepsSeen], ...where });
  note('it is a grid page on the world, not the solo grid', 'level' in where && where.level === 'platform.grid' && played, where);
  // Not this proof's gate: which cell the template card aims at is GO7's pick. With a Developer deck it names the hidden template
  // placement, which WORLD_CELLS=grid doesn't open, so the door seats the player in Driftwood (2026-11-11, opus-gridgate's receipt).
  console.log(`info the seat's cell: ${'slug' in where ? String(where.slug) : '?'} (the template card's cell is GO7's follow-up)`);
  await page.screenshot({ path: join(shots, 'template-online.png') });
  note('no page errors', errors.length === 0, errors);
  code = steps.every(step => step.ok) ? 0 : 1;
} finally {
  writeFileSync(join(work, 'grid-gate-proof.json'), `${JSON.stringify({ steps, code }, null, 2)}\n`);
  await browser?.close(); await rig.close(); door.close();
}
console.log(code === 0 ? 'grid-gate proof: PASS' : 'grid-gate proof: FAIL');
process.exit(code);
