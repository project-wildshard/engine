#!/usr/bin/env node
// MMO-PLAN GO5: a disagreeing hint costs no reload. On the local rig (WORLD_CELLS=grid, memory saves), one device plays Driftwood from
// Shard select (its hint now names Driftwood), then Signal Dunes (the door's seat moves there), and leaves past the 30 s hold. Its hint
// is set back to Driftwood and the title's grid tap boots Driftwood; the door's `resume` names Signal Dunes, and the page must enter
// Signal Dunes on the same document and the same socket: one navigation (title to grid page), one world socket, still open, frames in
// Signal Dunes, the player walks. Headless, muted, the browser's own 60 fps.
//   WS_RIG_PORTS=<first> scripts/browser-lane.sh node scripts/regrid-in-page-proof.mjs <app dist stamped with http://127.0.0.1:<first + 3>/release.json>
//     <work dir> <key.json> [--engine=webkit]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { chromium, webkit } from './browser-playwright.mjs';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';
import { openRig, WORLD_PORT } from './online-rig.mjs';

const [dist = '', relativeWork = '', keyFile = ''] = process.argv.slice(2).filter(value => !value.startsWith('--'));
const work = relativeWork === '' ? '' : absolute(relativeWork);
if (dist === '' || work === '' || keyFile === '') throw new Error('usage: regrid-in-page-proof.mjs <dist> <work> <key.json> [--engine=webkit]');
const engineName = process.argv.find(arg => arg.startsWith('--engine='))?.slice(9) ?? 'chromium';
const HOLD_MS = 40_000, shots = join(work, 'shots');
mkdirSync(shots, { recursive: true });
const sleep = (/** @type {number} */ ms) => new Promise(resolve => { setTimeout(resolve, ms); });
/** @type {{ step: string, ok: boolean, detail?: unknown }[]} */
const steps = [];
/** @param {string} step @param {boolean} ok @param {unknown} [detail] */
const note = (step, ok, detail) => { steps.push({ step, ok, ...detail === undefined ? {} : { detail } }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}${detail === undefined ? '' : ` ${JSON.stringify(detail).slice(0, 300)}`}`); };
/** @type {{ grid: { cells: { instance: string, slug: string }[] } }} */
const catalogue = JSON.parse(readFileSync(join(dist, 'catalogue.json'), 'utf8'));
const instanceOf = (/** @type {string} */ slug) => catalogue.grid.cells.find(row => row.slug === slug)?.instance ?? '?';
const DRIFTWOOD = instanceOf('driftwood-isle'), DUNES = instanceOf('sunscar-dunes');
const DEVICE_DOC = 'wildshard.save.v2@2.device';

const rig = await openRig({ dist, work, keyFile, pgBin: 'memory:', pgData: '', shard: 'driftwood-isle', more: ['sunscar-dunes'], cells: 'grid', workers: 2 });
let code = 1, browser = /** @type {import('./browser-playwright.mjs').Browser | null} */ (null);
try {
  let open = null;
  for (let tries = 0; tries < 300 && open === null; tries++) { open = await fetch(`http://127.0.0.1:${String(WORLD_PORT)}/health`).then(found => found.ok ? found.json() : null).catch(() => null); if (open === null) await sleep(200); }
  if (open === null) throw new Error(`The world did not start: see ${join(work, 'server.log')}`);
  browser = await (engineName === 'webkit' ? webkit : chromium).launch({ headless: true, args: engineName === 'chromium' ? [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] : [] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  await saveFixture(context, { scope: 'global', key: 'settings', merge: true, data: { volume: 0 } });
  // every socket each document opens, and whether it is still open
  await context.addInitScript(() => {
    const W = /** @type {any} */ (window), Real = W.WebSocket;
    W.__go5Sockets = [];
    // a seat's link sends a bundle every frame; the grid gate's world-word probe (`askWorld`) only pings, then closes
    W.WebSocket = class extends Real { constructor(/** @type {any[]} */ ...args) { super(...args); const row = { url: String(args[0]), socket: this, sends: 0, opened: performance.now(), closed: 0 }; W.__go5Sockets.push(row);
      this.addEventListener('close', () => { row.closed = performance.now(); });
      const send = Real.prototype.send; Object.defineProperty(this, 'send', { value: (/** @type {any} */ data) => { row.sends++; send.call(this, data); } }); } };
  });
  const errors = /** @type {string[]} */ ([]);
  // One page for the whole run: WebKit's pages in one context shared no localStorage here (the third page lost the name and the hint)
  const page = await context.newPage();
  let stage = 'first';
  page.on('pageerror', error => { errors.push(`${stage}: ${error.message.slice(0, 240)}`); });
  /** Shard select → `card` → play, wait for frames in `cell`, on the run's page. @param {string} card @param {string} cell @param {string} name */
  const viaDeck = async (card, cell, name) => {
    stage = name;
    await page.goto(`${rig.base}/?mute=1&nolock=1`, { waitUntil: 'load' });
    await page.locator('.ws-main-select').click({ timeout: 120_000 });
    if (await page.locator('#ws-name-box input').waitFor({ timeout: 20_000 }).then(() => true).catch(() => false)) { await page.locator('#ws-name-box input').fill('regrid'); await page.locator('#ws-name-box button[type=submit]').click(); }
    await page.locator('.ws-menu-card').first().waitFor({ state: 'visible', timeout: 30_000 });
    const index = await page.evaluate(wanted => [...document.querySelectorAll('.ws-menu-card')].findIndex(row => (row.textContent ?? '').includes(wanted)), card);
    if (index < 0) throw new Error(`No ${card} card`);
    await page.locator('.ws-menu-dots i').nth(index).click();
    await page.locator('.ws-menu-play').click();
    const played = await page.waitForFunction(() => typeof window.__workerClient === 'function' && window.__workerClient().frames > 30, undefined, { timeout: 180_000 }).then(() => true).catch(() => false);
    const inside = await page.evaluate(() => /** @type {any} */ (window.__wildshard.shard.grid).state().inside).catch(() => null);
    note(`${name}: Shard select's ${card} seats this device in ${cell}`, played && inside === cell, { played, inside });
    return page;
  };
  const drift = await viaDeck('Driftwood Isle', DRIFTWOOD, 'first');
  await sleep(3000);
  const hint = await page.evaluate(name => JSON.parse(localStorage.getItem(name) ?? '{}').keys?.['grid.last-played']?.data ?? null, DEVICE_DOC);
  note('the page kept a Driftwood hint', hint?.instance === DRIFTWOOD, { instance: hint?.instance });
  void drift;
  await viaDeck('Signal Dunes', DUNES, 'second');
  await sleep(3000);
  // leave the world for a static file on the same origin: no app runs there to write the device's save back
  await page.goto(`${rig.base}/version.json`, { waitUntil: 'load' });
  // past J114's hold, so the next dial is a fresh seat whose `resume` names the door's place (a held seat re-enters by GO4's reload)
  await sleep(HOLD_MS);
  // The device's hint goes back to Driftwood (a hint the server disagrees with)
  await page.evaluate(([name, data]) => { const doc = JSON.parse(localStorage.getItem(name) ?? '{"keys":{}}'); doc.keys ??= {}; doc.keys['grid.last-played'] = { v: 1, data }; localStorage.setItem(name, JSON.stringify(doc)); }, [DEVICE_DOC, hint]);
  stage = 'third';
  const navigations = /** @type {string[]} */ ([]), lines = /** @type {string[]} */ ([]), loads = /** @type {number[]} */ ([]);
  const heard = /** @type {string[]} */ ([]);
  page.on('console', line => { heard.push(`${line.type()} ${line.text().slice(0, 300)}`); if (line.text().includes('[grid]')) lines.push(line.text().slice(0, 200)); });
  page.on('load', () => { loads.push(Date.now()); });
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push(frame.url().replace(/[?#].*$/u, '')); });
  await page.goto(`${rig.base}/?mute=1&nolock=1`, { waitUntil: 'load' });
  const titleHint = await page.evaluate(name => JSON.parse(localStorage.getItem(name) ?? '{}').keys?.['grid.last-played']?.data?.instance ?? null, DEVICE_DOC);
  note('the title starts with a Driftwood hint', titleHint === DRIFTWOOD, { titleHint });
  const navigatedAtTitle = navigations.length, loadedAtTitle = loads.length;
  await page.locator('.ws-main-grid').click({ timeout: 120_000 });
  const played = await page.waitForFunction(dunesCell => typeof window.__workerClient === 'function' && window.__workerClient().frames > 30
    && /** @type {any} */ (window.__wildshard.shard.grid).state().inside === dunesCell, DUNES, { timeout: 240_000, polling: 250 }).then(() => true).catch(() => false);
  await sleep(2000);
  const sockets = await page.evaluate(port => /** @type {any[]} */ (/** @type {any} */ (window).__go5Sockets ?? []).filter(row => String(row.url).includes(`:${String(port)}`)).map(row => ({ open: row.socket.readyState === 1, sends: row.sends, lifeMs: Math.round((row.closed === 0 ? performance.now() : row.closed) - row.opened) })), WORLD_PORT).catch(() => null);
  const after = navigations.slice(navigatedAtTitle), documents = loads.length - loadedAtTitle;
  writeFileSync(join(work, `${engineName}-console.log`), `${heard.join('\n')}\n`);
  note('the grid tap booted Driftwood and the page entered Signal Dunes, the server\'s cell', played, { lines });
  note('the in-page path ran (the link handed over)', lines.some(line => line.includes(`the seat is in ${DUNES}`)), { lines });
  // the title's grid tap loads the grid page (one document); a disagreeing hint's re-entry is no second one
  note('one document after the title (the grid page), no reload for the disagreeing hint', documents === 1, { documents, navigations: after.length });
  const links = sockets?.filter(row => row.sends > 3) ?? null;
  note('one seat link on the final document, still open (a world-word probe pings once or twice and closes)', links !== null && links.length === 1 && links.every(row => row.open), { sockets });
  const feet = () => page.evaluate(() => { const at = window.__wildshard.world?.player.position; return at === undefined ? null : { x: at.x, z: at.z }; }).catch(() => null);
  const before = await feet();
  await page.keyboard.down('KeyW'); await sleep(2500); await page.keyboard.up('KeyW');
  const moved = await feet(), walked = before !== null && moved !== null ? Math.hypot(moved.x - before.x, moved.z - before.z) : 0;
  note('the player walks in Signal Dunes', walked > 1, { walked: Number(walked.toFixed(2)) });
  await page.screenshot({ path: join(shots, `${engineName}-dunes.png`) });
  note('no page errors', errors.length === 0, errors);
  code = steps.every(step => step.ok) ? 0 : 1;
} finally {
  writeFileSync(join(work, `regrid-in-page-${engineName}.json`), `${JSON.stringify({ engine: engineName, steps, code }, null, 2)}\n`);
  await browser?.close(); await rig.close();
}
console.log(code === 0 ? 'regrid-in-page proof: PASS' : 'regrid-in-page proof: FAIL');
process.exit(code);
