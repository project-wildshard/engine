#!/usr/bin/env node
// SHARD-COMPAT NB2, proven on a local build (J490: rows are done when proven locally; nothing waits on staging). A signed grid
// world on loopback (online-rig.mjs, this checkout's client and server) and two clients: a desktop page (Chromium 1280×800)
// that stays in Driftwood, and a phone page (402×874, pixel density 3, touch). It fails unless:
//   - the phone's pick of Sunscar Dunes seats it in Dunes (the desktop does not see it);
//   - a fresh pick of Driftwood inside the hold lands the phone in Driftwood with no page error, and the desktop sees it there
//     (the held Dunes seat moved, GO7; engine 9b23c7ac8);
//   - with the phone gone, the desktop still sees its held body at 4 minutes, and the phone back at 4 minutes lands where it left;
//   - gone again, the held body leaves the world between 295 and 320 seconds (HOLD_MS, 5 minutes, D1.5, Q44).
//   scripts/browser-lane.sh node scripts/seat-hold-proof.mjs <work dir> [--short]   (--short: hold checks at 20 s / 40 s, for a dry run)
import { execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { chromium, devices } from './browser-playwright.mjs';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';

// The rig's ports come from WS_RIG_PORTS when online-rig.mjs loads: this proof's own block, clear of other lanes' rigs.
process.env.WS_RIG_PORTS ??= '19576';
const { PLAY_FLAGS, RELEASE_PORT, enterPage, intoWorld, openRig } = await import('./online-rig.mjs');
const { enterZone } = await import('./zone-entry.mjs');
const ROOT = absolute(import.meta.dirname, '..');
const workArg = process.argv.slice(2).find(value => !value.startsWith('--')) ?? '';
if (workArg === '') throw new Error('usage: seat-hold-proof.mjs <work dir> [--short]');
const work = absolute(workArg), short = process.argv.includes('--short');
const HELD_AT = short ? 20_000 : 240_000, GONE_BY = short ? 40_000 : 320_000, GONE_AFTER = short ? 0 : 295_000;
const DUNES = 'sunscar-dunes', DRIFTWOOD = 'driftwood-isle';
const steps = /** @type {{ step: string, ok: boolean }[]} */ ([]);
/** @param {string} step @param {boolean} ok @param {unknown} [detail] */
const note = (step, ok, detail) => { steps.push({ step, ok }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}${detail === undefined ? '' : ` ${JSON.stringify(detail).slice(0, 400)}`}`); };
/** @param {number} ms */
const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });
const at = () => new Date().toISOString().slice(11, 19);

/** The level a page plays and where its player stands. @param {import('playwright').Page} page */
const whereIs = page => page.evaluate(() => {
  const shard = /** @type {any} */ (window).__wildshard, world = shard?.world;
  // A grid page plays `platform.grid`; the cell it stands in is the grid's `inside` (as grid-gate-proof reads it).
  return { level: String(shard?.shard?.grid?.state().inside ?? world?.game.level.id ?? ''), x: Number(world?.player.position.x ?? Number.NaN), z: Number(world?.player.position.z ?? Number.NaN) };
});
/** The names a page sees in its world. @param {import('playwright').Page} page */
const seen = page => page.evaluate(() => (/** @type {any} */ (window).__onlinePlayers?.() ?? []).map((/** @type {any} */ row) => String(row.name)));
/** Whether `name` is among the rows `page` sees. @param {import('playwright').Page} page @param {string} name */
const sees = async (page, name) => (await seen(page)).some((/** @type {string} */ row) => row.startsWith(name));
/** Poll until `test` holds or `ms` pass. @param {() => Promise<boolean>} test @param {number} ms */
async function until(test, ms) { const end = Date.now() + ms; for (;;) { if (await test()) return true; if (Date.now() > end) return false; await sleep(1000); } }
/** Walk the phone forward a moment, as its stick does. @param {import('playwright').Page} page */
async function walk(page) {
  await page.evaluate(() => { /** @type {any} */ (window).__wildshard.world.player.touchMove.y = 1; });
  await sleep(2500);
  await page.evaluate(() => { /** @type {any} */ (window).__wildshard.world.player.touchMove.y = 0; });
  await sleep(1500);
}
const noise = (/** @type {string} */ line) => /WebSocket connection|ERR_CONNECTION|Failed to load resource/u.test(line);

/** Build this checkout's client for the rig's signed release and open a grid world with Dunes and Driftwood. */
async function openWorld() {
  mkdirSync(work, { recursive: true });
  const dist = join(work, 'dist'), keyFile = join(work, 'fixture-key.json'), pair = generateKeyPairSync('ed25519');
  const key = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
  rmSync(keyFile, { force: true });
  writeFileSync(keyFile, JSON.stringify({ private: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), public: key }), { mode: 0o600, flag: 'wx' });
  const build = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const built = spawnSync('python3', ['scripts/heavy-lane.py', 'build', '--', process.execPath, 'scripts/build-app.mjs', '--outDir', dist], {
    cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, WS_BUILD_ID: build, WILDSHARD_RELEASE_URL: `http://127.0.0.1:${String(RELEASE_PORT)}/release.json`, WILDSHARD_RELEASE_KEY: key } });
  if (built.status !== 0) throw new Error(`the client build stopped (${String(built.status)})`);
  // claimFixture wants a new rig folder each run.
  rmSync(join(work, 'rig'), { recursive: true, force: true });
  try {
    return await openRig({ dist, work: join(work, 'rig'), keyFile, pgBin: 'pglite:', more: [DUNES], cells: 'grid', isolated: true });
  } finally { rmSync(keyFile, { force: true }); }
}

const rig = await openWorld(), url = (/** @type {string} */ slug) => ({ zone: slug, base: rig.base });
const browser = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
/** @type {typeof devices[string] & { screen?: { width: number, height: number } }} */
const { defaultBrowserType: _engine, ...phone } = devices['iPhone 16 Pro'];
let code = 1;
try {
  note('phone layout', phone.screen?.width === 402 && phone.screen?.height === 874 && phone.deviceScaleFactor === 3 && phone.hasTouch, phone.screen);
  const desk = await enterPage(browser, { viewport: { width: 1280, height: 800 } }, url(DRIFTWOOD), 'Desk');
  await intoWorld(desk.page);
  note('desktop plays Driftwood', (await whereIs(desk.page)).level.includes('driftwood'), await whereIs(desk.page));

  const hand = await enterPage(browser, phone, url(DUNES), 'Hand');
  await intoWorld(hand.page);
  const inDunes = await whereIs(hand.page);
  note('phone pick of Dunes plays Dunes', inDunes.level.includes('dunes'), inDunes);
  await sleep(5000);
  note('the desktop does not see the Dunes seat', !(await sees(desk.page, 'Hand')), await seen(desk.page));

  // A fresh title pick of Driftwood inside the Dunes hold: the one-shard page dials its own shard (NB2).
  hand.errors.length = 0;
  await enterZone(hand.page, { ...url(DRIFTWOOD), flags: PLAY_FLAGS });
  await intoWorld(hand.page);
  const moved = await whereIs(hand.page);
  note('the fresh Driftwood pick plays Driftwood', moved.level.includes('driftwood'), moved);
  note('the desktop sees the phone in Driftwood (the seat moved)', await until(() => sees(desk.page, 'Hand'), 20_000), await seen(desk.page));
  const pickErrors = hand.errors.filter(line => !noise(line));
  note('no page error on the pick', pickErrors.length === 0, pickErrors.slice(0, 4));

  await walk(hand.page);
  const left = await whereIs(hand.page);
  await hand.page.close();
  const gone = Date.now();
  console.log(`${at()} phone closed at ${JSON.stringify(left)}; held check in ${String(HELD_AT / 1000)} s`);
  await sleep(HELD_AT);
  note(`the desktop still sees the held body at ${String(HELD_AT / 1000)} s`, await sees(desk.page, 'Hand'), { seconds: (Date.now() - gone) / 1000 });
  const back = await hand.context.newPage();
  back.on('pageerror', error => { hand.errors.push(error.message.slice(0, 240)); });
  await enterZone(back, { ...url(DRIFTWOOD), flags: PLAY_FLAGS });
  await intoWorld(back);
  const returned = await whereIs(back);
  note('back inside the hold, the phone lands where it left', returned.level.includes('driftwood') && Math.hypot(returned.x - left.x, returned.z - left.z) < 1.5,
    { left, returned });

  await back.close();
  const again = Date.now();
  console.log(`${at()} phone closed again; watching the hold run out`);
  await sleep(GONE_AFTER);
  const stillAt = await sees(desk.page, 'Hand');
  note(`still held at ${String(GONE_AFTER / 1000)} s`, short || stillAt);
  const left2 = await until(async () => !(await sees(desk.page, 'Hand')), GONE_BY - GONE_AFTER);
  const heldFor = (Date.now() - again) / 1000;
  note('the held body leaves the world when the hold runs out', left2 && heldFor >= GONE_AFTER / 1000, { heldFor });
  const faults = [...desk.errors, ...hand.errors].filter(line => !noise(line));
  note('no page error', faults.length === 0, faults.slice(0, 6));
  code = steps.every(row => row.ok) ? 0 : 1;
} catch (error) {
  note('the proof stopped', false, String(error).slice(0, 400));
} finally {
  await browser.close();
  await rig.close();
}
console.log(code === 0 ? 'PASS' : 'FAIL');
process.exitCode = code;
