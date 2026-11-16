#!/usr/bin/env node
// ZONE-ENTRY ZE14 (J352): zone entry offline. One browser context visits Driftwood, Nalati and Driftwood again by their Shard Select
// cards while online (the service worker keeps what each read), then goes offline and boots Driftwood from Shard Select. Its west
// gate (Sunscar, never visited) shows "Not downloaded" in place of the count and never enters; its east gate (Nalati, visited)
// counts to 0 and enters Nalati, which reaches control as the new home. Every failed request after going offline is logged.
//   scripts/browser-lane.sh node scripts/zone-offline-proof.mjs --base=<loopback url> --out=<dir> [--device='iPhone 17 Pro'] [--engine=chromium|webkit]
// Loopback only: the walker is placed by the in-page harness pose (J205).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { chromium, devices, webkit } from 'playwright';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';

/** @param {string} name @param {string} fallback */
const flag = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const base = flag('base', '').replace(/\/$/u, ''), out = absolute(flag('out', '')), device = flag('device', ''), engineName = flag('engine', 'chromium');
if (!/^http:\/\/127\.0\.0\.1:\d+$/u.test(base) || out === absolute('')) throw new Error('usage: zone-offline-proof.mjs --base=<loopback url> --out=<dir>');
mkdirSync(out, { recursive: true });
const sleep = (/** @type {number} */ ms) => new Promise(resolve => { setTimeout(resolve, ms); });
const HALF = 250, PITCH = 562.5, WARM_MS = 25_000;
const tag = `${engineName}-${device === '' ? 'desk' : 'phone'}`;
const result = { base, device, engine: engineName, at: new Date().toISOString(), build: '', warm: /** @type {string[]} */ ([]), unvisited: /** @type {unknown} */ (null), visited: /** @type {unknown} */ (null),
  failed: /** @type {string[]} */ ([]), errors: /** @type {string[]} */ ([]), note: '' };
const browser = await (engineName === 'webkit' ? webkit : chromium).launch({ headless: true, args: engineName === 'chromium' ? [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] : [] });
let code = 1;
try {
  result.build = await fetch(`${base}/version.json`).then(async found => String((await found.json()).build)).catch(() => '');
  const phone = device === '' ? undefined : devices[device];
  if (device !== '' && phone === undefined) throw new Error(`No Playwright device ${device}`);
  const context = await browser.newContext(phone ?? { viewport: { width: 1280, height: 720 } });
  await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  await saveFixture(context, { scope: 'global', key: 'settings', merge: true, data: { volume: 0 } });
  /** Boot `card` from Shard Select in a new page and wait for control. @param {string} card */
  const boot = async card => {
    const page = await context.newPage();
    page.on('pageerror', error => { result.errors.push(`${card}: ${error.message.slice(0, 200)}`); });
    await page.goto(`${base}/?mute=1&nolock=1`, { waitUntil: 'load' });
    await page.locator('.ws-main-select').click({ timeout: 120_000 });
    if (await page.locator('#ws-name-box input').waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)) { await page.locator('#ws-name-box input').fill('offline'); await page.locator('#ws-name-box button[type=submit]').click(); }
    await page.locator('.ws-menu-card').first().waitFor({ state: 'visible', timeout: 30_000 });
    const index = await page.evaluate(name => [...document.querySelectorAll('.ws-menu-card')].findIndex(row => (row.textContent ?? '').includes(name)), card);
    if (index < 0) throw new Error(`No ${card} card`);
    await page.locator('.ws-menu-dots i').nth(index).click();
    await page.locator('.ws-menu-play').click();
    await page.waitForFunction(() => /** @type {any} */ (window).__wildshard?.shard?.grid?.state?.().live?.live?.gameplayReady === true, undefined, { timeout: 180_000, polling: 250 });
    await sleep(2000);
    await page.getByText('DONE', { exact: true }).click({ timeout: 2000 }).catch(() => undefined);
    return page;
  };
  // online: each visit stays a while, so its far ring and the service worker's copies settle
  for (const card of ['Driftwood Isle', 'Nalati Grasslands', 'Driftwood Isle']) {
    const page = await boot(card); await sleep(WARM_MS); result.warm.push(card); await page.close();
  }
  await context.setOffline(true);
  /** where the walk is when a read fails: boot, west (the unvisited gate), east (the visited gate and its entry) */
  let stage = 'boot';
  // the page's own failed reads (the service worker's network-first tries fail offline by design, then answer from its copy)
  context.on('requestfailed', request => {
    const url = request.url(); if (request.serviceWorker() !== null || /\/api\/(?:telemetry|errors)|version\.json/u.test(url)) return;
    result.failed.push(`${stage} ${request.failure()?.errorText ?? ''} ${url.replace(base, '')}`);
  });
  const page = await boot('Driftwood Isle');
  const state = () => page.evaluate(() => { const W = /** @type {any} */ (window), st = W.__wildshard.shard.grid.state(), wf = st.live?.live?.worldFeet ?? W.__wildshard.world.player.position;
    return { x: Number(wf.x.toFixed(2)), z: Number(wf.z.toFixed(2)), gate: st.gate ?? null, home: st.live?.live?.home ?? st.home ?? null, ready: st.live?.live?.gameplayReady === true,
      loading: document.querySelector('.ws-load[data-navigation]') !== null }; });
  const origin = await page.evaluate(() => { const W = /** @type {any} */ (window), wf = W.__wildshard.shard.grid.state().live.live.worldFeet, p = W.__wildshard.world.player.position; return { x: wf.x - p.x, z: wf.z - p.z }; });
  const face = (/** @type {number} */ yaw) => page.evaluate(wanted => { /** @type {any} */ (window).__wildshard.world.player.yaw = wanted; }, yaw);
  const walkTo = async (/** @type {number} */ x) => {
    for (const ends = Date.now() + 60_000; Date.now() < ends;) {
      const at = await state(); if (Math.abs(at.x - x) < 0.4) break;
      await face(Math.atan2(at.x - x, at.z - origin.z)); await page.keyboard.down('KeyW'); await sleep(Math.min(400, Math.abs(at.x - x) * 200)); await page.keyboard.up('KeyW');
    }
  };
  const place = (/** @type {number} */ dir) => page.evaluate(([px, pz]) => { const p = /** @type {any} */ (window).__wildshard.world.player; p.spawn(px, pz, p.yaw, 1.5); p.link?.place?.(p.position.x, p.position.y, p.position.z, p.yaw); }, [dir * (HALF - 20), 0]);
  // west: Sunscar's gate, a cell this context never entered. 2 m into its buffer for 8 s: the reason, never an entry
  stage = 'west'; await place(-1); await sleep(3000);
  const westEdge = origin.x - (PITCH - HALF);
  await walkTo(westEdge - 2);
  /** @type {unknown[]} */ const westCards = [];
  for (const ends = Date.now() + 8000; Date.now() < ends; await sleep(250)) westCards.push((await state()).gate);
  await page.screenshot({ path: join(out, `${tag}-unvisited-gate.png`) });
  const afterWest = await state();
  result.unvisited = { cards: [...new Set(westCards.map(gate => JSON.stringify(gate)))], home: afterWest.home, loading: afterWest.loading };
  await walkTo(westEdge + 8);
  // east: Nalati's gate, visited online. Stand on to 0: the entry, then control with Nalati the home
  stage = 'east'; await place(1); await sleep(3000);
  const eastEdge = origin.x + (PITCH - HALF);
  await walkTo(eastEdge + 2);
  const shown = (await state()).gate;
  await page.screenshot({ path: join(out, `${tag}-visited-gate.png`) });
  const entered = await page.waitForFunction(() => { const st = /** @type {any} */ (window).__wildshard?.shard?.grid?.state?.(); return st?.live?.live?.gameplayReady === true && (st.live.live.home ?? st.home) === 'nalati-grasslands'; },
    undefined, { timeout: 120_000, polling: 250 }).then(() => true).catch(() => false);
  stage = 'entered'; await sleep(1500);
  await page.screenshot({ path: join(out, `${tag}-visited-entered.png`) });
  result.visited = { gate: shown, entered, after: await state().catch(() => null) };
  const unvisited = /** @type {any} */ (result.unvisited), visited = /** @type {any} */ (result.visited);
  const reasonShown = unvisited.cards.some((/** @type {string} */ row) => row.includes('Not downloaded'));
  console.log(JSON.stringify({ unvisited, visited, failed: result.failed.length }));
  code = reasonShown && unvisited.home === 'driftwood-isle' && !unvisited.loading && visited.entered === true ? 0 : 1;
  await context.close();
} catch (error) { result.note = String(error).slice(0, 400); console.log(`FAIL ${result.note}`); }
finally {
  writeFileSync(join(out, `${tag}-zone-offline.json`), `${JSON.stringify(result, null, 2)}\n`);
  await browser.close();
}
process.exit(code);
