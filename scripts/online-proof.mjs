#!/usr/bin/env node
// E7.2d, E7.6: two real browsers in one world, on this Mac. It boots the built server from a signed file on real Postgres, opens two muted pages of a build
// stamped with that file, and fails unless each sees the other's body, Name, board and chat, and a reported line lands in `chat_report`.
// It starts nothing it does not stop, and it opens no port past loopback. Its key is made once for the build, and signs a file on 127.0.0.1 and nothing else.
// `--next=` is a second build of the same stamp: a real deploy under both pages, with its countdown, a stale tab reloading once, and everyone back in place.
//   scripts/browser-lane.sh node scripts/online-proof.mjs <app dist> <work dir> <key.json> <pg bin dir> <pg data dir> [--engine=chromium|webkit] [--next=<app dist>]
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { chromium, devices, webkit } from 'playwright';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';
import { enterPage, intoWorld, openRig } from './online-rig.mjs';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';

const [dist = '', work = '', keyFile = '', pgBin = '', pgData = ''] = process.argv.slice(2).filter(value => !value.startsWith('--'));
/** @param {string} name @param {string} fallback */
const flag = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const engine = flag('engine', 'chromium'), nextDist = flag('next', ''), seats = flag('seats', ''), SHARD = 'driftwood-isle', shots = join(work, 'shots');
mkdirSync(shots, { recursive: true });

/** @type {{ step: string, ok: boolean, detail?: unknown }[]} */
const steps = [];
/** @param {string} step @param {boolean} ok @param {unknown} [detail] */
const note = (step, ok, detail) => { steps.push({ step, ok, ...detail === undefined ? {} : { detail } }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}${detail === undefined ? '' : ` ${JSON.stringify(detail).slice(0, 300)}`}`); };

const rig = await openRig({ dist, nextDist, work, keyFile, pgBin, pgData, shard: SHARD, ...seats === '' ? {} : { seats: Number(seats) } }), { nextBuild, DATABASE } = rig;

const launched = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true, args: engine === 'webkit' ? [] : [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const { defaultBrowserType: _engine, ...phone } = devices['iPhone 16 Pro'];
/** @param {string} name */
const enter = async name => { const entered = await enterPage(launched, phone, `${rig.base}/?chunk=${SHARD}&mute=1&nolock=1&skipintro=1`, name); await intoWorld(entered.page); return entered; };
/** @param {import('playwright').Page} page */
const others = page => page.evaluate(() => window.__onlinePlayers?.() ?? []);
/** @param {import('playwright').Page} page @param {(rows: readonly { name: string, gait: string, board: boolean, x: number, z: number, modelled: boolean, held: number }[]) => boolean} seen @param {string} step */
const seeing = async (page, seen, step) => { for (let tries = 0; tries < 80; tries++) { const rows = await others(page); if (seen(rows)) { note(step, true, rows); return rows; } await page.waitForTimeout(250); } note(step, false, await others(page)); return []; };
let code = 1, opened = /** @type {Awaited<ReturnType<typeof enter>>[]} */ ([]);
try {
  const jake = await enter('Jake'), matt = await enter('Matt');
  opened = [jake, matt];
  note('both pages hold a seat', true, { jake: await jake.page.evaluate(() => (/** @type {NonNullable<typeof window.__workerClient>} */ (window.__workerClient))().own), matt: await matt.page.evaluate(() => (/** @type {NonNullable<typeof window.__workerClient>} */ (window.__workerClient))().own) });
  await seeing(jake.page, rows => rows.some(row => row.name === 'Matt' && row.modelled), 'Jake sees Matt\'s body and Name');
  await seeing(matt.page, rows => rows.some(row => row.name === 'Jake' && row.modelled), 'Matt sees Jake\'s body and Name');
  await jake.page.screenshot({ path: join(shots, '1-jake-sees-matt.png') });
  await matt.page.keyboard.down('KeyW');
  await seeing(jake.page, rows => rows.some(row => row.name === 'Matt' && row.gait !== 'idle'), 'Matt walks, and Jake sees the gait');
  await jake.page.waitForTimeout(1600);
  await jake.page.screenshot({ path: join(shots, '2-jake-sees-matt-walk.png') });
  await jake.page.waitForTimeout(170);
  await jake.page.screenshot({ path: join(shots, '2b-jake-sees-matt-walk.png') });
  await matt.page.keyboard.up('KeyW');
  // Side on: Matt turns across Jake's view, and Jake watches his legs.
  await matt.page.evaluate(() => { (/** @type {NonNullable<typeof window.__wildshard.world>} */ (window.__wildshard.world)).player.yaw = Math.PI / 2; });
  await matt.page.keyboard.down('KeyW');
  await jake.page.waitForTimeout(150);
  for (const frame of ['a', 'b', 'c']) { await jake.page.screenshot({ path: join(shots, `2c-side-${frame}.png`) }); await jake.page.waitForTimeout(40); }
  // At a run, back along the open pier: a side-on walk can end against a post, and a body that has stopped shows no gait. Over 5 m/s the gait says so, and the stride lengthens.
  await matt.page.evaluate(() => { (/** @type {NonNullable<typeof window.__wildshard.world>} */ (window.__wildshard.world)).player.yaw = Math.PI; });
  await matt.page.keyboard.down('ShiftLeft');
  await seeing(jake.page, rows => rows.some(row => row.name === 'Matt' && row.gait === 'run'), 'Matt runs, and Jake sees the run');
  for (const frame of ['a', 'b', 'c']) { await jake.page.screenshot({ path: join(shots, `2d-run-${frame}.png`) }); await jake.page.waitForTimeout(40); }
  await matt.page.keyboard.up('ShiftLeft');
  await matt.page.keyboard.up('KeyW');
  await matt.page.evaluate(() => { (/** @type {NonNullable<typeof window.__wildshard.world>} */ (window.__wildshard.world)).player.yaw = Math.PI; });
  await matt.page.keyboard.press('KeyH');
  await seeing(jake.page, rows => rows.some(row => row.name === 'Matt' && row.board), 'Matt boards, and Jake sees the board');
  await jake.page.waitForTimeout(800);
  await jake.page.screenshot({ path: join(shots, '3-jake-sees-the-board.png') });
  await matt.page.keyboard.press('KeyH');
  await matt.page.locator('#ws-chat input').fill('hello from England');
  await matt.page.locator('#ws-chat input').press('Enter');
  await jake.page.locator('#ws-chat', { hasText: 'Matt: hello from England' }).waitFor({ timeout: 10_000 });
  await matt.page.locator('#ws-chat', { hasText: 'Matt: hello from England' }).waitFor({ timeout: 10_000 });
  note('both see the line', true);
  await jake.page.screenshot({ path: join(shots, '4-jake-sees-the-line.png') });
  await jake.page.locator('#ws-chat button', { hasText: 'Report' }).first().click();
  const saves = new Client({ connectionString: DATABASE });
  await saves.connect();
  let reported = [];
  for (let tries = 0; tries < 40 && reported.length === 0; tries++) { reported = (await saves.query('select name, shown, shard from chat_report')).rows; await jake.page.waitForTimeout(250); }
  await saves.end();
  note('the reported line is in chat_report', reported.length === 1 && reported[0].name === 'Matt' && reported[0].shown === 'hello from England', reported);
  // The strips, on a server that goes away and comes back: this is E7.5's restart on two pages. A socket that won't connect is the browser's own console line.
  const before = await matt.page.evaluate(() => ({ x: (/** @type {NonNullable<typeof window.__workerClient>} */ (window.__workerClient))().serverX, z: (/** @type {NonNullable<typeof window.__workerClient>} */ (window.__workerClient))().serverZ }));
  await rig.stop();
  // FM4: the banner names the cause (Reconnecting, or Restarting for a server that says so)
  await jake.page.locator('#ws-reconnect-strip').waitFor({ state: 'visible', timeout: 8000 });
  await jake.page.screenshot({ path: join(shots, '5-the-strip.png') });
  note('the banner says the link is down', true, { said: await jake.page.locator('#ws-reconnect-strip').textContent() });
  rig.start();
  await jake.page.locator('#ws-reconnect-strip').waitFor({ state: 'hidden', timeout: 30_000 });
  await seeing(jake.page, rows => rows.some(row => row.name === 'Matt' && row.modelled), 'the strip clears, and Jake sees Matt again');
  const after = await matt.page.evaluate(() => ({ x: (/** @type {NonNullable<typeof window.__workerClient>} */ (window.__workerClient))().serverX, z: (/** @type {NonNullable<typeof window.__workerClient>} */ (window.__workerClient))().serverZ }));
  note('Matt is back where he stood', Math.hypot(after.x - before.x, after.z - before.z) < 2, { before, after });
  if (nextBuild !== '') {
    const at = await matt.page.evaluate(() => ({ x: (/** @type {NonNullable<typeof window.__workerClient>} */ (window.__workerClient))().serverX, z: (/** @type {NonNullable<typeof window.__workerClient>} */ (window.__workerClient))().serverZ }));
    rig.publish(2, nextBuild);
    await jake.page.locator('#ws-countdown-strip', { hasText: 'World update' }).waitFor({ timeout: 15_000 });
    await jake.page.screenshot({ path: join(shots, '6-the-countdown.png') });
    note('the countdown shows, and play goes on', await jake.page.evaluate(() => (/** @type {NonNullable<typeof window.__workerClient>} */ (window.__workerClient))().closed === null));
    await rig.pagesServe(nextDist);
    await rig.drained();
    rig.start(nextBuild);
    /** @param {import('playwright').Page} page */
    const landed = async page => { await page.waitForFunction(wanted => (/** @type {typeof globalThis & { __WS_BUILD_ID__?: string }} */ (globalThis)).__WS_BUILD_ID__ === wanted && typeof window.__workerClient === 'function' && window.__wildshard?.world?.player !== undefined, nextBuild, { timeout: 120_000 }); await page.evaluate(FLOOR_GRID_ENTER); await page.waitForFunction(() => (/** @type {NonNullable<typeof window.__workerClient>} */ (window.__workerClient))().own !== null && (/** @type {NonNullable<typeof window.__workerClient>} */ (window.__workerClient))().frames > 30, undefined, { timeout: 60_000 }); };
    await Promise.all([landed(jake.page), landed(matt.page)]);
    note('both stale tabs reloaded into the server\'s build', true, { build: nextBuild });
    note('the Name stayed with the device, so no box asked twice', await jake.page.locator('#ws-name-box').count() === 0);
    await seeing(jake.page, rows => rows.some(row => row.name === 'Matt' && row.modelled), 'Jake sees Matt on the new build');
    const back = await matt.page.evaluate(() => ({ x: (/** @type {NonNullable<typeof window.__workerClient>} */ (window.__workerClient))().serverX, z: (/** @type {NonNullable<typeof window.__workerClient>} */ (window.__workerClient))().serverZ }));
    note('Matt landed where he stood', Math.hypot(back.x - at.x, back.z - at.z) < 2, { at, back });
    await jake.page.screenshot({ path: join(shots, '7-after-the-deploy.png') });
  }
  if (seats !== '') {
    // J178: a full world turns the next page away, and lets it in when a seat frees: a held seat lasts J114's 30 s, and the page tries each 30 s.
    const ann = await enterPage(launched, phone, `${rig.base}/?chunk=${SHARD}&mute=1&nolock=1&skipintro=1`, 'Ann');
    await ann.page.locator('[data-failmode="full"]').waitFor({ timeout: 90_000 });
    note('the third page is told World is full', true);
    await ann.page.waitForTimeout(1500);
    await ann.page.screenshot({ path: join(shots, '8-world-is-full.png') });
    note('no body came in with it', (await others(jake.page)).every(row => row.name !== 'Ann'));
    const leaving = Date.now();
    await matt.context.close();
    opened = [jake, ann];
    await ann.page.locator('[data-failmode="full"]').waitFor({ state: 'detached', timeout: 75_000 });
    await intoWorld(ann.page);
    note('a seat frees, and the page comes in by itself', true, { seconds: Math.round((Date.now() - leaving) / 1000) });
    await seeing(jake.page, rows => rows.some(row => row.name === 'Ann' && row.modelled), 'Jake sees Ann');
    await ann.context.close();
  }
  /** @param {string} line */
  const quiet = line => !/WebSocket connection|ERR_CONNECTION|Failed to load resource/u.test(line), faults = [...jake.errors, ...matt.errors].filter(quiet);
  note('no page error', faults.length === 0, faults.slice(0, 6));
  code = steps.every(row => row.ok) ? 0 : 1;
} catch (error) {
  note('the proof stopped', false, String(error).slice(0, 400));
  for (const { page, errors } of opened) {
    const said = await page.evaluate(async () => {
      const found = await navigator.serviceWorker?.getRegistration(), state = (/** @type {ServiceWorker | null | undefined} */ worker) => worker === null || worker === undefined ? null : worker.state;
      return { build: (/** @type {typeof globalThis & { __WS_BUILD_ID__?: string }} */ (globalThis)).__WS_BUILD_ID__, navigation: (/** @type {PerformanceNavigationTiming | undefined} */ (performance.getEntriesByType('navigation')[0]))?.type, shown: document.body.textContent?.slice(0, 120), controller: navigator.serviceWorker?.controller?.state ?? null, installing: state(found?.installing), waiting: state(found?.waiting), active: state(found?.active), session: Object.keys(sessionStorage), lastEnd: Object.entries(localStorage).filter(([name]) => /unload|end/iu.test(name)).map(row => row.join('=').slice(0, 160)) };
    }).catch(String);
    note('what the page says', false, { said, errors: errors.slice(-6) }); writeFileSync(join(work, 'stopped.json'), JSON.stringify({ said, errors }, null, 1));
    await page.screenshot({ path: join(shots, `stopped-${String(opened.findIndex(row => row.page === page))}.png`) }).catch(() => undefined);
  }
} finally {
  await launched.close();
  await rig.close();
}
console.log(code === 0 ? 'PASS' : 'FAIL');
if (!existsSync(shots)) console.log('no shots');
process.exit(code);
