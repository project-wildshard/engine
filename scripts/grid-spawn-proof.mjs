#!/usr/bin/env node
// GRID-CROSSING GC21 (J300, Jake 2026-11-12: "shard select should pop you in … you can pop into anything you want"): the 25-cell
// spawn proof on staging. For every cell of the grid, in a fresh headless Chromium profile, desktop (1440×900) and Jake's phone
// layout (402×874, touch): title → SHARD SELECT → that shard's card → ENTER WORLD, then control, a 10 m walk by real input
// (keys on desktop, the touch stick on the phone), one jump, and the seat's cell as the server's own snapshot names it
// (`__workerClient().cell`) beside the page's grid cell (`grid.state().inside`). A cell with no card that enters (no card, or
// a Coming soon / Draft card) is red on the card path; the proof then tries the same card with Developer on (it unlocks the
// Experimental and Developer-only cards), so the report also says whether the cell itself spawns. (A fresh `/?chunk=` visit lands
// on the deck, the title arrival, so it is no way round a missing card.) One HTML report, 25 rows × 2 layouts, load ms and shots.
// J205: staging only, never production. At most 3 pages at once (`WORLD_SEATS` 32).
//   node scripts/grid-spawn-proof.mjs <out dir> [--layouts=desktop,phone] [--cells=<instance,…>] [--parallel=3] [--no-dev]
//   node scripts/grid-spawn-proof.mjs <out dir> --report-only   (redraws report.html from <out dir>/runs.json)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, join, resolve as absolute } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';
import { guardStagingSockets } from './staging-proof-lines.mjs';

const BASE = 'https://staging.wildshard.io', HEALTH = 'https://wildshard.tailb41b20.ts.net:8443/health', RELEASE = 'https://packs.wildshard.io/releases/staging.json';
const out = absolute(process.argv.slice(2).find(arg => !arg.startsWith('--')) ?? '');
if (out === absolute('')) throw new Error('usage: grid-spawn-proof.mjs <out dir> [--layouts=desktop,phone] [--cells=…] [--parallel=3] [--no-dev]');
/** @param {string} name @param {string} fallback */
const flag = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const layouts = flag('layouts', 'desktop,phone').split(','), parallel = Math.min(3, Number(flag('parallel', '3')));
const devRetry = !process.argv.includes('--no-dev'), only = flag('cells', '').split(',').filter(Boolean);
const shots = join(out, 'shots');
mkdirSync(shots, { recursive: true });

/** The 25 cells (src/shared/game/grid/singleplayer.json) and the deck card that names each, where the deck has one. */
// staging's own grid: the catalogue at the build staging runs (`/health`), not this checkout's, which other lanes edit
const stagingBuild = await fetch(HEALTH, { signal: AbortSignal.timeout(15_000) }).then(async found => String((await found.json()).build)).catch(() => '');
const catalogueText = (() => {
  try { return execFileSync('git', ['show', `${stagingBuild}:src/shared/game/grid/singleplayer.json`], { cwd: join(import.meta.dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { console.log(`staging build ${stagingBuild} is not in this checkout: reading the working catalogue`); return readFileSync(join(import.meta.dirname, '../src/shared/game/grid/singleplayer.json'), 'utf8'); }
})();
const catalogue = /** @type {{ grid: { cells: { instance: string, slug: string, cell: [number, number] }[] } }} */ (JSON.parse(catalogueText));
const CARD = /** @type {Record<string, string>} */ ({ 'driftwood-isle': 'Driftwood Isle', 'pine-hollow': 'Pine Hollow', 'nalati-grasslands': 'Nalati Grasslands', 'nine-dragon-stack': 'Nine Dragon Stack',
  'sunscar-dunes': 'Signal Dunes', 'far-reach': 'Sky Reach', _template: 'Template shard', 'open-plot-thin-ice': 'Thin Ice' });
const cells = catalogue.grid.cells.filter(cell => only.length === 0 || only.includes(cell.instance)).sort((a, b) => b.cell[1] - a.cell[1] || a.cell[0] - b.cell[0]);

/** @typedef {{ instance: string, slug: string, cell: [number, number] }} Cell */
/** @typedef {{ instance: string, slug: string, xy: [number, number], layout: string, path: 'card' | 'dev', card: string, ok: boolean, why: string, loadMs: number | null, walkedM: number | null, jumpM: number | null, inside: string | null, seat: string | null, mode: string, url: string, errors: string[], shots: string[], at: string }} Run */

/** One run: a fresh profile, one way in, control, walk, jump, seat. @param {import('playwright').Browser} browser @param {Cell} cell @param {string} layout @param {'card' | 'dev'} path @returns {Promise<Run>} */
async function runOne(browser, cell, layout, path) {
  const phone = layout === 'phone', tag = `${cell.instance}-${layout}-${path}`;
  /** @type {Run} */
  const run = { instance: cell.instance, slug: cell.slug, xy: cell.cell, layout, path, card: CARD[cell.slug] ?? '', ok: false, why: '', loadMs: null, walkedM: null, jumpM: null, inside: null, seat: null, mode: '', url: '', errors: [], shots: [], at: new Date().toISOString() };
  const context = await browser.newContext(phone ? { viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' } : { viewport: { width: 1440, height: 900 } });
  await context.addInitScript(guardStagingSockets, 'wss://rooms-staging.wildshard.io');
  await saveFixture(context, { scope: 'global', key: 'settings', data: { music: false, sfx: false, volume: 0 }, merge: true });
  if (path === 'dev') await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.on('pageerror', error => { run.errors.push(error.message.slice(0, 200)); });
  page.on('console', line => { if (line.type() === 'error' && run.errors.length < 8) run.errors.push(`console: ${line.text().slice(0, 200)}`); });
  page.on('framenavigated', frame => { if (frame === page.mainFrame() && run.errors.length < 12) run.errors.push(`nav: ${frame.url().replace(BASE, '')}`); });
  const shot = async (/** @type {string} */ name) => { const file = join(shots, `${tag}-${name}.png`); await page.screenshot({ path: file, timeout: 15_000 }).then(() => run.shots.push(file)).catch(() => undefined); };
  const press = async (/** @type {string} */ selector) => {
    if (!phone) { await page.locator(selector).first().click({ timeout: 30_000 }); return; }
    const box = await page.locator(selector).first().boundingBox({ timeout: 30_000 });
    if (box === null) throw new Error(`${selector} is not on screen`);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  };
  const named = async () => {
    if (!await page.locator('#ws-name-box input').waitFor({ timeout: 12_000 }).then(() => true).catch(() => false)) return;
    await page.locator('#ws-name-box input').fill(`Agent gc21 ${layout[0] ?? ''}${String(Date.now() % 10000)}`);
    await page.locator('#ws-name-box button[type=submit]').click();
  };
  let t0 = 0;
  try {
    {
      await page.goto(`${BASE}/?mute=1&nolock=1`, { waitUntil: 'load', timeout: 90_000 });
      await page.locator('.ws-main-select').waitFor({ state: 'visible', timeout: 90_000 });
      await press('.ws-main-select');
      await named();
      await page.locator('.ws-menu-card').first().waitFor({ state: 'visible', timeout: 30_000 });
      await page.waitForTimeout(800);
      const cards = await page.evaluate(() => [...document.querySelectorAll('.ws-menu-card')].map(card => (card.textContent ?? '').replaceAll(/\s+/gu, ' ').trim()));
      const index = run.card === '' ? -1 : cards.findIndex(text => text.includes(run.card));
      if (index < 0) { run.why = `no card in Shard Select (deck: ${cards.length} cards)`; await shot('deck'); return run; }
      const text = cards[index] ?? '';
      if (/Coming soon|Draft/iu.test(text)) { run.why = `card is locked: "${text.slice(0, 40)}"`; await page.locator('.ws-menu-dots i').nth(index).click(); await page.waitForTimeout(600); await shot('deck'); return run; }
      await page.locator('.ws-menu-dots i').nth(index).click();
      await page.waitForTimeout(700);
      await shot('deck');
      t0 = Date.now();
      await press('.ws-menu-play');
    }
    // control: the world's player, the server's frames, and on a grid page its live cell gameplay-ready
    const ready = await page.waitForFunction(() => {
      const W = /** @type {any} */ (window), grid = W.__wildshard?.shard?.grid, wire = W.__workerClient?.();
      // oxlint-disable-next-line unicorn/prefer-dom-node-text-content -- the text a player sees, not hidden templates
      if ([...document.querySelectorAll('h1, h2')].some(head => head instanceof HTMLElement && head.getClientRects().length > 0 && /could not load|couldn.t enter/iu.test(head.innerText))) return 'error';
      if (W.__wildshard?.world?.player === undefined || (wire?.frames ?? 0) < 20) return false;
      if (grid === undefined) return 'one-shard';
      const st = grid.state(); return st.live?.live?.gameplayReady === true && typeof st.inside === 'string' ? 'grid' : false;
    }, undefined, { timeout: 180_000, polling: 250 }).then(handle => handle.jsonValue()).catch(() => null);
    run.url = page.url();
    if (ready === null || ready === 'error') {
      // what the screen says: the error page's own words, or the title
      const said = await page.evaluate(() => {
        // oxlint-disable-next-line unicorn/prefer-dom-node-text-content -- the text a player sees, not hidden templates
        const head = [...document.querySelectorAll('h1, h2')].find(row => row instanceof HTMLElement && row.getClientRects().length > 0 && /could not load|couldn.t enter/iu.test(row.innerText));
        // oxlint-disable-next-line unicorn/prefer-dom-node-text-content -- the text a player sees, not hidden templates
        return (head?.parentElement ?? document.body).innerText.replaceAll(/\s+/gu, ' ').trim().slice(0, 260);
      }).catch(() => '');
      const onTitle = await page.evaluate(() => { const select = document.querySelector('.ws-main:not(.hide) .ws-main-select'); return select !== null && select.getClientRects().length > 0; }).catch(() => false);
      run.why = ready === 'error' ? `load error: ${said}` : onTitle ? `ended on the title after ENTER WORLD, no world and no error shown (url ${run.url.replace(BASE, '') || '/'})` : `no control within 180 s: ${said.slice(0, 160)}`;
      await shot('stuck'); return run;
    }
    run.loadMs = Date.now() - t0; run.mode = String(ready);
    await page.waitForTimeout(1500);
    // the first-play card and a paused clock come off by the player's own taps
    if (await page.getByText('DONE', { exact: true }).isVisible().catch(() => false)) await page.getByText('DONE', { exact: true }).click({ timeout: 3000 }).catch(() => undefined);
    if (await page.evaluate(() => /** @type {any} */ (window).__wildshard?.world?.game?.app?.clock?.paused === true)) await page.getByRole('button', { name: /^resume$/iu }).click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(500);
    await shot('control');
    const where = () => page.evaluate(() => { const p = /** @type {any} */ (window).__wildshard.world.player.position; return { x: Number(p.x), y: Number(p.y), z: Number(p.z) }; });
    const from = await where();
    // 10 m by input: W held on desktop; on the phone a finger on the stick, pushed up
    let walked = 0;
    const deadline = Date.now() + 25_000;
    let stuck = 0, last = from;
    if (phone) {
      const ring = await page.locator('.ws-touch-stick').boundingBox();
      if (ring === null) throw new Error('no touch stick on the phone layout');
      const cdp = await context.newCDPSession(page), cx = ring.x + ring.width / 2, cy = ring.y + ring.height / 2;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, id: 1 }] });
      for (let dy = 0; dy <= 60; dy += 10) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy - dy, id: 1 }] });
      while (Date.now() < deadline && walked < 10) {
        await page.waitForTimeout(250);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + (stuck > 8 ? 30 : 0), y: cy - 60, id: 1 }] });
        const at = await where(); walked = Math.hypot(at.x - from.x, at.z - from.z);
        stuck = Math.hypot(at.x - last.x, at.z - last.z) < 0.05 ? stuck + 1 : 0; last = at;
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.keyboard.down('KeyW');
      while (Date.now() < deadline && walked < 10) {
        await page.waitForTimeout(250);
        const at = await where(); walked = Math.hypot(at.x - from.x, at.z - from.z);
        stuck = Math.hypot(at.x - last.x, at.z - last.z) < 0.05 ? stuck + 1 : 0; last = at;
        if (stuck === 6) await page.keyboard.press('Space');
        if (stuck === 10) { await page.keyboard.down('KeyA'); await page.waitForTimeout(600); await page.keyboard.up('KeyA'); }
      }
      await page.keyboard.up('KeyW');
    }
    run.walkedM = Number(walked.toFixed(1));
    await page.waitForTimeout(600);
    // one action: a jump, by the jump button on the phone and Space on desktop
    const before = await where();
    const peak = page.evaluate(start => new Promise(resolve => { let top = 0; const t = performance.now(); const tick = () => { const y = /** @type {any} */ (window).__wildshard.world.player.position.y; top = Math.max(top, y - start); if (performance.now() - t > 1200) resolve(top); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); }), before.y);
    await (phone ? press('.ws-touch .jump') : page.keyboard.press('Space'));
    run.jumpM = Number(Number(await peak).toFixed(2));
    await page.waitForTimeout(800);
    const seat = await page.evaluate(() => { const W = /** @type {any} */ (window); return { seat: W.__workerClient?.().cell ?? null, inside: W.__wildshard?.shard?.grid?.state?.().inside ?? null }; });
    // the snapshot's cell is 1-based into the grid catalogue (clientWorker.ts siteOf); 0 is no grid
    run.seat = typeof seat.seat === 'number' ? catalogue.grid.cells[seat.seat - 1]?.instance ?? `#${String(seat.seat)}` : null; run.inside = seat.inside;
    await shot('after');
    const inCell = run.mode === 'grid' && run.inside === cell.instance && run.seat === cell.instance;
    const reasons = [];
    if (run.mode !== 'grid') reasons.push(`entered a ${run.mode} page, not the grid (url ${run.url.replace(BASE, '')})`);
    else if (run.inside !== cell.instance) reasons.push(`landed in ${String(run.inside)}`);
    if (run.mode === 'grid' && run.seat !== cell.instance) reasons.push(`server seat in ${String(run.seat)}`);
    if (walked < 10) reasons.push(`walked only ${walked.toFixed(1)} m`);
    if ((run.jumpM ?? 0) < 0.3) reasons.push(`jump rose ${String(run.jumpM)} m`);
    run.ok = inCell && walked >= 10 && (run.jumpM ?? 0) >= 0.3;
    run.why = reasons.join('; ');
  } catch (error) {
    run.why = `stopped: ${String(error).split('\n')[0]?.slice(0, 220) ?? ''}`; await shot('error');
  } finally {
    await context.close().catch(() => undefined);
  }
  return run;
}

/** A cell whose card the Developer deck shows (the template). @param {Cell} cell */
const developerCard = cell => cell.slug === '_template';
const runsFile = join(out, 'runs.json');
/** @type {{ runs: Run[], staging: Record<string, unknown> }} */
const state = existsSync(runsFile) ? JSON.parse(readFileSync(runsFile, 'utf8')) : { runs: [], staging: {} };
if (!process.argv.includes('--report-only')) {
  const health = await fetch(HEALTH, { signal: AbortSignal.timeout(15_000) }).then(found => found.json()).catch(() => ({}));
  const release = await fetch(RELEASE, { signal: AbortSignal.timeout(15_000) }).then(async found => JSON.parse((await found.json()).body)).catch(() => ({}));
  const version = await fetch(`${BASE}/version.json`, { signal: AbortSignal.timeout(15_000) }).then(found => found.json()).catch(() => ({}));
  state.staging = { serial: health.serial ?? release.serial, build: health.build ?? release.engineBuild, pageBuild: version.build, cells: health.cells, workers: health.workers, table: health.table, shards: (release.shards ?? []).length, started: new Date().toISOString() };
  console.log(`staging serial ${String(state.staging.serial)} build ${String(state.staging.build)} cells ${String(health.cells)} workers ${String(health.workers)}`);
  const browser = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  // phone first (the brief: all 25 phone runs before desktop if time runs short)
  const jobs = layouts.slice().sort(a => (a === 'phone' ? -1 : 1)).flatMap(layout => cells.map(cell => ({ cell, layout })));
  const save = () => { writeFileSync(runsFile, `${JSON.stringify(state, null, 2)}\n`); };
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      if (job === undefined) break;
      const done = await runOne(browser, job.cell, job.layout, 'card');
      state.runs = state.runs.filter(row => !(row.instance === done.instance && row.layout === done.layout && row.path === 'card')); state.runs.push(done); save();
      console.log(`${done.ok ? 'GREEN' : 'RED  '} card  ${job.layout.padEnd(7)} ${job.cell.instance.padEnd(18)} ${String(done.loadMs ?? '-').padStart(6)} ms ${done.why}`);
      if (!done.ok && devRetry && done.loadMs === null && (done.why.startsWith('card is locked') || (done.why.startsWith('no card') && developerCard(job.cell)))) {
        const fall = await runOne(browser, job.cell, job.layout, 'dev');
        state.runs = state.runs.filter(row => !(row.instance === fall.instance && row.layout === fall.layout && row.path === 'dev')); state.runs.push(fall); save();
        console.log(`${fall.ok ? 'green' : 'red  '} dev   ${job.layout.padEnd(7)} ${job.cell.instance.padEnd(18)} ${String(fall.loadMs ?? '-').padStart(6)} ms ${fall.why}`);
      }
    }
  };
  try { await Promise.all(Array.from({ length: parallel }, worker)); } finally { await browser.close(); }
  state.staging.finished = new Date().toISOString();
  save();
}

// ── the report: one page, its shots beside it as small JPEGs (thumbs/), published with it ──
/** @param {string} text */
const esc = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
/** @param {string} file */
const thumb = async file => {
  if (!existsSync(file)) return '';
  const name = `thumbs/${basename(file, '.png')}.jpg`;
  mkdirSync(join(out, 'thumbs'), { recursive: true });
  await sharp(file).resize({ width: 220 }).jpeg({ quality: 64 }).toFile(join(out, name));
  return name;
};
const all = catalogue.grid.cells.slice().sort((a, b) => b.cell[1] - a.cell[1] || a.cell[0] - b.cell[0]);
const find = (/** @type {string} */ instance, /** @type {string} */ layout, /** @type {string} */ path) => state.runs.find(row => row.instance === instance && row.layout === layout && row.path === path);
const table = /** @type {Record<string, number>} */ (state.staging.table ?? {});
const cardRuns = state.runs.filter(row => row.path === 'card'), green = cardRuns.filter(row => row.ok).length;
const chunkRuns = state.runs.filter(row => row.path === 'dev'), chunkGreen = chunkRuns.filter(row => row.ok).length;
/** @param {Run | undefined} run */
const cellHtml = async run => {
  if (run === undefined) return '<td class="run"><span class="chip none">not run</span></td>';
  const pick = run.shots.find(file => file.endsWith('-after.png')) ?? run.shots.find(file => file.endsWith('-control.png')) ?? run.shots.at(-1) ?? '';
  const img = pick === '' ? '' : `<img src="${await thumb(pick)}" alt="${esc(run.instance)} ${esc(run.layout)}" loading="lazy">`;
  const facts = run.loadMs === null ? '' : `<dl><dt>load</dt><dd>${String(run.loadMs)} ms</dd><dt>walk</dt><dd>${String(run.walkedM)} m</dd><dt>jump</dt><dd>${String(run.jumpM)} m</dd><dt>seat</dt><dd>${esc(String(run.seat))}</dd></dl>`;
  return `<td class="run"><div class="runbox"><span class="chip ${run.ok ? 'ok' : 'bad'}">${run.ok ? 'GREEN' : 'RED'}</span>${facts}${run.why === '' ? '' : `<p class="why">${esc(run.why)}</p>`}${img}</div></td>`;
};
const rows = [];
for (const cell of all) {
  const parts = [];
  for (const layout of ['phone', 'desktop']) {
    parts.push(await cellHtml(find(cell.instance, layout, 'card')));
    const fall = find(cell.instance, layout, 'dev');
    parts.push(fall === undefined ? `<td class="run direct"><span class="muted">${find(cell.instance, layout, 'card')?.why.startsWith('no card') === true ? 'no card with Developer on either' : 'not needed'}</span></td>` : (await cellHtml(fall)).replace('class="run"', 'class="run direct"'));
  }
  const worker = table[cell.instance];
  rows.push(`<tr><th scope="row"><b>${esc(CARD[cell.slug] ?? cell.slug)}</b><span class="mono">${esc(cell.instance)}</span><span class="mono">cell [${cell.cell.join(', ')}] · worker ${worker === undefined ? '?' : String(worker)}</span></th>${parts.join('')}</tr>`);
}
const s = state.staging, when = new Date(typeof s.finished === 'string' ? s.finished : typeof s.started === 'string' ? s.started : Date.now()).toLocaleString('sv-SE', { timeZone: 'America/Cancun' }).slice(0, 16);
const html = `<title>Grid Spawn Proof GC21</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;600&family=Space+Grotesk:wght@600&display=swap">
<style>
/* A survey sheet: one summary strip, then the 5×5 grid as a ledger, north row first, each run a column. */
:root { --bg: #f3f5f4; --panel: #ffffff; --fg: #18201d; --muted: #5d6b66; --line: #d5ddd9; --ok: #1d7a45; --ok-bg: #dcf1e4; --bad: #b3261e; --bad-bg: #f9e0dd; --accent: #2d6a73;
  --display: 'Space Grotesk', 'IBM Plex Sans', system-ui, sans-serif; --body: 'IBM Plex Sans', system-ui, sans-serif; --mono: 'IBM Plex Mono', ui-monospace, monospace; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #101614; --panel: #18201d; --fg: #e4ebe8; --muted: #93a39d; --line: #2c3833; --ok: #6fd29a; --ok-bg: #173826; --bad: #ff8a80; --bad-bg: #3d1b18; --accent: #7cc3cc; color-scheme: dark } }
:root[data-theme="dark"] { --bg: #101614; --panel: #18201d; --fg: #e4ebe8; --muted: #93a39d; --line: #2c3833; --ok: #6fd29a; --ok-bg: #173826; --bad: #ff8a80; --bad-bg: #3d1b18; --accent: #7cc3cc; color-scheme: dark }
body { background: var(--bg); color: var(--fg); font-family: var(--body); line-height: 1.45; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 24px 48px; }
h1 { font-family: var(--display); font-size: 1.9rem; margin: 0 0 4px; text-wrap: balance; }
.sub { color: var(--muted); margin: 0 0 20px; max-width: 70ch; }
.strip { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; }
.stat { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 10px 14px; min-width: 0; }
.stat b { display: block; font-family: var(--display); font-size: 1.5rem; font-variant-numeric: tabular-nums; }
.stat span { color: var(--muted); font-size: 0.8rem; letter-spacing: 0.04em; text-transform: uppercase; }
.mono, dl, .why { font-family: var(--mono); font-size: 0.75rem; }
.wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); }
table { border-collapse: collapse; width: 100%; min-width: 1180px; }
th, td { border-bottom: 1px solid var(--line); vertical-align: top; text-align: left; padding: 8px; }
thead th { font-size: 0.75rem; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); position: sticky; top: 0; background: var(--panel); }
tbody th { width: 170px; } tbody th b { display: block; } tbody th .mono { display: block; color: var(--muted); }
td.direct { background: color-mix(in srgb, var(--bg) 60%, var(--panel)); }
.runbox { display: grid; gap: 4px; width: 220px; }
.runbox img { width: 220px; height: auto; border-radius: 4px; border: 1px solid var(--line); }
dl { display: grid; grid-template-columns: auto 1fr; gap: 0 8px; margin: 0; font-variant-numeric: tabular-nums; } dt { color: var(--muted); } dd { margin: 0; overflow-wrap: anywhere; }
.why { margin: 0; color: var(--bad); overflow-wrap: anywhere; }
.chip { display: inline-block; font-family: var(--mono); font-size: 0.72rem; font-weight: 600; letter-spacing: 0.06em; padding: 2px 8px; border-radius: 3px; width: max-content; }
.chip.ok { color: var(--ok); background: var(--ok-bg); } .chip.bad { color: var(--bad); background: var(--bad-bg); } .chip.none, .muted { color: var(--muted); font-size: 0.75rem; }
code { font-family: var(--mono); font-size: 0.85em; }
</style>
<h1>Grid spawn proof, GC21</h1>
<p class="sub">Staging, every cell of the 5×5 grid, each in a fresh headless Chromium profile: title → SHARD SELECT → the shard's card → ENTER WORLD, then control, a 10 m walk by input, a jump, and the seat's cell from the server's own snapshot. A run is green only if the page is the grid, inside that cell, the server seats it there, it walks 10 m and jumps. The Shard Select columns are a fresh player (Developer off). Where that card is locked, the grey column tries the same card with Developer on, to show whether the cell itself spawns; the open plots have no card with Developer on either. Finished ${esc(when)} Cancún.</p>
<div class="strip">
<div class="stat"><b>${String(green)} / ${String(cardRuns.length)}</b><span>Shard Select runs green</span></div>
<div class="stat"><b>${String(chunkGreen)} / ${String(chunkRuns.length)}</b><span>Developer-on retries green</span></div>
<div class="stat"><b>${esc(String(s.serial))}</b><span>staging serial</span></div>
<div class="stat"><b class="mono">${esc(String(s.build).slice(0, 10))}</b><span>build</span></div>
<div class="stat"><b>${esc(String(s.cells))} on ${esc(String(s.workers))}</b><span>cells on workers</span></div>
</div>
<div class="wrap"><table><thead><tr><th>Cell (north row first)</th><th>Phone 402×874 · Shard Select</th><th>Phone · Developer on</th><th>Desktop 1440×900 · Shard Select</th><th>Desktop · Developer on</th></tr></thead>
<tbody>${rows.join('\n')}</tbody></table></div>
`;
writeFileSync(join(out, 'report.html'), html);
console.log(`report: ${join(out, 'report.html')} · Shard Select ${String(green)}/${String(cardRuns.length)} green · Developer on ${String(chunkGreen)}/${String(chunkRuns.length)} green`);
process.exit(cardRuns.length > 0 && green === cardRuns.length ? 0 : 1);
