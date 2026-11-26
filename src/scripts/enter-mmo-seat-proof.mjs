#!/usr/bin/env node
// QA-FEEDBACK-2026-11-23-b row 19 (Jake, ~11:30 Cancún, staging: "Enter MMO should, ask the server where the fuck I am, and then like
// load the correct zone, and like not spawn me in Driftwood, and then not teleport me"), proven on a local build (J490). A signed grid
// world on loopback (online-rig.mjs: this checkout's client and server, Driftwood and Sunscar Dunes) and a phone page in headless
// WebKit (402×874, pixel density 3, touch). It fails unless:
//   - a player who stood in Signal Dunes, back on the title with no hint on the device (the case a placement change or another device
//     makes), taps ENTER THE MMO and lands in Signal Dunes: the loading card never names Driftwood, the door never moves the page
//     (`[grid] the seat is in`), and the page says the door answered first (`[grid] enter: the door seats this player in`);
//   - the same with the device's hint kept;
//   - a fresh player's ENTER THE MMO lands in Driftwood, the home;
//   - no page error.
//   src/scripts/browser-lane.sh node src/scripts/enter-mmo-seat-proof.mjs <work dir> [--dist=<a built client stamped for this rig>]
import { execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { webkit } from './browser-playwright.mjs';
import { PHONE } from './journey-proof.mjs';
import { saveFixture } from './debug-settings.mjs';

// A free rig block locked for this run (QA 11-25 row 130), or the one WS_RIG_PORTS names; the lock goes when the process exits.
process.env.WS_RIG_PORTS = String((await (await import('./rig-ports.mjs')).reserveRigPorts()).base);
const { RELEASE_PORT, enterPage, intoWorld, openRig } = await import('./online-rig.mjs');
const ROOT = absolute(import.meta.dirname, '..', '..');
const workArg = process.argv.slice(2).find(value => !value.startsWith('--')) ?? '';
if (workArg === '') throw new Error('usage: enter-mmo-seat-proof.mjs <work dir>');
const work = absolute(workArg), DUNES = 'sunscar-dunes';
const steps = /** @type {{ step: string, ok: boolean, detail?: unknown }[]} */ ([]);
/** @param {string} step @param {boolean} ok @param {unknown} [detail] */
const note = (step, ok, detail) => { steps.push({ step, ok, ...(detail === undefined ? {} : { detail }) }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}${detail === undefined ? '' : ` ${JSON.stringify(detail).slice(0, 500)}`}`); };
/** @param {number} ms */
const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });
const noise = (/** @type {string} */ line) => /WebSocket connection|ERR_CONNECTION|Failed to load resource|WebSocket network error/u.test(line);

/** The cell a page plays and stands in. @param {import('playwright').Page} page */
const whereIs = page => page.evaluate(() => {
  const shard = /** @type {any} */ (window).__wildshard, state = shard?.shard?.grid?.state?.();
  return { inside: String(state?.inside ?? ''), home: String(state?.live?.live?.home ?? state?.home ?? ''), level: String(shard?.world?.game.level.id ?? '') };
});
/** Build this checkout's client for the rig's signed release (or reuse `--dist`) and open a grid world with Dunes and Driftwood. */
async function openWorld() {
  mkdirSync(work, { recursive: true });
  const keyFile = join(work, 'fixture-key.json'), given = process.argv.find(value => value.startsWith('--dist='))?.slice('--dist='.length);
  let dist = given === undefined ? join(work, 'dist') : absolute(given);
  if (given === undefined || !existsSync(join(work, 'dist-key.json'))) {
    const pair = generateKeyPairSync('ed25519'), key = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
    writeFileSync(join(work, 'dist-key.json'), JSON.stringify({ private: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), public: key }), { mode: 0o600 });
    dist = join(work, 'dist');
    const build = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    const built = spawnSync('python3', ['src/scripts/heavy-lane.py', 'build', '--', process.execPath, 'src/scripts/build-app.mjs', '--outDir', dist], {
      cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...process.env, WS_BUILD_ID: build, WILDSHARD_RELEASE_URL: `http://127.0.0.1:${String(RELEASE_PORT)}/release.json`, WILDSHARD_RELEASE_KEY: key } });
    if (built.status !== 0) throw new Error(`the client build stopped (${String(built.status)})`);
  }
  rmSync(keyFile, { force: true });
  writeFileSync(keyFile, readFileSync(join(work, 'dist-key.json')), { mode: 0o600, flag: 'wx' });
  rmSync(join(work, 'rig'), { recursive: true, force: true });
  try { return await openRig({ dist, work: join(work, 'rig'), keyFile, pgBin: 'pglite:', more: [DUNES], cells: 'grid', isolated: true }); }
  finally { rmSync(keyFile, { force: true }); }
}

/** Watch one Enter MMO: every loading-card name shown, and the page's `[grid]` lines. @param {import('playwright').Page} page */
function watchEntry(page) {
  const names = /** @type {string[]} */ ([]), lines = /** @type {string[]} */ ([]);
  const watching = { live: true };
  page.on('console', line => { if (watching.live && line.text().startsWith('[grid]')) lines.push(line.text().slice(0, 200)); });
  void (async () => {
    while (watching.live) {
      const name = await page.evaluate(() => document.querySelector('.ws-load:not(.hide) [data-el="slug"]')?.textContent ?? null).catch(() => null);
      if (name !== null && name !== '' && names.at(-1) !== name) names.push(name);
      await sleep(100);
    }
  })();
  return { names, lines, stop: () => { watching.live = false; } };
}
/** ENTER THE MMO on the title this page shows, then into the world; what the entry showed. @param {import('playwright').Page} page */
async function enterMmo(page, name = '') {
  await page.locator('.ws-main-grid').waitFor({ state: 'visible', timeout: 120_000 });
  await sleep(2000); // the title's ask of the door goes as it paints
  const watch = watchEntry(page), started = Date.now();
  await page.locator('.ws-main-grid').click();
  if (name !== '') {
    await page.locator('#ws-name-box input').waitFor({ timeout: 60_000 });
    await page.locator('#ws-name-box input').fill(name);
    await page.locator('#ws-name-box button[type=submit]').click();
  }
  await intoWorld(page);
  await sleep(4000); // a door that would move the seat says so within this
  watch.stop();
  return { names: watch.names, lines: watch.lines, where: await whereIs(page), seconds: (Date.now() - started) / 1000 };
}
/** Back to the title as the pause menu's EXIT TO TITLE does. @param {import('playwright').Page} page */
async function toTitle(page) {
  await page.evaluate(() => { document.dispatchEvent(new Event('ws:exit-to-main')); });
  await page.locator('.ws-main-grid').waitFor({ state: 'visible', timeout: 60_000 });
}
/** Forget the device's hint, as a placement change (its seal) or another device leaves it: the page then reads nothing of its own. */
const forgetHint = () => {
  for (const name of ['wildshard.save.v2@2.device', 'wildshard.save.v2@2.session']) {
    const store = name.endsWith('session') ? sessionStorage : localStorage, doc = JSON.parse(store.getItem(name) ?? '{"keys":{}}');
    for (const key of ['grid.last-played', 'grid.server-placed', 'grid.recovery.once']) delete doc.keys?.[key];
    store.setItem(name, JSON.stringify(doc));
  }
};

const rig = await openWorld(), url = (/** @type {string} */ slug) => ({ zone: slug, base: rig.base });
const browser = await webkit.launch({ headless: true });
const out = join(work, 'proof');
mkdirSync(out, { recursive: true });
let code = 1;
const errors = /** @type {string[]} */ ([]);
try {
  note('phone layout', PHONE.viewport.width === 402 && PHONE.viewport.height === 874 && PHONE.deviceScaleFactor === 3 && PHONE.hasTouch, PHONE.viewport);
  const hand = await enterPage(browser, PHONE, url(DUNES), 'Hand');
  hand.page.on('pageerror', error => { errors.push(error.message.slice(0, 240)); });
  await intoWorld(hand.page);
  const first = await whereIs(hand.page);
  note('the player stands in Signal Dunes', first.inside.includes('dunes'), first);
  await sleep(3000);

  // 1: no hint on the device. Before row 19 this booted Driftwood and the door moved the page (two loading screens).
  await toTitle(hand.page);
  await hand.page.evaluate(forgetHint);
  await hand.page.goto(`${rig.base}/?mute=1&nolock=1`, { waitUntil: 'load' });
  const wiped = await enterMmo(hand.page);
  await hand.page.screenshot({ path: join(out, '1-no-hint.png') });
  note('no hint: Enter MMO lands in Signal Dunes', wiped.where.inside.includes('dunes') && wiped.where.home.includes('dunes'), wiped.where);
  note('no hint: the loading card never names Driftwood', wiped.names.length > 0 && !wiped.names.some(name => /driftwood/iu.test(name)), wiped.names);
  note('no hint: the door answered first and never moved the page', wiped.lines.some(line => line.includes('enter: the door seats this player in sunscar-dunes'))
    && !wiped.lines.some(line => line.includes('the seat is in')), wiped.lines);

  // 2: the hint kept
  await toTitle(hand.page);
  const kept = await enterMmo(hand.page);
  await hand.page.screenshot({ path: join(out, '2-hint-kept.png') });
  note('hint kept: Enter MMO lands in Signal Dunes', kept.where.inside.includes('dunes'), kept.where);
  note('hint kept: one card, Signal Dunes, no move', !kept.names.some(name => /driftwood/iu.test(name)) && !kept.lines.some(line => line.includes('the seat is in')), { names: kept.names, lines: kept.lines });

  // 3: a fresh player starts at the home
  const fresh = await browser.newContext(PHONE), page = await fresh.newPage();
  await saveFixture(fresh, { scope: 'device', key: 'devMode', data: true });
  page.on('pageerror', error => { errors.push(error.message.slice(0, 240)); });
  await page.goto(`${rig.base}/?mute=1&nolock=1`, { waitUntil: 'load' });
  const home = await enterMmo(page, 'Fresh');
  await page.screenshot({ path: join(out, '3-fresh.png') });
  note('a fresh player lands in Driftwood', home.where.inside.includes('driftwood'), { where: home.where, names: home.names, lines: home.lines });

  const faults = [...errors, ...hand.errors].filter(line => !noise(line));
  note('no page error', faults.length === 0, faults.slice(0, 6));
  code = steps.every(row => row.ok) ? 0 : 1;
} catch (error) {
  note('the proof stopped', false, String(error).slice(0, 400));
} finally {
  writeFileSync(join(out, 'verdict.json'), JSON.stringify({ pass: steps.every(row => row.ok) && code === 0, steps }, null, 2));
  await browser.close();
  await rig.close();
}
console.log(code === 0 ? 'PASS' : 'FAIL');
process.exitCode = code;
