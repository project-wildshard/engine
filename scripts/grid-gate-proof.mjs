#!/usr/bin/env node
// GO4 on the rooms address: the grid page's gate, in a real browser, behind a front door that keeps `/health` private as D7 and
// MS5.1's Caddy do (every plain HTTP request a 404 with no CORS; only the socket upgrade passes). The server runs WORLD_CELLS=grid
// over Driftwood and the template, and the page must still learn the world hosts the grid: Shard select opens the deck, the Template
// shard card enters the grid at the template's cell (GO7), the page boots past the loading card's `server` step on the world and the
// player walks; then a second phone does the same from the Driftwood card and is seated in Driftwood, and a third from the Signal Dunes
// card (a client-page home, the deck's stall at loading step `home`). `--legs=` picks others: sky (Sky Reach) is a spot check. The
// Open Plots have no deck card, so none of them is ever a page's first home from Shard select.
//   scripts/browser-lane.sh node scripts/grid-gate-proof.mjs <app dist stamped with http://127.0.0.1:18799/release.json> <work dir> <key.json> [--legs=template,driftwood,dunes]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { join, resolve as absolute } from 'node:path';
import { chromium, devices } from 'playwright';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';
import { openRig, WORLD_PORT } from './online-rig.mjs';

const [dist = '', relativeWork = ''] = process.argv.slice(2), work = relativeWork === '' ? '' : absolute(relativeWork), keyFile = process.argv[4] ?? '';
if (dist === '' || work === '' || keyFile === '') throw new Error('usage: grid-gate-proof.mjs <dist> <work> <key.json>');
/** Each leg: the deck's card, and the grid slug it seats you in. Driftwood is the rig's home cell. */
const LEGS = /** @type {Record<string, { card: string, slug: string }>} */ ({
  template: { card: 'Template shard', slug: '_template' }, driftwood: { card: 'Driftwood Isle', slug: 'driftwood-isle' },
  dunes: { card: 'Signal Dunes', slug: 'sunscar-dunes' }, sky: { card: 'Sky Reach', slug: 'far-reach' },
});
const legs = (process.argv.find(arg => arg.startsWith('--legs='))?.slice(7) ?? 'template,driftwood,dunes').split(',');
for (const name of legs) if (LEGS[name] === undefined) throw new Error(`No leg ${name}: ${Object.keys(LEGS).join(', ')}`);
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

const rig = await openRig({ dist, work, keyFile, pgBin: 'memory:', pgData: '', shard: 'driftwood-isle', more: legs.map(name => LEGS[name]?.slug ?? '').filter(slug => slug !== 'driftwood-isle'), cells: 'grid', socket: `ws://127.0.0.1:${String(DOOR_PORT)}/` });
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
  /** One player on a fresh phone: Shard select → the card named `card` → Enter world, a Name, and play. The seat's cell must be `cell`.
   *  @param {import('playwright').Browser} launched @param {string} card @param {string} cell @param {string} name */
  const leg = async (launched, card, cell, name) => {
    const context = await launched.newContext(phone), page = await context.newPage(), errors = /** @type {string[]} */ ([]), stepsSeen = new Set();
    // a leg that stops still closes its phone (Codex): a failed page left open skews the legs after it
    try {
    page.on('pageerror', error => { errors.push(error.message.slice(0, 240)); });
    // the page's own console, for the leg that stops: what it waited on
    const lines = /** @type {string[]} */ ([]);
    page.on('console', line => { if (line.type() === 'warning' || line.type() === 'error') lines.push(`${line.type()} ${line.text().slice(0, 400)}`); });
    context.on('close', () => { writeFileSync(join(work, `${name}-console.log`), `${lines.join('\n')}\n`); });
    // MG5: a phone's first PLAY skips the deck by design; a returning device opens it.
    await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
    // The template card is Developer's (its placement is hidden in the public catalogue), as in online-rig's pages.
    await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
    await page.goto(`${rig.base}/?mute=1&nolock=1`, { waitUntil: 'load' });
    await page.locator('.ws-main').waitFor({ state: 'visible', timeout: 120_000 }).catch(async () => { await page.screenshot({ path: join(shots, `${name}-no-title.png`) }); });
    await page.locator('.ws-main-select').click({ timeout: 60_000 });
    // MP2.4: a fresh device's first PLAY asks its Name before SHARD SELECT opens
    const named = await page.locator('#ws-name-box input').waitFor({ timeout: 30_000 }).then(() => true).catch(() => false);
    note(`${name}: the first PLAY asks a Name`, named);
    if (named) { await page.locator('#ws-name-box input').fill(name); await page.locator('#ws-name-box button[type=submit]').click(); }
    await page.locator('.ws-menu-card').first().waitFor({ state: 'visible', timeout: 30_000 });
    note(`${name}: Shard select opens the deck`, true);
    // By the card's own name: "Blender Template" (off the grid) also says template.
    const index = await page.evaluate(wanted => [...document.querySelectorAll('.ws-menu-card')].findIndex(row => (row.textContent ?? '').includes(wanted)), card);
    const cards = index >= 0 ? undefined : await page.evaluate(() => [...document.querySelectorAll('.ws-menu-card')].map(row => (row.textContent ?? '').slice(0, 40)));
    note(`${name}: the deck holds the ${card} card`, index >= 0, { index, ...cards === undefined ? {} : { cards } });
    if (index < 0) throw new Error(`No ${card} card`);
    // The deck's dot selects a card (a tap on an off-centre card lands on the captured track, as a swipe's end).
    await page.locator('.ws-menu-dots i').nth(index).click();
    const selected = await page.evaluate(() => { const shown = document.querySelector('.ws-menu-card.selected'); return shown instanceof HTMLElement ? shown.dataset.i : undefined; });
    note(`${name}: the ${card} card is selected`, selected === String(index), { selected });
    await page.locator('.ws-menu-play').click();
    const watch = setInterval(() => { void (async () => { const step = await page.evaluate(() => { const shown = document.querySelector('.ws-load'); return shown instanceof HTMLElement ? shown.dataset.step ?? '' : ''; }).catch(() => ''); if (step !== '') stepsSeen.add(step); })(); }, 100);
    const played = await page.waitForFunction(() => typeof window.__workerClient === 'function' && window.__workerClient().frames > 30, undefined, { timeout: 150_000 }).then(() => true).catch(() => false);
    clearInterval(watch);
    const where = await page.evaluate(() => { const state = /** @type {{ inside: string | null, cells: { instance: string, slug: string }[] }} */ (/** @type {{ state: () => unknown }} */ (window.__wildshard.shard.grid).state()); return { level: window.__wildshard.world?.game.level.id, inside: state.inside, slug: state.cells.find(row => row.instance === state.inside)?.slug, own: window.__workerClient?.().own }; }).catch((/** @type {unknown} */ error) => ({ error: String(error) }));
    note(`${name}: boots past \`server\` on the world: frames from the server`, played, { steps: [...stepsSeen], ...where });
    note(`${name}: a grid page on the world, not the solo grid`, 'level' in where && where.level === 'platform.grid' && played, where);
    // GO7: Shard select seats the player in the card's cell; the door's seat is the page's cell (GO5).
    note(`${name}: seated in ${cell}`, 'inside' in where && where.inside === cell, where);
    /** @returns {Promise<{ x: number, z: number } | null>} */
    const feet = () => page.evaluate(() => { const at = window.__wildshard.world?.player.position; return at === undefined ? null : { x: at.x, z: at.z }; }).catch(() => null);
    const before = await feet();
    await page.keyboard.down('KeyW'); await new Promise(resolve => { setTimeout(resolve, 2500); }); await page.keyboard.up('KeyW');
    const after = await feet();
    const walked = before !== null && after !== null ? Math.hypot(after.x - before.x, after.z - before.z) : 0;
    note(`${name}: the player walks`, walked > 1, { before, after, walked });
    await page.screenshot({ path: join(shots, `${name}-online.png`) });
    note(`${name}: no page errors`, errors.length === 0, errors);
    } finally { await context.close().catch(() => undefined); }
  };
  // The template cell runs `_template` (MS7: WORLD_CELLS=grid opens it), and Driftwood is the home cell.
  /** @type {{ grid: { cells: { instance: string, slug: string }[] } }} */
  const catalogue = JSON.parse(readFileSync(join(dist, 'catalogue.json'), 'utf8'));
  for (const name of legs) {
    const { card, slug } = LEGS[name] ?? { card: '', slug: '' };
    // one leg's stop is its own FAIL; the next leg still runs
    await leg(browser, card, catalogue.grid.cells.find(row => row.slug === slug)?.instance ?? '?', name).catch((/** @type {unknown} */ error) => { note(`${name}: the leg ran`, false, String(error)); });
  }
  code = steps.every(step => step.ok) ? 0 : 1;
} finally {
  writeFileSync(join(work, 'grid-gate-proof.json'), `${JSON.stringify({ steps, code }, null, 2)}\n`);
  await browser?.close(); await rig.close(); door.close();
}
console.log(code === 0 ? 'grid-gate proof: PASS' : 'grid-gate proof: FAIL');
process.exit(code);
